'use strict';
// Main levels: built into the game, replaced by the server's published level pack (admins can change
// levels without a new game version). The last pack is cached, so offline play keeps working.

const Levels = {
  main: [],        // [{ id: '1-1', world, title, data }]
  version: 'builtin',
  cacheKey: 'mainpack-' + Config.name.replace(/[^A-Za-z0-9]/g, ''),

  init() {
    this.main = DATA.levelIndex.map(f => {
      const text = DATA.levels[f];
      const id = (/^id=(.+)$/m.exec(text) || [])[1] || f;
      return { id: id.trim(), world: Number((/^world=(\d+)$/m.exec(text) || [])[1] || 1), title: '', data: text };
    });
    try {
      const c = JSON.parse(localStorage.getItem(this.cacheKey) || 'null');
      if (c && Array.isArray(c.levels) && c.levels.length) { this.main = c.levels; this.version = c.version; }
    } catch (e) { /* ignore */ }
  },

  /** Fetches the published pack; callback runs only if something changed. */
  async refresh(onChange) {
    if (!Config.root) return;
    try {
      const r = await fetch(`${Config.root}/api/v1/levels/main`, { headers: { 'If-None-Match': `"${this.version}"` }, cache: 'no-cache', credentials: 'omit' });
      if (r.status !== 200) return;
      const j = await r.json();
      if (!Array.isArray(j.levels) || !j.levels.length || j.version === this.version) return;
      this.main = j.levels.map(l => ({ id: String(l.id), world: Number(l.world) || 1, title: String(l.title || ''), data: String(l.data) }));
      this.version = j.version;
      try { localStorage.setItem(this.cacheKey, JSON.stringify({ version: j.version, levels: this.main })); } catch (e) { /* ignore */ }
      if (onChange) onChange();
    } catch (e) { /* offline: keep what we have */ }
  },

  parse(i) { const l = this.main[i]; return parseLevel(l.id, l.data); },
  indexOf(id) { return this.main.findIndex(l => l.id === id); },
  worldOf(id) { return Number(String(id).split('-')[0]) || 1; },
};
