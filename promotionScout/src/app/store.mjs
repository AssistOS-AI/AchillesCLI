import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hash, fail } from '../embeddings/config.mjs';
import { sqliteRuntime } from '../embeddings/cache.mjs';
import { normalizeItem } from './normalize.mjs';

export const schemaVersion = 6;

export async function openStore(dataDir) {
  const { DatabaseSync } = await sqliteRuntime();
  mkdirSync(dataDir, { recursive: true });
  return new Store(new DatabaseSync(join(dataDir, 'scout.sqlite')), join(dataDir, 'scout.sqlite'));
}

export class Store {
  constructor(db, path = 'scout.sqlite') {
    this.db = db;
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    // No migrations: an older or newer database must be removed before this version can use it.
    if (version !== 0 && version !== schemaVersion) {
      throw fail('DB_VERSION', `Database schema ${version} is not supported. Remove ${path} and its -wal/-shm files.`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects(name TEXT PRIMARY KEY, query TEXT NOT NULL, watch_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS topics(project TEXT PRIMARY KEY REFERENCES projects(name),
        label TEXT NOT NULL, topic_key TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        search_terms TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS sites(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
        template TEXT NOT NULL, options TEXT NOT NULL DEFAULT '{}', builtin INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, type TEXT NOT NULL, locator TEXT NOT NULL,
        site TEXT, state TEXT NOT NULL DEFAULT '{}', last_error TEXT, last_poll TEXT, UNIQUE(type,locator));
      CREATE TABLE IF NOT EXISTS project_sources(project TEXT REFERENCES projects(name), source TEXT REFERENCES sources(id),
        enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(project,source));
      CREATE TABLE IF NOT EXISTS source_attempts(source TEXT PRIMARY KEY REFERENCES sources(id), attempted INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, platform TEXT, kind TEXT, external_id TEXT, title TEXT,
        text TEXT, url TEXT, author TEXT, date TEXT, thread_id TEXT, parent_id TEXT, content_hash TEXT, raw_json TEXT,
        fetched_at TEXT, language TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS items_date ON items(date);
      CREATE TABLE IF NOT EXISTS source_items(source TEXT REFERENCES sources(id), item TEXT REFERENCES items(id),
        PRIMARY KEY(source,item));
      CREATE TABLE IF NOT EXISTS feed_source_items(source TEXT REFERENCES sources(id), item TEXT REFERENCES items(id),
        content_hash TEXT NOT NULL, PRIMARY KEY(source,item));
      CREATE TABLE IF NOT EXISTS evaluations(project TEXT REFERENCES projects(name), item TEXT REFERENCES items(id),
        space TEXT, watch_hash TEXT, content_hash TEXT, score REAL, context TEXT, evaluated_at TEXT,
        PRIMARY KEY(project,item,space,watch_hash,content_hash));
      CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT,
        status TEXT NOT NULL, stats TEXT NOT NULL DEFAULT '{}', errors TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS findings(url TEXT PRIMARY KEY, item TEXT REFERENCES items(id),
        run INTEGER REFERENCES runs(id), found_at TEXT NOT NULL, seen_at TEXT);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subtopics(id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL REFERENCES projects(name),
        text TEXT NOT NULL, text_key TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project, text_key));
      CREATE TABLE IF NOT EXISTS threads(item TEXT PRIMARY KEY REFERENCES items(id), url TEXT NOT NULL, source TEXT,
        title TEXT, post TEXT, comments TEXT NOT NULL DEFAULT '[]', content_hash TEXT, fetched_at TEXT,
        attempted INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE TABLE IF NOT EXISTS thread_scores(item TEXT REFERENCES items(id),
        subtopic INTEGER REFERENCES subtopics(id) ON DELETE CASCADE, space TEXT NOT NULL, content_hash TEXT NOT NULL,
        score REAL NOT NULL, context TEXT, scored_at TEXT NOT NULL, PRIMARY KEY(item, subtopic, space, content_hash));
      CREATE TABLE IF NOT EXISTS generations(id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL REFERENCES items(id),
        project TEXT NOT NULL REFERENCES projects(name), topic TEXT NOT NULL, subtopic TEXT NOT NULL, agent TEXT NOT NULL,
        model TEXT, effort TEXT, status TEXT NOT NULL, comment TEXT, error TEXT, log TEXT NOT NULL, created_at TEXT NOT NULL,
        started_at TEXT, finished_at TEXT);
      CREATE TABLE IF NOT EXISTS subtopic_findings(item TEXT REFERENCES items(id), project TEXT REFERENCES projects(name),
        run INTEGER REFERENCES runs(id), found_at TEXT NOT NULL, seen_at TEXT, PRIMARY KEY(item, project));
      PRAGMA user_version=${schemaVersion};
    `);
  }
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = work(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  project(name) {
    const row = this.db.prepare('SELECT * FROM projects WHERE name=?').get(name);
    if (!row) throw fail('PROJECT_UNKNOWN', `Unknown project: ${name}`);
    return row;
  }
  saveProject(name, query) {
    if (typeof name !== 'string' || !/^[\w-]{1,80}$/.test(name) || typeof query !== 'string' || !query.trim()) {
      throw fail('INPUT_INVALID', 'Project name must be a slug and its query must contain the search intent');
    }
    const watchHash = hash(`max-chunk-v1\n${query}`);
    this.db.prepare(`INSERT INTO projects VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET
      query=excluded.query, watch_hash=excluded.watch_hash`).run(name, query, watchHash);
    return this.project(name);
  }
  projects() { return this.db.prepare('SELECT * FROM projects ORDER BY name').all(); }
  addSource(project, type, locator, site = null) {
    this.project(project);
    const id = hash(`${type}\n${locator}`).slice(0, 24);
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO sources(id,type,locator,site) VALUES(?,?,?,?)').run(id, type, locator, site);
      if (site) this.db.prepare('UPDATE sources SET site=? WHERE id=?').run(site, id);
      this.db.prepare(`INSERT INTO project_sources VALUES(?,?,1) ON CONFLICT(project,source)
        DO UPDATE SET enabled=1`).run(project, id);
    });
    return { id, type, locator };
  }
  sources(project, enabledOnly = false) {
    this.project(project);
    return this.db.prepare(`SELECT s.*, ps.enabled FROM sources s JOIN project_sources ps ON s.id=ps.source
      WHERE ps.project=? ${enabledOnly ? 'AND ps.enabled=1' : ''} ORDER BY s.id`).all(project);
  }
  // Returns the number of items that did not exist before this ingestion.
  ingest(source, rawItems, state, { feed = false } = {}) {
    const items = rawItems.map(raw => normalizeItem(raw, source));
    const keys = ['id', 'platform', 'kind', 'external_id', 'title', 'text', 'url', 'author', 'date',
      'thread_id', 'parent_id', 'content_hash', 'raw_json', 'fetched_at', 'language'];
    const insert = this.db.prepare(`INSERT INTO items(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})
      ON CONFLICT(id) DO UPDATE SET ${keys.slice(1).filter(key => key !== 'fetched_at').map(key => `${key}=excluded.${key}`).join(',')}`);
    const exists = this.db.prepare('SELECT 1 FROM items WHERE id=?');
    return this.transaction(() => {
      let added = 0;
      for (const item of items) {
        if (!exists.get(item.id)) added++;
        insert.run(...keys.map(key => item[key]));
        this.db.prepare('INSERT OR IGNORE INTO source_items VALUES(?,?)').run(source.id, item.id);
        if (feed) this.db.prepare('INSERT OR REPLACE INTO feed_source_items VALUES(?,?,?)')
          .run(source.id, item.id, item.content_hash);
      }
      this.db.prepare('UPDATE sources SET state=?, last_poll=?, last_error=NULL WHERE id=?')
        .run(JSON.stringify(state), new Date().toISOString(), source.id);
      return added;
    });
  }
  available(project, since, feedOnly = false) {
    return this.db.prepare(`SELECT DISTINCT i.* FROM items i JOIN source_items si ON si.item=i.id
      JOIN project_sources ps ON ps.source=si.source WHERE ps.project=? AND ps.enabled=1
      AND COALESCE(i.date,i.fetched_at)>=? AND i.language IN ('en','')
      ${feedOnly ? `AND EXISTS (SELECT 1 FROM feed_source_items f JOIN sources s ON s.id=f.source
        WHERE f.source=si.source AND f.item=i.id AND f.content_hash=i.content_hash
        AND s.type IN ('automatic','rss','rsshub'))` : ''}
      ORDER BY i.id`).all(project, since);
  }
  saveEvaluations(project, space, evaluations, expectedWatch) {
    this.transaction(() => {
      if (this.project(project).watch_hash !== expectedWatch) throw fail('WATCH_CHANGED', 'Topic changed during ranking; rerun');
      const now = new Date().toISOString();
      for (const row of evaluations) this.db.prepare('INSERT OR REPLACE INTO evaluations VALUES(?,?,?,?,?,?,?,?)')
        .run(project, row.id, space, expectedWatch, row.content_hash, row.score, row.context, now);
    });
  }
  // Records first appearance of each passing URL; returns how many URLs were new.
  saveFindings(run, rows) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO findings(url,item,run,found_at) VALUES(?,?,?,?)');
    const now = new Date().toISOString();
    return this.transaction(() => rows.reduce((added, row) => added + Number(insert.run(row.url, row.id, run, now).changes), 0));
  }
  markSeen(urls = null) {
    const now = new Date().toISOString();
    if (!urls) return Number(this.db.prepare('UPDATE findings SET seen_at=? WHERE seen_at IS NULL').run(now).changes);
    return this.transaction(() => urls.reduce((count, url) => count
      + Number(this.db.prepare('UPDATE findings SET seen_at=? WHERE url=? AND seen_at IS NULL').run(now, url).changes), 0));
  }
  // A subtopic match is one discussion within one topic. Like results, it is new once, from its first match until
  // the operator marks it reviewed.
  saveSubtopicFindings(run, matches) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO subtopic_findings(item,project,run,found_at) VALUES(?,?,?,?)');
    const now = new Date().toISOString();
    return this.transaction(() => matches.reduce((added, { item, project }) =>
      added + Number(insert.run(item, project, run, now).changes), 0));
  }
  markSubtopicMatchesSeen(matches = null) {
    const now = new Date().toISOString();
    if (!matches) return Number(this.db.prepare('UPDATE subtopic_findings SET seen_at=? WHERE seen_at IS NULL').run(now).changes);
    const update = this.db.prepare('UPDATE subtopic_findings SET seen_at=? WHERE item=? AND project=? AND seen_at IS NULL');
    return this.transaction(() => matches.reduce((count, { item, topic }) => count + Number(update.run(now, item, topic).changes), 0));
  }
  setting(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  saveSetting(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(key, JSON.stringify(value));
  }
  startRun() {
    return Number(this.db.prepare("INSERT INTO runs(started_at,status) VALUES(?,'running')")
      .run(new Date().toISOString()).lastInsertRowid);
  }
  finishRun(id, status, stats = {}, errors = []) {
    this.db.prepare('UPDATE runs SET finished_at=?, status=?, stats=?, errors=? WHERE id=?')
      .run(new Date().toISOString(), status, JSON.stringify(stats), JSON.stringify(errors), id);
  }
  // A process that ended during a cycle cannot finish its run record.
  closeInterruptedRuns() {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE runs SET status='interrupted', finished_at=COALESCE(finished_at,?) WHERE status='running'").run(now);
  }
  close() { this.db.close(); }
}
