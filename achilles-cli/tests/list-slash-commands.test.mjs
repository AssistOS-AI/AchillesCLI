import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, unlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const localDependencyPath = join(repoRoot, 'node_modules', 'achillesAgentLib');
const workspaceDependencyPath = resolve(repoRoot, '../../../../ploinky/node_modules/achillesAgentLib');

async function ensureLocalAchillesAgentLib() {
    try {
        await lstat(localDependencyPath);
        return false;
    } catch {
        await symlink(workspaceDependencyPath, localDependencyPath, 'dir');
        return true;
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
