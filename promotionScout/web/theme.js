// Light, dark or system theme, remembered per browser.
function applyTheme(choice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = choice;
  try { localStorage.setItem('scout-theme', choice); } catch {}
}

export function setupTheme(select) {
  let saved = 'system';
  try { saved = localStorage.getItem('scout-theme') ?? 'system'; } catch {}
  select.value = saved; applyTheme(saved);
  select.addEventListener('change', event => applyTheme(event.target.value));
}
