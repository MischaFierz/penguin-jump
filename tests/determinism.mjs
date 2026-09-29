// Cross-language determinism test: the desktop game (C#), the web game (JS) and the server
// replay check (PHP) must compute bit-identical gameplay for the same inputs, otherwise honest
// highscores would be rejected. Runs every level with several pseudo-random input sequences.
// Usage: node tests/determinism.mjs <game-executable> <php-executable> [seeds=3] [ticks=12000]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [game, php, seeds = '3', ticks = '12000'] = process.argv.slice(2);
if (!game || !php) { console.error('usage: node tests/determinism.mjs <game-exe> <php-exe> [seeds] [ticks]'); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'det-'));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, maxBuffer: 1 << 30, encoding: 'utf8' });
const levels = JSON.parse(fs.readFileSync(path.join(root, 'shared/levels/index.json'), 'utf8'));
let failed = 0, completed = 0;
for (const lv of levels) {
  const level = path.join(root, 'shared/levels', lv);
  for (let seed = 1; seed <= Number(seeds); seed++) {
    const input = path.join(tmp, `in-${seed}.txt`);
    fs.writeFileSync(input, run(process.execPath, ['tests/gen-inputs.mjs', String(seed * 7919 + lv.length), ticks]));
    const outs = {
      cs: run(game, ['--simtest', level, input]),
      js: run(process.execPath, ['tests/js-sim.mjs', level, input]),
      php: run(php, ['server/tests/sim-cli.php', level, input]),
    };
    const result = outs.cs.split('\n').find(l => l.startsWith('RESULT'));
    const bad = Object.entries(outs).filter(([, o]) => o !== outs.cs).map(([k, o]) => {
      const a = outs.cs.split('\n'), b = o.split('\n');
      const line = a.findIndex((l, i) => l !== b[i]);
      return `${k} differs at tick ${line + 1}:\n    cs: ${a[line]?.slice(0, 160)}\n    ${k}: ${b[line]?.slice(0, 160)}`;
    });
    if (result.startsWith('RESULT 1')) completed++;
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${lv} seed ${seed}  ${result}`);
    for (const b of bad) console.log('  ' + b);
    failed += bad.length ? 1 : 0;
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} run(s) differ` : `\nall runs identical in C#, JS and PHP (${completed} reached the goal)`);
process.exit(failed ? 1 : 0);
