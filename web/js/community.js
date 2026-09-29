'use strict';
// Community levels: browse (most liked / newest / most played, search), play, like, leaderboard, report.

class CommunityScene {
  constructor(state) {
    const s = state || {};
    this.sort = s.sort || 'top'; this.q = s.q || ''; this.page = s.page || 1;
    this.t = 0; this.list = null; this.total = 0; this.error = null; this.sel = s.sel || 0;
    this.load();
  }
  state() { return { sort: this.sort, q: this.q, page: this.page, sel: this.sel }; }
  async load() {
    this.list = null; this.error = null;
    if (!Online.enabled) { this.error = Loc.t('online.not_configured'); return; }
    const r = await Online.call('GET', `/community?sort=${this.sort}&page=${this.page}&q=${encodeURIComponent(this.q)}`, null, true);
    if (r.error) { this.error = Loc.t(Online.errorKey(r.error)); return; }
    this.list = r.data.levels; this.total = r.data.total;
    this.sel = Math.min(this.sel, Math.max(0, this.list.length - 1));
  }
  tabs() { return [['top', Loc.t('online.by_top')], ['new', Loc.t('online.by_new')], ['plays', Loc.t('online.by_plays')]]; }
  tabRect(i) { return { x: 200 + i * 230, y: 110, w: 215, h: 50 }; }
  cardRect(i) { const c = i % 2, r = Math.floor(i / 2); return { x: 130 + c * 520, y: 180 + r * 84, w: 500, h: 72 }; }
  searchRect() { return { x: 900, y: 110, w: 240, h: 50 }; }
  pageRect(d) { return d < 0 ? { x: 130, y: 610, w: 120, h: 50 } : { x: 1030, y: 610, w: 120, h: 50 }; }
  buildRect() { return { x: 480, y: 610, w: 320, h: 50 }; }
  update(dt) {
    this.t += dt;
    if (!document.getElementById('form').hidden) return;
    const n = this.list ? Math.min(10, this.list.length) : 0;
    this.tabs().forEach(([k], i) => { if (Input.click && Ui.hover(this.tabRect(i)) && this.sort !== k) { this.sort = k; this.page = 1; Audio.play('menuMove'); this.load(); } });
    if (Input.click && Ui.hover(this.searchRect())) this.search();
    if (Input.kp('KeyF')) this.search();
    if (Input.click && Ui.hover(this.buildRect())) Scenes.go(new EditorListScene());
    const pages = Math.max(1, Math.ceil(this.total / 20));
    if ((Input.click && Ui.hover(this.pageRect(-1)) || Input.kp('PageUp')) && this.page > 1) { this.page--; this.load(); }
    if ((Input.click && Ui.hover(this.pageRect(1)) || Input.kp('PageDown')) && this.page < pages) { this.page++; this.load(); }
    if (n) {
      const prev = this.sel;
      if (Input.menuRight) this.sel = Math.min(n - 1, this.sel + 1);
      if (Input.menuLeft) this.sel = Math.max(0, this.sel - 1);
      if (Input.menuDown) this.sel = Math.min(n - 1, this.sel + 2);
      if (Input.menuUp) this.sel = Math.max(0, this.sel - 2);
      let click = false;
      for (let i = 0; i < n; i++) if (Ui.hover(this.cardRect(i))) { if (Input.mouse.moved && !Input.isTouch) this.sel = i; if (Input.click) { this.sel = i; click = true; } }
      if (prev !== this.sel) Audio.play('menuMove');
      if (Input.confirm || click) { Audio.play('menuSelect'); const st = this.state(); Scenes.go(new CommunityLevelScene(this.list[this.sel].id, () => new CommunityScene(st), this.list[this.sel])); return; }
    }
    if (backPressed()) Scenes.go(new TitleScene());
  }
  search() {
    Form.onCancel = () => Form.hide();
    Form.show(Loc.t('community.title'), [{ id: 'q', label: Loc.t('community.search'), value: this.q, max: 40 }],
      [{ label: Loc.t('community.search'), submit: true, action: v => { Form.hide(); this.q = v.q.trim(); this.page = 1; this.load(); } },
        { label: Loc.t('menu.back'), action: () => Form.hide() }]);
  }
  draw() {
    Backdrop.draw(this.t, false);
    Backdrop.header(Loc.t('community.title'), 24);
    this.tabs().forEach(([k, label], i) => Ui.button(this.tabRect(i), label, this.sort === k, 24));
    Ui.button(this.searchRect(), this.q ? '🔍 ' + this.q : '🔍 ' + Loc.t('community.search'), false, 22);
    if (this.error) Ui.textBlock(this.error, VW / 2, 300, 28, 800);
    else if (!this.list) Ui.text('...', VW / 2, 330, 34, '#fff', 'center');
    else if (!this.list.length) Ui.textBlock(Loc.t('community.empty'), VW / 2, 300, 28, 800);
    else this.list.slice(0, 10).forEach((l, i) => {
      const r = this.cardRect(i), sel = i === this.sel, th = Themes[l.world] || Themes[1];
      Ui.rrect(r.x, r.y, r.w, r.h, 16, sel ? C.accent : 'rgba(30,48,90,0.94)', sel ? '#fff' : rgba(th.cap, 0.9));
      const fg = sel ? C.ink : '#fff';
      let s = 28; while (s > 16 && Ui.measure(l.title, s) > 330) s -= 2;
      Ui.text(l.title, r.x + 16, r.y + 8, s, fg, 'left', !sel);
      Ui.text(Loc.f('community.by', l.author), r.x + 16, r.y + 42, 18, sel ? C.ink : 'rgb(170,200,240)', 'left', false);
      Ui.text(`${l.liked ? '♥' : '♡'} ${l.likes}   ▶ ${l.plays}`, r.x + r.w - 16, r.y + 24, 22, fg, 'right', !sel);
    });
    const pages = Math.max(1, Math.ceil(this.total / 20));
    if (this.page > 1) Ui.button(this.pageRect(-1), '◀', false, 26);
    if (this.page < pages) Ui.button(this.pageRect(1), '▶', false, 26);
    Ui.button(this.buildRect(), '✎ ' + Loc.t('editor.title'), false, 24);
    if (pages > 1) Ui.text(`${this.page} / ${pages}`, VW / 2, 578, 20, 'rgb(40,60,100)', 'center', false);
    backButton();
  }
}

class CommunityLevelScene {
  constructor(code, back, info) {
    this.code = code; this.back = back; this.info = info || null; this.t = 0; this.menu = new Menu(); this.msg = null;
    this.level = null; this.top = null;
    this.load();
  }
  async load() {
    const r = await Online.call('GET', '/community/' + this.code, null, true);
    if (r.error) { this.msg = Loc.t(Online.errorKey(r.error)); return; }
    this.level = r.data; this.info = r.data;
    const t = await Online.top(this.code, 'time', 5);
    this.top = t.data ? t.data.entries : [];
  }
  items() { return [Loc.t('menu.play'), (this.info && this.info.liked ? '♥ ' : '♡ ') + Loc.t('community.like'), Loc.t('online.leaderboard'), Loc.t('community.report'), Loc.t('menu.back')]; }
  layout() { this.menu.rects = this.items().map((_, i) => ({ x: 120, y: 250 + i * 70, w: 380, h: 58 })); }
  play() {
    if (!this.level) return;
    const back = () => new CommunityLevelScene(this.code, this.back, this.info);
    Session.lives = 3;
    Scenes.go(new PlayScene(-1, null, { code: this.code, kind: 'community', data: parseLevel(this.code, this.level.data), title: this.level.title, author: this.level.author, back }));
  }
  async like() {
    if (!Online.loggedIn) { this.msg = Loc.t('community.login_needed'); return; }
    const r = await Online.call('POST', `/community/${this.code}/like`, {});
    if (r.data) { this.info.liked = r.data.liked; this.info.likes = r.data.likes; } else this.msg = Loc.t(Online.errorKey(r.error));
  }
  report() {
    Form.onCancel = () => Form.hide();
    Form.show(Loc.t('community.report'), [{ id: 'reason', label: Loc.t('community.report_reason'), max: 200 }],
      [{ label: Loc.t('community.report'), submit: true, action: async v => { Form.hide(); const r = await Online.call('POST', `/community/${this.code}/report`, { reason: v.reason }); this.msg = r.error ? Loc.t(Online.errorKey(r.error)) : Loc.t('community.reported'); } },
        { label: Loc.t('menu.back'), action: () => Form.hide() }]);
  }
  update(dt) {
    this.t += dt;
    if (!document.getElementById('form').hidden) return;
    this.layout();
    const r = this.menu.update(this.items().length);
    if (r === 0) this.play();
    if (r === 1) this.like();
    if (r === 2) Scenes.go(new LeaderboardScene(this.code, () => new CommunityLevelScene(this.code, this.back, this.info)));
    if (r === 3) this.report();
    if (r === 4 || backPressed()) Scenes.go(this.back());
  }
  draw() {
    Backdrop.draw(this.t, false);
    const i = this.info;
    let s = 58; const title = i ? i.title : '...';
    while (s > 28 && Ui.measure(title, s) > 1100) s -= 4;
    Ui.title(title, VW / 2, 40, s, '#fff', 'rgb(30,50,100)');
    if (i) Ui.text(`${Loc.f('community.by', i.author)}   ·   ${i.liked ? '♥' : '♡'} ${i.likes}   ·   ▶ ${i.plays}`, VW / 2, 130, 24, 'rgb(40,60,100)', 'center', false);
    this.layout();
    this.items().forEach((t, k) => Ui.button(this.menu.rects[k], t, this.menu.selected === k, 26));
    Ui.panel(560, 190, 620, 420);
    Ui.text(Loc.t('online.by_time'), 870, 206, 26, C.accent, 'center');
    if (this.top === null) Ui.text('...', 870, 300, 30, '#fff', 'center');
    else if (!this.top.length) Ui.textBlock(Loc.t('online.empty'), 870, 300, 24, 540);
    else this.top.forEach((e, k) => {
      const y = 260 + k * 60;
      Ui.text(`${e.rank}. ${e.name}${e.registered ? ' ✓' : ''}`, 600, y, 26, '#fff');
      Ui.text(Online.fmt(e.timeTicks), 1150, y, 26, '#fff', 'right');
    });
    if (this.level) {
      // mini map of the level
      const rows = this.level.data.split('\n'), start = rows.indexOf('---') + 1, map = rows.slice(start, start + 15);
      const w = Math.max(...map.map(r => r.length)), px = Math.min(4, 600 / w);
      for (let y = 0; y < map.length; y++) for (let x = 0; x < map[y].length; x++) {
        const c = map[y][x]; if (c === ' ') continue;
        g.fillStyle = MINI_COLORS[c] || 'rgba(255,255,255,0.7)';
        g.fillRect(580 + x * px, 540 + y * px, px, px);
      }
    }
    if (this.msg) Ui.textBlock(this.msg, VW / 2, 640, 22, 1000);
    backButton();
  }
}

const MINI_COLORS = { '#': '#6b8fc7', B: '#9fc7ec', '?': '#f2b632', F: '#f2b632', S: '#f2b632', W: '#f2b632', H: '#f2b632', E: '#b98b52', o: '#ffd24a', '-': '#8a6a4a',
  x: '#bfe6ff', '^': '#c9cfd8', '~': '#ff6a3a', M: '#a3784a', V: '#a3784a', '*': '#ff4f7b', C: '#39d98a', G: '#ffffff', '@': '#20263c', e: '#a877e6', s: '#e05656', b: '#57c1ff', h: '#76d35b', i: '#dff4ff', '!': '#c69a5b' };
