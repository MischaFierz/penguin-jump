// Renders web/icon.svg to the PNG sizes needed by the web app (PWA) and the Android launcher.
// Needs "rsvg-convert" (librsvg2-bin, installed in CI). Usage: node tools/render-icons.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = path.join(root, 'web/icon.svg');
const render = (size, out) => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', out, svg]);
};

render(192, path.join(root, 'web/icon-192.png'));
render(512, path.join(root, 'web/icon-512.png'));
for (const [dpi, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }))
  render(size, path.join(root, `android/app/src/main/res/mipmap-${dpi}/ic_launcher.png`));
console.log('icons rendered');
