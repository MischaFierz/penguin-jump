// Assembles the complete website for upload to the PHP webspace:
//   dist/website/            <- upload this folder (point the domain to dist/website/public if possible)
//     public/                   web root: index.php, assets, /play (web game), version.json(.sig)
//     src, templates, migrations, config/config.example.php, data (levels, translations, game.json)
// Usage: node tools/build-server.mjs [outDir] [version]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist/website'));
const version = process.argv[3] || process.env.GAME_VERSION || '0.0.0-dev';

const copy = (from, to, filter = () => true) => fs.cpSync(from, to, { recursive: true, filter: src => filter(src) });
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// server code (never the real config or local test data)
copy(path.join(root, 'server'), out, src => {
  const rel = path.relative(path.join(root, 'server'), src).replace(/\\/g, '/');
  return !(rel === 'config/config.php' || rel.startsWith('tests') || rel.startsWith('data/') && rel !== 'data/.htaccess' || rel.endsWith('.sqlite'));
});

// game data used by the server: levels (replay check), translations (world names), name
copy(path.join(root, 'shared/levels'), path.join(out, 'data/levels'));
fs.mkdirSync(path.join(out, 'data/lang'), { recursive: true });
for (const l of ['en', 'fr', 'de']) fs.copyFileSync(path.join(root, `shared/lang/${l}.json`), path.join(out, `data/lang/${l}.json`));
fs.copyFileSync(path.join(root, 'game.json'), path.join(out, 'data/game.json'));

// the web game under /play (same origin -> it talks to the API without CORS)
execFileSync(process.execPath, [path.join(root, 'tools/build-web.mjs'), version], { stdio: 'inherit' });
copy(path.join(root, 'web'), path.join(out, 'public/play'));
fs.copyFileSync(path.join(root, 'web/icon.svg'), path.join(out, 'public/assets/icon.svg'));

console.log(`website built in ${path.relative(root, out) || out} (version ${version})`);
