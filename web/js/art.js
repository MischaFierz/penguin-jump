'use strict';
// Shape-based graphics (port of Game/Art.cs).
const T = 48;
let g = null; // CanvasRenderingContext2D set by main.js

const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] === undefined ? 1 : c[3] / 255) * a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 255];
const BLACK = [0, 0, 0], WHITE = [255, 255, 255];

function hash(n) {
  let x = (Math.imul(n | 0, 747796405) + 2891336453) >>> 0;
  x = Math.imul(((x >>> ((x >>> 28) + 4)) ^ x) >>> 0, 277803737) >>> 0;
  return (((x >>> 22) ^ x) >>> 0) % 1000 / 1000;
}

function ellipse(x, y, rx, ry, col) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); g.fillStyle = col; g.fill(); }
function circle(x, y, r, col) { ellipse(x, y, r, r, col); }
function rect(x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }
function rrect(x, y, w, h, r, col) { g.beginPath(); g.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2)); g.fillStyle = col; g.fill(); }
function tri(a, b, c, col) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.closePath(); g.fillStyle = col; g.fill(); }
function line(a, b, w, col) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineWidth = w; g.strokeStyle = col; g.lineCap = 'round'; g.stroke(); }
function star(cx, cy, r1, r2, col, rot = 0) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + i * Math.PI / 5 - Math.PI / 2, r = i % 2 === 0 ? r1 : r2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.closePath(); g.fillStyle = col; g.fill();
}

const Themes = {
  1: { skyTop: [110, 180, 245], skyBottom: [210, 236, 255], far: [170, 200, 235], near: [130, 175, 220], cap: [250, 252, 255], fill: [96, 130, 180], dark: [70, 96, 140], brick: [150, 210, 250], liquid: [40, 110, 170], liquidTop: [150, 210, 250], ceiling: false, weather: 0 },
  2: { skyTop: [24, 16, 48], skyBottom: [58, 34, 92], far: [44, 30, 78], near: [66, 44, 110], cap: [170, 150, 255], fill: [70, 58, 110], dark: [46, 36, 78], brick: [120, 190, 255], liquid: [40, 90, 150], liquidTop: [110, 180, 240], ceiling: true, weather: 1 },
  3: { skyTop: [8, 12, 40], skyBottom: [28, 50, 96], far: [34, 52, 92], near: [48, 72, 120], cap: [240, 248, 255], fill: [70, 84, 120], dark: [44, 54, 84], brick: [150, 210, 255], liquid: [30, 60, 120], liquidTop: [120, 180, 255], ceiling: false, weather: 2 },
  4: { skyTop: [40, 8, 8], skyBottom: [120, 36, 16], far: [70, 20, 16], near: [96, 32, 20], cap: [90, 70, 70], fill: [58, 40, 44], dark: [36, 24, 28], brick: [160, 110, 100], liquid: [240, 90, 20], liquidTop: [255, 200, 60], ceiling: true, weather: 3 },
};

const Art = {
  background(th, camX, time) {
    const grd = g.createLinearGradient(0, 0, 0, VH);
    grd.addColorStop(0, rgba(th.skyTop)); grd.addColorStop(1, rgba(th.skyBottom));
    g.fillStyle = grd; g.fillRect(0, 0, VW, VH);

    if (th.weather === 2) {
      for (let i = 0; i < 70; i++) {
        let sx = (i * 137.5 - camX * 0.05) % VW; if (sx < 0) sx += VW;
        const sy = (i * 71.3) % 380, tw = 0.5 + 0.5 * Math.sin(time * 2 + i);
        circle(sx, sy, 1.2 + tw, `rgba(255,255,255,${0.4 + tw * 0.6})`);
      }
      for (let band = 0; band < 3; band++) {
        const col = band === 1 ? '160,90,255' : '80,255,170';
        for (let x = 0; x < VW; x += 8) {
          const y = 120 + band * 50 + Math.sin((x + camX * 0.1) * 0.006 + time * 0.6 + band) * 40;
          const h = 60 + Math.sin(x * 0.02 + time + band * 2) * 30;
          const lg = g.createLinearGradient(0, y, 0, y + h);
          lg.addColorStop(0, `rgba(${col},0.22)`); lg.addColorStop(1, `rgba(${col},0)`);
          g.fillStyle = lg; g.fillRect(x, y, 8, h);
        }
      }
    } else if (th.weather === 0) {
      circle(1040, 110, 60, 'rgba(255,250,220,0.47)');
      circle(1040, 110, 44, 'rgb(255,250,230)');
      for (let i = 0; i < 6; i++) {
        const cx = ((i * 330 - camX * 0.12 + time * 8) % (VW + 300) + VW + 300) % (VW + 300) - 150;
        this.cloud(cx, 70 + (i * 53) % 150, 1 + (i % 3) * 0.3);
      }
    } else {
      const glow = th.weather === 1 ? '150,120,255' : '255,120,40';
      for (let i = 0; i < 5; i++) {
        const gx = ((i * 400 - camX * 0.15) % 1600 + 1600) % 1600 - 160, gy = 360 + (i % 2) * 120;
        const rg = g.createRadialGradient(gx, gy, 0, gx, gy, 220);
        rg.addColorStop(0, `rgba(${glow},0.15)`); rg.addColorStop(1, `rgba(${glow},0)`);
        g.fillStyle = rg; g.fillRect(gx - 220, gy - 220, 440, 440);
      }
    }
    this.mountains(camX * 0.2, 470, 180, 260, th.far, th.weather === 0 || th.weather === 2);
    this.hills(camX * 0.45, 560, th.near, th.weather);
  },

  cloud(x, y, s) {
    const c = 'rgba(255,255,255,0.86)';
    g.beginPath();
    g.ellipse(x, y, 26 * s, 26 * s, 0, 0, 7); g.ellipse(x + 30 * s, y - 12 * s, 32 * s, 32 * s, 0, 0, 7);
    g.ellipse(x + 64 * s, y, 24 * s, 24 * s, 0, 0, 7);
    g.fillStyle = c; g.fill();
    rrect(x - 20 * s, y, 104 * s, 24 * s, 12 * s, c);
  },

  mountains(offset, baseY, spacing, height, c, caps) {
    const start = -(offset % spacing) - spacing;
    let idx = Math.floor(offset / spacing);
    for (let x = start; x < VW + spacing; x += spacing, idx++) {
      const hh = height * (0.6 + 0.4 * hash(idx));
      const top = [x + spacing * 0.5, baseY - hh], l = [x - spacing * 0.3, baseY + 40], r = [x + spacing * 1.3, baseY + 40];
      tri(top, l, r, rgba(c));
      if (caps) tri(top, [top[0] + (l[0] - top[0]) * 0.25, top[1] + (l[1] - top[1]) * 0.25], [top[0] + (r[0] - top[0]) * 0.25, top[1] + (r[1] - top[1]) * 0.25], 'rgba(245,250,255,0.9)');
    }
    rect(0, baseY + 39, VW, VH - baseY, rgba(c));
  },

  hills(offset, baseY, c, weather) {
    g.beginPath(); g.moveTo(0, VH);
    for (let x = 0; x <= VW; x += 8) {
      const wx = x + offset;
      g.lineTo(x, baseY + Math.sin(wx * 0.004) * 40 + Math.sin(wx * 0.011) * 18);
    }
    g.lineTo(VW, VH); g.closePath(); g.fillStyle = rgba(c); g.fill();
    if (weather === 0 || weather === 2) {
      for (let i = -1; i < 12; i++) {
        const tx = i * 140 - (offset % 140), id = Math.floor(offset / 140) + i;
        if (hash(id) < 0.4) continue;
        const wx = tx + offset;
        const ty = baseY + Math.sin(wx * 0.004) * 40 + Math.sin(wx * 0.011) * 18;
        this.pine(tx, ty + 10, 0.8 + hash(id * 3) * 0.5, mix(c, BLACK, 0.25));
      }
    }
  },

  pine(x, y, s, c) {
    rect(x - 4 * s, y - 14 * s, 8 * s, 16 * s, rgba(mix(c, BLACK, 0.3)));
    for (let i = 0; i < 3; i++) {
      const yy = y - 12 * s - i * 20 * s, ww = (34 - i * 8) * s;
      tri([x, yy - 34 * s], [x - ww, yy], [x + ww, yy], rgba(c));
      tri([x, yy - 34 * s], [x - ww * 0.5, yy - 17 * s], [x + ww * 0.5, yy - 17 * s], 'rgba(240,248,255,0.8)');
    }
  },

  ground(tx, ty, th, cap, edgeL, edgeR) {
    const x = tx * T, y = ty * T;
    rect(x, y, T, T, rgba(th.fill));
    const h = hash(tx * 31 + ty * 17);
    circle(x + 10 + Math.floor(h * 26), y + 20 + Math.floor(h * 17) % 20, 4, rgba(th.dark));
    circle(x + 34 - Math.floor(h * 18), y + 36, 3, rgba(th.dark));
    if (edgeL) rect(x, y, 4, T, rgba(th.dark));
    if (edgeR) rect(x + T - 4, y, 4, T, rgba(th.dark));
    if (cap) {
      rect(x, y, T, 12, rgba(th.cap));
      for (let i = 0; i < 3; i++) circle(x + 8 + i * 16, y + 12, 7 + Math.floor(hash(tx * 7 + i) * 3), rgba(th.cap));
      rect(x, y, T, 3, rgba(mix(th.cap, WHITE, 0.6)));
    }
  },

  brick(x, y, th) {
    const c = th.brick, ln = rgba(mix(c, BLACK, 0.3));
    rect(x, y, T, T, rgba(mix(c, BLACK, 0.35)));
    rect(x + 2, y + 2, T - 4, T - 4, rgba(c));
    rect(x, y + 23, T, 3, ln); rect(x + 22, y, 3, 24, ln); rect(x + 10, y + 24, 3, 24, ln); rect(x + 34, y + 24, 3, 24, ln);
    rect(x + 5, y + 5, 12, 4, 'rgba(255,255,255,0.55)');
  },

  prize(x, y, time, used) {
    if (used) { rrect(x, y, T, T, 7, 'rgb(90,80,100)'); rrect(x + 3, y + 3, T - 6, T - 6, 6, 'rgb(130,118,140)'); return; }
    const gl = 0.5 + 0.5 * Math.sin(time * 4 + x * 0.01);
    rrect(x, y, T, T, 7, 'rgb(200,110,20)');
    rrect(x + 3, y + 3, T - 6, T - 6, 6, rgba(mix([255, 190, 40], [255, 225, 110], gl)));
    star(x + T / 2, y + T / 2 + 1, 15, 6.5, 'rgba(255,255,255,0.94)', time * 0.8);
    for (const [dx, dy] of [[7, 7], [T - 7, 7], [7, T - 7], [T - 7, T - 7]]) circle(x + dx, y + dy, 2.5, 'rgb(160,80,10)');
  },

  crumble(x, y, shake, th) {
    const ox = shake > 0 ? Math.sin(shake * 80) * 2 : 0;
    const c = mix(th.brick, WHITE, 0.3);
    rrect(x + ox, y, T, T * 0.6, 8, rgba(mix(c, BLACK, 0.25)));
    rrect(x + ox + 2, y + 2, T - 4, T * 0.6 - 6, 7, rgba(c));
    const cr = rgba(mix(c, BLACK, 0.4));
    line([x + ox + 12, y + 3], [x + ox + 20, y + 16], 2, cr); line([x + ox + 20, y + 16], [x + ox + 30, y + 10], 2, cr);
    line([x + ox + 34, y + 20], [x + ox + 40, y + 26], 2, cr);
  },

  oneWay(x, y, th, l, r) {
    const wood = [150, 100, 60];
    rrect(x, y, T, 16, 6, rgba(mix(wood, BLACK, 0.3)));
    rrect(x + 1, y + 1, T - 2, 11, 5, rgba(wood));
    rect(x, y, T, 4, rgba(th.cap));
    if (l) rect(x + 6, y + 14, 6, 10, rgba(mix(wood, BLACK, 0.3)));
    if (r) rect(x + T - 12, y + 14, 6, 10, rgba(mix(wood, BLACK, 0.3)));
  },

  platform(x, y, wt, th) {
    const w = wt * T;
    rrect(x, y + 3, w, 20, 10, 'rgba(0,0,0,0.27)');
    rrect(x, y, w, 20, 10, 'rgb(70,90,130)');
    rrect(x + 2, y + 2, w - 4, 12, 6, 'rgb(130,160,210)');
    rect(x + 6, y, w - 12, 4, rgba(th.cap));
    for (let i = 0; i < wt; i++) circle(x + i * T + T / 2, y + 12, 3, 'rgb(60,70,100)');
  },

  spikes(x, y, th) {
    const c = th.weather === 3 ? [60, 50, 50] : [200, 225, 245];
    for (let i = 0; i < 3; i++) {
      const sx = x + i * 16;
      tri([sx + 8, y + 14], [sx, y + T], [sx + 16, y + T], rgba(mix(c, BLACK, 0.35)));
      tri([sx + 8, y + 16], [sx + 3, y + T], [sx + 11, y + T], rgba(c));
    }
  },

  liquid(x, y, top, th, time) {
    if (!top) { rect(x, y, T, T, rgba(th.liquid)); return; }
    rect(x, y + 12, T, T - 12, rgba(th.liquid));
    g.beginPath(); g.moveTo(x, y + 16);
    for (let i = 0; i <= T; i += 4) g.lineTo(x + i, y + 10 + Math.sin((x + i) * 0.08 + time * 3) * 3);
    g.lineTo(x + T, y + 16); g.closePath(); g.fillStyle = rgba(th.liquidTop); g.fill();
  },

  coin(cx, cy, time, scale = 1) {
    const w = Math.abs(Math.cos(time * 4 + cx * 0.02));
    const rx = Math.max(3, 13 * w) * scale, ry = 16 * scale;
    ellipse(cx, cy, rx + 2, ry + 2, 'rgb(170,110,10)');
    ellipse(cx, cy, rx, ry, 'rgb(255,205,50)');
    ellipse(cx, cy, rx * 0.55, ry * 0.6, 'rgb(255,235,140)');
    if (w > 0.5) rect(cx - rx * 0.15, cy - ry * 0.35, Math.max(2, rx * 0.3), ry * 0.7, 'rgb(220,150,20)');
  },

  spring(x, y, compress) {
    const top = y + 14 + compress * 16;
    for (let i = 0; i < 3; i++) rrect(x + 10, top + 8 + i * (T - 8 - (top - y)) / 3, T - 20, 6, 3, 'rgb(220,60,60)');
    rrect(x + 4, top, T - 8, 10, 5, 'rgb(240,240,250)');
    rrect(x + 6, y + T - 8, T - 12, 8, 4, 'rgb(90,90,110)');
  },

  checkpoint(x, y, active, time) {
    rect(x + 20, y - 48, 6, 96, 'rgb(200,200,210)');
    circle(x + 23, y - 50, 6, 'rgb(255,210,60)');
    const fy = active ? y - 44 : y + 10, w = Math.sin(time * 6) * 4;
    tri([x + 26, fy], [x + 26, fy + 26], [x + 60, fy + 13 + w], active ? 'rgb(60,220,120)' : 'rgb(200,70,70)');
    rect(x + 10, y + 40, 26, 8, 'rgb(120,120,140)');
  },

  igloo(x, y, time) {
    const cx = x + T / 2, by = y + T;
    g.beginPath(); g.arc(cx, by, 82, Math.PI, 0); g.fillStyle = 'rgb(170,200,230)'; g.fill();
    g.beginPath(); g.arc(cx, by, 78, Math.PI, 0); g.fillStyle = 'rgb(240,248,255)'; g.fill();
    for (let i = 1; i < 4; i++) {
      const yy = by - i * 19, half = Math.sqrt(Math.max(0, 78 * 78 - (by - yy) ** 2));
      line([cx - half, yy], [cx + half, yy], 2, 'rgb(170,200,230)');
    }
    for (let i = -2; i <= 2; i++) line([cx + i * 28, by - 19], [cx + i * 28 + 8, by - 38], 2, 'rgb(170,200,230)');
    rect(cx - 22, by - 36, 44, 36, 'rgb(30,40,70)');
    g.beginPath(); g.arc(cx, by - 36, 22, Math.PI, 0); g.fillStyle = 'rgb(30,40,70)'; g.fill();
    g.beginPath(); g.arc(cx, by - 36, 14, Math.PI, 0); g.fillStyle = 'rgba(255,200,90,0.35)'; g.fill();
    rect(cx - 2, by - 130, 4, 56, 'rgb(200,200,210)');
    tri([cx + 2, by - 130], [cx + 2, by - 106], [cx + 34, by - 118 + Math.sin(time * 5) * 4], 'rgb(255,196,64)');
  },

  sign(x, y) {
    rect(x + 21, y + 20, 6, 28, 'rgb(120,80,50)');
    rrect(x + 4, y + 2, 40, 28, 6, 'rgb(120,80,50)');
    rrect(x + 7, y + 5, 34, 22, 5, 'rgb(200,150,95)');
    rect(x + 22, y + 8, 4, 10, 'rgb(90,50,30)'); rect(x + 22, y + 20, 4, 4, 'rgb(90,50,30)');
  },

  penguin(x, y, facing, anim, speed01, air, vy, power, wings, alpha = 1, dead = false, s = 1) {
    g.save(); g.globalAlpha = alpha;
    const body = power === 2 ? 'rgb(30,60,110)' : 'rgb(30,36,58)', belly = 'rgb(250,250,255)', orange = 'rgb(255,150,30)';
    const bob = air ? 0 : Math.abs(Math.sin(anim * 14)) * 3 * speed01;
    const lean = air ? 0 : facing * speed01 * 3;
    const cx = x + lean, cy = y - 25 * s - bob;
    const step = air ? 0 : Math.sin(anim * 14) * 6 * speed01;
    const fy = dead ? cy + 22 * s : y - 3;
    ellipse(x - 8 * s + step, fy, 9 * s, 4 * s, orange);
    ellipse(x + 8 * s - step, fy, 9 * s, 4 * s, orange);
    if (wings) {
      const flap = Math.sin(anim * (air ? 26 : 6)) * (air ? 0.6 : 0.2);
      for (const side of [-1, 1]) {
        const rx = cx - facing * 6 * s + side * 6 * s, ry = cy - 6 * s;
        tri([rx, ry], [rx + side * 22 * s, ry - 14 * s - flap * 16 * s], [rx + side * 18 * s, ry + 2 * s - flap * 8 * s], 'rgba(255,255,255,0.92)');
      }
    }
    ellipse(cx, cy, 19 * s, 24 * s, body);
    ellipse(cx + facing * 4 * s, cy + 4 * s, 13 * s, 18 * s, belly);
    const flip = air ? (vy < 0 ? -0.9 : 0.6) : Math.sin(anim * 14) * 0.5 * speed01;
    const sh = [cx - facing * 12 * s, cy - 2 * s], tip = [sh[0] - facing * (8 + flip * 6) * s, sh[1] + (14 - flip * 12) * s];
    line(sh, tip, 8 * s, body);
    const ex = cx + facing * 7 * s, ey = cy - 11 * s;
    if (dead) {
      line([ex - 4, ey - 4], [ex + 4, ey + 4], 2.5, belly); line([ex - 4, ey + 4], [ex + 4, ey - 4], 2.5, belly);
    } else {
      circle(ex, ey, 6 * s, belly); circle(ex + facing * 2 * s, ey, 3.2 * s, 'rgb(20,20,30)'); circle(ex + facing * 3 * s, ey - 1.5 * s, 1.2 * s, belly);
      const e2 = cx - facing * 3 * s;
      circle(e2, ey, 4.5 * s, belly); circle(e2 + facing * 1.5 * s, ey, 2.5 * s, 'rgb(20,20,30)');
    }
    const bx = cx + facing * 14 * s, by = cy - 5 * s;
    tri([bx - facing * 4 * s, by - 4 * s], [bx - facing * 4 * s, by + 4 * s], [bx + facing * 8 * s, by + s], orange);
    circle(cx + facing * 12 * s, cy - 2 * s, 3 * s, 'rgba(255,140,160,0.63)');
    if (power >= 1) {
      const sc = power === 2 ? 'rgb(120,220,255)' : 'rgb(230,50,60)';
      rrect(cx - 16 * s, cy + s, 32 * s, 7 * s, 3.5 * s, sc);
      const sp = [cx - facing * 12 * s, cy + 5 * s];
      line(sp, [sp[0] - facing * 14 * s, sp[1] + 8 * s + Math.sin(anim * 10) * 3], 6 * s, sc);
      if (power === 2) star(cx, cy - 26 * s, 5 * s, 2.5 * s, '#fff', anim * 3);
    }
    g.restore();
  },

  walker(bx, by, facing, t, squashed) {
    const col = [170, 120, 230], dark = rgba(mix(col, BLACK, 0.4));
    if (squashed) { ellipse(bx, by - 6, 22, 7, rgba(col)); return; }
    const bob = Math.abs(Math.sin(t * 10)) * 3, cx = bx, cy = by - 17 - bob, st = Math.sin(t * 10) * 5;
    ellipse(bx - 9 + st, by - 3, 8, 4, dark); ellipse(bx + 9 - st, by - 3, 8, 4, dark);
    ellipse(cx, cy, 22, 17, rgba(col)); ellipse(cx, cy + 6, 15, 8, rgba(mix(col, WHITE, 0.35)));
    const ex = cx + facing * 7, ey = cy - 5;
    circle(ex - 5, ey, 5, '#fff'); circle(ex + 5, ey, 5, '#fff');
    circle(ex - 5 + facing * 2, ey + 1, 2.5, '#000'); circle(ex + 5 + facing * 2, ey + 1, 2.5, '#000');
    line([ex - 10, ey - 7], [ex - 2, ey - 4], 3, dark); line([ex + 10, ey - 7], [ex + 2, ey - 4], 3, dark);
  },

  spiky(bx, by, facing, t) {
    const cx = bx, cy = by - 18 - Math.abs(Math.sin(t * 8)) * 2;
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + i / 8 * Math.PI, dx = Math.cos(a), dy = Math.sin(a), px = -dy * 7, py = dx * 7;
      tri([cx + dx * 30, cy + dy * 30], [cx + dx * 16 - px, cy + dy * 16 - py], [cx + dx * 16 + px, cy + dy * 16 + py], 'rgb(180,230,255)');
    }
    ellipse(cx, cy, 21, 17, 'rgb(60,90,140)');
    ellipse(cx + facing * 10, cy + 4, 10, 9, 'rgb(230,200,170)');
    circle(cx + facing * 12, cy - 3, 3, '#000'); circle(cx + facing * 20, cy + 4, 3, 'rgb(40,20,20)');
    const st = Math.sin(t * 8) * 4;
    ellipse(bx - 8 + st, by - 3, 6, 3, 'rgb(40,50,80)'); ellipse(bx + 8 - st, by - 3, 6, 3, 'rgb(40,50,80)');
  },

  bird(cx, cy, facing, t) {
    const flap = Math.sin(t * 14);
    tri([cx - 4, cy - 2], [cx - 26, cy - 4 - flap * 18], [cx + 4, cy - 2], 'rgb(150,160,180)');
    ellipse(cx, cy, 20, 12, 'rgb(245,245,250)');
    circle(cx + facing * 14, cy - 6, 9, 'rgb(245,245,250)');
    circle(cx + facing * 17, cy - 8, 2.5, '#000');
    const bkx = cx + facing * 22, bky = cy - 5;
    tri([bkx, bky], [bkx + facing * 10, bky + 3], [bkx, bky + 5], 'rgb(255,190,40)');
    tri([cx + 8, cy - 2], [cx + 30, cy - 14 + flap * 16], [cx - 8, cy - 2], 'rgb(245,245,250)');
  },

  hopper(bx, by, facing, t, air) {
    const col = 'rgb(90,200,120)', dark = 'rgb(58,130,78)', cx = bx, cy = by - (air ? 22 : 16);
    if (air) { line([cx - 10, cy + 8], [cx - 16, cy + 22], 5, dark); line([cx + 10, cy + 8], [cx + 16, cy + 22], 5, dark); }
    else { ellipse(bx - 14, by - 5, 9, 5, dark); ellipse(bx + 14, by - 5, 9, 5, dark); }
    ellipse(cx, cy, 20, 15, col); ellipse(cx, cy + 5, 13, 8, 'rgb(220,250,200)');
    circle(cx - 8, cy - 12, 7, col); circle(cx + 8, cy - 12, 7, col);
    circle(cx - 8 + facing * 2, cy - 13, 4, '#fff'); circle(cx + 8 + facing * 2, cy - 13, 4, '#fff');
    circle(cx - 7 + facing * 3, cy - 13, 2, '#000'); circle(cx + 9 + facing * 3, cy - 13, 2, '#000');
  },

  icicle(x, y, shake) {
    const ox = shake > 0 ? Math.sin(shake * 90) * 2 : 0;
    tri([x + 8 + ox, y], [x + 24 + ox, y + 44], [x + 40 + ox, y], 'rgb(150,210,255)');
    tri([x + 16 + ox, y], [x + 24 + ox, y + 30], [x + 26 + ox, y], 'rgb(235,250,255)');
  },

  fish(cx, cy, t) {
    ellipse(cx, cy, 16, 10, 'rgb(255,120,90)');
    const w = Math.sin(t * 12) * 3;
    tri([cx - 12, cy], [cx - 24, cy - 9 + w], [cx - 24, cy + 9 + w], 'rgb(255,120,90)');
    circle(cx + 8, cy - 2, 2.5, '#000'); ellipse(cx - 2, cy + 3, 8, 3, 'rgb(255,200,170)');
  },

  snowflake(cx, cy, t) {
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, 24);
    rg.addColorStop(0, 'rgba(160,220,255,0.47)'); rg.addColorStop(1, 'rgba(160,220,255,0)');
    g.fillStyle = rg; g.fillRect(cx - 24, cy - 24, 48, 48);
    for (let i = 0; i < 6; i++) {
      const a = t * 1.5 + i * Math.PI / 3, dx = Math.cos(a), dy = Math.sin(a);
      line([cx, cy], [cx + dx * 16, cy + dy * 16], 4, 'rgb(200,240,255)');
      const mx = cx + dx * 10, my = cy + dy * 10;
      line([mx, my], [mx + (dx - dy) * 5, my + (dy + dx) * 5], 3, 'rgb(200,240,255)');
      line([mx, my], [mx + (dx + dy) * 5, my + (dy - dx) * 5], 3, 'rgb(200,240,255)');
    }
    circle(cx, cy, 4, '#fff');
  },

  wingItem(cx, cy, t) {
    const f = Math.sin(t * 10) * 6;
    tri([cx, cy], [cx - 22, cy - 10 - f], [cx - 16, cy + 10], '#fff');
    tri([cx, cy], [cx + 16, cy + 10], [cx + 22, cy - 10 - f], '#fff');
    circle(cx, cy, 6, 'rgb(255,210,80)');
  },

  heart(cx, cy, s = 1, col = 'rgb(255,70,110)') {
    circle(cx - 7 * s, cy - 4 * s, 9 * s, col); circle(cx + 7 * s, cy - 4 * s, 9 * s, col);
    tri([cx - 15.5 * s, cy - s], [cx, cy + 16 * s], [cx + 15.5 * s, cy - s], col);
    circle(cx - 9 * s, cy - 7 * s, 3 * s, 'rgba(255,255,255,0.67)');
  },

  penguinHead(cx, cy, s = 1) {
    circle(cx, cy, 14 * s, 'rgb(30,36,58)');
    ellipse(cx + 2, cy + 4 * s, 9 * s, 9 * s, '#fff');
    circle(cx + 4 * s, cy - 3 * s, 4 * s, '#fff'); circle(cx + 5 * s, cy - 3 * s, 2 * s, '#000');
    tri([cx + 8 * s, cy], [cx + 8 * s, cy + 5 * s], [cx + 17 * s, cy + 2 * s], 'rgb(255,150,30)');
  },
};
