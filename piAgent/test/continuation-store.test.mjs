import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    __testables,
    continuationDescriptor,
    createContinuationHandle,
} from '../scripts/continuation-store.mjs';
import { createContinuationStoreFixture } from './continuation-store-fixture.mjs';

test('PI continuation store derives records and sessions from explicit fixed roots', async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-continuation-store-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const homeRoot = path.join(directory, 'home');
    const storeRoot = path.join(homeRoot, '.ploinky', 'records');
    const sessionRoot = path.join(homeRoot, '.ploinky', 'sessions');
    await fs.mkdir(homeRoot);
    const store = createContinuationStoreFixture({ homeRoot, storeRoot, sessionRoot });
    const handle = createContinuationHandle();

    const written = store.writeContinuationRecord(handle, {
        projectDir: '/workspace/project with spaces',
    });
    const descriptor = continuationDescriptor(handle);
    const read = store.readContinuationRecord(handle);

    assert.deepEqual(descriptor, { version: 1, handle, toolName: 'continue-task' });
    assert.equal(written.projectDir, '/workspace/project with spaces');
    assert.equal(written.sessionDir, path.join(sessionRoot, handle));
    assert.equal(read.projectDir, written.projectDir);
    assert.equal(read.sessionDir, written.sessionDir);
    assert.equal((await fs.stat(path.join(storeRoot, `${handle}.json`))).mode & 0o777, 0o600);
});

test('PI continuation store rejects host paths, root selection, and incompatible records', async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-continuation-reject-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const homeRoot = path.join(directory, 'home');
    const storeRoot = path.join(homeRoot, '.ploinky', 'records');
    const sessionRoot = path.join(homeRoot, '.ploinky', 'sessions');
    await fs.mkdir(homeRoot);
    const store = createContinuationStoreFixture({ homeRoot, storeRoot, sessionRoot });

    for (const projectDir of ['/workspace', '/tmp/project', '/workspace/../escape']) {
        assert.throws(
            () => store.writeContinuationRecord(createContinuationHandle(), { projectDir }),
            /invalid_continuation_record/,
        );
    }
    await assert.rejects(fs.access(storeRoot));
    await assert.rejects(fs.access(sessionRoot));

    const handle = createContinuationHandle();
    store.writeContinuationRecord(handle, { projectDir: '/workspace/project' });
    const recordPath = path.join(storeRoot, `${handle}.json`);
    const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
    await fs.writeFile(recordPath, JSON.stringify({ ...record, version: 0 }));
    assert.throws(() => store.readContinuationRecord(handle), /invalid_continuation_record/);
});

test('PI continuation store rejects provider-created symlinks beneath HOME', async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-continuation-symlink-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const homeRoot = path.join(directory, 'home');
    const outside = path.join(directory, 'outside');
    await fs.mkdir(homeRoot);
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(homeRoot, '.ploinky'));
    const store = createContinuationStoreFixture({
        homeRoot,
        storeRoot: path.join(homeRoot, '.ploinky', 'records'),
        sessionRoot: path.join(homeRoot, '.ploinky', 'sessions'),
    });

    assert.throws(
        () => store.writeContinuationRecord(createContinuationHandle(), {
            projectDir: '/workspace/project',
        }),
        /unsafe_(?:continuation_store|pi_session_directory)/,
    );
    assert.deepEqual(await fs.readdir(outside), []);
});

test('PI retained directory fd defeats store rename-to-symlink write and read races', {
    skip: process.platform !== 'linux' ? 'requires Linux /proc/self/fd retained directory paths' : false,
}, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-continuation-retained-fd-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const homeRoot = path.join(directory, 'home');
    const storeRoot = path.join(homeRoot, '.ploinky', 'records');
    const sessionRoot = path.join(homeRoot, '.ploinky', 'sessions');
    const retainedStore = path.join(homeRoot, '.ploinky', 'retained-records');
    const outside = path.join(directory, 'outside');
    await fs.mkdir(homeRoot);
    await fs.mkdir(outside);
    const handle = createContinuationHandle();
    let writeSwap = false;
    const writeFilesystem = __testables.createRetainedFilesystem(homeRoot, {
        afterDirectoryOpen({ purpose }) {
            if (purpose !== 'continuation-record-write' || writeSwap) return;
            writeSwap = true;
            fsSync.renameSync(storeRoot, retainedStore);
            fsSync.symlinkSync(outside, storeRoot);
        },
    });
    const writeStore = __testables.createContinuationStore(
        { homeRoot, storeRoot, sessionRoot },
        writeFilesystem,
    );

    writeStore.writeContinuationRecord(handle, { projectDir: '/workspace/project' });

    assert.equal(writeSwap, true);
    assert.deepEqual(await fs.readdir(outside), []);
    assert.equal(
        JSON.parse(await fs.readFile(path.join(retainedStore, `${handle}.json`), 'utf8')).projectDir,
        '/workspace/project',
    );

    await fs.unlink(storeRoot);
    await fs.rename(retainedStore, storeRoot);
    const outsideRecord = path.join(outside, `${handle}.json`);
    await fs.writeFile(outsideRecord, JSON.stringify({
        version: 1,
        provider: 'pi',
        sessionId: handle,
        projectDir: '/workspace/attacker',
    }));
    let readSwap = false;
    const readFilesystem = __testables.createRetainedFilesystem(homeRoot, {
        afterDirectoryOpen({ purpose }) {
            if (purpose !== 'continuation-record-read' || readSwap) return;
            readSwap = true;
            fsSync.renameSync(storeRoot, retainedStore);
            fsSync.symlinkSync(outside, storeRoot);
        },
    });
    const readStore = __testables.createContinuationStore(
        { homeRoot, storeRoot, sessionRoot },
        readFilesystem,
    );

    const record = readStore.readContinuationRecord(handle);

    assert.equal(readSwap, true);
    assert.equal(record.projectDir, '/workspace/project');
});

test('PI retained install rejects substituted temp inodes without accepting attacker state', {
    skip: process.platform !== 'linux' ? 'requires Linux retained directory descriptors' : false,
    concurrency: false,
}, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-retained-install-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const homeRoot = path.join(directory, 'home');
    const storeRoot = path.join(homeRoot, '.ploinky', 'records');
    const sessionRoot = path.join(homeRoot, '.ploinky', 'sessions');
    await fs.mkdir(homeRoot);

    const originalFsync = fsSync.fsyncSync.bind(fsSync);
    let directoryFsyncs = 0;
    t.mock.method(fsSync, 'fsyncSync', (fd) => {
        if (fsSync.fstatSync(fd).isDirectory()) directoryFsyncs += 1;
        return originalFsync(fd);
    });
    const safeStore = __testables.createContinuationStore(
        { homeRoot, storeRoot, sessionRoot },
        __testables.createRetainedFilesystem(homeRoot),
    );
    safeStore.writeContinuationRecord(createContinuationHandle(), {
        projectDir: '/workspace/durable',
    });
    assert.equal(directoryFsyncs, 1);

    const attackedHandle = createContinuationHandle();
    const attackerRecord = `${JSON.stringify({
        version: 1,
        provider: 'pi',
        sessionId: attackedHandle,
        projectDir: '/workspace/attacker',
    })}\n`;
    const attackerPath = path.join(directory, 'attacker-record.json');
    fsSync.writeFileSync(attackerPath, attackerRecord, { mode: 0o600 });
    const attackedStore = __testables.createContinuationStore(
        { homeRoot, storeRoot, sessionRoot },
        __testables.createRetainedFilesystem(homeRoot, {
            beforeRename({ temporaryPath }) {
                fsSync.unlinkSync(temporaryPath);
                fsSync.linkSync(attackerPath, temporaryPath);
            },
        }),
    );
    assert.throws(() => attackedStore.writeContinuationRecord(attackedHandle, {
        projectDir: '/workspace/expected',
    }), /unsafe_continuation_store/);
    assert.equal(fsSync.readFileSync(attackerPath, 'utf8'), attackerRecord);
    assert.equal(fsSync.existsSync(path.join(storeRoot, `${attackedHandle}.json`)), false);
    assert.throws(() => attackedStore.readContinuationRecord(attackedHandle));

    const symlinkHandle = createContinuationHandle();
    const symlinkStore = __testables.createContinuationStore(
        { homeRoot, storeRoot, sessionRoot },
        __testables.createRetainedFilesystem(homeRoot, {
            beforeRename({ temporaryPath }) {
                fsSync.unlinkSync(temporaryPath);
                fsSync.symlinkSync(attackerPath, temporaryPath);
            },
        }),
    );
    assert.throws(() => symlinkStore.writeContinuationRecord(symlinkHandle, {
        projectDir: '/workspace/expected',
    }), /unsafe_continuation_store/);
    assert.equal(fsSync.readFileSync(attackerPath, 'utf8'), attackerRecord);
    assert.equal(fsSync.existsSync(path.join(storeRoot, `${symlinkHandle}.json`)), false);
});

test('PI production store fails closed without retained directory fd support', {
    skip: process.platform === 'linux' ? 'non-Linux fail-closed contract' : false,
}, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-continuation-no-fd-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const homeRoot = path.join(directory, 'home');
    await fs.mkdir(homeRoot);
    const store = __testables.createContinuationStore({
        homeRoot,
        storeRoot: path.join(homeRoot, '.ploinky', 'records'),
        sessionRoot: path.join(homeRoot, '.ploinky', 'sessions'),
    });

    assert.throws(
        () => store.writeContinuationRecord(createContinuationHandle(), {
            projectDir: '/workspace/project',
        }),
        (error) => error?.code === 'PLOINKY_RETAINED_FD_UNAVAILABLE',
    );
});

test('PI production continuation roots are the sole clean HOME ABI', async () => {
    assert.equal(__testables.STORE_DIRECTORY, '/home/agent/.ploinky/task-sessions');
    assert.equal(__testables.SESSION_DIRECTORY, '/home/agent/.ploinky/pi-sessions');
    const source = await fs.readFile(
        new URL('../scripts/continuation-store.mjs', import.meta.url),
        'utf8',
    );
    for (const forbidden of [
        '/root',
        'process.env',
        'PLOINKY_CONTINUATION_STORE_DIR',
        'PLOINKY_PI_SESSION_DIR',
        'lstatSync',
    ]) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
    assert.match(source, /O_DIRECTORY/);
    assert.match(source, /O_NOFOLLOW/);
    assert.match(source, /\/proc\/self\/fd/);
});
