'use strict';
// Core systems for the web / mobile version: config, localization, input (keyboard, gamepad,
// touch, mouse), synthesized audio, save data, UI helpers and the updater.
// Mirrors the C# desktop code in "Claude Game/Core".

const VW = 1280, VH = 720;
const DATA = window.GAME_DATA;

// ------------------------------------------------------------------ config
const Config = {
  name: DATA.config.name,
  baseUrl: (DATA.config.baseUrl || '').replace(/\/$/, ''),
  version: DATA.config.version || '0.0.0',
  isDev: /dev/.test(DATA.config.version || 'dev'),
  isAndroid: typeof window.AndroidBridge !== 'undefined',
};
// Server root for version.json and the API: the web game lives in <site>/play/, so on the website it is
// simply the parent folder (works for any domain/sub-folder); the Android app uses baseUrl from game.json.
Config.root = !Config.isAndroid && /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname) || /[?&]localserver/.test(location.search)
  ? new URL('..', location.href).href.replace(/\/$/, '') : Config.baseUrl;
document.title = Config.name;

// ------------------------------------------------------------------ localization
const FONT_STACK = "'Segoe UI', 'Helvetica Neue', Arial, 'Noto Sans', 'Hiragino Sans', 'Yu Gothic', 'Microsoft YaHei', 'PingFang SC', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK JP', sans-serif";
const Loc = {
  codes: DATA.langIndex,
  current: 'en',
  init(pref) {
    const nav = (navigator.language || 'en').toLowerCase();
    const guess = this.codes.find(c => nav === c || nav.startsWith(c + '-')) || 'en';
    this.current = this.codes.includes(pref) ? pref : guess;
    document.documentElement.lang = this.current;
  },
  set(code) { this.current = code; document.documentElement.lang = code; },
  t(key, code) {
    const l = DATA.langs[code || this.current];
    return (l && l[key]) || DATA.langs.en[key] || key;
  },
  f(key, ...args) { return this.t(key).replace(/\{(\d+)\}/g, (_, i) => args[i] ?? ''); },
  name(code) { return DATA.langs[code]['lang.name']; },
};

// ------------------------------------------------------------------ save data
const Save = {
  key: 'save-' + Config.name.replace(/[^A-Za-z0-9]/g, ''),
  data: { language: null, unlocked: 1, records: {}, sfx: 0.8, music: 0.5, skippedVersion: null, nickname: '', onlineUser: null, onlineToken: null },
  load() {
    try { Object.assign(this.data, JSON.parse(localStorage.getItem(this.key) || '{}')); } catch (e) { /* ignore */ }
  },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  },
};

// ------------------------------------------------------------------ input
const Input = {
  keys: new Set(), pressed: new Set(),
  pad: { buttons: [], prev: [], axes: [0, 0] },
  touch: { left: false, right: false, jump: false, run: false, pause: false, prevJump: false, prevRun: false, prevPause: false },
  mouse: { x: -1, y: -1, click: false, moved: false },
  isTouch: false,
  _stickPrev: { l: false, r: false, u: false, d: false },
  _stick: { l: false, r: false, u: false, d: false },
  _repeat: { dir: 0, timer: 0, fire: false },

  init(canvas) {
    window.addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement) return; // typing into the online form is not game input
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      Audio.unlock();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    const toVirtual = e => {
      const r = canvas.getBoundingClientRect();
      const s = Math.min(r.width / VW, r.height / VH);
      const ox = (r.width - VW * s) / 2, oy = (r.height - VH * s) / 2;
      return { x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s };
    };
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse') { const p = toVirtual(e); this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.moved = true; }
    });
    canvas.addEventListener('pointerdown', e => {
      Audio.unlock();
      const p = toVirtual(e);
      this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.click = true; this.mouse.moved = true;
      if (e.pointerType === 'touch') this.isTouch = true;
    });
    this._touchLayer();
  },

  // on-screen touch buttons (HTML elements, see index.html)
  _touchLayer() {
    const map = { 't-left': 'left', 't-right': 'right', 't-jump': 'jump', 't-run': 'run', 't-pause': 'pause' };
    const active = new Map(); // pointerId -> button
    const refresh = () => {
      for (const k of Object.values(map)) this.touch[k] = false;
      for (const b of active.values()) this.touch[b] = true;
      for (const [id, b] of Object.entries(map)) document.getElementById(id)?.classList.toggle('down', this.touch[b]);
    };
    const hit = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const btn = el && el.closest('.tbtn');
      return btn ? map[btn.id] : null;
    };
    const layer = document.getElementById('touch');
    if (!layer) return;
    const onDown = e => {
      e.preventDefault();
      Audio.unlock();
      this.isTouch = true;
      const b = hit(e.clientX, e.clientY);
      if (b) active.set(e.pointerId, b);
      refresh();
    };
    const onMove = e => {
      if (!active.has(e.pointerId)) return;
      const b = hit(e.clientX, e.clientY);
      // allow sliding between left/right and between jump/run
      if (b) active.set(e.pointerId, b);
      refresh();
    };
    const onUp = e => { active.delete(e.pointerId); refresh(); };
    layer.addEventListener('pointerdown', onDown);
    layer.addEventListener('pointermove', onMove);
    layer.addEventListener('pointerup', onUp);
    layer.addEventListener('pointercancel', onUp);
  },

  update(dt) {
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find(p => p);
    this.pad.prev = this.pad.buttons;
    this.pad.buttons = gp ? gp.buttons.map(b => b.pressed) : [];
    this.pad.axes = gp ? [gp.axes[0] || 0, gp.axes[1] || 0] : [0, 0];
    this._stickPrev = { ...this._stick };
    this._stick = { l: this.pad.axes[0] < -0.45, r: this.pad.axes[0] > 0.45, u: this.pad.axes[1] < -0.45, d: this.pad.axes[1] > 0.45 };

    const dir = this.rawUp ? 1 : this.rawDown ? 2 : this.rawLeft ? 3 : this.rawRight ? 4 : 0;
    const r = this._repeat;
    if (dir !== r.dir) { r.dir = dir; r.timer = 0.4; r.fire = false; }
    else if (dir) { r.timer -= dt; r.fire = r.timer <= 0; if (r.fire) r.timer = 0.12; }
    else r.fire = false;
  },

  endFrame() {
    this.pressed.clear();
    this.mouse.click = false;
    this.mouse.moved = false;
    this.touch.prevJump = this.touch.jump;
    this.touch.prevRun = this.touch.run;
    this.touch.prevPause = this.touch.pause;
  },

  k(...codes) { return codes.some(c => this.keys.has(c)); },
  kp(...codes) { return codes.some(c => this.pressed.has(c)); },
  b(...ids) { return ids.some(i => this.pad.buttons[i]); },
  bp(...ids) { return ids.some(i => this.pad.buttons[i] && !this.pad.prev[i]); },

  get left() { return this.k('ArrowLeft', 'KeyA') || this.b(14) || this._stick.l || this.touch.left; },
  get right() { return this.k('ArrowRight', 'KeyD') || this.b(15) || this._stick.r || this.touch.right; },
  get jumpPressed() { return this.kp('Space', 'ArrowUp', 'KeyW', 'KeyK') || this.bp(0) || (this.touch.jump && !this.touch.prevJump); },
  get jumpHeld() { return this.k('Space', 'ArrowUp', 'KeyW', 'KeyK') || this.b(0) || this.touch.jump; },
  get runHeld() { return this.k('ShiftLeft', 'ShiftRight', 'KeyX', 'KeyJ') || this.b(1, 2, 7) || this.touch.run; },
  get actionPressed() { return this.kp('ShiftLeft', 'ShiftRight', 'KeyX', 'KeyJ') || this.bp(1, 2) || (this.touch.run && !this.touch.prevRun); },
  get pausePressed() { return this.kp('Escape', 'KeyP', 'Enter') || this.bp(9) || (this.touch.pause && !this.touch.prevPause); },

  get rawUp() { return this.k('ArrowUp', 'KeyW') || this.b(12) || this._stick.u; },
  get rawDown() { return this.k('ArrowDown', 'KeyS') || this.b(13) || this._stick.d; },
  get rawLeft() { return this.k('ArrowLeft', 'KeyA') || this.b(14) || this._stick.l; },
  get rawRight() { return this.k('ArrowRight', 'KeyD') || this.b(15) || this._stick.r; },
  get menuUp() { return this.kp('ArrowUp', 'KeyW') || this.bp(12) || (this._stick.u && !this._stickPrev.u) || (this._repeat.fire && this._repeat.dir === 1); },
  get menuDown() { return this.kp('ArrowDown', 'KeyS') || this.bp(13) || (this._stick.d && !this._stickPrev.d) || (this._repeat.fire && this._repeat.dir === 2); },
  get menuLeft() { return this.kp('ArrowLeft', 'KeyA') || this.bp(14) || (this._stick.l && !this._stickPrev.l) || (this._repeat.fire && this._repeat.dir === 3); },
  get menuRight() { return this.kp('ArrowRight', 'KeyD') || this.bp(15) || (this._stick.r && !this._stickPrev.r) || (this._repeat.fire && this._repeat.dir === 4); },
  get confirm() { return this.kp('Enter', 'Space', 'NumpadEnter') || this.bp(0, 9); },
  get back() { return this.kp('Escape', 'Backspace') || this.bp(1) || (this.touch.pause && !this.touch.prevPause); },
  get click() { return this.mouse.click; },
};

// ------------------------------------------------------------------ audio (synthesized)
const Audio = {
  ctx: null, sounds: {}, tunes: [], musicNode: null, musicGain: null, currentTune: -1, wantedTune: -1,
  sfxVolume: 0.8, musicVolume: 0.5,

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.musicGain = this.ctx.createGain();
    this.musicGain.connect(this.ctx.destination);
    this._buildSfx();
    const want = this.wantedTune; this.wantedTune = -1; this.currentTune = -1;
    // music generation is heavier - do it lazily per tune
    this.playMusic(want);
  },

  _buffer(seconds, fn, volume, rate = 44100) {
    const n = Math.floor(seconds * rate);
    const buf = this.ctx.createBuffer(1, n, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.max(-1, Math.min(1, fn(i / rate) * volume));
    return buf;
  },

  _buildSfx() {
    const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
    const env = (t, len) => Math.max(0, Math.min(1, Math.min(t / 0.005, 1) * (1 - t / len)));
    const sq = (f, t) => ((t * f) % 1) < 0.5 ? 1 : -1;
    const tri = (f, t) => 4 * Math.abs(((t * f) % 1) - 0.5) - 1;
    const noise = () => Math.random() * 2 - 1;
    const arp = (t, step, ...n) => n[Math.min(Math.floor(t / step), n.length - 1)];
    const S = (name, len, fn, vol) => { this.sounds[name] = this._buffer(len, fn, vol); };
    S('jump', 0.16, t => sq(lerp(330, 660, t / 0.16), t) * env(t, 0.16), 0.35);
    S('doubleJump', 0.18, t => sq(lerp(500, 1000, t / 0.18), t) * env(t, 0.18), 0.3);
    S('coin', 0.22, t => sq(t < 0.06 ? 988 : 1319, t) * env(t, 0.22), 0.3);
    S('stomp', 0.14, t => tri(lerp(420, 120, t / 0.14), t) * env(t, 0.14), 0.7);
    S('kick', 0.12, t => (sq(lerp(800, 300, t / 0.12), t) * 0.6 + noise() * 0.4) * env(t, 0.12), 0.4);
    S('hurt', 0.35, t => sq(lerp(600, 150, t / 0.35), t) * env(t, 0.35) * ((Math.floor(t * 30) % 2 === 0) ? 1 : 0.5), 0.35);
    S('powerUp', 0.6, t => sq(arp(t, 0.05, 523, 659, 784, 1047, 784, 1047, 1319, 1568), t) * env(t, 0.6), 0.3);
    S('oneUp', 0.7, t => tri(arp(t, 0.1, 659, 784, 1319, 1047, 1175, 1568), t) * env(t, 0.7), 0.6);
    S('break', 0.25, t => noise() * env(t, 0.25) * 0.9 + tri(lerp(200, 60, t / 0.25), t) * 0.3, 0.5);
    S('crumble', 0.3, t => noise() * env(t, 0.3) * 0.6, 0.35);
    S('bump', 0.1, t => tri(lerp(180, 90, t / 0.1), t) * env(t, 0.1), 0.7);
    S('die', 1.0, t => sq(arp(t, 0.12, 784, 740, 698, 659, 523, 494, 440, 392), t) * env(t, 1.0), 0.3);
    S('checkpoint', 0.45, t => tri(arp(t, 0.09, 523, 659, 784, 1047, 1047), t) * env(t, 0.45), 0.6);
    S('spring', 0.3, t => tri(lerp(200, 900, t / 0.3) + Math.sin(t * 90) * 60, t) * env(t, 0.3), 0.6);
    S('throw', 0.1, t => noise() * env(t, 0.1) * 0.4 + sq(lerp(900, 500, t / 0.1), t) * 0.2, 0.5);
    S('complete', 1.6, t => (sq(arp(t, 0.13, 523, 659, 784, 1047, 784, 1047, 1319, 1319, 1568, 1568, 1568, 1568), t) * 0.6
      + tri(arp(t, 0.26, 262, 330, 392, 523, 392, 523), t) * 0.5) * env(t, 1.6), 0.35);
    S('gameOver', 1.4, t => tri(arp(t, 0.25, 392, 370, 349, 330, 262, 196), t) * env(t, 1.4), 0.6);
    S('menuMove', 0.05, t => sq(880, t) * env(t, 0.05), 0.2);
    S('menuSelect', 0.14, t => sq(t < 0.05 ? 880 : 1320, t) * env(t, 0.14), 0.25);
  },

  play(name) {
    if (!this.ctx || !this.sounds[name] || this.sfxVolume <= 0) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.sounds[name];
    const g = this.ctx.createGain();
    g.gain.value = this.sfxVolume;
    src.connect(g); g.connect(this.ctx.destination);
    src.start();
  },

  playMusic(tune) {
    this.wantedTune = tune;
    if (!this.ctx || tune === this.currentTune) return;
    if (this.musicNode) { try { this.musicNode.stop(); } catch (e) { /* ignore */ } this.musicNode = null; }
    this.currentTune = tune;
    if (tune < 0) return;
    if (!this.tunes[tune]) this.tunes[tune] = this._makeTune(tune);
    const src = this.ctx.createBufferSource();
    src.buffer = this.tunes[tune];
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.musicNode = src;
  },

  update() {
    if (this.musicGain) this.musicGain.gain.value = this.musicVolume * 0.6;
  },

  // same algorithm as MusicGen in Audio.cs
  _makeTune(tune) {
    const rate = 22050;
    const cfg = [[60, 100, false], [62, 132, false], [57, 112, true], [64, 124, false], [55, 144, true]][Math.min(tune, 4)];
    const [root, bpm, minor] = cfg;
    const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    const prog = minor ? [0, 5, 3, 4] : [0, 4, 5, 3];
    let seed = tune * 7919 + 17;
    const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const beat = 60 / bpm, bars = 8, spb = 8, step = beat / 2;
    const total = Math.floor(bars * spb * step * rate);
    const buf = this.ctx.createBuffer(1, total, rate);
    const d = buf.getChannelData(0);
    const note = (deg, oct) => { const o = Math.floor(deg / 7); const dd = ((deg % 7) + 7) % 7; return root + scale[dd] + 12 * (o + oct); };
    const freq = m => 440 * Math.pow(2, (m - 69) / 12);
    const add = (start, len, f, vol, wave) => {
      const s0 = Math.floor(start * rate), n = Math.floor(len * rate);
      for (let i = 0; i < n && s0 + i < total; i++) {
        const t = i / rate, p = (t * f) % 1;
        const v = wave === 0 ? (p < 0.5 ? 1 : -1) : wave === 1 ? 4 * Math.abs(p - 0.5) - 1 : (p < 0.25 ? 1 : -1);
        d[s0 + i] += v * vol * Math.min(1, t / 0.01) * Math.max(0, 1 - t / len);
      }
    };
    const motif = [];
    for (let i = 0; i < spb * 2; i++) motif.push(rnd(100) < 70 ? rnd(6) : -99);
    for (let bar = 0; bar < bars; bar++) {
      const chord = prog[bar % prog.length], bs = bar * spb * step;
      for (let s = 0; s < spb; s++) add(bs + s * step, step * 0.9, freq(note(chord + (s % 2 === 0 ? 0 : 4), -2)), 0.22, 1);
      for (let s = 0; s < spb * 2; s++) add(bs + s * step / 2, step / 2 * 0.8, freq(note(chord + [0, 2, 4, 2][s % 4], 0)), 0.045, 2);
      if (tune === 0 && bar % 2 === 1) continue;
      for (let s = 0; s < spb; s++) {
        const m = motif[(bar % 2) * spb + s];
        if (m === -99) continue;
        let deg = chord + [0, 2, 4, 7, 4, 2][m];
        if (bar >= 4 && s === 0) deg += 1;
        add(bs + s * step, step * 0.85, freq(note(deg, 1)), 0.09, 0);
      }
    }
    for (let i = 0; i < total; i++) d[i] = Math.max(-1, Math.min(1, d[i]));
    return buf;
  },
};

// ------------------------------------------------------------------ UI helpers
const C = {
  ink: '#182038', accent: '#ffc440', panel: 'rgba(18,28,54,0.9)', border: '#8cc8ff', white: '#fff',
};
const Ui = {
  ctx: null,
  font(size) { return `bold ${size}px ${FONT_STACK}`; },
  measure(text, size) { this.ctx.font = this.font(size); return this.ctx.measureText(text).width; },
  text(text, x, y, size, color = '#fff', align = 'left', shadow = true) {
    const c = this.ctx;
    c.font = this.font(size);
    c.textAlign = align; c.textBaseline = 'top';
    if (shadow) { c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillText(text, x + size * 0.05, y + size * 0.06); }
    c.fillStyle = color; c.fillText(text, x, y);
  },
  title(text, x, y, size, fill, outline) {
    const c = this.ctx;
    let s = size;
    while (s > 20 && this.measure(text, s) > VW - 80) s -= 4;
    c.font = this.font(s); c.textAlign = 'center'; c.textBaseline = 'top';
    c.lineJoin = 'round'; c.lineWidth = Math.max(4, s / 9); c.strokeStyle = outline;
    c.strokeText(text, x, y + s / 22);
    c.fillStyle = fill; c.fillText(text, x, y);
  },
  wrap(text, size, maxW) {
    const words = [];
    let cur = '';
    for (const ch of text) {
      const cjk = ch.charCodeAt(0) >= 0x2E80 && ch.charCodeAt(0) <= 0xFFEF;
      if (cjk) { if (cur) words.push(cur); words.push(ch); cur = ''; }
      else { cur += ch; if (ch === ' ') { words.push(cur); cur = ''; } }
    }
    if (cur) words.push(cur);
    const lines = []; let line = '';
    for (const w of words) {
      const cand = line + w;
      if (line && this.measure(cand.trimEnd(), size) > maxW) { lines.push(line.trimEnd()); line = w.trimStart(); }
      else line = cand;
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines;
  },
  textBlock(text, x, y, size, maxW, color = '#fff') {
    this.wrap(text, size, maxW).forEach((l, i) => this.text(l, x, y + i * size * 1.2, size, color, 'center'));
  },
  rrect(x, y, w, h, r, fill, stroke, lw = 3) {
    const c = this.ctx;
    c.beginPath(); c.roundRect(x, y, w, h, r);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); }
  },
  panel(x, y, w, h) {
    this.rrect(x + 6, y + 8, w, h, 18, 'rgba(0,0,0,0.35)');
    this.rrect(x, y, w, h, 18, C.panel, C.border);
  },
  button(r, label, selected, size = 34, enabled = true) {
    let { x, y, w, h } = r;
    if (selected) { const g = 4 + Math.sin(performance.now() / 1000 * 6) * 2; x -= g; y -= g / 2; w += g * 2; h += g; }
    this.rrect(x + 4, y + 6, w, h, h * 0.35, 'rgba(0,0,0,0.4)');
    this.rrect(x, y, w, h, h * 0.35, selected ? C.accent : 'rgba(30,48,90,0.92)', selected ? '#fff' : '#78aae6');
    let s = size;
    while (s > 14 && this.measure(label, s) > w - 24) s -= 2;
    this.text(label, x + w / 2, y + (h - s) / 2, s, selected ? C.ink : enabled ? '#fff' : '#8c96aa', 'center', !selected);
  },
  hover(r) { const m = Input.mouse; return m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h; },
};

class Menu {
  constructor() { this.selected = 0; this.rects = []; }
  update(count) {
    if (!count) return -1;
    if (Input.menuUp) { this.selected = (this.selected - 1 + count) % count; Audio.play('menuMove'); }
    if (Input.menuDown) { this.selected = (this.selected + 1) % count; Audio.play('menuMove'); }
    for (let i = 0; i < this.rects.length && i < count; i++) {
      if (!Ui.hover(this.rects[i])) continue;
      if (Input.mouse.moved && this.selected !== i && !Input.isTouch) { this.selected = i; Audio.play('menuMove'); }
      if (Input.click) { this.selected = i; Audio.play('menuSelect'); return i; }
    }
    if (Input.confirm) { Audio.play('menuSelect'); return this.selected; }
    return -1;
  }
}

// ------------------------------------------------------------------ updater
// Web/PWA: a newer version.json means new files are on the server -> reload (service worker is network-first).
// Android app: download and install the new APK through the native bridge.
const Updater = {
  state: 'idle', latest: null, apkUrl: null, progress: 0,
  isNewer(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y;
    }
    return false;
  },
  async check() {
    if (!Config.root || this.state === 'checking') return;
    this.state = 'checking';
    try {
      const r = await fetch(`${Config.root}/version.json?t=${Date.now()}`, { cache: 'no-store' });
      const j = await r.json();
      this.latest = j.version;
      const apk = j.downloads && j.downloads.android && j.downloads.android.url;
      this.apkUrl = apk ? (apk.startsWith('http') ? apk : `${Config.root}/${apk}`) : null;
      this.state = this.isNewer(j.version, Config.version) ? 'available' : 'uptodate';
    } catch (e) {
      this.state = 'failed';
    }
  },
  install() {
    if (Config.isAndroid) {
      if (!this.apkUrl) { this.state = 'failed'; return; }
      this.state = 'downloading';
      try { window.AndroidBridge.installUpdate(this.apkUrl); } catch (e) { this.state = 'failed'; }
      return;
    }
    this.state = 'restarting';
    (async () => {
      try {
        if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      } catch (e) { /* ignore */ }
      setTimeout(() => location.reload(), 600);
    })();
  },
};
// called by the Android app
window.onUpdateProgress = p => { Updater.progress = p; if (p >= 1) Updater.state = 'restarting'; };
window.onUpdateFailed = () => { Updater.state = 'failed'; };
