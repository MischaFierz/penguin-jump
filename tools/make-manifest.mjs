// Creates the signed update manifest for a release:
//   <out>/version.json      {version, date, downloads: {win-x64, linux-x64, android: {url, sha256, ...}}}
//   <out>/version.json.sig  ECDSA P-256 / SHA-256 signature (raw r||s, base64) over the exact bytes
// The private key comes from the environment (GitHub secret UPDATE_SIGNING_KEY, PEM).
// Usage: node tools/make-manifest.mjs <outDir> <version> <releaseBaseUrl> <file>...
//   files are matched by name: *-win-x64.zip, *-linux-x64.zip, *.apk
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [outDir, version, releaseUrl, ...files] = process.argv.slice(2);
const pem = process.env.UPDATE_SIGNING_KEY;
if (!outDir || !version || !releaseUrl || !pem) {
  console.error('usage: UPDATE_SIGNING_KEY=<pem> node tools/make-manifest.mjs <outDir> <version> <releaseBaseUrl> <files...>');
  process.exit(2);
}
const key = crypto.createPrivateKey(pem);
const game = JSON.parse(fs.readFileSync(new URL('../game.json', import.meta.url), 'utf8'));
const downloads = {};
for (const f of files) {
  const name = path.basename(f);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const url = `${releaseUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
  const m = /-(win-x64|linux-x64|osx-x64|osx-arm64)\.zip$/.exec(name);
  if (m) downloads[m[1]] = { url, sha256, size: fs.statSync(f).size, exe: m[1].startsWith('win') ? `${slug(game.name)}.exe` : slug(game.name) };
  else if (name.endsWith('.apk')) downloads.android = { url, sha256, size: fs.statSync(f).size };
}
const manifest = Buffer.from(JSON.stringify({ name: game.name, version, date: new Date().toISOString(), downloads }, null, 2) + '\n');
const sig = crypto.sign('sha256', manifest, { key, dsaEncoding: 'ieee-p1363' }).toString('base64');

// self-check against the public key that is compiled into the games
const pub = crypto.createPublicKey({ key: Buffer.from(game.updateKey, 'base64'), format: 'der', type: 'spki' });
if (!crypto.verify('sha256', manifest, { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64'))) {
  console.error('signature does not match game.json updateKey - wrong UPDATE_SIGNING_KEY?');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'version.json'), manifest);
fs.writeFileSync(path.join(outDir, 'version.json.sig'), sig + '\n');
console.log(`signed manifest for ${version}: ${Object.keys(downloads).join(', ')}`);

function slug(s) { return s.replace(/[^A-Za-z0-9]/g, ''); }
