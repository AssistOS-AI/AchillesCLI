import fs from 'node:fs';
import path from 'node:path';

import { __testables } from '../scripts/continuation-store.mjs';

function pathDirectory(homeRoot, directory, { create, errorCode }) {
    const relative = path.relative(homeRoot, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(errorCode);
    }
    const rootStat = fs.lstatSync(homeRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(errorCode);
    let current = homeRoot;
    for (const segment of relative.split(path.sep)) {
        current = path.join(current, segment);
        try {
            const stat = fs.lstatSync(current);
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(errorCode);
        } catch (error) {
            if (!create || error?.code !== 'ENOENT') throw error;
            fs.mkdirSync(current, { mode: 0o700 });
        }
    }
    return current;
}

function createPathFilesystem(homeRoot) {
    return Object.freeze({
        atomicWrite(directory, name, contents, options) {
            const root = pathDirectory(homeRoot, directory, options);
            const finalPath = path.join(root, name);
            const temporaryPath = `${finalPath}.tmp-${process.pid}`;
            try {
                fs.writeFileSync(temporaryPath, contents, { mode: 0o600, flag: 'wx' });
                fs.renameSync(temporaryPath, finalPath);
            } finally {
                try { fs.unlinkSync(temporaryPath); } catch (_) { }
            }
        },
        readFile(directory, name, options) {
            const filePath = path.join(pathDirectory(homeRoot, directory, options), name);
            const stat = fs.lstatSync(filePath);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(options.errorCode);
            return fs.readFileSync(filePath, 'utf8');
        },
    });
}

export function createContinuationStoreFixture(config) {
    return __testables.createContinuationStore(config, createPathFilesystem(config.homeRoot));
}
