'use strict';
// Level editor (community levels and, for admins, the main levels).
// A level is 15 rows of tile characters (legend in Claude Game/Game/Level.cs).
// Community levels: saved on the device, uploaded as a draft when logged in, and published only after the
// author finished the exact draft once (the server replays that run). Main levels: saved/published via the
// admin panel's session (opened from /admin/ with ?admin-edit=<id>).

const ED = { S: 32, TOP: 72, ROWS: 15 };
ED.MAP_H = ED.S * ED.ROWS;              // 480
ED.BAR_Y = ED.TOP + ED.MAP_H + 4;       // scroll bar
ED.PAL_Y = ED.BAR_Y + 22;               // palette

const TOOLS = ['#', 'B', '?', 'o', '-', 'x', '^', '~', '*', 'M', 'V', 'F', 'S', 'W', 'H', 'C', 'e', 's', 'b', 'h', 'i', '@', 'G', ' ', 'hand'];
const TOOL_KEYS = { '#': 'ground', B: 'brick', '?': 'coinblock', o: 'coin', '-': 'oneway', x: 'crumble', '^': 'spikes', '~': 'liquid', '*': 'spring',
  M: 'platform', V: 'platformv', F: 'fish', S: 'snowflake', W: 'wings', H: 'heart', C: 'checkpoint', e: 'walker', s: 'spiky', b: 'bird', h: 'hopper',
  i: 'icicle', '@': 'start', G: 'goal', ' ': 'eraser', hand: 'hand', '!': 'sign' };

// ------------------------------------------------------------------ storage of drafts on this device
const EditorStore = {
  key: 'editor-' + Config.name.replace(/[^A-Za-z0-9]/g, ''),
  all() { try { const a = JSON.parse(localStorage.getItem(this.key) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } },
  put(doc) {
    const a = this.all().filter(d => d.id !== doc.id);
    a.unshift({ id: doc.id, code: doc.code || null, title: doc.title, world: doc.world, rows: doc.rows, updatedAt: Date.now() });
    try { localStorage.setItem(this.key, JSON.stringify(a.slice(0, 60))); } catch (e) { /* storage full */ }
  },
  remove(id) { try { localStorage.setItem(this.key, JSON.stringify(this.all().filter(d => d.id !== id))); } catch (e) { /* ignore */ } },
};

function newDoc() {
  const rows = Array(ED.ROWS).fill('');
  rows[11] = '   @' + ' '.repeat(34) + 'G';
  rows[12] = '#'.repeat(40); rows[13] = '#'.repeat(40); rows[14] = '#'.repeat(40);
  return { id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), code: null, title: Loc.t('editor.untitled'), world: 1, rows, signs: [] };
}

// ------------------------------------------------------------------ admin backend (main levels)
const AdminBackend = {
  csrf: '',
  async call(method, path, body) {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = this.csrf; }
    const r = await fetch(`${Config.root}/admin/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (j.csrf) this.csrf = j.csrf;
    if (!r.ok) throw new Error(j.message || j.error || 'error');
    return j;
  },
  /** returns a doc that the editor fills once loaded */
  open(code) {
    const doc = { id: 'admin-' + code, code, admin: true, loading: true, title: '', world: 1, rows: Array(ED.ROWS).fill(''), signs: [] };
    (async () => {
      try {
        const st = await this.call('GET', '/state');
        if (st.stage !== 'ready') throw new Error(Loc.t('editor.admin_login'));
        const l = await this.call('GET', '/levels/main/' + encodeURIComponent(code));
        Object.assign(doc, { title: l.title, world: l.world, rows: l.rows, signs: l.signs, loading: false });
      } catch (e) { doc.loading = false; doc.error = e.message; }
    })();
    return doc;
  },
};

// ------------------------------------------------------------------ list of own levels
class EditorListScene {
  constructor() { this.t = 0; this.sel = 0; this.server = null; this.msg = null; this.loadServer(); }
  static openServer(code) {
    const s = new EditorListScene();
    s.pendingOpen = code;
    return s;
  }
  async loadServer() {
    if (!Online.loggedIn) { this.server = []; return; }
    const r = await Online.call('GET', '/my/levels');
    this.server = r.data ? r.data.levels : [];
    if (r.error) this.msg = Loc.t(Online.errorKey(r.error));
    if (this.pendingOpen) {
      const l = this.server.find(x => x.id === this.pendingOpen);
      if (l) Scenes.go(new EditorScene(this.docFromServer(l)));
      else this.msg = Loc.t(Online.loggedIn ? 'editor.not_found' : 'editor.login_needed');
      this.pendingOpen = null;
    }
  }
  docFromServer(l) {
    const local = EditorStore.all().find(d => d.code === l.id);
    return { id: local ? local.id : 'l' + l.id, code: l.id, title: l.title, world: l.world, rows: l.rows, signs: [], status: l.status };
  }
  entries() {
    const local = EditorStore.all();
    const out = local.map(d => ({ doc: d, status: (this.server || []).find(s => s.id === d.code)?.status || (d.code ? 'draft' : 'local') }));
    for (const s of this.server || []) if (!local.some(d => d.code === s.id)) out.push({ doc: this.docFromServer(s), status: s.status });
    return out;
  }
  rect(i) { return { x: 140 + (i % 2) * 510, y: 200 + Math.floor(i / 2) * 76, w: 490, h: 64 }; }
  update(dt) {
    this.t += dt;
    const list = this.entries().slice(0, 10), n = list.length + 1; // +1 = "new level"
    const prev = this.sel;
    if (Input.menuDown) this.sel = Math.min(n - 1, this.sel + (this.sel === 0 ? 1 : 2));
    if (Input.menuUp) this.sel = Math.max(0, this.sel - 2);
    if (Input.menuRight) this.sel = Math.min(n - 1, this.sel + 1);
    if (Input.menuLeft) this.sel = Math.max(0, this.sel - 1);
    let click = false;
    const newRect = { x: VW / 2 - 220, y: 120, w: 440, h: 60 };
    if (Ui.hover(newRect)) { if (Input.mouse.moved && !Input.isTouch) this.sel = 0; if (Input.click) { this.sel = 0; click = true; } }
    list.forEach((_, i) => { if (Ui.hover(this.rect(i))) { if (Input.mouse.moved && !Input.isTouch) this.sel = i + 1; if (Input.click) { this.sel = i + 1; click = true; } } });
    if (prev !== this.sel) Audio.play('menuMove');
    if (Input.confirm || click) {
      Audio.play('menuSelect');
      Scenes.go(new EditorScene(this.sel === 0 ? newDoc() : JSON.parse(JSON.stringify(list[this.sel - 1].doc))));
    } else if (backPressed()) Scenes.go(new TitleScene());
  }
  draw() {
    Backdrop.draw(this.t, false);
    Backdrop.header(Loc.t('editor.title'), 24);
    Ui.button({ x: VW / 2 - 220, y: 120, w: 440, h: 60 }, '+ ' + Loc.t('editor.new'), this.sel === 0, 28);
    const list = this.entries().slice(0, 10);
    if (this.server === null) Ui.text('...', VW / 2, 220, 26, '#fff', 'center');
    list.forEach((e, i) => {
      const r = this.rect(i), sel = this.sel === i + 1;
      Ui.rrect(r.x, r.y, r.w, r.h, 16, sel ? C.accent : 'rgba(30,48,90,0.94)', sel ? '#fff' : '#78aae6');
      Ui.text(e.doc.title, r.x + 16, r.y + 8, 26, sel ? C.ink : '#fff', 'left', !sel);
      Ui.text(Loc.t('editor.status_' + e.status), r.x + 16, r.y + 38, 18, sel ? C.ink : 'rgb(170,200,240)', 'left', false);
    });
    if (!Online.loggedIn) Ui.textBlock(Loc.t('editor.login_needed'), VW / 2, 600, 22, 1000);
    if (this.msg) Ui.textBlock(this.msg, VW / 2, 640, 22, 1000);
    backButton();
  }
}

// ------------------------------------------------------------------ the editor
class EditorScene {
  constructor(doc) {
    this.doc = doc;
    this.t = 0; this.camX = 0; this.tool = '#'; this.undo = []; this.painting = false; this.dirty = false;
    this.msg = doc.admin ? Loc.f('editor.admin', doc.code) : Loc.t('editor.hint'); this.msgT = 6;
    this.width = Math.max(40, ...doc.rows.map(r => r.length));
    this.busy = false;
    Audio.playMusic(-1);
  }

  // ---- geometry
  cols() { return Math.floor(VW / ED.S); }
  maxCam() { return Math.max(0, this.width - this.cols()); }
  cell(mx, my) { return { x: Math.floor(mx / ED.S + this.camX), y: Math.floor((my - ED.TOP) / ED.S) }; }
  inMap(mx, my) { return my >= ED.TOP && my < ED.TOP + ED.MAP_H; }
  palRect(i) { const perRow = 13, w = VW / perRow; return { x: (i % perRow) * w + 4, y: ED.PAL_Y + Math.floor(i / perRow) * 60, w: w - 8, h: 54 }; }
  buttons() {
    const b = [
      ['back', '◀', 12, 64], ['title', this.doc.title, 84, 300], ['world', Loc.t('editor.world') + ' ' + this.doc.world, 392, 150],
      ['narrow', '−', 550, 50], ['wide', '+', 604, 50], ['undo', '↶', 662, 56], ['test', '▶ ' + Loc.t('editor.test'), 726, 160],
      ['save', Loc.t('editor.save'), 894, 170], ['publish', Loc.t('editor.publish'), 1072, 196],
    ];
    return b.map(([id, label, x, w]) => ({ id, label, r: { x, y: 8, w, h: 54 } }));
  }
  say(text, secs = 5) { this.msg = text; this.msgT = secs; }

  // ---- editing
  get(x, y) { const r = this.doc.rows[y] || ''; return x < r.length ? r[x] : ' '; }
  set(x, y, c) {
    if (y < 0 || y >= ED.ROWS || x < 0 || x >= this.width) return;
    if (!this.doc.admin && c === '!') return;
    if (c === '@' || c === 'G') {
      // unique: remove the old one
      this.doc.rows = this.doc.rows.map(r => r.split(c).join(' '));
    }
    let r = this.doc.rows[y].padEnd(x + 1, ' ');
    r = r.slice(0, x) + c + r.slice(x + 1);
    this.doc.rows[y] = r.replace(/ +$/, '');
    this.dirty = true;
  }
  pushUndo() { this.undo.push(this.doc.rows.slice()); if (this.undo.length > 60) this.undo.shift(); }
  checkLevel() {
    const all = this.doc.rows.join('\n');
    if ((all.match(/@/g) || []).length !== 1) return Loc.t('editor.need_start');
    if ((all.match(/G/g) || []).length !== 1) return Loc.t('editor.need_goal');
    if (Math.max(...this.doc.rows.map(r => r.length)) < 20) return Loc.t('editor.too_small');
    return null;
  }
  levelText(code) { return `id=${code}\nworld=${this.doc.world}\n${this.doc.signs && this.doc.signs.length ? 'signs=' + this.doc.signs.join(',') + '\n' : ''}---\n${this.doc.rows.join('\n')}\n`; }

  update(dt) {
    this.t += dt;
    if (this.msgT > 0) this.msgT -= dt;
    if (this.doc.loading || this.busy || !document.getElementById('form').hidden) return;
    if (this.doc.error) { if (Input.click || Input.back) location.href = Config.root + '/admin/'; return; }
    const m = Input.mouse;
    // scrolling: wheel, arrow keys, hand tool, scroll bar
    const step = dt * 30;
    if (Input.k('ArrowRight', 'KeyD')) this.camX += step;
    if (Input.k('ArrowLeft', 'KeyA')) this.camX -= step;
    if (m.wheelY || m.wheelX) this.camX += (m.wheelX || m.wheelY) / 40;
    if (m.down && m.y >= ED.BAR_Y && m.y < ED.PAL_Y) this.camX = (m.x / VW) * this.width - this.cols() / 2;
    if ((Input.k('ControlLeft', 'ControlRight', 'MetaLeft') && Input.kp('KeyZ')) || false) this.doUndo();
    // toolbar
    if (Input.click) for (const b of this.buttons()) if (Ui.hover(b.r)) { this.command(b.id); return; }
    // palette
    if (Input.click) TOOLS.forEach((t, i) => { if (Ui.hover(this.palRect(i))) { this.tool = t; Audio.play('menuMove'); this.say(Loc.t('editor.tool.' + TOOL_KEYS[t]), 3); } });
    if (Input.kp('KeyH')) this.tool = 'hand';
    // painting / dragging
    if (m.down && this.inMap(m.x, m.y)) {
      if (this.tool === 'hand') {
        if (this.dragFrom === undefined) this.dragFrom = { x: m.x, cam: this.camX };
        this.camX = this.dragFrom.cam - (m.x - this.dragFrom.x) / ED.S;
      } else {
        if (!this.painting) { this.pushUndo(); this.painting = true; }
        const { x, y } = this.cell(m.x, m.y);
        const c = m.button === 2 ? ' ' : this.tool;
        if (this.get(x, y) !== c) this.set(x, y, c);
      }
    }
    if (!m.down) { this.painting = false; this.dragFrom = undefined; }
    this.camX = Math.max(0, Math.min(this.maxCam(), this.camX));
    if (Input.kp('Escape')) this.command('back');
  }

  doUndo() { if (this.undo.length) { this.doc.rows = this.undo.pop(); this.dirty = true; } }

  command(id) {
    Audio.play('menuSelect');
    switch (id) {
      case 'back':
        if (!this.doc.admin) EditorStore.put(this.doc);
        Scenes.go(this.doc.admin ? new TitleScene() : new EditorListScene());
        break;
      case 'title':
        Form.onCancel = () => Form.hide();
        Form.show(Loc.t('editor.rename'), [{ id: 'title', label: Loc.t('editor.rename'), value: this.doc.title, max: 40 }],
          [{ label: 'OK', submit: true, action: v => { Form.hide(); this.doc.title = v.title.trim().slice(0, 40) || this.doc.title; this.dirty = true; } }, { label: Loc.t('menu.back'), action: () => Form.hide() }]);
        break;
      case 'world': this.doc.world = this.doc.world % 4 + 1; this.dirty = true; break;
      case 'narrow':
        if (this.width > 20) { this.pushUndo(); this.width -= 10; this.doc.rows = this.doc.rows.map(r => r.slice(0, this.width).replace(/ +$/, '')); this.dirty = true; }
        break;
      case 'wide': if (this.width < 300) { this.width = Math.min(300, this.width + 10); this.camX = this.maxCam(); } break;
      case 'undo': this.doUndo(); break;
      case 'test': this.test(null); break;
      case 'save': this.save(); break;
      case 'publish': this.publish(); break;
    }
  }

  test(verifyRun, onDone) {
    const err = this.checkLevel();
    if (err) { this.say(err); return; }
    if (!this.doc.admin) EditorStore.put(this.doc);
    const code = verifyRun ? this.doc.code : 'test';
    Session.lives = 3;
    Scenes.go(new PlayScene(-1, null, {
      kind: 'test', code, title: this.doc.title, verifyRun,
      data: parseLevel(code, this.levelText(code)),
      back: () => this,
      done: r => { Scenes.go(this); if (onDone) onDone(r); else if (r.completed) this.say(Loc.t('editor.test_ok')); },
    }));
  }

  /** Saves on the device and, when logged in, as a draft on the server. @returns the server code or null */
  async save(quiet = false) {
    const err = this.doc.admin ? null : (this.doc.title.trim().length < 3 ? Loc.t('editor.title_short') : null);
    if (err) { this.say(err); return null; }
    if (this.doc.admin) {
      try {
        this.busy = true;
        await AdminBackend.call('POST', '/levels/main/' + encodeURIComponent(this.doc.code), { title: this.doc.title, world: this.doc.world, rows: this.doc.rows, signs: this.doc.signs });
        this.dirty = false; if (!quiet) this.say(Loc.t('editor.saved'));
        return this.doc.code;
      } catch (e) { this.say(e.message); return null; } finally { this.busy = false; }
    }
    EditorStore.put(this.doc);
    if (!Online.loggedIn) { if (!quiet) this.say(Loc.t('editor.saved_local'), 7); return null; }
    this.busy = true;
    const r = await Online.call('POST', this.doc.code ? `/my/levels/${this.doc.code}` : '/my/levels', { title: this.doc.title, world: this.doc.world, rows: this.doc.rows });
    this.busy = false;
    if (r.error) { this.say(Loc.t(EditorScene.errorKey(r.error))); return null; }
    this.doc.code = r.data.id;
    EditorStore.put(this.doc);
    this.dirty = false;
    if (!quiet) this.say(Loc.t('editor.saved'));
    return this.doc.code;
  }

  async publish() {
    const err = this.checkLevel();
    if (err) { this.say(err); return; }
    if (this.doc.admin) {
      if (!await this.save(true)) return;
      try {
        this.busy = true;
        await AdminBackend.call('POST', `/levels/main/${encodeURIComponent(this.doc.code)}/publish`);
        this.say(Loc.t('editor.published_main'), 8);
      } catch (e) { this.say(e.message); } finally { this.busy = false; }
      return;
    }
    if (!Online.loggedIn) { this.say(Loc.t('editor.login_needed'), 8); return; }
    const code = await this.save(true);
    if (!code) return;
    this.busy = true;
    const run = await Online.call('POST', '/runs', { level: code, purpose: 'verify' });
    this.busy = false;
    if (run.error) { this.say(Loc.t(EditorScene.errorKey(run.error))); return; }
    this.say(Loc.t('editor.publish_info'), 8);
    this.test(run.data.run, async r => {
      if (!r.completed) { this.say(Loc.t('editor.not_finished'), 8); return; }
      this.busy = true;
      const p = await Online.call('POST', `/my/levels/${code}/publish`, { run: r.runId, replay: r.replay, result: { timeTicks: r.timeTicks, score: r.score } });
      this.busy = false;
      this.say(p.error ? Loc.t(EditorScene.errorKey(p.error)) : Loc.t('editor.published'), 10);
    });
  }

  static errorKey(e) {
    return ({ level_start: 'editor.need_start', level_goal: 'editor.need_goal', level_width: 'editor.too_small', title_format: 'editor.title_short', title_bad: 'online.name_taken',
      too_many_levels: 'editor.too_many', community_closed: 'online.not_configured', draft_changed: 'editor.draft_changed', login_required: 'editor.login_needed', not_found: 'editor.not_found' })[e] || Online.errorKey(e);
  }

  // ---- drawing
  draw() {
    const th = Themes[this.doc.world] || Themes[1], S = ED.S, k = S / T;
    g.fillStyle = '#0a1024'; g.fillRect(0, 0, VW, VH);
    // map
    g.save();
    g.beginPath(); g.rect(0, ED.TOP, VW, ED.MAP_H); g.clip();
    g.translate(0, ED.TOP);
    // background at full width (only squeezed vertically), tiles at 2/3 size
    g.save(); g.scale(1, k); Art.background(th, this.camX * S, this.t); g.restore();
    g.translate(-this.camX * S, 0);
    g.scale(k, k);
    const x0 = Math.max(0, Math.floor(this.camX) - 1), x1 = Math.min(this.width, Math.ceil(this.camX + this.cols()) + 1);
    const at = (x, y) => (x < 0 || x >= this.width) ? '#' : this.get(x, y);
    for (let y = 0; y < ED.ROWS; y++) for (let x = x0; x < x1; x++) this.drawTile(at(x, y), x, y, th, at);
    // grid + level border
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1 / k;
    for (let x = x0; x <= x1; x++) { g.beginPath(); g.moveTo(x * T, 0); g.lineTo(x * T, ED.ROWS * T); g.stroke(); }
    for (let y = 0; y <= ED.ROWS; y++) { g.beginPath(); g.moveTo(x0 * T, y * T); g.lineTo(x1 * T, y * T); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(this.width * T, 0, 20 * T, ED.ROWS * T);
    // cursor
    const m = Input.mouse;
    if (this.inMap(m.x, m.y) && !Input.isTouch) {
      const c = this.cell(m.x, m.y);
      g.strokeStyle = C.accent; g.lineWidth = 3 / k; g.strokeRect(c.x * T, c.y * T, T, T);
    }
    g.restore();
    // scroll bar
    Ui.rrect(0, ED.BAR_Y, VW, 16, 8, 'rgba(255,255,255,0.12)');
    const vw = Math.min(1, this.cols() / this.width);
    Ui.rrect((this.camX / this.width) * VW, ED.BAR_Y, VW * vw, 16, 8, 'rgba(255,196,64,0.8)');
    // toolbar
    g.fillStyle = 'rgba(10,18,40,0.96)'; g.fillRect(0, 0, VW, ED.TOP);
    for (const b of this.buttons()) {
      let size = 24; while (size > 14 && Ui.measure(b.label, size) > b.r.w - 16) size -= 2;
      Ui.button(b.r, b.label, false, size);
    }
    // palette
    g.fillStyle = 'rgba(10,18,40,0.96)'; g.fillRect(0, ED.PAL_Y - 4, VW, VH - ED.PAL_Y + 4);
    TOOLS.forEach((t, i) => {
      const r = this.palRect(i), sel = t === this.tool;
      Ui.rrect(r.x, r.y, r.w, r.h, 12, sel ? C.accent : 'rgba(30,48,90,0.95)', sel ? '#fff' : 'rgba(120,170,230,0.6)', 2);
      this.drawIcon(t, r.x + r.w / 2, r.y + r.h / 2, th);
    });
    // message
    if (this.msgT > 0 && this.msg) {
      const w = Math.min(1100, Ui.measure(this.msg, 22) + 40);
      Ui.rrect(VW / 2 - w / 2, ED.TOP + 10, w, 40, 14, 'rgba(10,18,40,0.88)');
      Ui.text(this.msg, VW / 2, ED.TOP + 19, 22, '#fff', 'center', false);
    }
    if (this.doc.loading || this.busy) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, VW, VH); Ui.text('...', VW / 2, 330, 40, '#fff', 'center'); }
    if (this.doc.error) { g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(0, 0, VW, VH); Ui.textBlock(this.doc.error, VW / 2, 300, 28, 900); }
  }

  drawTile(c, x, y, th, at) {
    const px = x * T, py = y * T, t = this.t;
    switch (c) {
      case '#': Art.ground(x, y, th, y > 0 && at(x, y - 1) !== '#', at(x - 1, y) !== '#', at(x + 1, y) !== '#'); break;
      case 'B': Art.brick(px, py, th); break;
      case '?': case 'F': case 'S': case 'W': case 'H':
        Art.prize(px, py, t, false);
        if (c !== '?') { g.globalAlpha = 0.9; this.drawIcon({ F: 'F', S: 'S', W: 'W', H: 'H' }[c] + '!', px + T - 10, py + 10, th, 0.35); g.globalAlpha = 1; }
        break;
      case 'E': Art.prize(px, py, t, true); break;
      case 'x': Art.crumble(px, py, 0, th); break;
      case '-': Art.oneWay(px, py, th, at(x - 1, y) !== '-', at(x + 1, y) !== '-'); break;
      case '^': Art.spikes(px, py, th); break;
      case '~': Art.liquid(px, py, at(x, y - 1) !== '~', th, t); break;
      case 'o': Art.coin(px + T / 2, py + T / 2, t); break;
      case '*': Art.spring(px, py, 0); break;
      case 'M': case 'V':
        Art.platform(px, py + T - 28, 1, th);
        Ui.text(c === 'M' ? '↔' : '↕', px + T / 2, py + 2, 22, 'rgba(255,255,255,0.8)', 'center', false);
        break;
      case 'C': Art.checkpoint(px, py, false, t); break;
      case 'G': Art.igloo(px, py, t); break;
      case '!': Art.sign(px, py); break;
      case '@': Art.penguin(px + T / 2, py + T, 1, t, 0, false, 0, 0, false); break;
      case 'e': Art.walker(px + T / 2, py + T, -1, t, false); break;
      case 's': Art.spiky(px + T / 2, py + T, -1, t); break;
      case 'b': Art.bird(px + T / 2, py + T - 14, -1, t); break;
      case 'h': Art.hopper(px + T / 2, py + T, -1, t, false); break;
      case 'i': Art.icicle(px, py, 0); break;
    }
  }

  /** Palette icon centred at (cx, cy). */
  drawIcon(t, cx, cy, th, scale = 0.62) {
    g.save();
    g.translate(cx, cy); g.scale(scale, scale); g.translate(-T / 2, -T / 2);
    if (t === 'hand') Ui.text('✋', T / 2, 2, 40, '#fff', 'center', false);
    else if (t === ' ') Ui.text('⌫', T / 2, 4, 38, '#fff', 'center', false);
    else if (t.endsWith('!')) {
      const k = t[0];
      if (k === 'F') Art.fish(T / 2, T / 2, this.t); else if (k === 'S') Art.snowflake(T / 2, T / 2, this.t);
      else if (k === 'W') Art.wingItem(T / 2, T / 2, this.t); else Art.heart(T / 2, T / 2, 1);
    } else if (t === 'G') { g.translate(T / 2, T / 2); g.scale(0.7, 0.7); g.translate(-T / 2, -T / 2); Art.igloo(0, 0, this.t); }
    else if (t === 'F' || t === 'S' || t === 'W' || t === 'H') { Art.prize(0, 0, this.t, false); g.globalAlpha = 1; this.drawIcon(t + '!', T - 8, 8, th, 0.45); }
    else this.drawTile(t, 0, 0, th, () => ' ');
    g.restore();
  }
}
