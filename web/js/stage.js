'use strict';
// Level simulation (port of Game/Stage.cs) and rendering (port of Game/StageView.cs).
// The gameplay part must stay bit-identical to Stage.cs and server/src/Replay/Sim.php:
// same operations in the same order, no Math.random/Math.sin in anything that affects gameplay.

const P = {
  walk: 250, run: 400, accelGround: 2000, accelAir: 1300, friction: 2200,
  jumpV: 780, jumpVRun: 860, doubleJumpV: 720, gravityUp: 1800, gravity: 2800, maxFall: 1000,
  coyote: 0.1, jumpBuffer: 0.12, stompBounce: 460, stompBounceHeld: 740, springV: 1250, springVHeld: 1420,
  pw: 28, ph: 40, view: 1280, tps: 120, step: 1 / 120,
};
const rand = (a, b) => a + Math.random() * (b - a); // cosmetic only
const approach = (v, t, s) => v < t ? Math.min(v + s, t) : Math.max(v - s, t);
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const sign = v => v > 0 ? 1 : v < 0 ? -1 : 0;
const SOLID = new Set(['#', 'B', '?', 'F', 'S', 'W', 'H', 'E', 'x']);

// Deterministic sine (same polynomial as DetMath.Sin in C# and PHP).
function dsin(x) {
  const k = Math.floor(x / 6.283185307179586 + 0.5);
  let r = x - k * 6.283185307179586;
  if (r > 1.5707963267948966) r = 3.141592653589793 - r;
  else if (r < -1.5707963267948966) r = -3.141592653589793 - r;
  const r2 = r * r;
  return r * (1 + r2 * (-0.16666666666666666 + r2 * (0.008333333333333333 + r2 * (-0.0001984126984126984
    + r2 * (2.7557319223985893e-6 + r2 * (-2.505210838544172e-8 + r2 * 1.6059043836821613e-10))))));
}

// One tick of player input: 6 bits (left 1, right 2, run 4, jump held 8, jump pressed 16, action pressed 32).
const TickInput = {
  none: { left: false, right: false, run: false, held: false, jump: false, action: false },
  fromBits: b => ({ left: !!(b & 1), right: !!(b & 2), run: !!(b & 4), held: !!(b & 8), jump: !!(b & 16), action: !!(b & 32) }),
  bits: i => (i.left ? 1 : 0) | (i.right ? 2 : 0) | (i.run ? 4 : 0) | (i.held ? 8 : 0) | (i.jump ? 16 : 0) | (i.action ? 32 : 0),
};

function parseLevel(file, text) {
  const lines = (text !== undefined ? text : DATA.levels[file]).replace(/\r/g, '').split('\n');
  let id = file, world = 1, signs = [], i = 0;
  for (; i < lines.length && lines[i] !== '---'; i++) {
    const eq = lines[i].indexOf('=');
    if (eq < 0) continue;
    const k = lines[i].slice(0, eq).trim(), v = lines[i].slice(eq + 1).trim();
    if (k === 'id') id = v;
    if (k === 'world') world = parseInt(v, 10);
    if (k === 'signs') signs = v.split(',').map(s => s.trim()).filter(Boolean);
  }
  const rows = lines.slice(i + 1);
  while (rows.length > 15 && rows[rows.length - 1] === '') rows.pop();
  while (rows.length < 15) rows.push('');
  const w = Math.max(...rows.map(r => r.length));
  const tiles = rows.map(r => r.padEnd(w, ' ').split(''));
  return { id, world, signs, tiles, w, h: rows.length };
}

class Stage {
  constructor(data, cp) {
    this.data = data;
    this.theme = (typeof Themes !== 'undefined' && (Themes[data.world] || Themes[1])) || null;
    this.tiles = data.tiles.map(r => r.slice());
    this.W = data.w; this.H = data.h;
    this.player = { x: 0, y: 0, vx: 0, vy: 0, facing: 1, onGround: false, coyote: 0, buffer: 0, power: 0, wings: false,
      doubleUsed: false, invuln: 0, anim: 0, prevBottom: 0, riding: null, dead: false, deadTimer: 0, hidden: false };
    this.enemies = []; this.platforms = []; this.icicles = []; this.items = []; this.snowballs = [];
    this.particles = []; this.texts = []; this.coinPops = []; this.checkpoints = []; this.signs = [];
    this.bumps = new Map(); this.crumbleTimer = new Map(); this.crumbleFallen = new Map(); this.springAnim = new Map();
    this.timeTicks = 0; this.clock = 0; this.score = 0; this.coins = 0; this.totalCoins = 0;
    this.camX = 0; this.shake = 0; this.combo = 0;
    this.completed = false; this.completeTimer = 0; this.scoreAtGoal = 0;
    this.message = null; this.messageTimer = 0; this.lastCheckpoint = null;
    this.onDied = null; this.onCompleted = null; this.onExtraLife = null;
    this.in = TickInput.none;
    const signPos = [];
    const orig = data.tiles;
    for (let x = 0; x < this.W; x++) for (let y = 0; y < this.H; y++) {
      const c = this.tiles[y][x];
      const clear = () => { this.tiles[y][x] = ' '; };
      switch (c) {
        case '@': this.player.x = x * T + (T - P.pw) / 2; this.player.y = y * T + T - P.ph; clear(); break;
        case 'e': this.enemies.push(this.makeEnemy('walker', x, y)); clear(); break;
        case 's': this.enemies.push(this.makeEnemy('spiky', x, y)); clear(); break;
        case 'b': this.enemies.push(this.makeEnemy('bird', x, y)); clear(); break;
        case 'h': this.enemies.push(this.makeEnemy('hopper', x, y)); clear(); break;
        case 'i': this.icicles.push({ x: x * T, y: y * T, state: 0, timer: 0, vy: 0 }); clear(); break;
        case 'C': this.checkpoints.push({ tx: x, ty: y, active: false }); clear(); break;
        case 'G': this.goal = { x, y }; clear(); break;
        case '!': signPos.push([x, y]); clear(); break;
        case 'M': case 'V': {
          if (x > 0 && orig[y][x - 1] === c) { clear(); break; }
          let len = 1;
          while (x + len < this.W && orig[y][x + len] === c) len++;
          const ox = x * T, oy = y * T + T - 20 - 8;
          this.platforms.push({ ox, oy, x: ox, y: oy, dx: 0, dy: 0, wt: len, vertical: c === 'V', phase: x * 0.37 });
          clear(); break;
        }
        case 'o': case '?': this.totalCoins++; break;
      }
    }
    signPos.sort((a, b) => a[0] - b[0] || a[1] - b[1]).forEach(([sx, sy], i) => this.signs.push({ tx: sx, ty: sy, key: data.signs[i] || '' }));
    if (cp) {
      this.lastCheckpoint = cp;
      this.player.x = cp.tx * T + (T - P.pw) / 2; this.player.y = cp.ty * T + T - P.ph;
      this.score = cp.score; this.coins = cp.coins; this.timeTicks = cp.timeTicks;
      for (const c of this.checkpoints) if (c.tx <= cp.tx) c.active = true;
    }
    this.player.prevBottom = this.player.y + P.ph;
    this.camX = Math.max(0, Math.min(Math.max(0, this.W * T - P.view), this.player.x + P.pw / 2 - P.view * 0.4));
  }

  get time() { return this.timeTicks / P.tps; }
  get finalScore() { return this.completed ? this.scoreAtGoal : this.score; }

  makeEnemy(kind, tx, ty) {
    const [w, h] = { walker: [40, 32], spiky: [40, 34], bird: [40, 28], hopper: [36, 30] }[kind];
    const x = tx * T + (T - w) / 2, y = ty * T + T - h;
    return { kind, w, h, x, y, ox: x, oy: y, vx: 0, vy: 0, facing: -1, active: false, onGround: false, squashed: false, flipped: false, deathTimer: 0, t: 0, hopTimer: 1 };
  }

  at(x, y) { return x < 0 || x >= this.W ? '#' : y < 0 || y >= this.H ? ' ' : this.tiles[y][x]; }
  solid(x, y) {
    const c = this.at(x, y);
    if (c === 'x' && this.crumbleFallen.has(x + ',' + y)) return false;
    return SOLID.has(c);
  }
  oneWay(x, y) { const c = this.at(x, y); return c === '-' || c === '*'; }

  /** Advances the level by dt; during play dt is always P.step (one tick) and input a TickInput. */
  update(dt, input) {
    this.in = input || TickInput.none;
    this.clock += dt;
    if (dt > 0 && !this.completed && !this.player.dead) this.timeTicks++;
    if (this.messageTimer > 0) this.messageTimer -= dt;
    if (this.shake > 0) this.shake -= dt;
    for (const p of this.platforms) {
      const s = dsin(this.clock * 6.283185307179586 / 4.5 + p.phase) * (3 * T);
      const nx = p.vertical ? p.ox : p.ox + s, ny = p.vertical ? p.oy + s : p.oy;
      p.dx = nx - p.x; p.dy = ny - p.y; p.x = nx; p.y = ny;
    }
    if (this.player.dead) this.updateDead(dt);
    else if (this.completed) this.updateCompletion(dt);
    else this.updatePlayer(dt);
    this.updateCrumbles(dt);
    this.updateEnemies(dt);
    this.updateIcicles(dt);
    this.updateItems(dt);
    this.updateSnowballs(dt);
    this.updateEffects(dt);
    if (!this.player.dead) {
      const target = this.player.x + P.pw / 2 - P.view * 0.4 + this.player.facing * 60;
      this.camX += (target - this.camX) * Math.min(1, dt * 5);
      this.camX = Math.max(0, Math.min(Math.max(0, this.W * T - P.view), this.camX));
    }
  }

  rectP() { const p = this.player; return { x: p.x, y: p.y, w: P.pw, h: P.ph }; }

  updatePlayer(dt) {
    const p = this.player, inp = this.in;
    p.anim += dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.riding) { p.x += p.riding.dx; p.y += p.riding.dy; p.riding = null; }
    if (inp.jump) p.buffer = P.jumpBuffer; else p.buffer -= dt;
    if (p.onGround) { p.coyote = P.coyote; p.doubleUsed = false; } else p.coyote -= dt;

    const target = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), max = inp.run ? P.run : P.walk;
    if (target !== 0) {
      p.facing = target;
      let acc = p.onGround ? P.accelGround : P.accelAir;
      if (sign(p.vx) !== target && p.onGround) acc *= 1.6;
      p.vx = approach(p.vx, target * max, acc * dt);
    } else if (p.onGround) p.vx = approach(p.vx, 0, P.friction * dt);
    else p.vx = approach(p.vx, 0, P.friction * 0.25 * dt);

    if (p.buffer > 0 && p.coyote > 0) {
      const rf = Math.max(0, Math.min(1, (Math.abs(p.vx) - P.walk) / (P.run - P.walk)));
      p.vy = -(P.jumpV + (P.jumpVRun - P.jumpV) * rf);
      p.onGround = false; p.buffer = 0; p.coyote = 0;
      Audio.play('jump');
      this.dust(p.x + P.pw / 2, p.y + P.ph, 5);
    } else if (p.buffer > 0 && !p.onGround && p.wings && !p.doubleUsed) {
      p.vy = -P.doubleJumpV; p.doubleUsed = true; p.buffer = 0;
      Audio.play('doubleJump');
      for (let i = 0; i < 8; i++) this.spawn(p.x + P.pw / 2, p.y + P.ph / 2 + 16, rand(-120, 120), rand(40, 140), 0.5, 4, [255, 255, 255, 230], false);
    }
    if (inp.action && p.power === 2 && this.snowballs.length < 2) {
      this.snowballs.push({ x: p.x + P.pw / 2 + p.facing * 16, y: p.y + P.ph / 2 - 4, vx: p.facing * 560 + p.vx * 0.3, vy: 120, life: 2 });
      Audio.play('throw');
    }
    const grav = p.vy < 0 && inp.held ? P.gravityUp : P.gravity;
    p.vy = Math.min(p.vy + grav * dt, P.maxFall);
    p.prevBottom = p.y + P.ph;
    this.moveX(dt);
    this.moveY(dt, inp.held);
    if (p.y > this.H * T + 60) this.kill();
    this.checkHazards(); this.checkPickups(); this.checkCheckpoints(); this.checkGoal();
  }

  moveX(dt) {
    const p = this.player;
    p.x += p.vx * dt;
    if (p.x < 0) { p.x = 0; p.vx = 0; }
    if (p.x > this.W * T - P.pw) { p.x = this.W * T - P.pw; p.vx = 0; }
    const y0 = Math.floor(p.y / T), y1 = Math.floor((p.y + P.ph - 0.01) / T);
    if (p.vx > 0) {
      const x = Math.floor((p.x + P.pw) / T);
      for (let y = y0; y <= y1; y++) if (this.solid(x, y)) { p.x = x * T - P.pw; p.vx = 0; break; }
    } else if (p.vx < 0) {
      const x = Math.floor(p.x / T);
      for (let y = y0; y <= y1; y++) if (this.solid(x, y)) { p.x = (x + 1) * T; p.vx = 0; break; }
    }
  }

  moveY(dt, held) {
    const p = this.player;
    p.y += p.vy * dt;
    p.onGround = false;
    const x0 = Math.floor((p.x + 1) / T), x1 = Math.floor((p.x + P.pw - 1) / T);
    if (p.vy >= 0) {
      const bottom = p.y + P.ph, y = Math.floor(bottom / T);
      let best = Infinity, springX = -1;
      for (let x = x0; x <= x1; x++) {
        if (this.solid(x, y)) best = Math.min(best, y * T);
        else if (this.oneWay(x, y)) {
          const top = y * T + (this.at(x, y) === '*' ? 16 : 0);
          if (p.prevBottom <= top + 0.5 && bottom >= top) { best = Math.min(best, top); if (this.at(x, y) === '*') springX = x; }
        }
      }
      for (const mp of this.platforms) {
        if (p.x + P.pw > mp.x + 2 && p.x < mp.x + mp.wt * T - 2) {
          const top = mp.y;
          if (p.prevBottom <= top + Math.abs(mp.dy) + 1 && bottom >= top && top < best) { best = top; p.riding = mp; }
        }
      }
      if (best < Infinity) {
        p.y = best - P.ph;
        if (springX >= 0) {
          p.vy = -(held ? P.springVHeld : P.springV);
          this.springAnim.set(springX + ',' + y, 0.3);
          Audio.play('spring');
          p.riding = null;
          return;
        }
        if (p.vy > 600) this.dust(p.x + P.pw / 2, p.y + P.ph, 4);
        p.vy = 0; p.onGround = true; this.combo = 0;
        for (let x = x0; x <= x1; x++) {
          const k = x + ',' + y;
          if (this.at(x, y) === 'x' && !this.crumbleTimer.has(k) && !this.crumbleFallen.has(k)) this.crumbleTimer.set(k, 0.45);
        }
      } else p.riding = null;
    } else {
      const y = Math.floor(p.y / T);
      let hitX = -1, bestO = 0;
      for (let x = x0; x <= x1; x++) {
        if (!this.solid(x, y)) continue;
        const o = Math.min(p.x + P.pw, (x + 1) * T) - Math.max(p.x, x * T);
        if (o > bestO) { bestO = o; hitX = x; }
      }
      if (hitX >= 0) { p.y = (y + 1) * T; p.vy = 40; this.hitBlock(hitX, y); }
    }
  }

  hitBlock(x, y) {
    const c = this.at(x, y), cx = x * T + T / 2, cy = y * T;
    if (c === '?') { this.tiles[y][x] = 'E'; this.bump(x, y); this.addCoin(); this.coinPops.push({ x: cx, y: cy, t: 0 }); }
    else if (c === 'F' || c === 'S' || c === 'W' || c === 'H') {
      this.tiles[y][x] = 'E'; this.bump(x, y);
      const kind = { F: 'fish', S: 'snowflake', W: 'wing', H: 'heart' }[c];
      this.items.push({ kind, x: x * T + T / 2, y: y * T + T / 2, vx: kind === 'snowflake' ? 0 : 110, vy: 0, emerge: 0.5, t: 0 });
      Audio.play('powerUp');
    } else if (c === 'B') {
      if (this.player.power >= 1) {
        this.tiles[y][x] = ' '; this.score += 50; Audio.play('break'); this.shake = 0.1;
        for (let i = 0; i < 4; i++) this.spawn(x * T + 12 + (i % 2) * 24, y * T + 12 + Math.floor(i / 2) * 24, (i % 2 === 0 ? -1 : 1) * rand(80, 160), rand(-520, -320), 1.2, 12, this.theme && this.theme.brick, true, 1);
      } else { this.bump(x, y); Audio.play('bump'); }
    } else Audio.play('bump');
    const above = { x: x * T, y: y * T - 10, w: T, h: 12 };
    for (const e of this.enemies) if (!e.squashed && !e.flipped && e.active && overlap(e, above)) this.knock(e, x * T + T / 2 < e.x + e.w / 2 ? 1 : -1);
    if (this.at(x, y - 1) === 'o') { this.tiles[y - 1][x] = ' '; this.addCoin(); this.coinPops.push({ x: cx, y: cy - T, t: 0 }); }
  }

  bump(x, y) { this.bumps.set(x + ',' + y, 0.2); }
  bumpOffset(x, y) { const t = this.bumps.get(x + ',' + y); return t ? -Math.sin(Math.PI * (1 - t / 0.2)) * 12 : 0; }

  addCoin() {
    this.coins++; this.score += 100; Audio.play('coin');
    if (this.coins % 100 === 0) this.extraLife();
  }
  extraLife() { this.onExtraLife && this.onExtraLife(); Audio.play('oneUp'); this.showMessage(Loc.t('power.heart')); }
  showMessage(t) { this.message = t; this.messageTimer = 3.2; }

  checkHazards() {
    const r = this.rectP(), p = this.player;
    const x0 = Math.floor(r.x / T), x1 = Math.floor((r.x + r.w) / T), y0 = Math.floor(r.y / T), y1 = Math.floor((r.y + r.h) / T);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const c = this.at(x, y);
        if (c === '^' && overlap(r, { x: x * T + 6, y: y * T + 20, w: T - 12, h: T - 20 })) { this.hurt(); if (!p.dead) p.vy = -520; return; }
        if (c === '~' && overlap(r, { x: x * T, y: y * T + 18, w: T, h: T - 18 })) { this.kill(); return; }
      }
  }

  checkPickups() {
    const r = this.rectP(), p = this.player;
    const x0 = Math.floor(r.x / T), x1 = Math.floor((r.x + r.w) / T), y0 = Math.floor(r.y / T), y1 = Math.floor((r.y + r.h) / T);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        if (this.at(x, y) !== 'o' || !overlap(r, { x: x * T + 10, y: y * T + 6, w: T - 20, h: T - 12 })) continue;
        this.tiles[y][x] = ' '; this.addCoin();
        for (let i = 0; i < 6; i++) this.spawn(x * T + T / 2, y * T + T / 2, rand(-100, 100), rand(-160, 40), 0.4, 3, [255, 230, 120], false);
      }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.emerge > 0 || !overlap(r, { x: it.x - 16, y: it.y - 16, w: 32, h: 32 })) continue;
      this.items.splice(i, 1);
      this.score += 1000;
      this.texts.push({ x: it.x, y: it.y, text: '1000', life: 1, color: typeof C !== 'undefined' ? C.accent : '#fff' });
      if (it.kind === 'fish') { p.power = Math.max(p.power, 1); this.showMessage(Loc.t('power.fish')); Audio.play('powerUp'); }
      if (it.kind === 'snowflake') { p.power = 2; this.showMessage(Loc.t('power.snowflake')); Audio.play('powerUp'); }
      if (it.kind === 'wing') { p.wings = true; this.showMessage(Loc.t('power.wing')); Audio.play('powerUp'); }
      if (it.kind === 'heart') this.extraLife();
      for (let k = 0; k < 14; k++) this.spawn(it.x, it.y, rand(-200, 200), rand(-200, 200), 0.6, 4, [255, 240, 150], false);
    }
  }

  checkCheckpoints() {
    for (const c of this.checkpoints) {
      if (c.active || !overlap(this.rectP(), { x: c.tx * T, y: c.ty * T - T, w: T, h: T * 2 })) continue;
      c.active = true;
      this.lastCheckpoint = { tx: c.tx, ty: c.ty, score: this.score, coins: this.coins, timeTicks: this.timeTicks };
      Audio.play('checkpoint');
      this.texts.push({ x: c.tx * T + T / 2, y: c.ty * T - 60, text: Loc.t('checkpoint'), life: 1.6, color: 'rgb(120,255,170)' });
      for (let k = 0; k < 16; k++) this.spawn(c.tx * T + 40, c.ty * T - 30, rand(-150, 150), rand(-250, 50), 0.8, 4, [120, 255, 170], true);
    }
  }

  checkGoal() {
    const d = { x: this.goal.x * T - 4, y: this.goal.y * T - 16, w: T + 8, h: T + 16 };
    if (!overlap(this.rectP(), d)) return;
    this.completed = true; this.scoreAtGoal = this.score; this.completeTimer = 0;
    this.player.vx = 0; this.player.vy = 0;
    Audio.playMusic(-1); Audio.play('complete');
  }

  updateCompletion(dt) {
    const p = this.player;
    this.completeTimer += dt; p.anim += dt;
    p.x = approach(p.x, this.goal.x * T + T / 2 - P.pw / 2, 120 * dt);
    p.vy = Math.min(p.vy + P.gravity * dt, P.maxFall);
    p.prevBottom = p.y + P.ph;
    this.moveY(dt, false);
    if (this.completeTimer > 0.9) p.hidden = true;
    if (this.completeTimer > 1.2 && this.completeTimer - dt <= 1.2)
      for (let k = 0; k < 30; k++) this.spawn(this.goal.x * T + T / 2, this.goal.y * T - 60, rand(-260, 260), rand(-420, -80), 1.4, 5, mix([255, 200, 60], [120, 220, 255], Math.random()), true, 1);
    if (this.completeTimer > 2.4 && this.completeTimer - dt <= 2.4) this.onCompleted && this.onCompleted();
  }

  hurt() {
    const p = this.player;
    if (p.invuln > 0 || p.dead || this.completed) return;
    if (p.power > 0 || p.wings) { p.power = 0; p.wings = false; p.invuln = 2; Audio.play('hurt'); this.shake = 0.2; }
    else this.kill();
  }

  kill() {
    const p = this.player;
    if (p.dead || this.completed) return;
    p.dead = true; p.deadTimer = 0; p.vx = 0; p.vy = -700;
    Audio.playMusic(-1); Audio.play('die'); this.shake = 0.3;
  }

  updateDead(dt) {
    const p = this.player;
    p.deadTimer += dt;
    if (p.deadTimer < 0.4) return;
    p.vy = Math.min(p.vy + P.gravity * 0.6 * dt, P.maxFall);
    p.y += p.vy * dt;
    if (p.deadTimer > 2.2 && p.deadTimer - dt <= 2.2) this.onDied && this.onDied();
  }

  updateCrumbles(dt) {
    for (const [k, t0] of [...this.crumbleTimer]) {
      const t = t0 - dt;
      if (t > 0) { this.crumbleTimer.set(k, t); continue; }
      this.crumbleTimer.delete(k); this.crumbleFallen.set(k, 4);
      Audio.play('crumble');
      const [x, y] = k.split(',').map(Number);
      for (let i = 0; i < 5; i++) this.spawn(x * T + rand(6, 42), y * T + rand(4, 24), rand(-40, 40), rand(0, 100), 1, 8, this.theme ? mix(this.theme.brick, WHITE, 0.3) : null, true, 1);
    }
    for (const [k, t0] of [...this.crumbleFallen]) {
      const t = t0 - dt;
      this.crumbleFallen.set(k, t);
      if (t > 0) continue;
      const [x, y] = k.split(',').map(Number);
      if (overlap({ x: x * T, y: y * T, w: T, h: T }, this.rectP())) continue;
      this.crumbleFallen.delete(k);
    }
    for (const m of [this.bumps, this.springAnim]) for (const [k, t] of [...m]) { if (t - dt <= 0) m.delete(k); else m.set(k, t - dt); }
  }

  updateEnemies(dt) {
    const L = this.camX - 2 * T, R = this.camX + P.view + 2 * T;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.active) { if (e.x + e.w > L && e.x < R) e.active = true; else continue; }
      e.t += dt;
      if (e.squashed) { e.deathTimer += dt; if (e.deathTimer > 0.5) this.enemies.splice(i, 1); continue; }
      if (e.flipped) { e.vy += P.gravity * dt; e.x += e.vx * dt; e.y += e.vy * dt; if (e.y > this.H * T + 100) this.enemies.splice(i, 1); continue; }
      if (e.kind === 'walker' || e.kind === 'spiky') { e.vx = e.facing * (e.kind === 'walker' ? 70 : 55); this.moveEnemy(e, dt, true); }
      else if (e.kind === 'hopper') {
        if (e.onGround) {
          e.vx = 0; e.hopTimer -= dt;
          if (e.hopTimer <= 0) {
            const dx = this.player.x + P.pw / 2 - (e.x + e.w / 2);
            if (Math.abs(dx) < 8 * T) e.facing = dx > 0 ? 1 : -1;
            e.vx = e.facing * 150; e.vy = -640; e.hopTimer = 1.1; e.onGround = false;
          }
        }
        this.moveEnemy(e, dt, false);
      } else {
        const nx = e.ox + dsin(e.t * 0.9) * 2.2 * T, ny = e.oy + dsin(e.t * 2.4) * 0.5 * T;
        e.facing = nx > e.x ? 1 : -1; e.x = nx; e.y = ny;
      }
      if (e.y > this.H * T + 100) { this.enemies.splice(i, 1); continue; }
      if (!this.player.dead && !this.completed) this.playerVsEnemy(e);
    }
  }

  moveEnemy(e, dt, turnAtEdges) {
    e.vy = Math.min(e.vy + P.gravity * dt, P.maxFall);
    e.x += e.vx * dt;
    const y0 = Math.floor(e.y / T), y1 = Math.floor((e.y + e.h - 0.01) / T);
    const blocked = (x, y) => this.solid(x, y) || this.at(x, y) === '^' || this.at(x, y) === '~';
    if (e.vx > 0) {
      const x = Math.floor((e.x + e.w) / T);
      for (let y = y0; y <= y1; y++) if (blocked(x, y) || x >= this.W) { e.x = x * T - e.w; e.facing = -1; if (e.kind === 'hopper') e.vx = -e.vx; break; }
    } else if (e.vx < 0) {
      const x = Math.floor(e.x / T);
      for (let y = y0; y <= y1; y++) if (blocked(x, y) || x < 0) { e.x = (x + 1) * T; e.facing = 1; if (e.kind === 'hopper') e.vx = -e.vx; break; }
    }
    const prevBottom = e.y + e.h;
    e.y += e.vy * dt;
    e.onGround = false;
    const x0 = Math.floor((e.x + 2) / T), x1 = Math.floor((e.x + e.w - 2) / T);
    if (e.vy >= 0) {
      const y = Math.floor((e.y + e.h) / T);
      for (let x = x0; x <= x1; x++)
        if (this.solid(x, y) || (this.at(x, y) === '-' && prevBottom <= y * T + 0.5)) { e.y = y * T - e.h; e.vy = 0; e.onGround = true; break; }
    } else {
      const y = Math.floor(e.y / T);
      for (let x = x0; x <= x1; x++) if (this.solid(x, y)) { e.y = (y + 1) * T; e.vy = 0; break; }
    }
    if (turnAtEdges && e.onGround) {
      const fx = Math.floor((e.facing > 0 ? e.x + e.w + 1 : e.x - 1) / T), fy = Math.floor((e.y + e.h + 1) / T);
      if (!this.solid(fx, fy) && this.at(fx, fy) !== '-') e.facing = -e.facing;
    }
  }

  playerVsEnemy(e) {
    const p = this.player;
    if (!overlap(this.rectP(), { x: e.x + 4, y: e.y + 4, w: e.w - 8, h: e.h - 4 })) return;
    const fromAbove = p.vy > 0 && p.prevBottom <= e.y + 14;
    if (fromAbove && e.kind !== 'spiky') {
      this.combo++;
      const pts = 100 * Math.min(this.combo, 8);
      this.score += pts;
      this.texts.push({ x: e.x + e.w / 2, y: e.y, text: String(pts), life: 1, color: '#fff' });
      p.vy = -(this.in.held ? P.stompBounceHeld : P.stompBounce);
      p.y = e.y - P.ph;
      Audio.play('stomp');
      for (let i = 0; i < 8; i++) this.spawn(e.x + e.w / 2, e.y + e.h / 2, rand(-160, 160), rand(-200, 0), 0.5, 4, [255, 255, 255, 220], true);
      if (e.kind === 'bird') this.knock(e, p.facing); else { e.squashed = true; e.deathTimer = 0; }
    } else this.hurt();
  }

  knock(e, dir) {
    if (e.squashed || e.flipped) return;
    e.flipped = true; e.vx = dir * 140; e.vy = -480;
    this.score += 200;
    this.texts.push({ x: e.x + e.w / 2, y: e.y, text: '200', life: 1, color: '#fff' });
    Audio.play('kick');
  }

  updateIcicles(dt) {
    const p = this.player;
    for (const ic of this.icicles) {
      if (ic.state === 0) {
        const pcx = p.x + P.pw / 2;
        if (!p.dead && pcx > ic.x - 1.2 * T && pcx < ic.x + 2.2 * T && p.y > ic.y) { ic.state = 1; ic.timer = 0.45; }
      } else if (ic.state === 1) { ic.timer -= dt; if (ic.timer <= 0) ic.state = 2; }
      else if (ic.state === 2) {
        ic.vy = Math.min(ic.vy + 1800 * dt, 1100); ic.y += ic.vy * dt;
        const tx = Math.floor((ic.x + T / 2) / T), ty = Math.floor((ic.y + 40) / T);
        if (this.solid(tx, ty) || this.oneWay(tx, ty) || ic.y > this.H * T) {
          ic.state = 3; Audio.play('break');
          for (let i = 0; i < 8; i++) this.spawn(ic.x + T / 2, ic.y + 36, rand(-180, 180), rand(-300, -80), 0.7, 5, [190, 230, 255], true, 1);
        }
        for (const e of this.enemies) if (!e.squashed && !e.flipped && overlap({ x: ic.x + 12, y: ic.y, w: 24, h: 40 }, e)) this.knock(e, 1);
      }
      if (ic.state < 3 && !p.dead && overlap(this.rectP(), { x: ic.x + 12, y: ic.y, w: 24, h: 40 })) this.hurt();
    }
  }

  updateItems(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      if (it.emerge > 0) { it.emerge -= dt; it.y -= T / 0.5 * dt; continue; }
      if (it.kind === 'snowflake') continue;
      it.vy = Math.min(it.vy + P.gravity * 0.8 * dt, P.maxFall);
      it.x += it.vx * dt;
      if (this.solid(Math.floor((it.x + sign(it.vx) * 16) / T), Math.floor(it.y / T))) it.vx = -it.vx;
      it.y += it.vy * dt;
      const by = Math.floor((it.y + 16) / T), bx = Math.floor(it.x / T);
      if (it.vy > 0 && (this.solid(bx, by) || this.oneWay(bx, by))) { it.y = by * T - 16; it.vy = it.kind === 'wing' ? -420 : 0; }
      if (it.y > this.H * T + 50) this.items.splice(i, 1);
    }
  }

  updateSnowballs(dt) {
    for (let i = this.snowballs.length - 1; i >= 0; i--) {
      const s = this.snowballs[i];
      s.life -= dt;
      s.vy = Math.min(s.vy + 1600 * dt, 900);
      s.x += s.vx * dt;
      let dead = s.life <= 0 || s.y > this.H * T;
      if (this.solid(Math.floor((s.x + sign(s.vx) * 9) / T), Math.floor(s.y / T))) dead = true;
      s.y += s.vy * dt;
      const bx = Math.floor(s.x / T), by = Math.floor((s.y + 9) / T);
      if (s.vy > 0 && (this.solid(bx, by) || this.oneWay(bx, by))) { s.y = by * T - 9; s.vy = -380; }
      for (const e of this.enemies) {
        if (e.squashed || e.flipped || !e.active) continue;
        if (overlap({ x: s.x - 10, y: s.y - 10, w: 20, h: 20 }, e)) { this.knock(e, s.vx >= 0 ? 1 : -1); dead = true; break; }
      }
      if (dead) {
        for (let k = 0; k < 6; k++) this.spawn(s.x, s.y, rand(-120, 120), rand(-160, 40), 0.4, 4, [255, 255, 255], true);
        this.snowballs.splice(i, 1);
      }
    }
  }

  updateEffects(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      if (p.gravity) p.vy += 1400 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) { const t = this.texts[i]; t.life -= dt; t.y -= 50 * dt; if (t.life <= 0) this.texts.splice(i, 1); }
    for (let i = this.coinPops.length - 1; i >= 0; i--) { this.coinPops[i].t += dt; if (this.coinPops[i].t > 0.5) this.coinPops.splice(i, 1); }
  }

  spawn(x, y, vx, vy, life, size, color, gravity, shape = 0) {
    if (this.headless) return;
    this.particles.push({ x, y, vx, vy, life, max: life, size, color, gravity, shape });
  }
  dust(x, y, n) { for (let i = 0; i < n; i++) this.spawn(x + rand(-10, 10), y - 2, rand(-90, 90), rand(-60, -10), 0.35, rand(3, 6), [255, 255, 255, 200], false); }

  nearbySign() {
    const cx = this.player.x + P.pw / 2, cy = this.player.y + P.ph / 2;
    return this.signs.find(s => Math.hypot(s.tx * T + T / 2 - cx, s.ty * T + T / 2 - cy) < 110) || null;
  }

  /** Gameplay state as text, used by the cross-language determinism test (tests/determinism.mjs). */
  stateHash() {
    const f = new Float64Array(1), u = new BigUint64Array(f.buffer);
    const B = d => { f[0] = d; return u[0].toString(16).padStart(16, '0'); };
    const p = this.player;
    let s = `${this.timeTicks} ${this.score} ${this.coins} ${this.completed ? 1 : 0} ${p.dead ? 1 : 0} ${B(p.x)} ${B(p.y)} ${B(p.vx)} ${B(p.vy)} ${B(this.camX)} ${this.enemies.length}`;
    for (const e of this.enemies) s += ` ${B(e.x)},${B(e.y)}`;
    return s;
  }
}


// ------------------------------------------------------------------ rendering
const StageView = {
  draw(s, lives) {
    const th = s.theme;
    Art.background(th, s.camX, s.clock);
    this.weather(th, s.camX, s.clock);
    const shake = s.shake > 0 ? Math.sin(s.clock * 90) * 5 * (s.shake / 0.3) : 0;
    g.save();
    g.translate(-Math.round(s.camX) + shake, 0);
    const x0 = Math.max(0, Math.floor(s.camX / T) - 2), x1 = Math.min(s.W - 1, Math.floor((s.camX + VW) / T) + 2);
    Art.igloo(s.goal.x * T, s.goal.y * T, s.clock);
    for (let x = x0; x <= x1; x++) for (let y = 0; y < s.H; y++) {
      const c = s.tiles[y][x], px = x * T, py = y * T;
      switch (c) {
        case '#': Art.ground(x, y, th, (y > 0 && s.at(x, y - 1) !== '#') || (y === 0 && !th.ceiling), x > 0 && s.at(x - 1, y) !== '#', x < s.W - 1 && s.at(x + 1, y) !== '#'); break;
        case 'B': Art.brick(px, py + s.bumpOffset(x, y), th); break;
        case '?': case 'F': case 'S': case 'W': case 'H': Art.prize(px, py + s.bumpOffset(x, y), s.clock, false); break;
        case 'E': Art.prize(px, py + s.bumpOffset(x, y), s.clock, true); break;
        case 'x': if (!s.crumbleFallen.has(x + ',' + y)) { const t = s.crumbleTimer.get(x + ',' + y); Art.crumble(px, py, t !== undefined ? 0.45 - t : 0, th); } break;
        case '-': Art.oneWay(px, py, th, s.at(x - 1, y) !== '-', s.at(x + 1, y) !== '-'); break;
        case '^': Art.spikes(px, py, th); break;
        case '~': Art.liquid(px, py, s.at(x, y - 1) !== '~', th, s.clock); break;
        case 'o': Art.coin(px + T / 2, py + T / 2, s.clock); break;
        case '*': { const t = s.springAnim.get(x + ',' + y); Art.spring(px, py, t ? Math.sin(t / 0.3 * Math.PI) : 0); break; }
      }
    }
    for (const sg of s.signs) Art.sign(sg.tx * T, sg.ty * T);
    for (const cp of s.checkpoints) Art.checkpoint(cp.tx * T, cp.ty * T, cp.active, s.clock);
    for (const mp of s.platforms) Art.platform(mp.x, mp.y, mp.wt, th);
    for (const cp of s.coinPops) Art.coin(cp.x, cp.y - 20 - Math.sin(cp.t / 0.5 * Math.PI) * 60, s.clock * 3, 1 - cp.t);
    for (const it of s.items) {
      if (it.kind === 'fish') Art.fish(it.x, it.y, it.t);
      else if (it.kind === 'snowflake') Art.snowflake(it.x, it.y + Math.sin(it.t * 3) * 4, it.t);
      else if (it.kind === 'wing') Art.wingItem(it.x, it.y, it.t);
      else Art.heart(it.x, it.y, 1 + Math.sin(it.t * 8) * 0.08);
    }
    for (const e of s.enemies) {
      const bx = e.x + e.w / 2, by = e.y + e.h;
      if (e.kind === 'walker') Art.walker(bx, by, e.facing, e.t, e.squashed);
      else if (e.kind === 'spiky') Art.spiky(bx, by, e.facing, e.t);
      else if (e.kind === 'bird') Art.bird(bx, by - e.h / 2, e.facing, e.t);
      else Art.hopper(bx, by, e.facing, e.t, !e.onGround);
      if (e.flipped) for (let i = 0; i < 3; i++) { const a = s.clock * 5 + i * Math.PI * 2 / 3; star(bx + Math.cos(a) * 14, by - e.h - 6 + Math.sin(a) * 5, 5, 2.2, 'rgb(255,230,90)'); }
    }
    for (const ic of s.icicles) if (ic.state < 3) Art.icicle(ic.x, ic.y, ic.state === 1 ? ic.timer : 0);
    const p = s.player;
    if (!p.hidden && !(p.invuln > 0 && Math.floor(p.invuln * 20) % 2 === 0))
      Art.penguin(p.x + P.pw / 2, p.y + P.ph, p.facing, p.anim, Math.min(1, Math.abs(p.vx) / P.walk), !p.onGround, p.vy, p.dead ? 0 : p.power, p.wings && !p.dead, 1, p.dead);
    for (const sb of s.snowballs) { circle(sb.x + 2, sb.y + 3, 10, 'rgba(0,0,0,0.24)'); circle(sb.x, sb.y, 10, 'rgb(250,252,255)'); circle(sb.x - 3, sb.y - 3, 4, 'rgb(200,225,255)'); }
    for (const pt of s.particles) {
      const col = rgba(pt.color, pt.life / pt.max);
      if (pt.shape === 1) { g.save(); g.translate(pt.x, pt.y); g.rotate(pt.life * 7); rect(-pt.size / 2, -pt.size / 2, pt.size, pt.size, col); g.restore(); }
      else circle(pt.x, pt.y, pt.size, col);
    }
    for (const ft of s.texts) { g.globalAlpha = Math.min(1, ft.life * 2); Ui.text(ft.text, ft.x, ft.y, 26, ft.color, 'center'); g.globalAlpha = 1; }
    const sign = s.nearbySign();
    if (sign && sign.key) this.bubble(Loc.t(sign.key), sign.tx * T + T / 2, sign.ty * T - 12, s.camX);
    g.restore();
    this.hud(s, lives);
  },

  bubble(text, cx, bottom, camX) {
    const size = 24, lines = Ui.wrap(text, size, 420);
    const w = Math.max(...lines.map(l => Ui.measure(l, size))) + 36, h = lines.length * size * 1.2 + 24;
    const x = Math.max(camX + 10, Math.min(camX + VW - w - 10, cx - w / 2)), y = bottom - h - 14;
    Ui.rrect(x + 4, y + 5, w, h, 12, 'rgba(0,0,0,0.27)');
    Ui.rrect(x, y, w, h, 12, 'rgba(255,252,240,0.98)', 'rgb(120,80,50)');
    tri([cx - 10, y + h - 1], [cx + 10, y + h - 1], [cx, y + h + 12], 'rgba(255,252,240,0.98)');
    lines.forEach((l, i) => Ui.text(l, x + w / 2, y + 12 + i * size * 1.2, size, C.ink, 'center', false));
  },

  weather(th, camX, t) {
    const n = th.weather === 0 ? 60 : th.weather === 2 ? 40 : th.weather === 1 ? 25 : 45;
    for (let i = 0; i < n; i++) {
      const speed = 30 + hash(i) * 50;
      let x = (hash(i * 7) * 1400 - camX * (0.3 + hash(i * 3) * 0.5) + Math.sin(t + i) * 20) % 1400;
      if (x < 0) x += 1400;
      x -= 60;
      if (th.weather === 3) circle(x, VH - (hash(i * 11) * 720 + t * speed * 1.5) % 760, 1.5 + hash(i * 5) * 2, `rgba(255,${Math.floor(140 + hash(i) * 80)},60,0.8)`);
      else if (th.weather === 1) circle(x, (hash(i * 11) * 720 + Math.sin(t * 0.5 + i) * 30 + 720) % 720, Math.max(0.5, 1.5 + Math.sin(t * 3 + i)), 'rgba(200,180,255,0.63)');
      else circle(x, (hash(i * 11) * 760 + t * speed) % 760 - 20, 1.5 + hash(i * 5) * 2.5, 'rgba(255,255,255,0.8)');
    }
  },

  hud(s, lives) {
    const box = 'rgba(10,20,45,0.67)';
    Ui.rrect(12, 10, 300, 56, 20, box);
    Art.penguinHead(40, 38, 1.1);
    Ui.text(`× ${Math.max(0, lives)}`, 60, 22, 30, '#fff');
    Art.coin(150, 38, 0, 0.8);
    Ui.text(`× ${s.coins}`, 168, 22, 30, '#fff');
    let px = 262;
    if (s.player.power >= 1) { rrect(px - 16, 24, 32, 10, 5, s.player.power === 2 ? 'rgb(120,220,255)' : 'rgb(230,50,60)'); px += 30; }
    if (s.player.wings) Art.wingItem(px, 38, s.clock);
    const title = `${Loc.t('world.' + s.data.world)}  ${s.data.id}`, tw = Ui.measure(title, 26);
    Ui.rrect(640 - tw / 2 - 20, 10, tw + 40, 44, 22, box);
    Ui.text(title, 640, 19, 26, '#fff', 'center');
    Ui.rrect(VW - 322, 10, 310, 56, 20, box);
    Ui.text(Loc.t('hud.score'), VW - 306, 14, 18, 'rgb(170,200,240)');
    Ui.text(String(s.score).padStart(6, '0'), VW - 306, 32, 28, '#fff');
    Ui.text(Loc.t('hud.time'), VW - 24, 14, 18, 'rgb(170,200,240)', 'right');
    Ui.text(fmtTime(s.time), VW - 24, 32, 28, '#fff', 'right');
    if (s.messageTimer > 0 && s.message) {
      const a = Math.min(1, s.messageTimer * 2), w = Math.min(900, Ui.measure(s.message, 26) + 50);
      const lines = Ui.wrap(s.message, 26, w - 40), h = lines.length * 26 * 1.2 + 22;
      g.globalAlpha = a;
      Ui.rrect(640 - w / 2, 78, w, h, 20, 'rgba(255,196,64,0.95)');
      lines.forEach((l, i) => Ui.text(l, 640, 89 + i * 26 * 1.2, 26, C.ink, 'center', false));
      g.globalAlpha = 1;
    }
  },
};

function fmtTime(sec) { const s = Math.floor(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
