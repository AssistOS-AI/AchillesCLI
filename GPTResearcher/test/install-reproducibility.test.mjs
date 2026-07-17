import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
    access,
    appendFile,
    chmod,
    copyFile,
    mkdtemp,
    mkdir,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.resolve(TEST_DIR, '..');
const INSTALLER_PATH = path.join(AGENT_DIR, 'scripts', 'install-gpt-researcher.sh');
const APP_LOCK_PATH = path.join(AGENT_DIR, 'scripts', 'gpt-researcher-requirements.lock');
const BOOTSTRAP_LOCK_PATH = path.join(AGENT_DIR, 'scripts', 'gpt-researcher-bootstrap.lock');
const APP_INPUT_PATH = path.join(AGENT_DIR, 'scripts', 'gpt-researcher-requirements.in');
const SOURCE_COMMIT = '5cdad9cb434754188b78bd998df18dd8d502cf7e';
const SOURCE_REQUIREMENTS_SHA256 = 'f8c36b147c9f53d96bd20f41df303943889ac90323603285fafe97dcc9a84b60';
const APP_LOCK_SHA256 = '3c81338133667f49c3c7366b36c943f9e456663faa27eb3486bf8fd7bf08f6bb';
const BOOTSTRAP_LOCK_SHA256 = '4e5068e06240daf19cf2ca08370a5413e5af634d3a3cb70198cfe4b0b9289386';
const DEFAULT_ENVIRONMENT_DIGEST = 'a'.repeat(64);

const UPSTREAM_REQUIREMENTS = `# GPT-Researcher Direct Dependencies
# Python 3.10+ required for LangChain v1

# Core Framework
fastapi>=0.104.1
uvicorn>=0.24.0.post1
pydantic>=2.5.1
python-dotenv>=1.0.0

# LangChain v1
langchain>=1.0.0
langchain-classic>=1.0.0
langchain-community>=0.4.0
langchain-core>=1.0.0
langchain-ollama>=1.0.0
langchain-openai>=1.0.0
langchain-text-splitters>=1.0.0
langgraph>=0.2.76

# LLM Providers
openai>=1.3.3
ollama>=0.4.8
litellm>=1.71.0
google-genai>=1.0.0  # For image generation with Imagen

# Search & Research
tavily-python>=0.7.12
ddgs>=9.0.0
arxiv>=2.0.0

# Document Processing
beautifulsoup4>=4.12.2
pymupdf>=1.23.6
python-docx>=1.1.0
python-pptx>=1.0.0
unstructured>=0.13
lxml>=4.9.2
pandas>=2.0.0

# Vector Store & Embeddings
tiktoken>=0.7.0
numpy>=2.0.0,<2.3.0

# Utilities
aiofiles>=23.2.1
httpx>=0.28.1
websockets>=13.1
requests>=2.31.0
pyyaml>=6.0.1
jinja2>=3.1.6
loguru>=0.7.2
colorama>=0.4.6

# Output Formats
md2pdf>=1.0.1
mistune>=3.0.2
htmldocx>=0.0.6

# MCP Support (optional)
mcp>=1.9.1
langchain-mcp-adapters>=0.1.0

# Data Handling
sqlalchemy>=2.0.28
python-multipart>=0.0.6
json-repair>=0.29.8
json5>=0.9.25
markdown>=3.5.1

`;

function sha256(payload) {
    return createHash('sha256').update(payload).digest('hex');
}

function gitBlobOid(payload) {
    const bytes = Buffer.from(payload);
    return createHash('sha1')
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest('hex');
}

function shellQuote(value) {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

function resultOutput(result) {
    return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function requirementBlocks(lock) {
    const lines = lock.split('\n');
    const blocks = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*==/.test(lines[index])) {
            continue;
        }
        const block = [lines[index]];
        while (block.at(-1).trimEnd().endsWith('\\')) {
            index += 1;
            assert.ok(index < lines.length, 'lock requirement continuation must terminate');
            block.push(lines[index]);
        }
        blocks.push(block.join('\n'));
    }
    return blocks;
}

test('dependency locks pin and hash the complete supported graph', async () => {
    const [appLock, bootstrapLock, appInput] = await Promise.all([
        readFile(APP_LOCK_PATH, 'utf8'),
        readFile(BOOTSTRAP_LOCK_PATH, 'utf8'),
        readFile(APP_INPUT_PATH, 'utf8'),
    ]);

    assert.equal(sha256(appLock), APP_LOCK_SHA256);
    assert.equal(sha256(bootstrapLock), BOOTSTRAP_LOCK_SHA256);

    const appRequirements = requirementBlocks(appLock);
    const bootstrapRequirements = requirementBlocks(bootstrapLock);
    assert.equal(appRequirements.length, 196);
    assert.equal(bootstrapRequirements.length, 3);
    for (const requirement of [...appRequirements, ...bootstrapRequirements]) {
        assert.match(requirement, /^[A-Za-z0-9][A-Za-z0-9._-]*==[^\s\\]+/);
        assert.match(requirement, /--hash=sha256:[0-9a-f]{64}/);
    }

    assert.match(appLock, /^gpt-researcher==0\.15\.1 /m);
    assert.match(appLock, /^langchain-mcp-adapters==0\.3\.0 /m);
    assert.match(appLock, /^ddgs==9\.14\.4 /m);
    assert.doesNotMatch(appLock, /^(?!#).*?(?:>=|~=)/m);
    assert.match(appInput, new RegExp(SOURCE_COMMIT));
    assert.match(appInput, new RegExp(SOURCE_REQUIREMENTS_SHA256));
    assert.match(appInput, /x86_64-manylinux_2_36/);
    assert.match(appInput, /aarch64-manylinux_2_36/);
    assert.match(appInput, /--exclude-newer 2026-07-15T00:00:00Z/);
});

test('isolated environment inventory rejects unowned startup files', async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gpt-researcher-inventory-'));
    t.after(() => rm(root, { recursive: true, force: true }));

    const venv = path.join(root, 'venv');
    const createVenv = spawnSync('python3', ['-m', 'venv', venv], { encoding: 'utf8' });
    assert.equal(createVenv.status, 0, resultOutput(createVenv));

    const venvPython = path.join(venv, 'bin', 'python');
    const siteProbe = spawnSync(
        venvPython,
        ['-I', '-S', '-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'],
        { encoding: 'utf8' },
    );
    assert.equal(siteProbe.status, 0, resultOutput(siteProbe));
    const sitePackages = siteProbe.stdout.trim();
    const runtimePolicy = path.join(sitePackages, 'ploinky_gpt_researcher_v5.pth');
    await writeFile(runtimePolicy, 'import sys; sys.dont_write_bytecode = True\n');

    const installer = await readFile(INSTALLER_PATH, 'utf8');
    const digestSource = installer.match(/environment_digest\(\) \{[\s\S]*?<<'PY'\n([\s\S]*?)\nPY\n\}/)?.[1];
    assert.ok(digestSource, 'environment digest implementation must remain executable as an isolated probe');

    const probe = () => spawnSync(venvPython, ['-I', '-S', '-'], {
        encoding: 'utf8',
        env: {
            ...process.env,
            PLOINKY_RUNTIME_POLICY_FILE: runtimePolicy,
            PLOINKY_SITE_PACKAGES: sitePackages,
        },
        input: `${digestSource}\n`,
    });
    const clean = probe();
    assert.equal(clean.status, 0, resultOutput(clean));
    assert.match(clean.stdout.trim(), /^[0-9a-f]{64}$/);

    const unexpectedStartup = path.join(sitePackages, 'unexpected-startup.pth');
    await writeFile(unexpectedStartup, 'import os\n');
    const tampered = probe();
    assert.notEqual(tampered.status, 0);
    assert.match(resultOutput(tampered), /unowned installed file: .*unexpected-startup\.pth/);
});

async function makeHarness(t) {
    assert.equal(sha256(UPSTREAM_REQUIREMENTS), SOURCE_REQUIREMENTS_SHA256);

    const root = await mkdtemp(path.join(os.tmpdir(), 'gpt-researcher-install-'));
    t.after(async () => {
        spawnSync('chmod', ['-R', 'u+w', root]);
        await rm(root, { recursive: true, force: true });
    });

    const paths = {
        root,
        app: path.join(root, 'app'),
        venv: path.join(root, 'venv'),
        bin: path.join(root, 'bin'),
        home: path.join(root, 'home'),
        workspace: path.join(root, 'workspace'),
        installer: path.join(root, 'install.sh'),
        appLock: path.join(root, 'requirements.lock'),
        bootstrapLock: path.join(root, 'bootstrap.lock'),
        sourceRequirements: path.join(root, 'upstream-requirements.txt'),
        environmentDigest: path.join(root, 'environment-digest'),
        commandLog: path.join(root, 'commands.log'),
        failPipCheck: path.join(root, 'fail-pip-check'),
    };

    await mkdir(paths.bin);
    await Promise.all([
        copyFile(APP_LOCK_PATH, paths.appLock),
        copyFile(BOOTSTRAP_LOCK_PATH, paths.bootstrapLock),
        writeFile(paths.sourceRequirements, UPSTREAM_REQUIREMENTS),
        writeFile(paths.environmentDigest, `${DEFAULT_ENVIRONMENT_DIGEST}\n`),
        writeFile(paths.commandLog, ''),
    ]);

    const fakePython = `#!/bin/sh
set -eu
if [ "$#" -ge 4 ] && [ "$1" = "-I" ] && [ "$2" = "-m" ] && [ "$3" = "venv" ]; then
    mkdir -p "$4/bin" "$4/lib/python3.11/site-packages"
    ln -s python3 "$4/bin/python"
    ln -s "$0" "$4/bin/python3"
    ln -s python3 "$4/bin/python3.11"
    printf '%s\n' \
        "home = $(dirname "$0")" \
        'include-system-site-packages = false' \
        'version = 3.11.2' \
        "executable = $0" \
        "command = $0 -m venv $4" > "$4/pyvenv.cfg"
    exit 0
fi
if [ "$#" -ge 4 ] && [ "$1" = "-I" ] && [ "$2" = "-S" ] && [ "$3" = "-c" ]; then
    printf '%s\\n' "$FAKE_RUNTIME"
    exit 0
fi
if [ "$#" -ge 5 ] && [ "$1" = "-I" ] && [ "$2" = "-S" ] && [ "$3" = "-" ]; then
    exec "$REAL_PYTHON" "$@"
fi
if [ "$#" -ge 3 ] && [ "$1" = "-I" ] && [ "$2" = "-S" ] && [ "$3" = "-" ]; then
    cat >/dev/null
    cat "$ENV_DIGEST_FILE"
    exit 0
fi
if [ "$#" -ge 6 ] && [ "$1" = "-I" ] && [ "$2" = "-B" ] && [ "$3" = "-m" ] && [ "$4" = "pip" ] && [ "$5" = "--isolated" ]; then
    printf '%s\\n' "$*" >> "$COMMAND_LOG"
    if [ "$6" = "check" ] && [ -e "$FAIL_PIP_CHECK_FILE" ]; then
        printf '%s\\n' 'simulated pip check failure' >&2
        exit 1
    fi
    exit 0
fi
printf '%s\\n' "unexpected fake python invocation: $*" >&2
exit 64
`;

    const fakeGit = `#!/bin/sh
set -eu
[ "$#" -ge 3 ] && [ "$1" = "-C" ]
repo=$2
shift 2
command=$1
case "$command" in
    init)
        mkdir -p "$repo/.git"
        cp "$SOURCE_REQUIREMENTS_FIXTURE" "$repo/requirements.txt"
        printf '%s\\n' immutable > "$repo/tracked.py"
        ;;
    remote)
        if [ "$#" -ge 4 ] && [ "$2" = "add" ]; then
            printf '%s\\n' "$4" > "$repo/.git/origin"
        elif [ "$#" -ge 3 ] && [ "$2" = "get-url" ]; then
            cat "$repo/.git/origin"
        else
            exit 64
        fi
        ;;
    fetch)
        printf '%s\\n' "$*" >> "$COMMAND_LOG"
        ;;
    checkout)
        printf '%s\\n' "$SOURCE_COMMIT" > "$repo/.git/head"
        ;;
    rev-parse)
        cat "$repo/.git/head"
        ;;
    cat-file)
        [ -f "$repo/.git/head" ]
        ;;
    fsck)
        [ -f "$repo/.git/head" ]
        ;;
    ls-tree)
        printf '100644 blob %s\\trequirements.txt\\0' "$FAKE_REQUIREMENTS_GIT_OID"
        printf '100644 blob %s\\ttracked.py\\0' "$FAKE_TRACKED_GIT_OID"
        ;;
    *)
        printf '%s\\n' "unexpected fake git invocation: $*" >&2
        exit 64
        ;;
esac
`;

    const realSha256sum = spawnSync('/bin/sh', ['-c', 'command -v sha256sum'], { encoding: 'utf8' }).stdout.trim();
    assert.ok(realSha256sum, 'sha256sum is required by the production installer');
    const realPython = spawnSync('/bin/sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();
    assert.ok(realPython, 'python3 is required by the production installer test');
    const fakeSha256sum = `#!/bin/sh
set -eu
exec "$REAL_SHA256SUM" "$@"
`;

    await Promise.all([
        writeFile(path.join(paths.bin, 'python3'), fakePython, { mode: 0o755 }),
        writeFile(path.join(paths.bin, 'git'), fakeGit, { mode: 0o755 }),
        writeFile(path.join(paths.bin, 'sha256sum'), fakeSha256sum, { mode: 0o755 }),
    ]);

    let installer = await readFile(INSTALLER_PATH, 'utf8');
    const replacements = [
        ['VENV_DIR=/opt/gpt-researcher-venv', `VENV_DIR=${shellQuote(paths.venv)}`],
        ['APP_DIR=/opt/gpt-researcher-app', `APP_DIR=${shellQuote(paths.app)}`],
        ['SYSTEM_PYTHON=/usr/bin/python3', `SYSTEM_PYTHON=${shellQuote(path.join(paths.bin, 'python3'))}`],
        ['SYSTEM_PYTHON_REAL=/usr/bin/python3.11', `SYSTEM_PYTHON_REAL=${shellQuote(path.join(paths.bin, 'python3'))}`],
        ['SYSTEM_PYTHON_HOME=/usr/bin', `SYSTEM_PYTHON_HOME=${shellQuote(paths.bin)}`],
        ['LOCK_FILE=/code/scripts/gpt-researcher-requirements.lock', `LOCK_FILE=${shellQuote(paths.appLock)}`],
        ['BOOTSTRAP_LOCK_FILE=/code/scripts/gpt-researcher-bootstrap.lock', `BOOTSTRAP_LOCK_FILE=${shellQuote(paths.bootstrapLock)}`],
    ];
    for (const [from, to] of replacements) {
        assert.equal(installer.split(from).length, 2, `expected one installer assignment for ${from}`);
        installer = installer.replace(from, to);
    }
    await writeFile(paths.installer, installer, { mode: 0o755 });

    const env = {
        ...process.env,
        PATH: `${paths.bin}:${process.env.PATH}`,
        HOME: paths.home,
        WORKSPACE_PATH: paths.workspace,
        FAKE_RUNTIME: 'CPython:3.11.2:Linux:x86_64',
        ENV_DIGEST_FILE: paths.environmentDigest,
        COMMAND_LOG: paths.commandLog,
        FAIL_PIP_CHECK_FILE: paths.failPipCheck,
        SOURCE_REQUIREMENTS_FIXTURE: paths.sourceRequirements,
        SOURCE_COMMIT,
        FAKE_REQUIREMENTS_GIT_OID: gitBlobOid(UPSTREAM_REQUIREMENTS),
        FAKE_TRACKED_GIT_OID: gitBlobOid('immutable\n'),
        REAL_SHA256SUM: realSha256sum,
        REAL_PYTHON: realPython,
    };

    return { paths, env };
}

function runInstaller(harness, envOverrides = {}) {
    return spawnSync('/bin/sh', [harness.paths.installer], {
        encoding: 'utf8',
        env: { ...harness.env, ...envOverrides },
    });
}

async function installClean(t) {
    const harness = await makeHarness(t);
    const result = runInstaller(harness);
    assert.equal(result.status, 0, resultOutput(result));
    return harness;
}

test('installer uses only hash locks and revalidates a reused generation', async (t) => {
    const harness = await installClean(t);
    const initialLog = await readFile(harness.paths.commandLog, 'utf8');
    const installs = initialLog.split('\n').filter((line) => line.startsWith('-I -B -m pip --isolated install '));
    assert.equal(installs.length, 2);
    assert.ok(installs.every((line) => line.includes('--no-compile')));
    assert.match(installs[0], /--require-hashes --only-binary=:all: -r .*bootstrap\.lock/);
    assert.match(installs[1], /--require-hashes --no-build-isolation --only-binary=:all: --no-binary=docopt,langdetect,sgmllib3k -r .*requirements\.lock/);
    assert.equal(initialLog.split('\n').filter((line) => line === '-I -B -m pip --isolated check').length, 1);

    const marker = await readFile(path.join(harness.paths.venv, '.ploinky-install-v5'), 'utf8');
    assert.match(marker, new RegExp(`source_commit=${SOURCE_COMMIT}`));
    assert.match(marker, new RegExp(`lock_sha256=${APP_LOCK_SHA256}`));
    assert.match(marker, new RegExp(`bootstrap_lock_sha256=${BOOTSTRAP_LOCK_SHA256}`));
    assert.match(marker, /runtime_policy_sha256=d975cade6e94b6039f6ce18b9c796318a748a74a8fde288df3caad09fdfca7b3/);
    assert.match(marker, /venv_config_sha256=[0-9a-f]{64}/);
    assert.match(marker, new RegExp(`environment_sha256=${DEFAULT_ENVIRONMENT_DIGEST}`));

    const reuse = runInstaller(harness);
    assert.equal(reuse.status, 0, resultOutput(reuse));
    const reuseLog = await readFile(harness.paths.commandLog, 'utf8');
    assert.equal(reuseLog.split('\n').filter((line) => line.startsWith('-I -B -m pip --isolated install ')).length, 2);
    assert.equal(reuseLog.split('\n').filter((line) => line === '-I -B -m pip --isolated check').length, 2);
});

test('installer rejects a tampered reuse marker', async (t) => {
    const harness = await installClean(t);
    await appendFile(path.join(harness.paths.venv, '.ploinky-install-v5'), 'tampered=true\n');
    const result = runInstaller(harness);
    assert.notEqual(result.status, 0);
    assert.match(resultOutput(result), /tampered runtime state/i);
});

test('installer rejects a modified immutable source checkout', async (t) => {
    const harness = await installClean(t);
    const trackedSource = path.join(harness.paths.app, 'tracked.py');
    await chmod(trackedSource, 0o644);
    await writeFile(trackedSource, 'modified\n');
    await chmod(trackedSource, 0o444);
    const result = runInstaller(harness);
    assert.notEqual(result.status, 0);
    assert.match(resultOutput(result), /immutable source digest mismatch/);
    assert.match(resultOutput(result), /tampered runtime state/i);
});

test('installer rejects untracked content in the immutable source checkout', async (t) => {
    const harness = await installClean(t);
    await chmod(harness.paths.app, 0o755);
    await writeFile(path.join(harness.paths.app, 'untracked.py'), 'raise RuntimeError\n', { mode: 0o444 });
    await chmod(harness.paths.app, 0o555);
    const result = runInstaller(harness);
    assert.notEqual(result.status, 0);
    assert.match(resultOutput(result), /untracked immutable source entry/);
    assert.match(resultOutput(result), /tampered runtime state/i);
});

test('installer rejects a tampered pre-import runtime policy', async (t) => {
    const harness = await installClean(t);
    const runtimePolicy = path.join(
        harness.paths.venv,
        'lib',
        'python3.11',
        'site-packages',
        'ploinky_gpt_researcher_v5.pth',
    );
    await appendFile(runtimePolicy, 'import os\n');
    const result = runInstaller(harness);
    assert.notEqual(result.status, 0);
    assert.match(resultOutput(result), /tampered runtime state/i);
});

test('installer rejects a tampered venv launcher before executing it', async (t) => {
    const harness = await installClean(t);
    const launcher = path.join(harness.paths.venv, 'bin', 'python');
    const executionSentinel = path.join(harness.paths.root, 'tampered-launcher-executed');
    await rm(launcher);
    await writeFile(launcher, `#!/bin/sh\n: > ${shellQuote(executionSentinel)}\nexit 0\n`, { mode: 0o755 });
    const result = runInstaller(harness);
    assert.notEqual(result.status, 0);
    assert.match(resultOutput(result), /tampered runtime state/i);
    await assert.rejects(access(executionSentinel));
});

test('installer rejects installed-environment digest drift before reuse', async (t) => {
    const harness = await installClean(t);
    await writeFile(harness.paths.environmentDigest, `${'b'.repeat(64)}\n`);
    const result = runInstaller(harness);
    assert.notEqual(result.status, 0);
    assert.match(resultOutput(result), /tampered runtime state/i);
});

test('installer rejects a tampered lock without resolving again', async (t) => {
    const harness = await installClean(t);
    await appendFile(harness.paths.appLock, '# tampered\n');
    const result = runInstaller(harness);
    assert.notEqual(result.status, 0);
    assert.match(resultOutput(result), /artifact digest mismatch/i);
    const commandLog = await readFile(harness.paths.commandLog, 'utf8');
    assert.equal(commandLog.split('\n').filter((line) => line.startsWith('-I -B -m pip --isolated install ')).length, 2);
});

test('installer runs pip check on reuse and fails closed on dependency damage', async (t) => {
    const harness = await installClean(t);
    await writeFile(harness.paths.failPipCheck, 'fail\n');
    const result = runInstaller(harness);
    assert.notEqual(result.status, 0);
    assert.match(resultOutput(result), /simulated pip check failure/);
    assert.match(resultOutput(result), /tampered runtime state/i);
});

test('installer rejects an unlisted Python target before creating state', async (t) => {
    const harness = await makeHarness(t);
    const result = runInstaller(harness, { FAKE_RUNTIME: 'CPython:3.11.9:Linux:x86_64' });
    assert.notEqual(result.status, 0);
    assert.match(resultOutput(result), /Unsupported Python target/);
});

test('installer accepts the pinned Linux aarch64 Python target', async (t) => {
    const harness = await makeHarness(t);
    const result = runInstaller(harness, { FAKE_RUNTIME: 'CPython:3.11.2:Linux:aarch64' });
    assert.equal(result.status, 0, resultOutput(result));
});
