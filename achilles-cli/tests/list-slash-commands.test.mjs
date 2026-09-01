import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, unlink, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConversationSessionStore } from '../src/lib/conversationSessionStore.mjs';
import { setDisabledSkills } from '../src/lib/achillesSettings.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const localDependencyPath = join(repoRoot, 'node_modules', 'achillesAgentLib');
const workspaceDependencyPath = resolve(repoRoot, '../../achillesAgentLib');

async function ensureLocalAchillesAgentLib() {
    await mkdir(join(repoRoot, 'node_modules'), { recursive: true });
    try {
        await lstat(localDependencyPath);
        return false;
    } catch {
        try {
            await symlink(workspaceDependencyPath, localDependencyPath, 'dir');
            return true;
        } catch (error) {
            if (error?.code === 'EEXIST') {
                return false;
            }
            throw error;
        }
    }
}

test('command catalog exposes skill Help as argument completion description', async () => {
    const createdDependencyLink = await ensureLocalAchillesAgentLib();
    let toAutocompleteCatalog;
    try {
        ({ toAutocompleteCatalog } = await import('../src/mcp/list-slash-commands.mjs'));
    } finally {
        if (createdDependencyLink) {
            await unlink(localDependencyPath);
        }
    }

    const tempRoot = await mkdtemp(join(tmpdir(), 'achilles-cli-catalog-'));
    const skillDir = join(tempRoot, 'skills', 'admin-flow');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'oskill.md'), [
        '# Admin Flow',
        '',
        '## Description',
        'Coordinates admin work.',
        '',
        '## Help',
        'Use this for WebAdmin requests.',
        'Example: /exec admin-flow change admin email to user@example.com',
        '',
        '## Instructions',
        'Route the request.',
        '',
        '## Allowed-Skills',
        '- load-admin-context',
    ].join('\n'));

    const catalog = toAutocompleteCatalog({ dir: tempRoot });
    const execCommand = catalog.commands.find((command) => command.name === '/exec');
    const completion = execCommand.argCompletions.find((entry) => entry.value === 'admin-flow');

    assert.equal(completion.description, [
        'Use this for WebAdmin requests.',
        'Example: /exec admin-flow change admin email to user@example.com',
    ].join('\n'));
});

test('public skill catalog uses Achilles discovery and returns deterministic records', async () => {
    const createdDependencyLink = await ensureLocalAchillesAgentLib();
    let buildAchillesSkillCatalog;
    try {
        ({ buildAchillesSkillCatalog } = await import(`../src/mcp/list-slash-commands.mjs?catalog=${Date.now()}`));
    } finally {
        if (createdDependencyLink) {
            await unlink(localDependencyPath);
        }
    }

    const tempRoot = await mkdtemp(join(tmpdir(), 'achilles-cli-public-catalog-'));
    try {
        const skillDir = join(tempRoot, 'skills', 'workspace-tool');
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, 'cskill.md'), '# Workspace Tool\n');

        const catalog = buildAchillesSkillCatalog(tempRoot);
        const workspaceSkill = catalog.skills.find((skill) => skill.name === 'workspace-tool');

        assert.ok(workspaceSkill);
        assert.equal(workspaceSkill.type, 'cskill');
        assert.equal(workspaceSkill.isInternal, false);
        assert.deepEqual(Object.keys(workspaceSkill), ['key', 'name', 'type', 'isInternal']);
        assert.deepEqual(
            catalog.skills.map((skill) => skill.name),
            catalog.skills.map((skill) => skill.name).toSorted((left, right) => left.localeCompare(right)),
        );
        assert.equal(new Set(catalog.skills.map((skill) => skill.key)).size, catalog.skills.length);
    } finally {
        await rm(tempRoot, { recursive: true, force: true });
    }
});

test('MCP configuration publishes the Achilles-owned skill catalog tool', async () => {
    const config = JSON.parse(await readFile(new URL('../mcp-config.json', import.meta.url), 'utf8'));
    const tool = config.tools.find((entry) => entry.name === 'list_achilles_skills');

    assert.ok(tool);
    assert.equal(tool.command, '/code/src/mcp/list-skills.mjs');
    assert.equal(tool.inputSchema.dir.optional, true);
});

test('command catalog includes built-in AchillesCLI skills in skill completions', async () => {
    const createdDependencyLink = await ensureLocalAchillesAgentLib();
    let toAutocompleteCatalog;
    try {
        ({ toAutocompleteCatalog } = await import(`../src/mcp/list-slash-commands.mjs?builtin=${Date.now()}`));
    } finally {
        if (createdDependencyLink) {
            await unlink(localDependencyPath);
        }
    }

    const tempRoot = await mkdtemp(join(tmpdir(), 'achilles-cli-catalog-empty-'));
    const catalog = toAutocompleteCatalog({ dir: tempRoot });
    const execCommand = catalog.commands.find((command) => command.name === '/exec');
    const completion = execCommand.argCompletions.find((entry) => entry.value === 'read-skill');

    assert.equal(completion.label, 'read-skill');
    assert.equal(completion.description, 'Input: skillName.');
});

test('command catalog exposes the workspace task summary command', async () => {
    const createdDependencyLink = await ensureLocalAchillesAgentLib();
    let toAutocompleteCatalog;
    try {
        ({ toAutocompleteCatalog } = await import(`../src/mcp/list-slash-commands.mjs?tasks=${Date.now()}`));
    } finally {
        if (createdDependencyLink) {
            await unlink(localDependencyPath);
        }
    }

    const catalog = toAutocompleteCatalog({ dir: repoRoot });
    const tasks = catalog.commands.find((command) => command.name === '/tasks');
    assert.equal(tasks.usage, '/tasks [count|all]');
    assert.match(tasks.description, /background task status/i);
    assert.deepEqual(tasks.argCompletions, []);
});

test('command catalog exposes singular skill and plural directory controls', async () => {
    const createdDependencyLink = await ensureLocalAchillesAgentLib();
    let toAutocompleteCatalog;
    try {
        ({ toAutocompleteCatalog } = await import(`../src/mcp/list-slash-commands.mjs?skills-state=${Date.now()}`));
    } finally {
        if (createdDependencyLink) await unlink(localDependencyPath);
    }
    const skillDirectoryCompletions = [{ value: 'packages/tools', label: 'packages/tools', description: 'folder' }];
    const catalog = toAutocompleteCatalog({ dir: repoRoot, skillDirectoryCompletions });
    const skill = catalog.commands.find((command) => command.name === '/skill');
    const skills = catalog.commands.find((command) => command.name === '/skills');

    assert.deepEqual(skill.subCommands.map((command) => command.name), ['enable', 'disable']);
    assert.ok(skill.subCommands.every((command) => command.argCompletions.length > 0));
    assert.deepEqual(skills.subCommands.map((command) => command.name), ['enable', 'disable']);
    assert.ok(skills.subCommands.every((command) => command.argCompletions === skillDirectoryCompletions));
});

test('command catalog removes disabled skills from /exec but keeps them available to /skill enable', async (t) => {
    const createdDependencyLink = await ensureLocalAchillesAgentLib();
    let toAutocompleteCatalog;
    try {
        ({ toAutocompleteCatalog } = await import(`../src/mcp/list-slash-commands.mjs?disabled-skills=${Date.now()}`));
    } finally {
        if (createdDependencyLink) await unlink(localDependencyPath);
    }
    const tempRoot = await mkdtemp(join(tmpdir(), 'achilles-cli-disabled-catalog-'));
    t.after(() => rm(tempRoot, { recursive: true, force: true }));
    for (const name of ['alpha', 'beta']) {
        const skillDir = join(tempRoot, 'skills', name);
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, 'cskill.md'), `# ${name}\n\n## Description\n${name}\n`);
    }
    setDisabledSkills(tempRoot, ['alpha-cskill']);

    const catalog = toAutocompleteCatalog({ dir: tempRoot });
    const exec = catalog.commands.find((command) => command.name === '/exec');
    const skill = catalog.commands.find((command) => command.name === '/skill');
    const enable = skill.subCommands.find((command) => command.name === 'enable');
    const disable = skill.subCommands.find((command) => command.name === 'disable');

    assert.equal(exec.argCompletions.some((entry) => entry.value === 'alpha'), false);
    assert.equal(exec.argCompletions.some((entry) => entry.value === 'beta'), true);
    assert.equal(enable.argCompletions.some((entry) => entry.value === 'alpha'), true);
    assert.equal(disable.argCompletions.some((entry) => entry.value === 'alpha'), false);
});

test('command catalog exposes named session ids only under /session resume', async () => {
    const createdDependencyLink = await ensureLocalAchillesAgentLib();
    let toAutocompleteCatalog;
    try {
        ({ toAutocompleteCatalog } = await import(`../src/mcp/list-slash-commands.mjs?sessions=${Date.now()}`));
    } finally {
        if (createdDependencyLink) {
            await unlink(localDependencyPath);
        }
    }

    const sessionCompletions = [{
        value: '123e4567-e89b-42d3-a456-426614174000',
        label: 'Review authentication flow',
        description: '123e4567-e89b-42d3-a456-426614174000 · 2026-07-23T10:00:00.000Z',
    }];
    const catalog = toAutocompleteCatalog({ dir: repoRoot, sessionCompletions });
    const session = catalog.commands.find((command) => command.name === '/session');
    const resume = session.subCommands.find((command) => command.name === 'resume');

    assert.equal(catalog.commands.some((command) => command.name === '/sessions'), false);
    assert.deepEqual(resume.argCompletions, sessionCompletions);
});

test('task action completions display task names and insert opaque task ids', async () => {
    const createdDependencyLink = await ensureLocalAchillesAgentLib();
    let toAutocompleteCatalog;
    try {
        ({ toAutocompleteCatalog } = await import(`../src/mcp/list-slash-commands.mjs?task-actions=${Date.now()}`));
    } finally {
        if (createdDependencyLink) await unlink(localDependencyPath);
    }
    const completion = {
        value: 'task_1234567890abcdef12345678',
        label: 'Build the project',
        description: 'ongoing · queued · task_1234567890abcdef12345678',
    };
    const catalog = toAutocompleteCatalog({
        dir: repoRoot,
        taskCompletions: { view: [completion], continue: [], stop: [completion] },
    });
    const task = catalog.commands.find((command) => command.name === '/task');
    assert.deepEqual(task.subCommands.map((sub) => sub.name), ['view', 'continue', 'stop', 'model', 'login']);
    assert.deepEqual(task.subCommands.find((sub) => sub.name === 'view').argCompletions, [completion]);
    assert.deepEqual(task.subCommands.find((sub) => sub.name === 'stop').argCompletions, [completion]);
});

test('persisted sessions become named resume completions', async () => {
    const createdDependencyLink = await ensureLocalAchillesAgentLib();
    let buildSessionCompletions;
    try {
        ({ buildSessionCompletions } = await import(`../src/mcp/list-slash-commands.mjs?persisted-sessions=${Date.now()}`));
    } finally {
        if (createdDependencyLink) {
            await unlink(localDependencyPath);
        }
    }

    const tempRoot = await mkdtemp(join(tmpdir(), 'achilles-cli-session-catalog-'));
    try {
        const store = new ConversationSessionStore({ workingDir: tempRoot });
        const session = store.createSession();
        store.beginTurn({ text: 'Review authentication flow' });

        const completion = buildSessionCompletions(tempRoot)
            .find((entry) => entry.value === session.sessionId);
        assert.equal(completion.label, 'Review authentication flow');
        assert.match(completion.description, new RegExp(session.sessionId));
    } finally {
        await rm(tempRoot, { recursive: true, force: true });
    }
});

test('command catalog exposes the workspace Bash permission command', async () => {
    const createdDependencyLink = await ensureLocalAchillesAgentLib();
    let toAutocompleteCatalog;
    try {
        ({ toAutocompleteCatalog } = await import(`../src/mcp/list-slash-commands.mjs?permissions=${Date.now()}`));
    } finally {
        if (createdDependencyLink) {
            await unlink(localDependencyPath);
        }
    }

    const catalog = toAutocompleteCatalog({ dir: repoRoot });
    const permissions = catalog.commands.find((command) => command.name === '/permissions');
    assert.equal(permissions.usage, '/permissions [ask-for-approval|full-access]');
    assert.match(permissions.description, /Bash permission mode/i);
    assert.deepEqual(permissions.argCompletions, [
        {
            value: 'ask-for-approval',
            label: 'ask-for-approval',
            description: 'Ask before each new Bash command',
        },
        {
            value: 'full-access',
            label: 'full-access',
            description: 'Run Bash automatically inside the current workspace',
        },
    ]);
});

test('command catalog exposes Soul Gateway models only as /model arguments', async () => {
    const createdDependencyLink = await ensureLocalAchillesAgentLib();
    let toAutocompleteCatalog;
    try {
        ({ toAutocompleteCatalog } = await import(`../src/mcp/list-slash-commands.mjs?models=${Date.now()}`));
    } finally {
        if (createdDependencyLink) {
            await unlink(localDependencyPath);
        }
    }

    const modelCompletions = [
        { value: 'fast', label: 'fast', description: 'soul-gateway · Cascade · 2 models' },
        { value: 'anthropic/claude-sonnet', label: 'anthropic/claude-sonnet', description: 'anthropic · reasoning' },
    ];
    const catalog = toAutocompleteCatalog({ dir: repoRoot, modelCompletions });
    const model = catalog.commands.find((command) => command.name === '/model');
    const exec = catalog.commands.find((command) => command.name === '/exec');

    assert.equal(model.usage, '/model <model-name>');
    assert.equal(model.argMatchMode, 'fragment');
    assert.equal(model.argSuggestionLimit, null);
    assert.deepEqual(model.argCompletions, modelCompletions);
    assert.equal(exec.argCompletions.some((entry) => entry.value === 'fast'), false);
});
