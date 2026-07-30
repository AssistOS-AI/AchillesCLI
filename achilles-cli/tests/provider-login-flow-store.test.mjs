import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workerPath = fileURLToPath(new URL('./fixtures/noop-login-worker.mjs', import.meta.url));

for (const agent of ['codexAgent', 'piAgent', 'opencodeAgent']) {
    test(`${agent} owns its durable provider login flow state`, async (t) => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${agent}-login-flow-`));
        t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
        const store = await import(pathToFileURL(
            path.join(repositoryRoot, agent, 'scripts/login-flow-store.mjs'),
        ).href);
        const env = { ...process.env, PLOINKY_LOGIN_FLOW_DIR: directory };
        const created = store.createLoginFlow({
            provider: 'provider',
            method: 'method',
            workerPath,
            env,
        });
        assert.equal(created.status, 'running');
        assert.equal(created.provider, 'provider');
        assert.equal(created.pid, undefined);
        const cancelled = store.cancelLoginFlow(created.flowId, env);
        assert.equal(cancelled.status, 'cancelled');
        assert.equal(fs.statSync(path.join(directory, `${created.flowId}.json`)).mode & 0o777, 0o600);
    });
}
