import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));

test('research launcher uses the agent home and preserves arguments, input, and exit status', t => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'gpt-runtime-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const home = path.join(root, 'agent home');
    const bin = path.join(home, 'gpt-researcher', 'venv', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'python'), '#!/bin/sh\nprintf "%s\\n" "$@"\ncat\nexit 23\n', { mode: 0o755 });

    const result = spawnSync('/bin/sh', [path.join(scripts, 'run-research.sh'), '--query', 'a query with spaces'], {
        env: { ...process.env, HOME: home },
        input: '{"query":"stdin remains intact"}\n',
        encoding: 'utf8'
    });

    assert.equal(result.status, 23, result.stderr);
    assert.equal(result.stdout, `${path.join(scripts, 'start-research.py')}\n--query\na query with spaces\n{"query":"stdin remains intact"}\n`);
    assert.equal(result.stderr, '');
});

for (const invalidHome of [undefined, '', '/', 'relative/home']) {
    test(`runtime entry points reject invalid HOME ${JSON.stringify(invalidHome)}`, () => {
        const env = { ...process.env };
        delete env.HOME;
        if (invalidHome !== undefined) env.HOME = invalidHome;
        for (const entry of ['run-research.sh', 'install-gpt-researcher.sh', 'start-gpt-researcher.sh']) {
            const result = spawnSync('/bin/sh', [path.join(scripts, entry)], { env, encoding: 'utf8' });
            assert.notEqual(result.status, 0, entry);
            assert.match(result.stderr, /HOME (?:is required|must be)/, entry);
        }
    });
}

test('UI startup resolves the same home-owned app and fails before launching an absent installation', t => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'gpt-empty-home-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const result = spawnSync('/bin/sh', [path.join(scripts, 'start-gpt-researcher.sh')], {
        env: { ...process.env, HOME: home }, encoding: 'utf8'
    });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`Missing ${path.join(home, 'gpt-researcher', 'app')}. Run install first.`));
});
