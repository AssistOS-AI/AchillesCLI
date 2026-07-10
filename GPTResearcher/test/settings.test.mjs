import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function runTool(relativePath, input, env = {}) {
    const toolPath = new URL(relativePath, import.meta.url).pathname;
    const child = spawn(process.execPath, [toolPath], {
        env: { ...cleanNodeTestEnv(process.env), ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(JSON.stringify({ input }));
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve) => child.on('close', resolve));
    return {
        code,
        stderr,
        payload: stdout ? JSON.parse(stdout) : null,
    };
}

async function runScript(relativePath, { env = {}, imports = [] } = {}) {
    const scriptPath = new URL(relativePath, import.meta.url).pathname;
    const args = imports.flatMap((entry) => ['--import', new URL(entry, import.meta.url).pathname]);
    args.push(scriptPath);
    const child = spawn(process.execPath, args, {
        env: { ...cleanNodeTestEnv(process.env), ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve) => child.on('close', resolve));
    return {
        code,
        stderr,
        payload: stdout ? JSON.parse(stdout) : null,
    };
}

function cleanNodeTestEnv(env) {
    return Object.fromEntries(
        Object.entries(env).filter(([key]) => !key.startsWith('NODE_TEST')),
    );
}

test('GPTResearcher settings persist searchProvider beside model settings', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gpt-researcher-settings-'));
    try {
        const update = await runTool('../scripts/update-settings.mjs', {
            fastLlm: 'fast-model',
            smartLlm: 'smart-model',
            strategicLlm: 'deep-model',
            embedding: 'embed-model',
            searchProvider: 'duckduckgo',
        }, {
            HOME: dir,
        });
        assert.equal(update.code, 0, update.stderr);
        assert.deepEqual(update.payload.settings, {
            fastLlm: 'fast-model',
            smartLlm: 'smart-model',
            strategicLlm: 'deep-model',
            embedding: 'embed-model',
            searchProvider: 'duckduckgo',
        });

        const get = await runTool('../scripts/get-settings.mjs', {}, { HOME: dir });
        assert.equal(get.code, 0, get.stderr);
        assert.deepEqual(get.payload.settings, update.payload.settings);
        assert.match(await readFile(path.join(dir, 'gpt-researcher-settings.json'), 'utf8'), /searchProvider/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('GPTResearcher settings default searchProvider to searxng', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gpt-researcher-settings-defaults-'));
    try {
        const get = await runTool('../scripts/get-settings.mjs', {}, { HOME: dir });
        assert.equal(get.code, 0, get.stderr);
        assert.equal(get.payload.settings.searchProvider, 'searxng');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('GPTResearcher settings UI exposes search provider control', async () => {
    const html = await readFile(new URL('../IDE-plugins/gpt-researcher-settings/gpt-researcher-settings.html', import.meta.url), 'utf8');
    const source = await readFile(new URL('../IDE-plugins/gpt-researcher-settings/gpt-researcher-settings.js', import.meta.url), 'utf8');
    assert.match(html, /gptrSearchProvider/);
    assert.match(html, /Search provider/);
    assert.match(source, /searchProvider/);
    assert.match(source, /searchProviders/);
});

test('GPTResearcher SearchAgent bridge forwards configured provider', async () => {
    const source = await readFile(new URL('../scripts/call-search-agent.mjs', import.meta.url), 'utf8');
    assert.match(source, /SEARCH_AGENT_PROVIDER/);
    assert.match(source, /provider,\s*\n\s*query:/);
});

test('GPTResearcher derives search providers from Soul Gateway search-tagged models', async () => {
    const result = await runScript('../scripts/list-soul-gateway-models.mjs', {
        imports: ['./fixtures/mock-soul-gateway-models-fetch.mjs'],
        env: {
            PLOINKY_ROUTER_URL: 'http://127.0.0.1:8080',
            PLOINKY_AGENT_API_KEY: 'test-key',
        },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.payload.ok, true);
    assert.deepEqual(
        result.payload.searchProviders.map((provider) => provider.id).sort(),
        ['duckduckgo', 'tavily'],
    );
    assert.deepEqual(
        result.payload.chatModels.map((model) => model.id),
        ['codex-api/gpt-5.4-mini'],
    );
    assert.deepEqual(
        result.payload.embeddingModels.map((model) => model.id),
        ['codestral/codestral-embed'],
    );
});

test('GPTResearcher model listing does not bypass Soul Gateway for SearchAgent providers', async () => {
    const source = await readFile(new URL('../scripts/list-soul-gateway-models.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /AgentMcpClient/);
    assert.doesNotMatch(source, /search_agent_list_providers/);
});
