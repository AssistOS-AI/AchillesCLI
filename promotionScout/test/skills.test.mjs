import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initialize } from '../src/app/config.mjs';
import { openStore } from '../src/app/store.mjs';
import { runOperation } from '../tools/scout.mjs';
import { action as listTopics } from '../../skills/list-topics/scripts/action.mjs';
import { action as addTopic } from '../../skills/add-topic/scripts/action.mjs';
import { action as deleteTopic } from '../../skills/delete-topic/scripts/action.mjs';
import { toolValue, createScoutClient } from '../../skills/list-topics/scripts/scoutMcpClient.mjs';

const skillsDir = new URL('../../skills/', import.meta.url);
const skills = ['list-topics', 'add-topic', 'delete-topic', 'list-discussions', 'add-comments'];
const profile = { provider: 'fake', model: 'test/model', revision: 'a'.repeat(40), dtype: 'q8', dimensions: 2,
  pooling: 'mean', maxTokens: 32, queryPrefix: '', documentPrefix: '' };
const registry = { fake: { version: 'fake-v1', create: async () => ({ embed: async texts => texts.map(() => [1, 0]),
  dispose: async () => {} }) } };

// A client that runs the real Scout operations, shaped as the MCP tools return them.
async function scoutClient(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'scout-skills-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await initialize(dataDir);
  (await openStore(dataDir)).close();
  const calls = [];
  const call = async (tool, args = {}) => {
    calls.push(tool);
    assert.match(tool, /^scout_agent_/, 'skills call only the internal agent tools');
    const operation = tool.replace(/^scout_agent_/, '').replace(/_/g, '-');
    return toolValue({ content: [{ type: 'text', text: JSON.stringify(await runOperation(operation, args, { dataDir, profile, registry })) }] });
  };
  return { call, calls };
}

test('each skill is self-contained: SKILL.md frontmatter, its scripts and an identical MCP client', async () => {
  // The repository's skills/ folder may hold other skills too; these are Scout's.
  const present = await readdir(skillsDir);
  for (const skill of skills) assert.ok(present.includes(skill), skill);
  const client = await readFile(new URL('list-topics/scripts/scoutMcpClient.mjs', skillsDir), 'utf8');
  for (const skill of skills) {
    const doc = await readFile(new URL(`${skill}/SKILL.md`, skillsDir), 'utf8');
    const frontmatter = doc.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
    assert.ok(frontmatter, `${skill}: SKILL.md frontmatter`);
    assert.equal(frontmatter[1], skill);
    assert.match(doc, /node scripts\/run\.mjs/);
    assert.deepEqual((await readdir(new URL(`${skill}/scripts/`, skillsDir))).sort(), ['action.mjs', 'run.mjs', 'scoutMcpClient.mjs']);
    assert.equal(await readFile(new URL(`${skill}/scripts/scoutMcpClient.mjs`, skillsDir), 'utf8'), client, `${skill}: client copy`);
    const sources = await Promise.all(['action.mjs', 'run.mjs'].map(name => readFile(new URL(`${skill}/scripts/${name}`, skillsDir), 'utf8')));
    for (const source of sources) {
      for (const [, path] of source.matchAll(/from '([^']+)'/g)) {
        assert.ok(path.startsWith('node:') || path.startsWith('./'), `${skill}: imports only node: modules and its own files (${path})`);
      }
    }
  }
});

test('add-topic, list-topics and delete-topic manage topics and subtopics through the Scout tools', async t => {
  const client = await scoutClient(t);
  assert.equal(await listTopics('', client), 'No active topics.');

  const added = await addTopic(JSON.stringify({ topic: 'AI gaming news', subtopics: ['AI NPC dialogue', 'Procedural levels'] }), client);
  assert.match(added, /Topic "AI gaming news": added\./);
  assert.match(added, /Subtopic "AI NPC dialogue": added \[\d+\]\./);
  assert.match(added, /Subtopic "Procedural levels": added \[\d+\]\./);
  assert.match(await addTopic('Rust web frameworks', client), /Topic "Rust web frameworks": added\./);
  // An existing topic keeps its fields and gains only new subtopics.
  const again = await addTopic(JSON.stringify({ topic: 'ai GAMING news', subtopics: ['ai npc dialogue', 'Game balance'], tags: ['x'] }), client);
  assert.match(again, /already exists/);
  assert.match(again, /left unchanged/);
  assert.match(again, /Subtopic "ai npc dialogue": already exists\./);
  assert.match(again, /Subtopic "Game balance": added/);

  const listing = await listTopics('', client);
  assert.match(listing, /^2 active topics:/);
  assert.match(listing, /- AI gaming news\n {2}search terms \(derived\): ai gaming\n {2}tags \(derived\): /);
  assert.match(listing, / {4}- \[\d+\] AI NPC dialogue\n {4}- \[\d+\] Procedural levels\n {4}- \[\d+\] Game balance/);
  assert.match(listing, /- Rust web frameworks[\s\S]*subtopics: none/);
  assert.doesNotMatch(await listTopics('rust web frameworks', client), /AI gaming/);
  assert.equal(JSON.parse(await listTopics(JSON.stringify({ topic: 'AI gaming news', format: 'json' }), client))[0].subtopics.length, 3);

  // A typo among the subtopics removes nothing.
  await assert.rejects(deleteTopic(JSON.stringify({ topic: 'AI gaming news', subtopics: ['Game balance', 'missing'] }), client),
    /has no subtopic "missing"\. Its subtopics: \[\d+\] AI NPC dialogue; /);
  assert.match(await listTopics('AI gaming news', client), /Game balance/);
  const id = JSON.parse(await listTopics(JSON.stringify({ topic: 'AI gaming news', format: 'json' }), client))[0].subtopics[1].id;
  const removedSubtopics = await deleteTopic(JSON.stringify({ topic: 'ai gaming news', subtopics: ['game BALANCE', id] }), client);
  assert.match(removedSubtopics, /Subtopic "Game balance" \[\d+\] removed from "AI gaming news"\./);
  assert.match(removedSubtopics, /Subtopic "Procedural levels" \[\d+\] removed/);
  assert.match(await listTopics('AI gaming news', client), /AI NPC dialogue(?![\s\S]*Procedural)/);

  assert.match(await deleteTopic('Rust web frameworks', client), /Topic "Rust web frameworks" removed\. Its history stays stored/);
  assert.match(await listTopics('', client), /^1 active topic:\n- AI gaming news/);
  assert.match(await addTopic('rust web frameworks', client), /Topic "Rust web frameworks": restored\./);
});

test('skills report Scout errors and invalid input explicitly', async t => {
  const client = await scoutClient(t);
  await assert.rejects(deleteTopic('Unknown topic', client), error => error.code === 'TOPIC_UNKNOWN');
  await assert.rejects(deleteTopic(JSON.stringify({ topic: 'Unknown', subtopics: ['x'] }), client), /No active topic named "Unknown"/);
  await assert.rejects(addTopic('', client), /Give the topic name/);
  await assert.rejects(addTopic('{"subtopics":["x"]}', client), /topic is required/);
  await assert.rejects(addTopic('{"topic":"A","subtopics":"x"}', client), /subtopics must be a list of strings/);
  await assert.rejects(deleteTopic('{"topic":"A","subtopics":[]}', client), /non-empty list/);
  await assert.rejects(listTopics('{not json', client), /topic name or a JSON object/);
  // A rejected subtopic keeps what was saved and names what was not added.
  await assert.rejects(addTopic(JSON.stringify({ topic: 'Long subtopics', subtopics: ['ok', 'x'.repeat(501), 'later'] }), client),
    error => /Topic "Long subtopics": added\.\nSubtopic "ok": added \[\d+\]\.\nSubtopic "x+" failed: .*\nNot added: "x+", "later"\./.test(error.message));
  assert.match(await listTopics('Long subtopics', client), /\[\d+\] ok\n?$/);
});

test('toolValue unwraps the MCP result the way the Scout page does', () => {
  assert.deepEqual(toolValue({ total: 0 }), { total: 0 });
  assert.deepEqual(toolValue({ content: [{ type: 'text', text: 'stderr: warning' }, { type: 'text', text: '{"ok":1}' }] }), { ok: 1 });
  assert.throws(() => toolValue({ error: { code: 'TOPIC_UNKNOWN', message: 'Unknown topic: x' } }),
    error => error.code === 'TOPIC_UNKNOWN' && error.message === 'Unknown topic: x');
  assert.throws(() => toolValue({ content: [{ type: 'text', text: 'not json' }] }), /not JSON/);
});

test('the client loads the Ploinky SDK and context that RoboTeam mounts, and rejects secrets', async t => {
  const runtime = await mkdtemp(join(tmpdir(), 'scout-ploinky-runtime-'));
  t.after(() => rm(runtime, { recursive: true, force: true }));
  await mkdir(join(runtime, 'sdk/client'), { recursive: true });
  await writeFile(join(runtime, 'sdk/client/AgentMcpClient.mjs'), `export async function createAgentClient(agent, options) {
    return { callTool: async (tool, args) => ({ agent, options, tool, args, env: process.env.PLOINKY_TEST_SETTING }) };
  }\n`);
  const context = { version: 2, env: { PLOINKY_TEST_SETTING: 'from-context' }, userDelegationToken: 'grant' };
  await writeFile(join(runtime, 'context.json'), JSON.stringify(context));
  const client = await createScoutClient({ runtimeDirectory: runtime });
  assert.deepEqual(await client.call('scout_agent_topics_list', { limit: 1 }), { agent: 'promotionScout',
    options: { userDelegationToken: 'grant' }, tool: 'scout_agent_topics_list', args: { limit: 1 }, env: 'from-context' });
  delete process.env.PLOINKY_TEST_SETTING;

  await writeFile(join(runtime, 'context.json'), JSON.stringify({ ...context, env: { PLOINKY_MASTER_KEY: 'x' } }));
  await assert.rejects(createScoutClient({ runtimeDirectory: runtime }), /Invalid Ploinky runtime environment/);
  await writeFile(join(runtime, 'context.json'), JSON.stringify({ ...context, version: 1 }));
  await assert.rejects(createScoutClient({ runtimeDirectory: runtime }), /Unsupported Ploinky runtime context/);
});

test('run.mjs reports a missing Ploinky client and usage errors on standard error', () => {
  const env = { ...process.env, SCOUT_PLOINKY_RUNTIME: join(tmpdir(), 'scout-no-runtime-here') };
  const list = spawnSync(process.execPath, [new URL('list-topics/scripts/run.mjs', skillsDir).pathname], { env, encoding: 'utf8' });
  assert.equal(list.status, 1);
  assert.match(list.stderr, /Ploinky MCP client is unavailable/);
  const add = spawnSync(process.execPath, [new URL('add-topic/scripts/run.mjs', skillsDir).pathname], { env, encoding: 'utf8' });
  assert.equal(add.status, 1);
  assert.match(add.stderr, /Usage: node scripts\/run\.mjs --input/);
});
