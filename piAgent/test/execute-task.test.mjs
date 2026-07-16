import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const executeTaskPath = new URL('../scripts/execute-task.mjs', import.meta.url).pathname;

async function makeFakePiBin(directory) {
    const binPath = path.join(directory, 'fake-pi.mjs');
    await fs.writeFile(binPath, `#!/usr/bin/env node
import fs from 'node:fs';

fs.writeFileSync(process.env.PI_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
process.stdout.write('Pi ');
await new Promise((resolve) => setTimeout(resolve, 25));
process.stdout.write('answer');
`, 'utf8');
    await fs.chmod(binPath, 0o755);
    return binPath;
}

test('PI wrapper streams raw text and returns the final output as plain text', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-agent-test-'));
    const projectDir = path.join(temporaryDirectory, 'project');
    const argsPath = path.join(temporaryDirectory, 'args.json');
    await fs.mkdir(projectDir);
    const piBin = await makeFakePiBin(temporaryDirectory);

    const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [executeTaskPath], {
            env: {
                ...process.env,
                PI_BIN: piBin,
                PI_ARGS_PATH: argsPath,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(JSON.stringify({ input: { prompt: 'Do the task', projectDir } }));
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, 'Pi answer');
    assert.equal(result.stderr, 'Pi answer');
    assert.doesNotMatch(result.stdout, /^\s*\{/);
    assert.doesNotMatch(result.stderr, /\[pi|start projectDir|exit code/);

    const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.deepEqual(args.slice(0, 2), ['-p', '--no-session']);
});
