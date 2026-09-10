import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));

function setup(t) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'gpt-bytecode-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const code = path.join(root, 'code');
    const home = path.join(root, 'agent home');
    const app = path.join(home, 'gpt-researcher/app');
    const bin = path.join(home, 'gpt-researcher/venv/bin');
    cpSync(scripts, code, { recursive: true, filter: source => path.basename(source) !== '__pycache__' && !source.endsWith('.pyc') });
    mkdirSync(app, { recursive: true });
    mkdirSync(bin, { recursive: true });
    const env = { ...process.env, HOME: home, PYTHONDONTWRITEBYTECODE: '' };
    delete env.PYTHONPYCACHEPREFIX;
    delete env.PYTHONPATH;
    const python = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { env, encoding: 'utf8' });
    assert.equal(python.status, 0, python.stderr);
    symlinkSync(python.stdout.trim(), path.join(bin, 'python'));
    return { root, code, home, app, env };
}

function snapshot(root) {
    const result = {};
    function visit(directory) {
        for (const item of readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, item.name);
            if (item.isDirectory()) visit(file);
            else result[path.relative(root, file)] = createHash('sha256').update(readFileSync(file)).digest('hex');
        }
    }
    visit(root);
    return result;
}

function write(root, relative, text) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
}

test('actual MCP launcher imports Python adapters without writing into writable source', t => {
    const fixture = setup(t);
    const before = snapshot(fixture.code);
    const result = spawnSync('/bin/sh', [path.join(fixture.code, 'run-research.sh')], {
        env: fixture.env, input: 'invalid input', encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: false, error: 'Invalid or missing input. Expected JSON with query.' });
    assert.deepEqual(snapshot(fixture.code), before, 'Python imports must leave source bytes and file inventory unchanged');
});

test('actual UI startup disables bytecode before automatic sitecustomize and child imports', t => {
    const fixture = setup(t);
    // Only the upstream package and AgentServer are fixtures; the lifecycle
    // shell, sitecustomize, and all local adapters execute from the source copy.
    const upstream = {
        'gpt_researcher/__init__.py': '',
        'gpt_researcher/actions/__init__.py': '',
        'gpt_researcher/actions/retriever.py': 'def get_retriever(name): return name\n',
        'gpt_researcher/retrievers/__init__.py': '',
        'gpt_researcher/retrievers/utils.py': 'def get_all_retriever_names(): return []\n',
        'gpt_researcher/llm_provider/__init__.py': '',
        'gpt_researcher/llm_provider/generic/__init__.py': '',
        'gpt_researcher/llm_provider/generic/base.py': '_SUPPORTED_PROVIDERS = set()\nclass GenericLLMProvider:\n    @classmethod\n    def from_provider(cls, *args, **kwargs): return cls()\n',
        'gpt_researcher/memory/__init__.py': '',
        'gpt_researcher/memory/embeddings.py': '_SUPPORTED_PROVIDERS = set()\nclass Memory:\n    def __init__(self, *args, **kwargs): pass\n',
        'main.py': 'APP_MARKER = "fixture-ui"\n',
        'uvicorn/__init__.py': '',
        'uvicorn/__main__.py': `import json, os, pathlib, sys, main
from gpt_researcher.actions import retriever
from gpt_researcher.llm_provider.generic.base import GenericLLMProvider
modules = ['sitecustomize', 'gpt_researcher_agent', 'gpt_researcher_agent.io_utils', 'gpt_researcher_agent.settings', 'gpt_researcher_agent.search_agent', 'gpt_researcher_agent.soul_gateway']
assert all(name in sys.modules for name in modules)
assert retriever._ploinky_search_agent_retriever_patch
assert GenericLLMProvider._ploinky_soul_gateway_patch
pathlib.Path(os.environ['UI_RESULT']).write_text(json.dumps({'bytecodeDisabled': sys.dont_write_bytecode, 'marker': main.APP_MARKER, 'arguments': sys.argv[1:]}))
`,
    };
    for (const [name, contents] of Object.entries(upstream)) write(fixture.app, name, contents);
    const tools = path.join(fixture.root, 'tools');
    mkdirSync(tools);
    writeFileSync(path.join(tools, 'sh'), `#!/bin/sh
[ "$1" = /Agent/server/AgentServer.sh ] || exit 90
count=0
while [ "$count" -lt 100 ]; do
    if [ -f "$UI_RESULT" ]; then cat "$UI_RESULT"; exit 0; fi
    sleep 0.02
    count=$((count + 1))
done
exit 91
`, { mode: 0o755 });
    const before = snapshot(fixture.code);
    const appBefore = snapshot(fixture.app);
    const result = spawnSync('/bin/sh', [path.join(fixture.code, 'start-gpt-researcher.sh')], {
        env: { ...fixture.env, PATH: `${tools}${path.delimiter}${process.env.PATH}`,
            PYTHONPATH: `${fixture.code}${path.delimiter}${fixture.app}`, UI_RESULT: path.join(fixture.root, 'ui-result.json') },
        encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /sitecustomize\] applied GPTResearcher settings/);
    const observed = JSON.parse(readFileSync(path.join(fixture.root, 'ui-result.json'), 'utf8'));
    assert.equal(observed.bytecodeDisabled, true);
    assert.equal(observed.marker, 'fixture-ui');
    assert.deepEqual(observed.arguments, ['main:app', '--host', '0.0.0.0', '--port', '8000']);
    assert.deepEqual(snapshot(fixture.code), before, 'UI startup must leave all local source files unchanged');
    assert.deepEqual(snapshot(fixture.app), appBefore, 'UI imports must leave the selected upstream checkout unchanged');
});
