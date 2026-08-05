import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

for (const agent of ['codexAgent', 'piAgent', 'opencodeAgent']) {
    test(`${agent} has no provider-owned durable login-flow store or worker`, () => {
        const legacyFiles = [
            'scripts/login-flow-store.mjs',
            `${agent === 'codexAgent' ? 'scripts/codex-login-worker.mjs' : ''}`,
            `${agent === 'piAgent' ? 'scripts/pi-login-worker.mjs' : ''}`,
            `${agent === 'opencodeAgent' ? 'scripts/opencode-login-worker.mjs' : ''}`,
        ].filter(Boolean);

        for (const relativePath of legacyFiles) {
            assert.equal(fs.existsSync(path.join(repositoryRoot, agent, relativePath)), false);
        }

        const controlSource = fs.readFileSync(
            path.join(repositoryRoot, agent, 'scripts/task-session-control.mjs'),
            'utf8',
        );
        assert.doesNotMatch(controlSource, /PLOINKY_LOGIN_FLOW_DIR/);
        assert.doesNotMatch(controlSource, /login-flow-store|login-worker/);
    });
}
