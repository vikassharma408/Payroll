// Loaded last (after app.js and every views/*.js file): fills any screens
// that haven't registered a real view yet with a placeholder, then loads/
// seeds the db and performs the initial render. Must run after every real
// view has had a chance to call registerView().

function registerPlaceholder(path, section, label) {
  registerView(path, section, label, (container) => {
    container.innerHTML = `<div class="card"><p class="text-muted">${label} screen is coming in the next update.</p></div>`;
  });
}
for (const group of SIDEBAR) {
  for (const [path, label] of group.items) {
    if (!Views[path]) registerPlaceholder(path, group.section, label);
  }
}

async function boot() {
  applyTheme(currentTheme());
  document.getElementById("theme-toggle-btn").addEventListener("click", toggleTheme);
  document.getElementById("menu-toggle-btn").addEventListener("click", () => {
    setMobileMenuOpen(!document.getElementById("sidebar").classList.contains("open"));
  });

  const loaded = await Persistence.loadDb();
  if (loaded) {
    db = migrateDb(loaded);
    await Persistence.saveDb(db);
  } else {
    db = createEmptyDb();
    seedMasterData(db);
    await Persistence.saveDb(db);
  }

  window.addEventListener("hashchange", route);
  route();
  updateBackupStatus(false);
}

boot();
