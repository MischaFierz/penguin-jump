'use strict';
// Replay of a run: one input byte per tick, run-length encoded (value byte + LEB128 count), base64url.
// Identical to Game/Replay.cs and server/src/Replay/ReplayCodec.php.

const Replay = {
  encode(ticks) {
    const bytes = [];
    for (let i = 0; i < ticks.length;) {
      const v = ticks[i];
      let n = 1;
      while (i + n < ticks.length && ticks[i + n] === v) n++;
      bytes.push(v);
      let c = n;
      while (c >= 0x80) { bytes.push((c & 0x7f) | 0x80); c >>>= 7; }
      bytes.push(c);
      i += n;
    }
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  },

  decode(s, maxTicks = 20 * 60 * 120) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const out = [];
    let i = 0;
    while (i < bin.length) {
      const v = bin.charCodeAt(i++);
      if (v > 63) throw new Error('bad input byte');
      let c = 0, shift = 0;
      for (;;) {
        if (i >= bin.length || shift > 28) throw new Error('bad count');
        const b = bin.charCodeAt(i++);
        c += (b & 0x7f) * 2 ** shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      if (c === 0 || out.length + c > maxTicks) throw new Error('bad length');
      for (let k = 0; k < c; k++) out.push(v);
    }
    return out;
  },

  /** Plays the ticks like PlayScene does (respawn at the last checkpoint after dying). */
  run(level, ticks, afterTick) {
    let stage = new Stage(level, null), died = false;
    const hook = s => { s.headless = true; s.onDied = () => { died = true; }; };
    hook(stage);
    let n = 0;
    for (const bits of ticks) {
      stage.update(P.step, TickInput.fromBits(bits));
      n++;
      if (afterTick) afterTick(stage);
      if (stage.completed) return { completed: true, ticks: n, timeTicks: stage.timeTicks, score: stage.finalScore, coins: stage.coins };
      if (died) { died = false; stage = new Stage(level, stage.lastCheckpoint); hook(stage); }
    }
    return { completed: false, ticks: n, timeTicks: stage.timeTicks, score: stage.finalScore, coins: stage.coins };
  },

  timeBonus: timeTicks => Math.max(0, 300 - Math.floor(timeTicks / 120)) * 10,
};
if (typeof module !== 'undefined') module.exports = { Replay };
