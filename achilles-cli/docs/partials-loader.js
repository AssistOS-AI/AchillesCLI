async function loadPartial(selector, target) {
  const host = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!host) return;
  try {
    const response = await fetch(target);
    if (response.ok) host.innerHTML = await response.text();
  } catch (_) {}
}

function initializeNavigation() {
  const menus = [...document.querySelectorAll(".nav-menu")];
  const closeMenus = (except = null) => menus.forEach((menu) => {
    if (menu === except) return;
    menu.classList.remove("is-open");
    menu.querySelector(".nav-trigger")?.setAttribute("aria-expanded", "false");
  });
  menus.forEach((menu) => {
    const trigger = menu.querySelector(".nav-trigger");
    trigger?.addEventListener("click", () => {
      const opening = !menu.classList.contains("is-open");
      closeMenus(menu);
      menu.classList.toggle("is-open", opening);
      trigger.setAttribute("aria-expanded", String(opening));
    });
    trigger?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      menu.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
      trigger.focus();
    });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".nav-menu")) closeMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openMenu = document.querySelector(".nav-menu.is-open");
    if (!openMenu) return;
    closeMenus();
    openMenu.querySelector(".nav-trigger")?.focus();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([
    loadPartial("#site-header", "partials/header.html"),
    loadPartial("#site-footer", "partials/footer.html"),
  ]);
  initializeNavigation();
});
