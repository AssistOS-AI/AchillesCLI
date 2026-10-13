// Browser client for the promotionScout agent. All server data is inserted as text, never as HTML.
// The page is served under /<agent>/web/; every operation is an MCP tool reached through the router at /<agent>/mcp,
// with the operator's router session.
import { call, cycleTask, defined } from './agent.js';
import { createDiscussionBody } from './discussion.js';
import { setupTheme } from './theme.js';
const $ = selector => document.querySelector(selector);
const state = { tab: 'monitor', status: null, topics: [], topicRows: [], filters: {},
  offsets: { topics: 0, sites: 0, results: 0, discussions: 0, items: 0, sources: 0, runs: 0 },
  openSubtopics: new Set(), openDiscussions: new Set(), discussionShow: 'matched',
  siteFilters: { results: new Set(), items: new Set() }, show: 'all', sort: 'new' };


function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child);
  return node;
}
const safeHref = url => /^https?:\/\//i.test(url ?? '') ? url : null;
const link = (url, text, onclick) => safeHref(url)
  ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', onclick }, text || url) : (text || url || '');
const when = value => value ? new Date(value).toLocaleString() : '—';
const badge = (text, kind = text) => el('span', { class: `badge ${kind}` }, text);
const fill = (target, rows) => target.replaceChildren(...rows);
const show = (node, message) => { node.hidden = !message; node.textContent = message ?? ''; };
const cell = (...children) => el('td', {}, ...children);
const num = value => el('td', { class: 'num' }, String(value ?? 0));

// Theme: system preference unless the operator chose one; the choice is a local convenience only.
setupTheme($('#theme'));

// Tabs keep internal ids; the address shows names that follow the pipeline. Old addresses still open the same tab.
const publicNames = { sources: 'feeds', results: 'topic-matches', discussions: 'subtopic-matches' };
const internalNames = Object.fromEntries(Object.entries(publicNames).map(([internal, name]) => [name, internal]));
// Topic matches and Collected keep their filters in the URL fragment, e.g. #topic-matches?site=bluesky&show=new&sort=score.
function hashFor(tab) {
  const query = new URLSearchParams();
  const sites = state.siteFilters[tab === 'collected' ? 'items' : tab];
  if (sites?.size) query.set('site', [...sites].join(','));
  if (tab === 'results' && state.show === 'new') query.set('show', 'new');
  if (tab === 'results' && state.sort !== 'new') query.set('sort', state.sort);
  return `#${publicNames[tab] ?? tab}${query.size ? `?${query}` : ''}`;
}
const keepHash = () => { if (location.hash !== hashFor(state.tab)) history.replaceState(null, '', hashFor(state.tab)); };
function selectTab(tab) {
  state.tab = tab;
  for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  // On narrow screens the tab bar scrolls; keep the active tab visible.
  document.querySelector(`[data-tab="${tab}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  for (const panel of document.querySelectorAll('[role="tabpanel"]')) panel.hidden = panel.id !== tab;
  keepHash();
  refresh();
}
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => selectTab(button.dataset.tab));

function renderStatus(status) {
  const known = state.status?.lastRunId ?? null;
  state.status = { ...state.status, ...status };
  if (known !== null && (status.lastRunId ?? null) < known) state.status.lastRunId = known;
  const s = state.status;
  const pill = $('#state');
  pill.className = `pill ${s.cycleRunning ? 'busy' : s.monitoring ? 'on' : ''}`;
  pill.textContent = s.cycleRunning ? `Searching (run ${s.currentRun})` : s.monitoring ? 'Monitoring' : 'Idle';
  const toggle = $('#toggle');
  toggle.textContent = s.monitoring ? 'Stop' : 'Start monitoring';
  toggle.className = s.monitoring ? 'stop' : 'primary';
  $('#interval').disabled = s.monitoring;
  if (s.intervalHours && !s.monitoring && document.activeElement !== $('#interval')) $('#interval').value = String(s.intervalHours);
  $('#next').textContent = s.monitoring && s.nextRunAt ? `Next run: ${when(s.nextRunAt)}` : '';
}

async function loadStatus() {
  const status = await call('scout_status');
  if (!$('#interval').options.length) {
    const named = { 24: 'once a day', 48: 'every 2 days', 168: 'once a week' };
    for (const hours of status.intervalChoices) {
      $('#interval').append(el('option', { value: hours }, named[hours] ?? (hours === 1 ? 'every hour' : `every ${hours} hours`)));
    }
  }
  renderStatus(status);
  // The daemon writes a heartbeat every few seconds; an old one means cycles cannot start.
  const daemonAlive = status.daemon && Date.now() - Date.parse(status.daemon.heartbeatAt) < 30000;
  fill($('#services'), [el('dt', {}, 'Agent daemon'), el('dd', {}, badge(daemonAlive ? 'running' : 'not responding', daemonAlive ? 'ok' : 'error')),
    ...Object.entries(status.services).flatMap(([name, service]) => [
      el('dt', {}, name === 'rsshub' ? 'RSSHub' : name),
      el('dd', {}, badge(service.healthy ? 'running' : 'stopped', service.healthy ? 'ok' : ''), ' ', service.url,
        status.daemon?.services?.[name]?.message ? el('span', { class: 'sub' }, status.daemon.services[name].message) : null)])]);
  const run = status.lastRun;
  fill($('#last-run'), run ? [
    el('dt', {}, 'Run'), el('dd', {}, `#${run.id} `, badge(run.status)),
    el('dt', {}, 'Started'), el('dd', {}, when(run.started_at)),
    el('dt', {}, 'New results'), el('dd', {}, String(run.stats.newResults ?? 0)),
    el('dt', {}, 'Passed / evaluated'), el('dd', {}, `${run.stats.passed ?? 0} / ${run.stats.evaluated ?? 0}`),
    el('dt', {}, 'Errors'), el('dd', {}, String(run.errors.length)),
  ] : [el('dt', {}, 'None'), el('dd', {}, 'Start monitoring to run the first search.')]);
}

$('#toggle').addEventListener('click', async () => {
  const button = $('#toggle');
  button.disabled = true;
  show($('#monitor-error'));
  try {
    renderStatus(state.status?.monitoring ? await call('scout_monitor_stop')
      : await call('scout_monitor_start', { intervalHours: Number($('#interval').value) }));
    pollStatus();
  } catch (error) { show($('#monitor-error'), error.message); }
  finally { button.disabled = false; }
});

// Shared pager: hidden for a single page; jumps back when the current page emptied after a change.
const at = name => ({ offset: state.offsets[name] });
function pager(name, page, reload) {
  const box = $(`[data-pager="${name}"]`);
  const pages = Math.max(1, Math.ceil(page.total / page.limit));
  const current = Math.min(pages, Math.floor(page.offset / page.limit) + 1);
  const go = offset => { state.offsets[name] = offset; reload(); };
  if (!page.items.length && page.offset > 0) { go((pages - 1) * page.limit); return; }
  box.hidden = page.total <= page.limit;
  fill(box, [el('button', { onclick: () => go(Math.max(0, page.offset - page.limit)), disabled: current === 1 }, '‹ Previous'),
    el('span', { class: 'muted' }, `Page ${current} of ${pages} · ${page.offset + 1}–${page.offset + page.items.length} of ${page.total}`),
    el('button', { onclick: () => go(page.offset + page.limit), disabled: current === pages }, 'Next ›')]);
}

async function loadTopics() {
  state.topics = (await call('scout_topics_list', { limit: 500 })).items;
  for (const select of document.querySelectorAll('.topic-filter')) {
    const chosen = state.filters[select.dataset.for] ?? '';
    select.replaceChildren(el('option', { value: '' }, 'All topics'),
      ...state.topics.map(topic => el('option', { value: topic.project }, topic.label)));
    select.value = state.topics.some(topic => topic.project === chosen) ? chosen : '';
  }
}
for (const select of document.querySelectorAll('.topic-filter')) select.addEventListener('change', () => {
  state.filters[select.dataset.for] = select.value;
  state.offsets[select.dataset.for === 'collected' ? 'items' : select.dataset.for] = 0;
  refresh();
});
const filter = name => ({ topic: state.filters[name] || undefined });

const list = value => value.split(',').map(part => part.trim()).filter(Boolean);
const chips = (values, auto) => values.length ? el('div', { class: 'chips' }, values.map(value => el('span', { class: auto ? 'chip auto' : 'chip' }, value)),
  auto ? el('span', { class: 'auto-note' }, 'auto') : null) : el('span', { class: 'muted' }, 'none');
const preview = async (label, terms, tags) => {
  const derived = label.trim() ? await call('scout_topic_derive', { label }) : { searchTerms: [], tags: [] };
  terms.placeholder = derived.searchTerms.length ? `auto: ${derived.searchTerms.join(', ')}` : 'derived from the topic';
  tags.placeholder = derived.tags.length ? `auto: ${derived.tags.join(', ')}` : 'derived from the topic';
};
let previewTimer;
$('#topic-input').addEventListener('input', () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => preview($('#topic-input').value, $('#topic-terms'), $('#topic-tags')).catch(() => {}), 250);
});

async function renderTopics() {
  const page = await call('scout_topics_list', at('topics'));
  state.topicRows = page.items;
  $('#topics-empty').hidden = page.total > 0;
  $('#topic-rows').closest('table').hidden = !page.total;
  pager('topics', page, renderTopics);
  fill($('#topic-rows'), page.items.flatMap(topic => [el('tr', {},
    cell(topic.label), cell(chips(topic.effective.searchTerms, topic.effective.derivedTerms)),
    cell(chips(topic.effective.tags, topic.effective.derivedTags)),
    cell(el('button', { class: 'plain', 'aria-expanded': String(state.openSubtopics.has(topic.key)),
      onclick: () => { toggleSet(state.openSubtopics, topic.key); renderTopics(); } },
      `${topic.subtopics.length} subtopic${topic.subtopics.length === 1 ? '' : 's'} ${state.openSubtopics.has(topic.key) ? '▴' : '▾'}`)),
    num(topic.sources),
    cell(el('div', { class: 'row-actions' }, el('button', { class: 'plain', onclick: () => editTopic(topic) }, 'Edit'),
      el('button', { class: 'link', onclick: () => removeTopic(topic) }, 'Remove')))),
    state.openSubtopics.has(topic.key) ? subtopicPanel(topic) : null].filter(Boolean)));
}
const toggleSet = (set, value) => { if (set.has(value)) set.delete(value); else set.add(value); };
// Subtopics are listed inline under their topic for reading; they are edited in the Edit dialog.
function subtopicPanel(topic) {
  const list = topic.subtopics.length ? el('ul', {}, topic.subtopics.map(subtopic => el('li', {}, subtopic.text)))
    : el('p', { class: 'muted' }, 'No subtopics yet. Discussions are read only for topics with at least one subtopic.');
  return el('tr', { class: 'subtopic-panel' }, el('td', { colspan: 6 }, list,
    el('button', { class: 'plain', onclick: () => editTopic(topic) }, 'Edit subtopics')));
}
// One editing surface per topic: terms, tags and the full subtopic list, saved together.
const subtopicRow = (subtopic = {}) => el('li', { 'data-id': subtopic.id ?? '' },
  el('input', { value: subtopic.text ?? '', maxlength: 500, placeholder: 'e.g. AI-generated NPC dialogue in RPGs', 'aria-label': 'Subtopic' }),
  el('button', { type: 'button', class: 'link', onclick: event => event.target.closest('li').remove() }, 'Remove'));
function editTopic(topic) {
  const dialog = $('#topic-edit');
  state.editing = topic;
  $('#edit-label').value = topic.label;
  $('#edit-terms').value = topic.search_terms.join(', ');
  $('#edit-tags').value = topic.tags.join(', ');
  fill($('#edit-subtopics'), topic.subtopics.map(subtopicRow));
  preview(topic.label, $('#edit-terms'), $('#edit-tags')).catch(() => {});
  show($('#edit-error'));
  dialog.showModal();
}
// Empty terms and tags follow the text being typed, as in the add form.
let editPreviewTimer;
$('#edit-label').addEventListener('input', () => {
  clearTimeout(editPreviewTimer);
  editPreviewTimer = setTimeout(() => preview($('#edit-label').value, $('#edit-terms'), $('#edit-tags')).catch(() => {}), 250);
});
$('#edit-add-subtopic').addEventListener('click', () => {
  const row = subtopicRow();
  $('#edit-subtopics').append(row);
  row.querySelector('input').focus();
});
// Save is the form's only submit button, so Enter in any field saves instead of cancelling.
$('#edit-cancel').addEventListener('click', () => $('#topic-edit').close());
$('#topic-edit form').addEventListener('submit', async event => {
  event.preventDefault();
  const topic = state.editing;
  const subtopics = [...$('#edit-subtopics').children].map(row => ({ id: Number(row.dataset.id) || undefined,
    text: row.querySelector('input').value }));
  try {
    await call('scout_topic_update', { key: topic.key, label: $('#edit-label').value, searchTerms: list($('#edit-terms').value),
      tags: list($('#edit-tags').value), subtopics: subtopics.map(defined) });
    $('#topic-edit').close();
    await refresh();
  } catch (error) { show($('#edit-error'), error.message); }
});
function confirmThen(text, action, work, errorTarget) {
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = action;
  $('#confirm').returnValue = '';
  $('#confirm').showModal();
  $('#confirm').addEventListener('close', async () => {
    if ($('#confirm').returnValue !== 'ok') return;
    try { await work(); } catch (error) { show(errorTarget, error.message); }
  }, { once: true });
}
function removeTopic(topic) {
  confirmThen(`Remove "${topic.label}"? Its history stays stored; adding it again restores it.`, 'Remove', async () => {
    await call('scout_topic_delete', { key: topic.key }); await refresh();
  }, $('#topic-error'));
}
$('#topic-form').addEventListener('submit', async event => {
  event.preventDefault();
  show($('#topic-error'));
  try {
    const result = await call('scout_topic_create', { label: $('#topic-input').value,
      searchTerms: list($('#topic-terms').value), tags: list($('#topic-tags').value) });
    if (result.status === 'already exists') show($('#topic-error'), `"${result.label}" already exists; use Edit to change its terms and tags.`);
    for (const id of ['#topic-input', '#topic-terms', '#topic-tags']) $(id).value = '';
    await preview('', $('#topic-terms'), $('#topic-tags'));
    await refresh();
  } catch (error) { show($('#topic-error'), error.message); }
});

// Site chips with counts; with many sites a compact dropdown replaces them.
function siteFilter(name, facets, total, reload) {
  const box = $(`[data-sites="${name}"]`);
  const chosen = state.siteFilters[name];
  const change = next => { state.siteFilters[name] = next; state.offsets[name] = 0; keepHash(); reload(); };
  const known = new Map(facets.map(site => [site.id, site]));
  for (const id of chosen) if (!known.has(id)) known.set(id, { id, name: id, count: 0 });
  const sites = [...known.values()];
  if (sites.length <= 1 && !chosen.size) { box.replaceChildren(); return; }
  if (sites.length > 10) {
    const select = el('select', { 'aria-label': 'Site', onchange: event => change(new Set(event.target.value ? [event.target.value] : [])) },
      el('option', { value: '' }, `All sites (${total})`),
      sites.map(site => el('option', { value: site.id, selected: chosen.has(site.id) }, `${site.name} (${site.count})`)));
    fill(box, [select]);
    return;
  }
  const chip = (label, count, pressed, onclick) => el('button', { type: 'button', 'aria-pressed': String(pressed), onclick },
    label, el('span', { class: 'count' }, String(count)));
  fill(box, [chip('All', total, !chosen.size, () => change(new Set())),
    ...sites.map(site => chip(site.name, site.count, chosen.has(site.id), () => {
      const next = new Set(chosen);
      if (next.has(site.id)) next.delete(site.id); else next.add(site.id);
      change(next);
    }))]);
}
const siteQuery = name => ({ sites: state.siteFilters[name].size ? [...state.siteFilters[name]] : undefined });
const siteBadges = sites => sites?.length ? sites.map(site => el('span', { class: 'site-badge' }, site.name)) : [];
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

const reviewButton = action => el('button', { class: 'review', type: 'button', onclick: action }, 'Mark reviewed');
async function markSeen(urls) {
  await call('scout_results_mark_seen', urls ? { urls } : {});
}
async function loadResults() {
  if (state.tab !== 'results') {
    // Outside the tab only the new-result count for its label is needed.
    const { newCount } = await call('scout_results_list', { limit: 1 });
    $('#new-count').hidden = !newCount; $('#new-count').textContent = String(newCount);
    return;
  }
  const page = await call('scout_results_list', { ...filter('results'), ...at('results'), ...siteQuery('results'),
    new: state.show === 'new' || undefined, sort: state.sort !== 'new' ? state.sort : undefined });
  $('#new-count').hidden = !page.newCount; $('#new-count').textContent = String(page.newCount);
  $('#results-count').textContent = `${page.all} result(s), ${page.newCount} new`;
  $('#mark-seen').disabled = !page.newCount;
  siteFilter('results', page.facets, state.show === 'new' ? page.newCount : page.all, loadResults);
  pager('results', page, loadResults);
  fill($('#result-list'), page.items.length ? page.items.map(row => el('li', { class: row.new ? 'is-new' : '' },
    el('div', { class: 'head' }, row.new ? badge('new') : null, ...siteBadges(row.sites),
      link(row.url, row.title || host(row.url), () => { if (row.new) markSeen([row.url]).then(loadResults); }),
      el('span', { class: 'score' }, `similarity ${row.score.toFixed(3)}`),
      row.new ? reviewButton(() => markSeen([row.url]).then(loadResults)) : null),
    el('div', { class: 'meta' }, `${host(row.url)} · ${row.topics.join(', ')} · found ${when(row.found_at)}`
      + (row.run ? ` in run #${row.run}` : '')),
    el('blockquote', {}, row.context ?? ''))) : [el('li', { class: 'muted' }, 'No results yet.')]);
}
for (const input of document.querySelectorAll('input[name="show"]')) input.addEventListener('change', () => {
  state.show = input.value; state.offsets.results = 0; keepHash(); loadResults();
});
$('#result-sort').addEventListener('change', () => { state.sort = $('#result-sort').value; state.offsets.results = 0; keepHash(); loadResults(); });
$('#mark-seen').addEventListener('click', async () => { await markSeen(); await loadResults(); });

const discussionBadge = count => { $('#discussion-new-count').hidden = !count; $('#discussion-new-count').textContent = String(count); };
const markDiscussionsSeen = matches => call('scout_discussions_mark_seen', matches ? { matches } : {});
const discussionBody = createDiscussionBody({ el, when, state });

async function loadDiscussions() {
  if (state.tab !== 'discussions') { discussionBadge((await call('scout_discussions_list', { limit: 1 })).newCount); return; }
  const page = await call('scout_discussions_list', { ...filter('discussions'), ...at('discussions'),
    show: state.discussionShow !== 'matched' ? state.discussionShow : undefined });
  discussionBadge(page.newCount);
  $('#mark-discussions-seen').disabled = !page.newCount;
  $('#discussions-count').textContent = `${page.matched} matched, ${page.newCount} new, of ${page.all} read`
    + (page.pending ? ` · ${page.pending} waiting for the next run` : '');
  pager('discussions', page, loadDiscussions);
  // Opening a discussion does not mark it reviewed: the operator decides that with the button.
  fill($('#discussion-list'), page.items.length ? page.items.map(row => el('li', { class: row.new ? 'is-new' : '' },
    el('div', { class: 'head' }, row.new ? badge('new') : null, ...siteBadges(row.sites), link(row.thread_url, row.title || host(row.thread_url)),
      row.winner ? el('span', { class: 'score' }, `similarity ${row.winner.score.toFixed(3)}`) : null,
      row.new ? reviewButton(() => markDiscussionsSeen([{ item: row.id, topic: row.project }]).then(loadDiscussions)) : null),
    el('div', { class: 'meta' }, [host(row.thread_url), row.topic, row.source,
      row.fetched_at ? `read ${when(row.fetched_at)}` : null].filter(Boolean).join(' · ')),
    row.error ? el('p', { class: 'error' }, `Not read: ${row.error}`)
      : el('div', {}, row.winner ? el('div', {}, badge('subtopic', 'passed'), ' ', el('strong', {}, row.winner.text))
        : el('div', { class: 'muted' }, `No subtopic reached ${page.threshold}`),
      el('div', { class: 'score-chips' }, row.scores.map(score => el('span', { class: score.passed ? 'score-chip pass' : 'score-chip' },
        `${score.text} ${score.score === null ? '—' : score.score.toFixed(3)}`))),
      discussionBody(row))))
    : [el('li', { class: 'muted' }, { all: 'No discussions read yet.', new: 'No new subtopic matches.' }[state.discussionShow]
      ?? 'No discussion matches a subtopic yet.')]);
}
$('#mark-discussions-seen').addEventListener('click', async () => { await markDiscussionsSeen(); await loadDiscussions(); });
for (const input of document.querySelectorAll('input[name="discussion-show"]')) input.addEventListener('change', () => {
  state.discussionShow = input.value; state.offsets.discussions = 0; loadDiscussions();
});

async function loadItems() {
  const page = await call('scout_items_list', { ...filter('collected'), ...at('items'), ...siteQuery('items') });
  $('#collected-count').textContent = page.all ? `${page.total} of ${page.all} entries` : 'No entries collected yet.';
  siteFilter('items', page.facets, page.all, loadItems);
  pager('items', page, loadItems);
  fill($('#item-rows'), page.items.map(item => el('tr', {},
    el('td', { class: 'wide' }, item.new ? badge('new') : null, item.new ? ' ' : null, link(item.url, item.title),
      el('span', { class: 'sub' }, item.text?.slice(0, 220) ?? '')),
    cell(...siteBadges(item.sites)), cell(item.topics.join(', ')), cell(when(item.date)), cell(when(item.fetched_at)),
    el('td', { class: 'num' }, item.score === null ? '—' : item.score.toFixed(3)),
    cell(badge(item.status, item.status === 'passed' ? 'passed' : '')))));
}

const outcome = source => source.last_error ? [badge('error'), ' ', source.last_error]
  : source.skipped ? [badge('skipped'), ' ', source.skipped]
  : source.last_poll ? badge('ok') : badge('pending', '');

async function loadSources() {
  const page = await call('scout_sources_list', { ...filter('sources'), ...at('sources') });
  pager('sources', page, loadSources);
  fill($('#source-rows'), page.items.length ? page.items.map(source => el('tr', { class: source.enabled ? '' : 'inactive' },
    el('td', { class: 'address' }, source.type === 'rsshub' ? `RSSHub ${source.locator}` : link(source.locator),
      source.enabled ? null : el('span', { class: 'sub' }, 'No longer produced by the current terms, tags or sites')),
    cell(source.site ?? '—'), cell(source.topic), cell(when(source.attempted)), num(source.items), cell(outcome(source))))
    : [el('tr', {}, el('td', { colspan: 6, class: 'muted' }, 'Feeds appear after the first run.'))]);
}

async function loadSites() {
  const page = await call('scout_sites_list', at('sites'));
  pager('sites', page, loadSites);
  fill($('#site-rows'), page.items.map(site => el('tr', { class: site.enabled ? '' : 'inactive' },
    cell(site.name, el('span', { class: 'sub' }, site.builtin ? 'built-in' : 'added by you')),
    cell(site.kind + (site.tagStyle ? ` (${site.tagStyle})` : '')), el('td', { class: 'address' }, site.template),
    num(site.feeds), num(site.entries), cell(when(site.last_poll)),
    cell(!site.enabled ? badge('disabled', '') : site.failing ? badge(`${site.failing} failing`, 'error')
      : site.last_poll ? badge('ok') : badge('pending', '')),
    cell(el('div', { class: 'row-actions' },
      el('button', { class: 'plain', onclick: () => toggleSite(site) }, site.enabled ? 'Disable' : 'Enable'),
      site.builtin ? null : el('button', { class: 'link', onclick: () => removeSite(site) }, 'Delete'))))));
}
async function toggleSite(site) {
  try { await call('scout_site_set_enabled', { id: site.id, enabled: !site.enabled }); await loadSites(); }
  catch (error) { show($('#site-error'), error.message); }
}
function removeSite(site) {
  confirmThen(`Delete "${site.name}"? Entries already collected from it stay stored.`, 'Delete', async () => {
    await call('scout_site_delete', { id: site.id }); await loadSites();
  }, $('#site-error'));
}
$('#site-kind').addEventListener('change', () => {
  const kind = $('#site-kind').value;
  $('#site-style-label').hidden = kind !== 'tag';
  $('#site-template').placeholder = kind === 'search' ? 'https://example.org/search.rss?q={query}'
    : kind === 'tag' ? 'https://example.org/tags/{tag}.rss' : 'https://example.org/feed';
});
$('#site-form').addEventListener('submit', async event => {
  event.preventDefault();
  show($('#site-error'));
  const button = event.submitter;
  button.disabled = true;
  try {
    const kind = $('#site-kind').value;
    await call('scout_site_add', { name: $('#site-name').value, kind, template: $('#site-template').value,
      ...(kind === 'tag' ? { tagStyle: $('#site-style').value } : {}) });
    $('#site-name').value = ''; $('#site-template').value = '';
    await loadSites();
  } catch (error) { show($('#site-error'), error.message); }
  finally { button.disabled = false; }
});

async function loadRuns() {
  const page = await call('scout_runs_list', at('runs'));
  pager('runs', page, loadRuns);
  fill($('#run-rows'), page.items.length ? page.items.map(run => {
    const seconds = run.finished_at ? Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000) : null;
    return el('tr', {}, num(run.id), cell(when(run.started_at)), cell(seconds === null ? '—' : `${seconds}s`), cell(badge(run.status)),
      num(run.stats.sources), num(run.stats.polled), num(run.stats.newItems), num(run.stats.notEnglish), num(run.stats.evaluated),
      num(run.stats.passed), num(run.stats.newResults),
      cell(run.errors.length ? el('details', {}, el('summary', {}, `${run.errors.length} error(s)`),
        el('ul', {}, run.errors.map(error => el('li', {}, error)))) : '—'));
  }) : [el('tr', {}, el('td', { colspan: 12, class: 'muted' }, 'No runs yet.'))]);
}

async function refresh() {
  try {
    await loadTopics();
    const work = [loadResults(), loadDiscussions()];
    if (state.tab === 'monitor') work.push(loadStatus());
    if (state.tab === 'topics') work.push(renderTopics());
    if (state.tab === 'collected') work.push(loadItems());
    if (state.tab === 'sources') work.push(loadSources());
    if (state.tab === 'sites') work.push(loadSites());
    if (state.tab === 'runs') work.push(loadRuns());
    await Promise.all(work);
  } catch (error) { show($('#monitor-error'), `Cannot reach Scout: ${error.message}`); }
}

// Polls the status tool and, while a cycle task exists, that task's log. The log of the last cycle stays visible
// until the next one starts.
let pollTimer, shownTask = null, batches = 0;
async function pollStatus() {
  clearTimeout(pollTimer);
  try {
    const finished = state.status?.lastRunId;
    const status = await call('scout_status');
    renderStatus(status);
    show($('#monitor-error'));
    // Run ids only grow, so a stale response cannot hide a finished cycle.
    if (state.status.lastRunId !== finished) refresh();
    const taskId = status.currentTaskId ?? status.lastTaskId;
    if (taskId) await showCycleLog(taskId);
  } catch (error) {
    $('#state').className = 'pill'; $('#state').textContent = 'Disconnected';
    show($('#monitor-error'), `Cannot reach Scout: ${error.message}`);
  }
  pollTimer = setTimeout(pollStatus, state.status?.cycleRunning ? 2000 : 5000);
}
async function showCycleLog(taskId) {
  const task = await cycleTask(taskId);
  const log = $('#log');
  if (taskId !== shownTask) { shownTask = taskId; batches = 0; }
  const text = task ? task.logTail ?? '' : 'The log of this cycle is no longer available (the agent restarted).\n';
  if (log.textContent === text) return;
  const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
  log.textContent = text;
  if (stick) log.scrollTop = log.scrollHeight;
  // Long runs score discussions batch by batch; show new subtopic matches as each batch ends.
  const done = (text.match(/Discussions batch /g) ?? []).length;
  if (done > batches) { batches = done; loadDiscussions().catch(() => {}); }
}

const tabs = ['monitor', 'topics', 'sites', 'results', 'discussions', 'collected', 'sources', 'runs'];
const tabFromHash = () => {
  const [name, query = ''] = location.hash.slice(1).split('?');
  const tab = internalNames[name] ?? name;
  if (!tabs.includes(tab)) return 'monitor';
  const params = new URLSearchParams(query);
  const sites = new Set((params.get('site') ?? '').split(',').filter(Boolean));
  if (tab === 'results') {
    state.siteFilters.results = sites;
    state.show = params.get('show') === 'new' ? 'new' : 'all';
    state.sort = ['new', 'found', 'score'].includes(params.get('sort')) ? params.get('sort') : 'new';
    $(`input[name="show"][value="${state.show}"]`).checked = true;
    $('#result-sort').value = state.sort;
  }
  if (tab === 'collected') state.siteFilters.items = sites;
  return tab;
};
window.addEventListener('hashchange', () => { if (tabFromHash() !== state.tab) selectTab(tabFromHash()); });
await loadStatus().catch(error => show($('#monitor-error'), `Cannot reach Scout: ${error.message}`));
selectTab(tabFromHash());
pollStatus();
