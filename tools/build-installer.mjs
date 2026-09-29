// Builds the game as one .exe (with .NET inside) and packs it into a Windows installer (.msi).
// Result: dist\<Name>-Setup.msi  (and dist\<Name>-win-x64.zip for the in-game updater)
// Needs (once): dotnet tool install --global wix
// Usage: node tools/build-installer.mjs [version]     e.g. 1.0.50 (default: <game.json version>.0)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const game = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8'));
const slug = game.name.replace(/[^A-Za-z0-9]/g, '');
const version = process.argv[2] || process.env.GAME_VERSION || `${game.version}.0`;
if (!/^\d+\.\d+\.\d+$/.test(version)) { console.error('version must look like 1.0.42'); process.exit(2); }
const dist = path.join(root, 'dist');
const out = path.join(dist, 'installer-app');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// official builds sign save files with the key from the GitHub secret; use the same key locally if available
const keyFile = path.join(root, '..', 'Claude Game-keys', 'save-hmac-key.txt');
const saveKey = process.env.SAVE_HMAC_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : '');

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
console.log(`[1/3] publishing ${game.name} ${version} ...`);
run('dotnet', ['publish', 'Claude Game/Claude Game.csproj', '-c', 'Release', '-r', 'win-x64', '-p:PublishSingleFile=true',
  `-p:Version=${version}`, `-p:InformationalVersion=${version}`, `-p:AssemblyName=${slug}`, `-p:SaveKey=${saveKey}`, '-o', out, '-v', 'q', '-nologo']);
for (const f of fs.readdirSync(out)) if (f.endsWith('.pdb')) fs.rmSync(path.join(out, f));

console.log('[2/3] building the installer ...');
try { execFileSync('wix', ['--version'], { stdio: 'ignore' }); } catch {
  console.error('\nThe WiX tool is missing. Install it once with:\n    dotnet tool install --global wix\n');
  process.exit(1);
}
const msi = path.join(dist, `${slug}-Setup.msi`);
run('wix', ['build', path.join(root, 'installer/Game.wxs'), '-d', `Name=${game.name}`, '-d', `Version=${version}`,
  '-d', `ExeFile=${path.join(out, slug + '.exe')}`, '-d', `ExeName=${slug}.exe`, '-d', `IconFile=${path.join(root, 'Claude Game/app.ico')}`,
  '-pdbtype', 'none', '-o', msi]);

console.log('[3/3] zip for the in-game updater ...');
const zip = path.join(dist, `${slug}-win-x64.zip`);
fs.rmSync(zip, { force: true });
if (process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${path.join(out, '*').replace(/'/g, "''")}' -DestinationPath '${zip.replace(/'/g, "''")}'`], { stdio: 'inherit' });
} else run('zip', ['-j', '-q', zip, ...fs.readdirSync(out).map(f => path.join(out, f))]);

console.log(`\nDone:\n  ${msi}\n  ${zip}`);
