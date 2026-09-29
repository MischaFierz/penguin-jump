// Generates pseudo-random but reproducible tick inputs for the determinism test
// (a "bot" that mostly runs right, jumps a lot, sometimes turns around and throws).
// Usage: node tests/gen-inputs.mjs <seed> <ticks>  -> one input byte per line on stdout
const seed = Number(process.argv[2] || 1), ticks = Number(process.argv[3] || 6000);
let s = seed >>> 0 || 1;
const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
let dir = 2, run = 4, held = 0, hold = 0, out = [];
for (let t = 0; t < ticks; t++) {
  if (rnd() < 0.01) dir = rnd() < 0.8 ? 2 : rnd() < 0.5 ? 1 : 0;
  if (rnd() < 0.02) run = run ? 0 : 4;
  let pressed = 0;
  if (hold > 0) hold--; else if (rnd() < 0.03) { hold = 10 + Math.floor(rnd() * 50); pressed = 16; }
  held = hold > 0 ? 8 : 0;
  const action = rnd() < 0.01 ? 32 : 0;
  out.push(dir | run | held | pressed | action);
}
process.stdout.write(out.join('\n') + '\n');
