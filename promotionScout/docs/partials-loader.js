(async () => {
  document.title = 'Promotion Scout Documentation';
  for (const element of document.querySelectorAll('[data-include]')) {
    try {
      const response = await fetch(element.dataset.include);
      if (!response.ok) throw new Error('Missing shared navigation');
      element.innerHTML = await response.text();
    } catch {
      element.textContent = 'Shared navigation unavailable. Serve this folder over HTTP.';
    }
  }
  const groups = [...document.querySelectorAll('.nav-group')];
  function close(group, focus = false) {
    const button = group.querySelector('button');
    button.setAttribute('aria-expanded', 'false');
    group.querySelector('.submenu').hidden = true;
    if (focus) button.focus();
  }
  for (const group of groups) group.querySelector('button').addEventListener('click', () => {
    const button = group.querySelector('button');
    const opening = button.getAttribute('aria-expanded') !== 'true';
    groups.forEach(other => close(other));
    button.setAttribute('aria-expanded', String(opening));
    group.querySelector('.submenu').hidden = !opening;
  });
  document.addEventListener('click', event => groups.forEach(group => {
    if (!group.contains(event.target)) close(group);
  }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') groups.forEach(group => {
      if (group.querySelector('button').getAttribute('aria-expanded') === 'true') close(group, true);
    });
  });
  // Markdown links are relative to specs/ in source and to this page when rendered.
  const content = document.getElementById('content');
  if (content) {
    const repair = () => {
      document.title = 'Promotion Scout Documentation';
      content.querySelectorAll('a[href^="../wiki.html"]').forEach(link => {
        link.setAttribute('href', link.getAttribute('href').slice(3));
      });
    };
    new MutationObserver(repair).observe(content, { childList: true, subtree: true });
    repair();
  }
})();
