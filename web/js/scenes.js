'use strict';
// Menus and the play scene (port of the C# Scenes folder).

const Scenes = {
  current: null, next: null, fade: 0, fadingOut: false,
  start(s) { this.current = s; },
  go(s) { if (this.next) return; this.next = s; this.fadingOut = true; },
  update(dt) {
    if (this.fadingOut) {
      this.fade += dt * 5;
      if (this.fade >= 1) { this.fade = 1; this.current = this.next; this.next = null; this.fadingOut = false; }
      return;
    }
    if (this.fade > 0) this.fade = Math.max(0, this.fade - dt * 4);
    this.current.update(dt);
  },
  draw() {
    this.current.draw();
    document.body.classList.toggle('playing', !!this.current.showTouch && this.current.showTouch());
    if (this.fade > 0) { g.fillStyle = `rgba(8,12,28,${this.fade})`; g.fillRect(0, 0, VW, VH); }
  },
};

const Session = { lives: 3, levels: DATA.levelIndex };
const BACK_BTN = { x: 20, y: 20, w: 64, h: 64 };

function backButton() {
  Ui.rrect(BACK_BTN.x, BACK_BTN.y, BACK_BTN.w, BACK_BTN.h, 18, 'rgba(30,48,90,0.9)', '#78aae6');
  tri([BACK_BTN.x + 18, BACK_BTN.y + 32], [BACK_BTN.x + 42, BACK_BTN.y + 16], [BACK_BTN.x + 42, BACK_BTN.y + 48], '#fff');
}
const backPressed = () => Input.back || (Input.click && Ui.hover(BACK_BTN));

const Backdrop = {
  draw(t, penguin = true) {
    const th = Themes[1];
    Art.background(th, t * 40, t);
    for (let x = 0; x < VW; x += 48) { Art.ground(x / 48, 13, th, true, false, false); rect(x, 14 * 48, 48, 48, rgba(th.fill)); }
    for (let i = 0; i < 70; i++) {
      const x = (hash(i * 7) * 1400 + Math.sin(t + i) * 30) % 1400 - 60;
      const y = (hash(i * 11) * 760 + t * (30 + hash(i) * 50)) % 760 - 20;
      circle(x, y, 1.5 + hash(i * 5) * 2.5, 'rgba(255,255,255,0.8)');
    }
    if (penguin) Art.penguin((t * 110) % (VW + 200) - 100, 13 * 48, 1, t, 1, false, 0, 1, false);
  },
  header(text, y = 40) { Ui.title(text, VW / 2, y, 58, '#fff', 'rgb(30,50,100)'); },
  hint() { if (!Input.isTouch) Ui.text(Loc.t('hint.menu'), VW / 2, VH - 34, 20, 'rgb(40,60,100)', 'center', false); },
};

// ------------------------------------------------------------------ update dialog
const UpdateDialog = {
  visible: false, auto: false, sel: 0,
  show() { this.visible = true; this.sel = 0; },
  btn(i) { return { x: VW / 2 - 290 + i * 300, y: 420, w: 280, h: 62 }; },
  update() {
    if (this.auto && Updater.state === 'available' && Save.data.skippedVersion !== Updater.latest) { this.auto = false; this.show(); }
    if (this.auto && (Updater.state === 'uptodate' || Updater.state === 'failed')) this.auto = false;
    if (!this.visible) return false;
    if (Updater.state === 'available') {
      if (Input.menuLeft || Input.menuRight) { this.sel = 1 - this.sel; Audio.play('menuMove'); }
      for (let i = 0; i < 2; i++) if (Ui.hover(this.btn(i))) { if (Input.mouse.moved && !Input.isTouch) this.sel = i; if (Input.click) { this.sel = i; this.activate(); return true; } }
      if (Input.confirm) this.activate();
      else if (Input.back) this.skip();
    } else if (Updater.state === 'failed' || Updater.state === 'uptodate') {
      if (Input.confirm || Input.back || Input.click) this.visible = false;
    }
    return true;
  },
  skip() { this.visible = false; Save.data.skippedVersion = Updater.latest; Save.save(); },
  activate() {
    Audio.play('menuSelect');
    if (this.sel === 1) { this.skip(); return; }
    Updater.install();
  },
  draw() {
    if (!this.visible) return;
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, VW, VH);
    Ui.panel(VW / 2 - 340, 200, 680, 320);
    Ui.text(Config.name, VW / 2, 222, 38, C.accent, 'center');
    const st = Updater.state;
    if (st === 'available') {
      Ui.textBlock(Loc.f('update.available', Updater.latest), VW / 2, 290, 30, 600);
      Ui.button(this.btn(0), Loc.t('update.install'), this.sel === 0, 28);
      Ui.button(this.btn(1), Loc.t('update.later'), this.sel === 1, 28);
    } else if (st === 'downloading') {
      Ui.text(Loc.t('update.downloading'), VW / 2, 300, 30, '#fff', 'center');
      Ui.rrect(VW / 2 - 260, 370, 520, 34, 17, 'rgb(10,16,30)');
      if (Updater.progress > 0.01) Ui.rrect(VW / 2 - 257, 373, 514 * Updater.progress, 28, 14, C.accent);
    } else if (st === 'restarting') Ui.text(Loc.t('update.restart'), VW / 2, 330, 30, '#fff', 'center');
    else if (st === 'failed') Ui.textBlock(Loc.t('update.failed'), VW / 2, 310, 28, 600);
    else if (st === 'uptodate') Ui.textBlock(Loc.t('update.none'), VW / 2, 310, 28, 600);
    else Ui.text(Loc.t('update.checking'), VW / 2, 330, 30, '#fff', 'center');
  },
};

// ------------------------------------------------------------------ title
class TitleScene {
  constructor() {
    this.menu = new Menu(); this.t = 0;
    Audio.playMusic(0);
    if (!TitleScene.checked && !Config.isDev) {
      TitleScene.checked = true;
      UpdateDialog.auto = true;
      Updater.check();
    }
  }
  items() {
    const it = [Loc.t('menu.play'), `${Loc.t('menu.language')}: ${Loc.name(Loc.current)}`, Loc.t('menu.options')];
    if (Config.isAndroid) it.push(Loc.t('menu.quit'));
    return it;
  }
  layout(n) { this.menu.rects = []; for (let i = 0; i < n; i++) this.menu.rects.push({ x: VW / 2 - 200, y: 330 + i * 78, w: 400, h: 62 }); }
  update(dt) {
    this.t += dt;
    if (UpdateDialog.update()) return;
    const n = this.items().length;
    this.layout(n);
    const r = this.menu.update(n);
    if (r === 0) Scenes.go(new LevelSelectScene());
    if (r === 1) Scenes.go(new LanguageScene());
    if (r === 2) Scenes.go(new OptionsScene());
    if (r === 3 && Config.isAndroid) window.AndroidBridge.exit();
  }
  draw() {
    Backdrop.draw(this.t);
    const bob = Math.sin(this.t * 2) * 6;
    Ui.title(Config.name, VW / 2, 90 + bob, 104, '#fff', 'rgb(30,60,130)');
    Ui.text(Loc.t('subtitle'), VW / 2, 210 + bob, 32, 'rgb(255,214,90)', 'center');
    Art.penguin(VW / 2 - 330, 300, 1, this.t, 0, true, -1 + Math.sin(this.t * 3), 1, true, 1, false, 1.8);
    Art.penguin(VW / 2 + 330, 300, -1, this.t + 1, 0, false, 0, 2, false, 1, false, 1.8);
    const items = this.items();
    this.layout(items.length);
    items.forEach((s, i) => Ui.button(this.menu.rects[i], s, this.menu.selected === i));
    Ui.text(`v${Config.version}`, VW - 16, VH - 30, 18, 'rgb(40,60,100)', 'right', false);
    Backdrop.hint();
    UpdateDialog.draw();
  }
}

// ------------------------------------------------------------------ language
class LanguageScene {
  constructor() { this.sel = Math.max(0, Loc.codes.indexOf(Loc.current)); this.t = 0; this.original = Loc.current; }
  rect(i) { const c = i % 3, r = Math.floor(i / 3); return { x: VW / 2 - 570 + c * 380 + 10, y: 140 + r * 82, w: 360, h: 66 }; }
  update(dt) {
    this.t += dt;
    const n = Loc.codes.length, prev = this.sel;
    if (Input.menuLeft) this.sel = Math.max(0, this.sel - 1);
    if (Input.menuRight) this.sel = Math.min(n - 1, this.sel + 1);
    if (Input.menuUp && this.sel >= 3) this.sel -= 3;
    if (Input.menuDown) this.sel = Math.min(n - 1, this.sel + 3);
    let click = false;
    for (let i = 0; i < n; i++) if (Ui.hover(this.rect(i))) { if (Input.mouse.moved && !Input.isTouch) this.sel = i; if (Input.click) { this.sel = i; click = true; } }
    if (prev !== this.sel) { Audio.play('menuMove'); Loc.set(Loc.codes[this.sel]); updateRotateText(); }
    if (Input.confirm || click) {
      Audio.play('menuSelect');
      Loc.set(Loc.codes[this.sel]); updateRotateText();
      Save.data.language = Loc.current; Save.save();
      Scenes.go(new TitleScene());
    } else if (backPressed()) { Loc.set(this.original); updateRotateText(); Scenes.go(new TitleScene()); }
  }
  draw() {
    Backdrop.draw(this.t, false);
    Backdrop.header(Loc.t('lang.title'), 34);
    Loc.codes.forEach((code, i) => {
      const r = this.rect(i), sel = i === this.sel;
      Ui.rrect(r.x + 4, r.y + 6, r.w, r.h, 22, 'rgba(0,0,0,0.35)');
      Ui.rrect(r.x, r.y, r.w, r.h, 22, sel ? C.accent : 'rgba(30,48,90,0.92)', sel ? '#fff' : '#78aae6');
      Ui.text(Loc.name(code), r.x + r.w / 2, r.y + 15, 34, sel ? C.ink : '#fff', 'center', !sel);
      Ui.text(code.toUpperCase(), r.x + 14, r.y + 6, 14, sel ? C.ink : 'rgb(140,170,220)', 'left', false);
    });
    backButton();
    Backdrop.hint();
  }
}

// ------------------------------------------------------------------ options
class OptionsScene {
  constructor() { this.menu = new Menu(); this.t = 0; this.controls = false; this.checking = false; }
  layout() { this.menu.rects = []; for (let i = 0; i < 6; i++) this.menu.rects.push({ x: VW / 2 - 280, y: 150 + i * 80, w: 560, h: 62 }); }
  bar(v) { const n = Math.round(v * 10); return '■'.repeat(n) + '□'.repeat(10 - n); }
  update(dt) {
    this.t += dt;
    if (UpdateDialog.update()) return;
    if (this.controls) { if (Input.back || Input.confirm || Input.click) { this.controls = false; Audio.play('menuSelect'); } return; }
    if (this.checking && Updater.state === 'available') { this.checking = false; UpdateDialog.show(); }
    this.layout();
    const s = Save.data, dir = Input.menuRight ? 1 : Input.menuLeft ? -1 : 0;
    const clamp = v => Math.round(Math.max(0, Math.min(1, v)) * 10) / 10;
    if (dir) {
      if (this.menu.selected === 0) { s.sfx = clamp(s.sfx + dir * 0.1); Audio.sfxVolume = s.sfx; Audio.play('coin'); }
      if (this.menu.selected === 1) { s.music = clamp(s.music + dir * 0.1); Audio.musicVolume = s.music; }
      Save.save();
    }
    const r = this.menu.update(6);
    if (r === 0) { s.sfx = s.sfx >= 1 ? 0 : clamp(s.sfx + 0.1); Audio.sfxVolume = s.sfx; Save.save(); }
    if (r === 1) { s.music = s.music >= 1 ? 0 : clamp(s.music + 0.1); Audio.musicVolume = s.music; Save.save(); }
    if (r === 2) toggleFullscreen();
    if (r === 3) this.controls = true;
    if (r === 4) { this.checking = true; Updater.check(); }
    if (r === 5 || backPressed()) Scenes.go(new TitleScene());
  }
  draw() {
    Backdrop.draw(this.t);
    Backdrop.header(Loc.t('options.title'));
    this.layout();
    const s = Save.data, fs = !!document.fullscreenElement;
    const items = [
      `${Loc.t('options.sfx')}   ${this.bar(s.sfx)}`, `${Loc.t('options.music')}   ${this.bar(s.music)}`,
      `${Loc.t('options.fullscreen')}: ${fs ? Loc.t('options.on') : Loc.t('options.off')}`,
      Loc.t('options.controls'), Loc.t('options.update'), Loc.t('menu.back')];
    items.forEach((it, i) => Ui.button(this.menu.rects[i], it, this.menu.selected === i, 30));
    const st = { checking: 'update.checking', uptodate: 'update.none', failed: 'update.failed' }[Updater.state];
    if (st && (this.checking || Updater.state !== 'checking')) Ui.text(Loc.t(st), VW / 2, 640, 24, '#fff', 'center');
    Ui.text(`${Loc.t('options.version')} ${Config.version}`, VW - 16, VH - 30, 18, 'rgb(40,60,100)', 'right', false);
    backButton();
    if (this.controls) this.drawControls();
    UpdateDialog.draw();
  }
  drawControls() {
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, VW, VH);
    Ui.panel(160, 110, 960, 500);
    Ui.text(Loc.t('options.controls'), 640, 130, 44, C.accent, 'center');
    let y = 210;
    const cols = [[Loc.t('controls.keyboard'), 500], [Loc.t('controls.gamepad'), 760], [Loc.t('controls.touch'), 980]];
    for (const [t, x] of cols) Ui.text(t, x, y, 26, 'rgb(150,200,255)', 'center');
    const rows = [['controls.move', '← → / A D', 'D-Pad', '◀ ▶'], ['controls.jump', 'Space / ↑', 'A', '▲'],
      ['controls.run', 'Shift / X', 'X / B', 'B'], ['controls.pause', 'Esc / P', 'Start', 'II']];
    for (const [k, kb, pad, touch] of rows) {
      y += 70;
      Ui.text(Loc.t(k), 190, y, 26, '#fff');
      Ui.text(kb, 500, y, 26, '#fff', 'center'); Ui.text(pad, 760, y, 26, '#fff', 'center'); Ui.text(touch, 980, y, 26, '#fff', 'center');
    }
  }
}

// ------------------------------------------------------------------ level select
class LevelSelectScene {
  constructor() { this.sel = Math.max(0, Math.min(Save.data.unlocked - 1, Session.levels.length - 1)); this.t = 0; Audio.playMusic(0); }
  rect(i) { return { x: 470 + (i % 3) * 250, y: 130 + Math.floor(i / 3) * 132, w: 230, h: 112 }; }
  unlocked(i) { return i < Save.data.unlocked; }
  update(dt) {
    this.t += dt;
    const n = Session.levels.length, prev = this.sel;
    if (Input.menuLeft) this.sel = Math.max(0, this.sel - 1);
    if (Input.menuRight) this.sel = Math.min(n - 1, this.sel + 1);
    if (Input.menuUp && this.sel - 3 >= 0) this.sel -= 3;
    if (Input.menuDown && this.sel + 3 < n) this.sel += 3;
    let click = false;
    for (let i = 0; i < n; i++) if (Ui.hover(this.rect(i))) { if (Input.mouse.moved && !Input.isTouch) this.sel = i; if (Input.click) { this.sel = i; click = true; } }
    if (prev !== this.sel) Audio.play('menuMove');
    if ((Input.confirm || click) && this.unlocked(this.sel)) {
      Audio.play('menuSelect'); Session.lives = 3; Scenes.go(new PlayScene(this.sel));
    } else if (backPressed()) Scenes.go(new TitleScene());
  }
  draw() {
    Backdrop.draw(this.t, false);
    Backdrop.header(Loc.t('levels.title'), 30);
    const n = Session.levels.length;
    for (let w = 0; w < Math.ceil(n / 3); w++) {
      const th = Themes[w + 1];
      Ui.rrect(60, 124 + w * 132, 1160, 124, 24, rgba(th.skyTop, 0.85), rgba(th.cap, 0.8), 2);
      Ui.text(`${Loc.t('hud.world')} ${w + 1}`, 104, 140 + w * 132, 22, 'rgb(200,220,255)');
      const name = Loc.t('world.' + (w + 1));
      let s = 34; while (s > 16 && Ui.measure(name, s) > 350) s -= 2;
      Ui.text(name, 104, 172 + w * 132, s, '#fff');
    }
    for (let i = 0; i < n; i++) {
      let r = this.rect(i);
      const sel = i === this.sel, open = this.unlocked(i), id = `${Math.floor(i / 3) + 1}-${i % 3 + 1}`;
      if (sel) r = { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 };
      Ui.rrect(r.x, r.y, r.w, r.h, 20, sel ? C.accent : open ? 'rgba(30,48,90,0.94)' : 'rgba(40,44,60,0.9)', sel ? '#fff' : '#78aae6');
      const fg = sel ? C.ink : '#fff';
      Ui.text(id, r.x + 16, r.y + 10, 40, open ? fg : 'rgb(130,130,150)', 'left', !sel);
      if (!open) {
        const cx = r.x + r.w - 40, cy = r.y + 36;
        g.beginPath(); g.arc(cx, cy - 10, 10, Math.PI, 0); g.lineWidth = 4; g.strokeStyle = 'rgb(170,170,190)'; g.stroke();
        Ui.rrect(cx - 16, cy - 10, 32, 26, 6, 'rgb(170,170,190)');
        Ui.text(Loc.t('levels.locked'), r.x + 16, r.y + 70, 22, 'rgb(150,150,170)', 'left', false);
        continue;
      }
      const rec = Save.data.records[id];
      if (rec) {
        Art.coin(r.x + r.w - 70, r.y + 32, this.t, 0.7);
        Ui.text(`${rec.coins}/${rec.totalCoins}`, r.x + r.w - 14, r.y + 20, 22, fg, 'right', !sel);
        Ui.text(`${Loc.t('levels.best')}: ${rec.score}`, r.x + 16, r.y + 62, 20, fg, 'left', !sel);
        Ui.text(fmtTime(rec.time), r.x + r.w - 14, r.y + 62, 20, fg, 'right', !sel);
        star(r.x + r.w - 26, r.y + 94, 9, 4, 'rgb(255,230,90)');
      }
    }
    backButton();
    Backdrop.hint();
  }
}

// ------------------------------------------------------------------ play
class PlayScene {
  constructor(index, cp = null) {
    this.index = index;
    this.data = parseLevel(Session.levels[index]);
    this.stage = this.makeStage(cp);
    this.mode = 'intro'; this.modeTime = 0; this.acc = 0; this.menu = new Menu(); this.newRecord = false; this.timeBonus = 0;
    Audio.playMusic(this.data.world);
  }
  showTouch() { return Input.isTouch && this.mode === 'playing'; }
  makeStage(cp) {
    const s = new Stage(this.data, cp);
    s.onDied = () => this.died();
    s.onCompleted = () => this.completed();
    s.onExtraLife = () => { Session.lives++; };
    return s;
  }
  setMode(m) { this.mode = m; this.modeTime = 0; this.menu.selected = 0; }
  died() {
    Session.lives--;
    if (Session.lives < 0) { Audio.play('gameOver'); this.setMode('gameover'); return; }
    this.stage = this.makeStage(this.stage.lastCheckpoint);
    Audio.playMusic(this.data.world);
    this.setMode('intro');
  }
  completed() {
    const s = this.stage;
    this.timeBonus = Math.max(0, 300 - Math.floor(s.time)) * 10;
    s.score += this.timeBonus;
    const recs = Save.data.records, old = recs[this.data.id];
    this.newRecord = !old || s.score > old.score;
    const rec = old || { score: 0, coins: 0, totalCoins: 0, time: 0 };
    rec.score = Math.max(rec.score, s.score); rec.coins = Math.max(rec.coins, s.coins); rec.totalCoins = s.totalCoins;
    rec.time = rec.time <= 0 ? s.time : Math.min(rec.time, s.time);
    recs[this.data.id] = rec;
    Save.data.unlocked = Math.max(Save.data.unlocked, Math.min(this.index + 2, Session.levels.length));
    Save.save();
    this.setMode(this.index + 1 >= Session.levels.length ? 'victory' : 'complete');
  }
  layout(n, y) { this.menu.rects = []; for (let i = 0; i < n; i++) this.menu.rects.push({ x: VW / 2 - 220, y: y + i * 76, w: 440, h: 62 }); }
  update(dt) {
    this.modeTime += dt;
    const step = 1 / 120;
    switch (this.mode) {
      case 'intro':
        if (this.modeTime > 1.3 || (this.modeTime > 0.3 && (Input.jumpPressed || Input.confirm || Input.click))) this.setMode('playing');
        break;
      case 'playing':
        if (Input.pausePressed && !this.stage.completed && !this.stage.player.dead) { Audio.play('menuSelect'); this.setMode('paused'); return; }
        this.acc += Math.min(dt, 0.1);
        this.stage.pendingJump = this.stage.pendingJump || Input.jumpPressed;
        this.stage.pendingAction = this.stage.pendingAction || Input.actionPressed;
        while (this.acc >= step) {
          this.stage.update(step, true);
          this.acc -= step;
          if (this.mode !== 'playing') break;
        }
        break;
      case 'paused': {
        if (Input.pausePressed || Input.kp('Backspace') || Input.bp(1)) { this.setMode('playing'); return; }
        this.layout(4, 250);
        const r = this.menu.update(4);
        if (r === 0) this.setMode('playing');
        if (r === 1) Scenes.go(new PlayScene(this.index));
        if (r === 2) Scenes.go(new LevelSelectScene());
        if (r === 3) Scenes.go(new TitleScene());
        break;
      }
      case 'complete': {
        this.stage.update(dt, false);
        if (this.modeTime < 0.8) break;
        this.layout(2, 470);
        const r = this.menu.update(2);
        if (r === 0) Scenes.go(new PlayScene(this.index + 1));
        if (r === 1) Scenes.go(new LevelSelectScene());
        break;
      }
      case 'victory':
        this.stage.update(dt, false);
        if (this.modeTime > 1.5 && (Input.confirm || Input.back || Input.click)) Scenes.go(new TitleScene());
        break;
      case 'gameover': {
        if (this.modeTime < 1) break;
        this.layout(2, 380);
        const r = this.menu.update(2);
        if (r === 0) { Session.lives = 3; Scenes.go(new PlayScene(this.index)); }
        if (r === 1) Scenes.go(new LevelSelectScene());
        break;
      }
    }
  }
  stat(label, value, y) {
    Ui.text(label, VW / 2 - 260, y, 32, 'rgb(180,210,255)');
    Ui.text(value, VW / 2 + 260, y, 32, '#fff', 'right');
  }
  draw() {
    StageView.draw(this.stage, Session.lives);
    const m = this.mode;
    if (m === 'intro') {
      const a = this.modeTime < 1 ? 1 : Math.max(0, 1 - (this.modeTime - 1) / 0.3);
      g.globalAlpha = a;
      g.fillStyle = 'rgba(8,14,34,0.75)'; g.fillRect(0, 0, VW, VH);
      Ui.title(`${Loc.t('hud.world')} ${this.data.id}`, VW / 2, 250, 80, '#fff', 'rgb(30,60,130)');
      Ui.text(Loc.t('world.' + this.data.world), VW / 2, 360, 40, C.accent, 'center');
      Art.penguinHead(VW / 2 - 50, 450, 1.6);
      Ui.text(`× ${Session.lives}`, VW / 2 - 10, 432, 40, '#fff');
      g.globalAlpha = 1;
    } else if (m === 'playing' && Input.isTouch) {
      // pause hint is the on-screen button
    } else if (m === 'paused') {
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, VW, VH);
      Ui.panel(VW / 2 - 280, 140, 560, 460);
      Ui.text(Loc.t('pause.title'), VW / 2, 170, 52, C.accent, 'center');
      this.layout(4, 250);
      [Loc.t('pause.resume'), Loc.t('pause.restart'), Loc.t('pause.levels'), Loc.t('pause.menu')].forEach((s, i) => Ui.button(this.menu.rects[i], s, this.menu.selected === i, 30));
    } else if (m === 'complete' || m === 'victory') {
      const a = Math.min(1, this.modeTime * 3), victory = m === 'victory';
      g.fillStyle = `rgba(0,0,0,${0.5 * a})`; g.fillRect(0, 0, VW, VH);
      Ui.panel(VW / 2 - 330, 90, 660, victory ? 520 : 560);
      Ui.title(victory ? Loc.t('victory.title') : Loc.t('complete.title'), VW / 2, 112, 56, C.accent, 'rgb(60,30,0)');
      const s = this.stage;
      this.stat(Loc.t('complete.coins'), `${s.coins} / ${s.totalCoins}`, 205);
      this.stat(Loc.t('complete.time'), fmtTime(s.time), 261);
      this.stat(Loc.t('complete.score'), `${s.score}  (+${this.timeBonus})`, 317);
      if (this.newRecord && Math.floor(this.modeTime * 3) % 2 === 0) Ui.text(Loc.t('complete.record'), VW / 2, 377, 32, 'rgb(120,255,170)', 'center');
      if (victory) {
        Ui.textBlock(Loc.t('victory.text'), VW / 2, 440, 30, 580);
        if (this.modeTime > 1.5) Ui.text(Loc.t('menu.continue') + ' >', VW / 2, 560, 26, C.accent, 'center');
      } else if (this.modeTime >= 0.8) {
        this.layout(2, 470);
        Ui.button(this.menu.rects[0], Loc.t('complete.next'), this.menu.selected === 0, 30);
        Ui.button(this.menu.rects[1], Loc.t('pause.levels'), this.menu.selected === 1, 30);
      }
    } else if (m === 'gameover') {
      const a = Math.min(1, this.modeTime * 2);
      g.fillStyle = `rgba(20,0,10,${0.7 * a})`; g.fillRect(0, 0, VW, VH);
      g.globalAlpha = a;
      Ui.title(Loc.t('gameover.title'), VW / 2, 200, 90, 'rgb(255,90,90)', '#000');
      g.globalAlpha = 1;
      if (this.modeTime >= 1) {
        this.layout(2, 380);
        Ui.button(this.menu.rects[0], Loc.t('gameover.retry'), this.menu.selected === 0, 30);
        Ui.button(this.menu.rects[1], Loc.t('pause.levels'), this.menu.selected === 1, 30);
      }
    }
  }
}
