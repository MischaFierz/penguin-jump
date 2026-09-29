'use strict';
// Online features of the web / Android version: API client (same API as Core/Online.cs),
// an HTML form for text input (so phones show their keyboard) and the online scenes.

const Online = {
  get enabled() { return !!Config.root; },
  get loggedIn() { return !!Save.data.onlineToken; },
  client: Config.isAndroid ? 'android' : 'web',

  async call(method, path, body, auth = true) {
    if (!this.enabled) return { error: 'not_configured' };
    try {
      const headers = {};
      if (body) headers['Content-Type'] = 'application/json';
      if (auth && this.loggedIn) headers.Authorization = 'Bearer ' + Save.data.onlineToken;
      const r = await fetch(`${Config.root}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit' });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 && auth && this.loggedIn) { Save.data.onlineToken = null; Save.save(); }
      return r.ok ? { data: j } : { error: j.error || 'error' };
    } catch (e) {
      return { error: 'error' };
    }
  },
  async startRun(level) { const r = await this.call('POST', '/runs', { level }, false); return r.data ? r.data.run : null; },
  submit(run, level, replay, result, nickname) {
    return this.call('POST', '/scores', { run, level, replay, result, nickname: this.loggedIn ? undefined : nickname, client: this.client });
  },
  top(level, by, limit = 10) { return this.call('GET', `/scores?level=${encodeURIComponent(level)}&by=${by}&limit=${limit}`, null, false); },
  async auth(username, password, register) {
    const r = await this.call('POST', register ? '/auth/register' : '/auth/login', { username, password, client: this.client }, false);
    if (r.data) { Save.data.onlineToken = r.data.token; Save.data.onlineUser = r.data.username; Save.save(); }
    return r;
  },
  async logout() {
    await this.call('POST', '/auth/logout', {});
    Save.data.onlineToken = null; Save.data.onlineUser = null; Save.save();
  },
  errorKey(e) {
    return ({ not_configured: 'online.not_configured', nick_format: 'online.name_invalid', nick_bad: 'online.name_taken', nick_taken: 'online.name_taken',
      login_failed: 'online.login_failed', too_many: 'online.too_many', password_short: 'online.password_weak', password_long: 'online.password_weak',
      password_weak: 'online.password_weak', username_format: 'online.user_taken', username_taken: 'online.user_taken', rejected: 'online.rejected',
      bad_run: 'online.rejected', run_expired: 'online.rejected', bad_replay: 'online.rejected', not_found: 'editor.not_found', bad_level: 'editor.not_found' })[e] || 'online.error';
  },
  fmt(ticks) { const cs = Math.floor(ticks * 100 / 120); return `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; },
};

// ------------------------------------------------------------------ HTML form overlay (text input)
const Form = {
  el: null, onSubmit: null, onCancel: null,
  $(id) { return document.getElementById(id); },
  /** fields: [{ id, label, type, value, max }], buttons: [{ label, action }] */
  show(title, fields, buttons, message) {
    const f = this.$('form');
    this.$('form-title').textContent = title;
    const box = this.$('form-fields');
    box.replaceChildren();
    for (const fd of fields) {
      const label = document.createElement('label');
      const span = document.createElement('span');
      span.textContent = fd.label;
      const input = document.createElement('input');
      input.id = 'f-' + fd.id; input.type = fd.type || 'text'; input.value = fd.value || ''; input.maxLength = fd.max || 40;
      input.autocomplete = fd.autocomplete || 'off'; input.spellcheck = false; input.autocapitalize = 'off';
      label.append(span, input);
      box.append(label);
    }
    const btns = this.$('form-buttons');
    btns.replaceChildren();
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = b.submit ? 'submit' : 'button';
      btn.textContent = b.label;
      if (!b.submit) btn.addEventListener('click', () => b.action(this.values()));
      else this.onSubmit = b.action;
      btns.append(btn);
    }
    this.message(message || '');
    f.hidden = false;
    document.body.classList.add('form-open');
    const first = box.querySelector('input');
    if (first && !Input.isTouch) first.focus();
  },
  values() { const v = {}; for (const i of this.$('form-fields').querySelectorAll('input')) v[i.id.slice(2)] = i.value; return v; },
  message(t, error = true) { const m = this.$('form-msg'); m.textContent = t; m.className = error ? 'err' : ''; },
  busy(on) { for (const b of this.$('form-buttons').querySelectorAll('button')) b.disabled = on; },
  hide() { this.$('form').hidden = true; document.body.classList.remove('form-open'); if (document.activeElement) document.activeElement.blur(); },
  init() {
    this.$('form').addEventListener('submit', e => { e.preventDefault(); if (this.onSubmit) this.onSubmit(this.values()); });
    this.$('form').addEventListener('keydown', e => { if (e.key === 'Escape' && this.onCancel) this.onCancel(); });
  },
};

// ------------------------------------------------------------------ account (login / register / logout)
class AccountScene {
  constructor() { this.t = 0; this.menu = new Menu(); this.recovery = null; this.busy = false; this.open(); }
  open() {
    if (Online.loggedIn) { Form.hide(); return; }
    Form.onCancel = () => this.leave();
    Form.show(Loc.t('online.account'), [
      { id: 'user', label: Loc.t('online.username'), max: 20, autocomplete: 'username' },
      { id: 'pass', label: Loc.t('online.password_rules'), type: 'password', max: 128, autocomplete: 'current-password' },
    ], [
      { label: Loc.t('online.login'), submit: true, action: v => this.go(v, false) },
      { label: Loc.t('online.register'), action: v => this.go(v, true) },
      { label: Loc.t('menu.back'), action: () => this.leave() },
    ], Online.enabled ? '' : Loc.t('online.not_configured'));
  }
  async go(v, register) {
    if (this.busy) return;
    this.busy = true; Form.busy(true); Form.message('...', false);
    const r = await Online.auth(v.user.trim(), v.pass, register);
    this.busy = false; Form.busy(false);
    if (r.error) { Form.message(Loc.t(Online.errorKey(r.error))); return; }
    Form.hide();
    this.recovery = r.data.recoveryCode || null;
  }
  leave() { Form.hide(); Scenes.go(new OptionsScene()); }
  layout() { this.menu.rects = [{ x: VW / 2 - 220, y: 330, w: 440, h: 62 }, { x: VW / 2 - 220, y: 410, w: 440, h: 62 }]; }
  update(dt) {
    this.t += dt;
    if (!Online.loggedIn) return; // the HTML form handles input
    if (this.recovery) { if (Input.confirm || Input.click || Input.back) this.recovery = null; return; }
    this.layout();
    const r = this.menu.update(2);
    if (r === 0) Online.logout().then(() => this.open());
    if (r === 1 || backPressed()) Scenes.go(new OptionsScene());
  }
  draw() {
    Backdrop.draw(this.t, false);
    Backdrop.header(Loc.t('online.account'));
    if (!Online.loggedIn) return;
    Ui.panel(VW / 2 - 380, 150, 760, 400);
    Ui.text(Loc.f('online.logged_in', Save.data.onlineUser || ''), VW / 2, 220, 36, C.accent, 'center');
    this.layout();
    Ui.button(this.menu.rects[0], Loc.t('online.logout'), this.menu.selected === 0, 30);
    Ui.button(this.menu.rects[1], Loc.t('menu.back'), this.menu.selected === 1, 30);
    if (this.recovery) {
      g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(0, 0, VW, VH);
      Ui.panel(VW / 2 - 400, 200, 800, 300);
      Ui.textBlock(Loc.t('online.recovery'), VW / 2, 230, 26, 720);
      Ui.text(this.recovery, VW / 2, 360, 40, C.accent, 'center');
      Ui.text(Loc.t('menu.continue') + ' >', VW / 2, 440, 24, '#fff', 'center');
    }
  }
}

// ------------------------------------------------------------------ leaderboard of one level
function drawTable(entries, error, y, loading) {
  if (loading) { Ui.text('...', VW / 2, y + 60, 34, '#fff', 'center'); return; }
  if (error) { Ui.textBlock(error, VW / 2, y + 60, 26, 700); return; }
  if (!entries) return;
  if (!entries.length) { Ui.textBlock(Loc.t('online.empty'), VW / 2, y + 60, 26, 700); return; }
  const head = 'rgb(150,190,240)';
  Ui.text('#', VW / 2 - 380, y, 22, head); Ui.text(Loc.t('online.username'), VW / 2 - 320, y, 22, head);
  Ui.text(Loc.t('hud.time'), VW / 2 + 190, y, 22, head, 'right'); Ui.text(Loc.t('hud.score'), VW / 2 + 380, y, 22, head, 'right');
  for (const e of entries) {
    y += 42;
    const col = ['#fff', 'rgb(255,215,90)', 'rgb(220,225,235)', 'rgb(230,170,110)'][e.rank] || '#fff';
    Ui.text(String(e.rank), VW / 2 - 380, y, 28, col);
    Ui.text(e.name + (e.registered ? ' ✓' : ''), VW / 2 - 320, y, 28, col);
    Ui.text(Online.fmt(e.timeTicks), VW / 2 + 190, y, 28, col, 'right');
    Ui.text(String(e.score), VW / 2 + 380, y, 28, col, 'right');
  }
}

class LeaderboardScene {
  constructor(level, back) { this.level = level; this.back = back; this.by = 'time'; this.t = 0; this.reload(); }
  reload() {
    this.entries = null; this.error = null; this.loading = true;
    Online.top(this.level, this.by).then(r => { this.loading = false; if (r.error) this.error = Loc.t(Online.errorKey(r.error)); else this.entries = r.data.entries; });
  }
  update(dt) {
    this.t += dt;
    if (Input.menuLeft || Input.menuRight || (Input.click && Input.mouse.y < 200 && !Ui.hover(BACK_BTN))) { this.by = this.by === 'time' ? 'score' : 'time'; Audio.play('menuMove'); this.reload(); }
    else if (backPressed() || Input.confirm || Input.click) Scenes.go(this.back());
  }
  draw() {
    Backdrop.draw(this.t, false);
    Backdrop.header(`${Loc.t('online.leaderboard')}  ${this.level}`, 30);
    Ui.panel(VW / 2 - 420, 120, 840, 540);
    Ui.text(`◀  ${this.by === 'time' ? Loc.t('online.by_time') : Loc.t('online.by_score')}  ▶`, VW / 2, 140, 30, C.accent, 'center');
    drawTable(this.entries, this.error, 200, this.loading);
    backButton();
  }
}

// ------------------------------------------------------------------ submit a finished run
class SubmitScene {
  /** run: { level, runId, replay, timeTicks, score, coins } */
  constructor(run, next) {
    this.run = run; this.next = next; this.t = 0; this.busy = false; this.result = null; this.message = null; this.done = false;
    if (!run.runId) { this.message = Loc.t('online.no_run'); this.done = true; }
    else if (Online.loggedIn) this.send('');
    else this.ask('');
  }
  ask(msg) {
    Form.onCancel = () => { Form.hide(); Scenes.go(this.next()); };
    Form.show(Loc.t('online.submit'), [{ id: 'nick', label: Loc.t('online.nickname'), value: Save.data.nickname || '', max: 16, autocomplete: 'nickname' }],
      [{ label: Loc.t('online.submit'), submit: true, action: v => this.send(v.nick.trim()) }, { label: Loc.t('menu.back'), action: () => Form.onCancel() }], msg);
  }
  async send(nick) {
    if (this.busy) return;
    if (!Online.loggedIn && nick.length < 3) { Form.message(Loc.t('online.name_invalid')); return; }
    this.busy = true; Form.hide();
    const r = this.run;
    const res = await Online.submit(r.runId, r.level, r.replay, { timeTicks: r.timeTicks, score: r.score, coins: r.coins }, nick);
    this.busy = false;
    if (res.data) {
      this.result = res.data; this.done = true;
      if (!Online.loggedIn) { Save.data.nickname = nick; Save.save(); }
    } else if (['nick_format', 'nick_bad', 'nick_taken'].includes(res.error)) this.ask(Loc.t(Online.errorKey(res.error)));
    else { this.message = Loc.t(Online.errorKey(res.error)); this.done = true; }
  }
  update(dt) {
    this.t += dt;
    if (this.done && (Input.confirm || Input.back || Input.click)) Scenes.go(this.next());
  }
  draw() {
    Backdrop.draw(this.t, false);
    Backdrop.header(Loc.t('online.leaderboard'), 30);
    Ui.panel(VW / 2 - 420, 120, 840, 540);
    const r = this.run;
    Ui.text(`${r.level}   ${Online.fmt(r.timeTicks)}   ${r.score}`, VW / 2, 140, 30, C.accent, 'center');
    if (this.busy) Ui.text(Loc.t('online.sending'), VW / 2, 300, 30, '#fff', 'center');
    if (this.message) Ui.textBlock(this.message, VW / 2, 300, 26, 720);
    if (this.result) {
      Ui.textBlock(Loc.f('online.accepted', String(this.result.rankTime), String(this.result.rankScore)), VW / 2, 195, 26, 760);
      drawTable(this.result.top, null, 270, false);
    }
    if (this.done) Ui.text(Loc.t('menu.continue') + ' >', VW / 2, 612, 24, '#fff', 'center');
  }
}
