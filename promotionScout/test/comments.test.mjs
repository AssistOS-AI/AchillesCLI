import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/app/store.mjs';
import { saveTopic, activeTopics } from '../src/app/topics.mjs';
import { addSubtopic } from '../src/app/subtopics.mjs';
import { searchTopics } from '../src/app/search.mjs';
import { discussionsView, topicsView } from '../src/app/views.mjs';
import { addComments } from '../src/app/comments.mjs';
import { defaults } from '../src/app/config.mjs';
import { action as listDiscussions } from '../../skills/list-discussions/scripts/action.mjs';
import { action as addCommentsSkill } from '../../skills/add-comments/scripts/action.mjs';

// One discussion read behind a result of "AI gaming news", scored against its two subtopics in a toy vector space.
async function discussion(t) {
  const dir = await mkdtemp(join(tmpdir(), 'scout-comments-'));
  const store = await openStore(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  saveTopic(store, 'AI gaming news');
  const topic = activeTopics(store)[0];
  addSubtopic(store, topic.topic_key, 'npc dialogue');
  addSubtopic(store, topic.topic_key, 'level design');
  const feed = '<rss version="2.0"><channel><item><guid>https://forum.example/t/x/1</guid>'
    + '<title>AI gaming news</title><link>https://article.example/x</link></item></channel></rss>';
  const request = async url => new URL(url).hostname === 'feeds.example' ? { body: feed }
    : new URL(url).pathname.endsWith('.json') ? Promise.reject(Object.assign(new Error('HTTP 404'), { code: 'HTTP_ERROR', status: 404 }))
      : { type: 'text/html', body: '<html><body><article>AI gaming: npc dialogue that remembers players</article></body></html>' };
  const words = ['npc', 'level', 'gaming'];
  const service = { space: 'toy', threshold: 0.5, async embed(texts) {
    return texts.map(text => {
      const vector = [...words.map(word => Number(text.toLowerCase().includes(word))), 1];
      return vector.map(value => value / Math.hypot(...vector));
    });
  } };
  await searchTopics(store, service, defaults, { request, wait: async () => {}, run: store.startRun(), now: Date.now(),
    sites: [{ id: 'feed', name: 'Feed', kind: 'feed', template: 'https://feeds.example/rss', options: {} }] });
  const view = () => discussionsView(store, 'toy', { threshold: 0.5 });
  assert.equal(view().matched, 1);
  return { store, project: topic.project, view };
}

// The agent tools, run against the store as AgentServer would run them.
function client(store) {
  const tools = {
    scout_agent_topics_list: args => topicsView(store, args),
    scout_agent_discussions_list: args => discussionsView(store, 'toy', { threshold: 0.5, project: args.topic || null,
      show: args.show, offset: args.offset, limit: args.limit }),
    scout_agent_comments_add: args => addComments(store, args),
  };
  return { call: async (tool, args) => tools[tool](args) };
}

test('a batch of comments is stored in one step and appears with its discussion in the Subtopic matches view', async t => {
  const { store, project, view } = await discussion(t);
  const [row] = view().items;
  assert.deepEqual(row.generations, []);
  const result = addComments(store, { agent: 'robot-writer', model: 'claude-opus-5-5', comments: [
    { item: row.id, project, comment: '  First line\r\nSecond line  ' },
    { item: row.id, project, comment: 'About levels', subtopic: 'LEVEL DESIGN', agent: 'robot-two', model: undefined },
  ] });
  assert.equal(result.count, 2);
  // Without a subtopic, a comment goes to the best-scoring one; shared names apply unless an entry sets its own.
  assert.deepEqual(result.comments.map(({ id, ...comment }) => comment), [
    { item: row.id, project, topic: 'AI gaming news', subtopic: 'npc dialogue', agent: 'robot-writer', model: 'claude-opus-5-5' },
    { item: row.id, project, topic: 'AI gaming news', subtopic: 'level design', agent: 'robot-two', model: 'claude-opus-5-5' },
  ]);
  addComments(store, { comments: [{ item: row.id, project, comment: 'No names' }] });
  const generations = view().items[0].generations;
  assert.deepEqual(generations.map(({ comment, agent, model, subtopic }) => ({ comment, agent, model, subtopic })), [
    { comment: 'First line\nSecond line', agent: 'robot-writer', model: 'claude-opus-5-5', subtopic: 'npc dialogue' },
    { comment: 'About levels', agent: 'robot-two', model: 'claude-opus-5-5', subtopic: 'level design' },
    { comment: 'No names', agent: 'agent', model: null, subtopic: 'npc dialogue' },
  ]);
  assert.ok(generations.every(generation => generation.finished_at));
});

test('a batch with one rejected comment stores nothing and names the entry', async t => {
  const { store, project, view } = await discussion(t);
  const item = view().items[0].id;
  const refused = (comments, code, message) => assert.throws(() => addComments(store, { comments }),
    error => error.code === code && (!message || message.test(error.message)));
  const good = { item, project, comment: 'Fine' };
  refused([good, { item: 'missing', project, comment: 'x' }], 'DISCUSSION_UNKNOWN', /^comments\[1\]: /);
  refused([good, { item, project: 'missing', comment: 'x' }], 'DISCUSSION_UNKNOWN');
  refused([good, { item, project, comment: 'x', subtopic: 'unknown' }], 'SUBTOPIC_UNKNOWN', /comments\[1\]: Topic "AI gaming news" has no subtopic "unknown"/);
  refused([{ item, project, comment: '   ' }], 'INPUT_INVALID', /^comments\[0\]: comment needs/);
  refused([{ item, project, comment: 'x'.repeat(10001) }], 'INPUT_INVALID');
  refused([{ item, project, comment: 'bad \u0007 bell' }], 'INPUT_INVALID');
  refused([{ item, project }], 'INPUT_INVALID');
  refused([good, 'text'], 'INPUT_INVALID', /comments\[1\] must be an object/);
  refused([], 'INPUT_INVALID', /1–100 comments/);
  refused(Array.from({ length: 101 }, () => good), 'INPUT_INVALID');
  assert.throws(() => addComments(store, {}), { code: 'INPUT_INVALID' });
  assert.deepEqual(view().items[0].generations, [], 'no rejected batch stored anything');
  // A removed topic's discussions take no new comments.
  store.db.prepare('UPDATE topics SET active=0 WHERE project=?').run(project);
  refused([good], 'DISCUSSION_UNKNOWN');
});

test('list-discussions and add-comments let an agent read discussions and store comments in one batch', async t => {
  const { store, project, view } = await discussion(t);
  const agent = client(store);
  const listing = await listDiscussions('AI gaming news', agent);
  const [row] = view().items;
  assert.match(listing, /^1 matched discussion; showing 1–1\./);
  assert.match(listing, new RegExp(`item: ${row.id}\\n {4}project: ${project}\\n {4}topic: AI gaming news`));
  assert.match(listing, /subtopic: npc dialogue \(similarity \d\.\d{3}\) \[new\]/);
  assert.match(listing, /post: AI gaming: npc dialogue that remembers players/);
  assert.match(listing, /stored comments: none/);
  assert.match(listing, /add-comments skill/);
  await assert.rejects(listDiscussions('Unknown topic', agent), /No active topic named "Unknown topic"/);
  await assert.rejects(listDiscussions('{"show":"other"}', agent), /show must be matched, new or all/);
  assert.equal(JSON.parse(await listDiscussions('{"format":"json"}', agent)).items[0].id, row.id);

  const result = await addCommentsSkill(JSON.stringify({ agent: 'robot-writer', model: 'claude-opus-5-5', comments: [
    { item: row.id, project, comment: 'Shared NPC memory is the hard part.' },
    { item: row.id, project, comment: 'Level pacing matters too.', subtopic: 'level design', agent: 'robot-two' },
  ] }), agent);
  assert.match(result, /^Stored 2 comments:\n- \[\d+\] item .* \(topic "AI gaming news", subtopic "npc dialogue", by robot-writer\/claude-opus-5-5\)\n- \[\d+\] .*subtopic "level design", by robot-two\/claude-opus-5-5\)$/);
  assert.deepEqual(view().items[0].generations.map(generation => generation.agent), ['robot-writer', 'robot-two']);
  assert.match(await listDiscussions('', agent), /stored comments \(2\):\n {6}- robot-writer\/claude-opus-5-5 for "npc dialogue": Shared NPC memory/);
  // A single comment object is a batch of one.
  assert.match(await addCommentsSkill(JSON.stringify({ item: row.id, project, comment: 'Third.' }), agent), /^Stored 1 comment:/);

  // One rejected entry stores none of the batch.
  await assert.rejects(addCommentsSkill(JSON.stringify({ comments: [
    { item: row.id, project, comment: 'Fourth.' }, { item: 'missing', project, comment: 'x' },
  ] }), agent), error => error.code === 'DISCUSSION_UNKNOWN' && /^No comment was stored: comments\[1\]: /.test(error.message));
  assert.equal(view().items[0].generations.length, 3);
  await assert.rejects(addCommentsSkill('not json', agent), /Input must be JSON/);
  await assert.rejects(addCommentsSkill('{"item":"a","project":"b"}', agent), /comment is required \(comments\[0\]\)/);
  await assert.rejects(addCommentsSkill('{"comments":[{"item":"a","project":"b","comment":"c","extra":1}]}', agent), /Unknown field extra/);
  await assert.rejects(addCommentsSkill('{"comments":[],"agent":"x"}', agent), /1–100 comments/);
  await assert.rejects(addCommentsSkill('{"comments":[{"item":"a","project":"b","comment":"c"}],"other":1}', agent), /Unknown field other/);
});
