import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fail } from './config.mjs';

export async function sqliteRuntime() {
  try { return await import('node:sqlite'); }
  catch { throw fail('RUNTIME_UNSUPPORTED', 'SQLite requires Node.js >=22.13.0 with node:sqlite support.'); }
}

export class EmbeddingCache {
  constructor(DatabaseSync, path) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS embeddings (
        space TEXT NOT NULL, kind TEXT NOT NULL, text_hash TEXT NOT NULL,
        dimensions INTEGER NOT NULL, vector BLOB NOT NULL,
        PRIMARY KEY (space, kind, text_hash)
      );
    `);
    this.read = this.db.prepare('SELECT dimensions, vector FROM embeddings WHERE space=? AND kind=? AND text_hash=?');
    this.write = this.db.prepare('INSERT OR REPLACE INTO embeddings VALUES (?, ?, ?, ?, ?)');
  }

  get(space, kind, hash, dimensions) {
    const row = this.read.get(space, kind, hash);
    if (!row) return null;
    if (row.dimensions !== dimensions || row.vector.byteLength !== dimensions * 4) {
      throw fail('CACHE_INVALID', 'Stored embedding dimensions do not match this model.');
    }
    const buffer = Buffer.from(row.vector);
    return Array.from({ length: dimensions }, (_, i) => buffer.readFloatLE(i * 4));
  }

  set(space, kind, hash, vector) {
    const buffer = Buffer.alloc(vector.length * 4);
    vector.forEach((value, i) => buffer.writeFloatLE(value, i * 4));
    this.write.run(space, kind, hash, vector.length, buffer);
  }

  close() { this.db.close(); }
}
