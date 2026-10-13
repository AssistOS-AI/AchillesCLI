import { fail } from '../embeddings/config.mjs';
import { saveTopic, updateTopic, renameTopic, topicLimits, topicIdentity } from '../app/topics.mjs';
import { addSite, setSiteEnabled, deleteSite, tagStyles } from '../app/sites.mjs';
import { deriveFields } from '../app/derive.mjs';
import { addSubtopic, removeSubtopic, replaceSubtopics } from '../app/subtopics.mjs';
import { addComments } from '../app/comments.mjs';
import { createHttp } from '../providers/http.mjs';
import { healthy, serviceNames } from '../app/services.mjs';
import { intervalChoices } from '../app/monitor.mjs';
import { monitorStatus, startMonitoring, stopMonitoring } from '../app/control.mjs';
import { topicsView, sitesView, sourcesView, itemsView, resultsView, discussionsView, runsView, latestRun, pageSizes, siteFilter }
  from '../app/views.mjs';

const text = (value, name) => {
  if (typeof value !== 'string') throw fail('INPUT_INVALID', `${name} must be text`);
  return value;
};
const topic = input => input.topic || null;
const page = input => ({ offset: input.offset, limit: input.limit });
const sites = input => siteFilter(Array.isArray(input.sites) ? input.sites.join(',') : '');

// One function per MCP tool. Each receives the open context and the tool input and returns plain JSON.
export const operations = {
  status: async ({ store, settings, dataDir, threshold, subtopicThreshold, model }) => ({
    ...monitorStatus(store), dataDir, intervalChoices, topicLimits, tagStyles, threshold, subtopicThreshold, model, pageSizes,
    lastRun: latestRun(store),
    services: Object.fromEntries(await Promise.all(serviceNames.map(async name =>
      [name, { url: settings[`${name}Url`], healthy: await healthy(name, settings[`${name}Url`]) }]))),
  }),
  'monitor-start': ({ store }, input) => { startMonitoring(store, input.intervalHours); return monitorStatus(store); },
  'monitor-stop': ({ store }) => { stopMonitoring(store); return monitorStatus(store); },
  'topics-list': ({ store }, input) => topicsView(store, page(input)),
  'topic-create': ({ store }, input) => saveTopic(store, text(input.label, 'label'), false, input),
  // Text, terms, tags and (when sent) the full subtopic list are saved together.
  'topic-update': ({ store }, input) => store.transaction(() => {
    const original = text(input.key, 'key');
    // A new text renames the topic first; the other fields then apply to it under its new key.
    const key = input.label === undefined ? original : renameTopic(store, original, input.label).key;
    const updated = updateTopic(store, key, input);
    if (input.subtopics !== undefined) {
      const { project } = store.db.prepare('SELECT project FROM topics WHERE topic_key=?').get(topicIdentity(key).key);
      updated.subtopics = replaceSubtopics(store, project, input.subtopics);
    }
    return updated;
  }),
  'topic-delete': ({ store }, input) => saveTopic(store, text(input.key, 'key'), true),
  'topic-derive': (_, input) => deriveFields(input.label ?? ''),
  'subtopic-add': ({ store }, input) => addSubtopic(store, text(input.topic, 'topic'), input.text),
  'subtopic-remove': ({ store }, input) => removeSubtopic(store, input.id),
  'sites-list': ({ store }, input) => sitesView(store, page(input)),
  'site-add': ({ store, settings }, input) => addSite(store, input, createHttp(settings)),
  'site-set-enabled': ({ store }, input) => setSiteEnabled(store, input.id, input.enabled),
  'site-delete': ({ store }, input) => deleteSite(store, input.id),
  'sources-list': ({ store }, input) => sourcesView(store, topic(input), page(input)),
  'items-list': ({ store, space, threshold }, input) => itemsView(store, space,
    { project: topic(input), ...page(input), threshold, sites: sites(input) }),
  'results-list': ({ store, space, threshold }, input) => resultsView(store, space, { project: topic(input), threshold,
    onlyNew: input.new === true, ...page(input), sites: sites(input), sort: input.sort }),
  // Generated comments recorded before comment generation was removed are still listed with each discussion.
  'discussions-list': ({ store, space, threshold, subtopicThreshold }, input) => discussionsView(store, space,
    { project: topic(input), threshold, subtopicThreshold, ...page(input),
      show: ['all', 'new'].includes(input.show) ? input.show : 'matched' }),
  // Stores comments another agent wrote for discussions, as one batch; the Subtopic matches tab shows them.
  'comments-add': ({ store }, input) => addComments(store, input),
  'results-mark-seen': ({ store }, input) => {
    if (input.urls !== undefined && (!Array.isArray(input.urls) || input.urls.some(url => typeof url !== 'string'))) {
      throw fail('INPUT_INVALID', 'urls must be an array of strings; omit it to mark every result seen');
    }
    return { marked: store.markSeen(input.urls ?? null) };
  },
  'discussions-mark-seen': ({ store }, input) => {
    const valid = match => typeof match?.item === 'string' && typeof match?.topic === 'string';
    if (input.matches !== undefined && (!Array.isArray(input.matches) || !input.matches.every(valid))) {
      throw fail('INPUT_INVALID', 'matches must be an array of {item, topic}; omit it to mark every subtopic match reviewed');
    }
    return { marked: store.markSubtopicMatchesSeen(input.matches ?? null) };
  },
  'runs-list': ({ store }, input) => runsView(store, page(input)),
};
