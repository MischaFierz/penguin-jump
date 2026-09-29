// Runs the web version's simulation headless (no canvas, no sound) for the determinism test.
// Usage: node tests/js-sim.mjs <level.txt> <inputs.txt>   -> same output format as "PenguinJump --simtest"
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [levelFile, inputFile] = process.argv.slice(2);
const noop = () => {};
const ctx = vm.createContext({
  T: 48, VW: 1280, VH: 720, Audio: { play: noop, playMusic: noop }, Loc: { t: k => k },
  mix: () => [0, 0, 0, 255], WHITE: [255, 255, 255], console, btoa, atob, Float64Array, BigUint64Array,
});
for (const f of ['web/js/stage.js', 'web/js/replay.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8').replace(/^const StageView = \{[\s\S]*$/m, ''), ctx, { filename: f });
ctx.levelText = fs.readFileSync(levelFile, 'utf8');
ctx.levelName = path.basename(levelFile);
ctx.ticks = fs.readFileSync(inputFile, 'utf8').split('\n').filter(l => l.trim() !== '').map(Number);
const out = [];
ctx.emit = l => out.push(l);
vm.runInContext(`
  const lvl = parseLevel(levelName, levelText);
  const r = Replay.run(lvl, ticks, s => emit(s.stateHash()));
  emit('RESULT ' + (r.completed ? 1 : 0) + ' ' + r.ticks + ' ' + r.timeTicks + ' ' + (r.score + (r.completed ? Replay.timeBonus(r.timeTicks) : 0)) + ' ' + r.coins);
  emit('ENCODED ' + Replay.encode(ticks));
`, ctx);
process.stdout.write(out.join('\n') + '\n');
