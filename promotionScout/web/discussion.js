// The post, its comments and the comments stored for it: written by other agents (RoboTeam robots) or by earlier versions.
export function createDiscussionBody({ el, when, state }) {
  return function discussionBody(row) {
    const key = `${row.id}|${row.project}`;
    const generated = row.generations;
    return el('details', { class: 'discussion-body', open: state.openDiscussions.has(key) || undefined,
      ontoggle: event => { if (event.target.open) state.openDiscussions.add(key); else state.openDiscussions.delete(key); } },
      el('summary', {}, `Post and ${row.comments.length} comment${row.comments.length === 1 ? '' : 's'}`
        + (generated.length ? ` · ${generated.length} generated` : '')),
      row.post ? el('p', {}, row.post) : el('p', { class: 'muted' }, 'The post has no text besides its title.'),
      row.comments.length ? el('ol', {}, row.comments.map(comment => el('li', {}, comment))) : null,
      generated.length ? el('div', { class: 'generated' }, el('h4', {}, 'Generated comments'),
        el('ol', {}, generated.map(generation => el('li', { class: 'generated-comment' },
          el('div', { class: 'meta' }, [generation.agent, generation.model ?? 'default model', `for “${generation.subtopic}”`,
            when(generation.finished_at)].filter(Boolean).join(' · ')),
          el('p', { class: 'comment-text' }, generation.comment))))) : null);
  };
}
