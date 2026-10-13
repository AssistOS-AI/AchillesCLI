import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { SOCKET_PATHS, connectProbe, processIdentity } from './live-sessions-process-probe.mjs';

export const PLAN_FILE = '.p3-spike-plan.json';
const inside = (root, value) => value === root || value.startsWith(root === '/' ? '/' : `${root}/`);
const unescapeMount = value => value.replace(/\\([0-7]{3})/g, (_, digits) => String.fromCharCode(parseInt(digits, 8)));

export function parseMountInfo(text) {
    return text.trim().split('\n').filter(Boolean).map(line => {
        const fields = line.split(' ');
        const separator = fields.indexOf('-');
        assert.ok(separator >= 6, 'Malformed mountinfo');
        return { id: fields[0], parent: fields[1], device: fields[2], root: unescapeMount(fields[3]),
            target: unescapeMount(fields[4]), options: fields[5], type: fields[separator + 1] };
    });
}

export function captureGrants(args) {
    const grants = [];
    for (let i = 0; i < args.length && args[i] !== '--'; i++) {
        if (['--bind', '--ro-bind', '--dev-bind'].includes(args[i])) {
            grants.push({ source: args[++i], target: args[++i], permission: args[i - 2] === '--ro-bind' ? 'ro' : 'rw', kind: 'bind' });
        } else if (['--tmpfs', '--dev', '--proc'].includes(args[i])) {
            grants.push({ kind: args[i].slice(2), target: args[++i], permission: 'private' });
        } else if (args[i] === '--symlink') {
            grants.push({ kind: 'symlink', source: args[++i], target: args[++i], permission: 'link' });
        }
    }
    assert.ok(grants.some(grant => grant.kind === 'dev' && grant.target === '/dev'), 'Missing actual ALA /dev isolation');
    assert.ok(grants.some(grant => grant.kind === 'tmpfs' && grant.target === '/tmp'), 'Missing actual ALA /tmp isolation');
    return grants;
}

export function aliasesFor(socketPath, grants, mounts, realpath = value => fs.realpathSync(value)) {
    const coordinate = value => {
        const actual = realpath(value);
        const mount = mounts.filter(entry => inside(entry.target, actual)).sort((a, b) => b.target.length - a.target.length)[0];
        assert.ok(mount, 'Missing mount source identity');
        return { device: mount.device, file: path.posix.join(mount.root, path.posix.relative(mount.target, actual)) };
    };
    const socket = coordinate(socketPath);
    const aliases = new Set([socketPath, realpath(socketPath)]);
    for (const grant of grants.filter(entry => entry.kind === 'bind')) {
        const grantSource = realpath(grant.source);
        // Recursive bind grants also project nested mounts, including /data's
        // workspace alias; looking only at the grant root misses those paths.
        const projected = [grantSource, ...mounts.filter(mount => inside(grantSource, mount.target)).map(mount => mount.target)];
        for (const projectedSource of projected) {
            const source = coordinate(projectedSource);
            if (source.device === socket.device && inside(source.file, socket.file)) {
                const target = path.posix.join(grant.target, path.posix.relative(grantSource, projectedSource));
                aliases.add(path.posix.join(target, path.posix.relative(source.file, socket.file)));
            }
        }
    }
    // Include paths created through bwrap's explicit symlinks as well.
    for (let pass = 0; pass < grants.length; pass++) {
        const size = aliases.size;
        for (const link of grants.filter(entry => entry.kind === 'symlink')) {
            const source = path.posix.resolve(path.posix.dirname(link.target), link.source);
            for (const alias of [...aliases]) if (inside(source, alias)) aliases.add(path.posix.join(link.target, path.posix.relative(source, alias)));
        }
        if (aliases.size === size) break;
        assert.ok(aliases.size < 256, 'Alias expansion limit exceeded');
    }
    return [...aliases].sort();
}

export async function runAlaCapture() {
    assert.equal(process.platform, 'linux', 'Real sandbox spike requires Linux');
    const { resolveAlaInstallation } = await import('../../copilot/src/lib/execution/alaInstallation.mjs');
    const installation = await resolveAlaInstallation();
    const cwdIndex = process.argv.indexOf('--cwd');
    assert.ok(cwdIndex > 0);
    const cwd = fs.realpathSync(process.argv[cwdIndex + 1]);
    const original = childProcess.spawn;
    let captures = 0;
    childProcess.spawn = function (command, args, options) {
        if (path.basename(String(command)) === 'bwrap' && args.includes('--input-format') && args.includes('stream-json')) {
            const grants = captureGrants(args);
            const hostMounts = parseMountInfo(fs.readFileSync('/proc/self/mountinfo', 'utf8'));
            const sockets = SOCKET_PATHS.map(socketPath => ({ socketPath, realpath: fs.realpathSync(socketPath),
                aliases: aliasesFor(socketPath, grants, hostMounts) }));
            const plan = { version: 1, kind: 'actual-bwrap-spawn', capturePid: process.pid, grants, sockets,
                wrapperSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex') };
            fs.writeFileSync(path.join(cwd, PLAN_FILE), JSON.stringify(plan), { flag: 'wx', mode: 0o600 });
            captures++;
        }
        return Reflect.apply(original, this, [command, args, options]);
    };
    syncBuiltinESMExports();
    try {
        const { runCli } = await import(pathToFileURL(path.join(installation.packageRoot, 'src/cli.mjs')).href);
        const code = await runCli();
        assert.equal(captures, 1, 'Exactly one real backend bwrap spawn must be observed');
        process.exitCode = code;
    } finally {
        childProcess.spawn = original;
        syncBuiltinESMExports();
    }
}

export async function runSandboxProbe(robotName, workingDir) {
    assert.equal(process.platform, 'linux', 'Real sandbox spike requires Linux');
    assert.match(robotName, /^p3-spike-[a-z0-9-]+$/, 'Select a dedicated diagnostic robot');
    const workspaceRoot = await fsp.realpath(process.env.PLOINKY_WORKSPACE_ROOT);
    const cwd = await fsp.realpath(workingDir);
    assert.ok(cwd !== workspaceRoot && inside(workspaceRoot, cwd), 'Diagnostic cwd must be inside the selected workspace');
    assert.equal((await fsp.readdir(cwd)).length, 0, 'Use an empty task-owned diagnostic cwd');
    const { prepareCopilotContext } = await import('../../server/copilot-context.mjs');
    const context = await prepareCopilotContext(robotName, { prepareTools: false, holdUsage: true });
    const savedClaude = process.env.CLAUDE_BIN;
    const savedHuman = process.env.ROBOTEAM_HUMAN_INPUT_DIRECTORY;
    let engine, human;
    try {
        const { createHumanInputChannel } = await import('../../server/human-input-channel.mjs');
        human = await createHumanInputChannel({ request() { throw new Error('Diagnostic callback must not be called'); }, stop() {} });
        process.env.ROBOTEAM_HUMAN_INPUT_DIRECTORY = human.directory;
        process.env.CLAUDE_BIN = fileURLToPath(new URL('./live-sessions-probe-claude.mjs', import.meta.url));
        const { resolveAlaInstallation } = await import('../../copilot/src/lib/execution/alaInstallation.mjs');
        const { ConversationSessionStore } = await import('../../copilot/src/lib/storage/conversationSessionStore.mjs');
        const { createRobotSkillCatalog } = await import('../../copilot/src/lib/skills/robotSkillCatalog.mjs');
        const { createAlaEngine } = await import('../../copilot/src/lib/execution/alaEngine.mjs');
        const installation = await resolveAlaInstallation();
        const store = new ConversationSessionStore({ workingDir: cwd });
        const session = await store.createSession();
        const catalog = createRobotSkillCatalog({ context, sessionStore: store, workingDir: cwd,
            initialSessionId: session.sessionId, workflowExecution: true, workflowSkills: true });
        engine = createAlaEngine({ workingDir: cwd, sessionStore: store, skillCatalog: catalog,
            installation: { ...installation, entryPath: fileURLToPath(import.meta.url) },
            execution: { robotId: context.robot.id, backend: 'claude', workflowExecution: true } });
        const identity = await processIdentity();
        const before = await Promise.all(SOCKET_PATHS.map(socketPath => connectProbe(socketPath, identity)));
        const result = await engine.executeTurn({ sessionId: session.sessionId, prompt: 'Run the fixed isolation diagnostic.' });
        const observed = JSON.parse(result.outputText);
        assert.equal(observed.kind, 'sandbox-socket-probe');
        assert.match(observed.mountNamespace, /^mnt:\[\d+\]$/);
        assert.notEqual(observed.mountNamespace, identity.mountNamespace, 'Backend must execute in a distinct mount namespace');
        assert.ok(observed.mounts.length > 0, 'Sandbox mountinfo must be observed');
        const plan = JSON.parse(await fsp.readFile(path.join(cwd, PLAN_FILE), 'utf8'));
        assert.equal(plan.kind, 'actual-bwrap-spawn');
        for (const target of ['ploinky-runtime', 'roboflow-human-input', 'roboteam-task-failure', 'report-task-blocked']) {
            assert.ok(plan.grants.some(grant => grant.target === `/workspace/${target}`), `Missing production ${target} grant`);
        }
        assert.ok(plan.grants.some(grant => grant.target.endsWith('/.agents/skills')), 'Missing production skill overlay');
        const aliases = [...new Set(plan.sockets.flatMap(entry => entry.aliases))].sort();
        assert.deepEqual(observed.results.map(entry => entry.path).sort(), aliases);
        for (const entry of observed.results) assert.equal(entry.error, 'ENOENT', 'Every socket alias must be absent inside ALA');
        const after = await Promise.all(before.map(entry => connectProbe(entry.socketPath, identity, entry.incarnationDigest)));
        return { kind: 'sandbox-spike', status: 'passed', before, after, plan, observed,
            backendSha256: createHash('sha256').update(await fsp.readFile(process.env.CLAUDE_BIN)).digest('hex'),
            limitation: 'Trusted controls here run in harness; actual Ploinky CLI before/after controls are separately required.' };
    } finally {
        await engine?.close();
        await human?.close();
        await context.releaseUsage?.();
        if (savedClaude === undefined) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = savedClaude;
        if (savedHuman === undefined) delete process.env.ROBOTEAM_HUMAN_INPUT_DIRECTORY; else process.env.ROBOTEAM_HUMAN_INPUT_DIRECTORY = savedHuman;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        if (process.argv.includes('--home')) await runAlaCapture();
        else {
            assert.equal(process.argv.length, 4, 'Usage: node live-sessions-sandbox.mjs p3-spike-ROBOT /absolute/empty/cwd');
            console.log(JSON.stringify(await runSandboxProbe(process.argv[2], process.argv[3])));
        }
    } catch (error) {
        console.error(JSON.stringify({ kind: 'sandbox-spike', status: 'failed', code: error.code || error.name,
            frames: String(error.stack || '').split('\n').filter(line => /^\s+at /.test(line)) }));
        process.exitCode = 1;
    }
}
