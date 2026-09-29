// End-to-end test of the PHP server with PHP's built-in web server and a temporary SQLite database.
// Covers setup, accounts, 2FA, the highscore replay verification and a number of attack attempts.
// Usage: node tests/server-test.mjs <php-executable>
// With TEST_DB_DSN / TEST_DB_USER / TEST_DB_PASS set (CI) it runs against MySQL/MariaDB instead of SQLite.
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const php = process.argv[2];
if (!php) { console.error('usage: node tests/server-test.mjs <php-executable>'); process.exit(2); }

let pass = 0, fail = 0;
const check = (ok, name, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !extra ? '' : '  -> ' + extra}`); };

// ------------------------------------------------------------------ setup: build site, config, server
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srvtest-'));
const site = path.join(tmp, 'website');
execFileSync(process.execPath, [path.join(root, 'tools/build-server.mjs'), site, '1.0.5'], { stdio: 'ignore' });
fs.writeFileSync(path.join(site, 'public/version.json'), JSON.stringify({ version: '1.0.5', downloads: { 'win-x64': { url: 'https://github.com/x/y/releases/download/v1.0.5/Game-win-x64.zip', sha256: 'ab'.repeat(32) } } }));
const dbFile = path.join(tmp, 'test.sqlite');
const setupToken = crypto.randomBytes(24).toString('hex');
const cfg = path.join(tmp, 'config.php');
const dsn = process.env.TEST_DB_DSN || 'sqlite:' + dbFile.replace(/\\/g, '/');
const phpStr = v => JSON.stringify(String(v)).replace(/\$/g, '\\$'); // JSON string = valid PHP double-quoted string (with $ escaped)
fs.writeFileSync(cfg, `<?php return ['db_dsn' => ${phpStr(dsn)}, 'db_user' => ${phpStr(process.env.TEST_DB_USER || '')}, 'db_password' => ${phpStr(process.env.TEST_DB_PASS || '')}, 'app_secret' =>'${crypto.randomBytes(48).toString('hex')}',
  'setup_token' => '${setupToken}', 'force_https' => false, 'api_cors_origins' => ['https://appassets.androidplatform.net']];`);
const port = 18000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', path.join(site, 'public'), path.join(site, 'public/index.php')],
  { env: { ...process.env, APP_CONFIG: cfg }, stdio: 'ignore', windowsHide: true });
const cleanup = () => { try { server.kill(); } catch { /* ignore */ } };
process.on('exit', cleanup);
for (let i = 0; i < 50; i++) { try { await fetch(base + '/privacy'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

// ------------------------------------------------------------------ http helpers (cookie jar per "browser")
class Browser {
  cookies = new Map();
  async req(method, p, { form, json, headers = {} } = {}) {
    const h = { ...headers, Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) { body = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (json) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
    const r = await fetch(base + p, { method, headers: h, body, redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies.set(kv.slice(0, i), kv.slice(i + 1)); }
    const text = await r.text();
    return { status: r.status, headers: r.headers, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  }
  get(p, o) { return this.req('GET', p, o); }
  async post(p, form, from = p) {
    const page = await this.get(from);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1] ?? '';
    return this.req('POST', p, { form: { _csrf: csrf, ...form } });
  }
}
const api = (method, p, json, token, headers = {}) => new Browser().req(method, '/api/v1' + p, { json, headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

// ------------------------------------------------------------------ a real completed run of level 1-1 (from the JS game code)
const ctx = vm.createContext({ T: 48, VW: 1280, VH: 720, Audio: { play() {}, playMusic() {} }, Loc: { t: k => k }, mix: () => [0, 0, 0], WHITE: [255, 255, 255], btoa, atob, Float64Array, BigUint64Array });
for (const f of ['web/js/stage.js', 'web/js/replay.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8').replace(/^const StageView = \{[\s\S]*$/m, ''), ctx);
ctx.inputs = execFileSync(process.execPath, [path.join(root, 'tests/gen-inputs.mjs'), '1', '12000'], { encoding: 'utf8' }).trim().split('\n').map(Number);
ctx.levelText = fs.readFileSync(path.join(root, 'shared/levels/level1_1.txt'), 'utf8');
const run = vm.runInContext(`(() => { const r = Replay.run(parseLevel('level1_1.txt', levelText), inputs); const t = inputs.slice(0, r.ticks);
  return { ...r, final: r.score + Replay.timeBonus(r.timeTicks), replay: Replay.encode(t), shorter: Replay.encode(t.slice(0, -1)), longer: Replay.encode(t.concat([2, 2])) }; })()`, ctx);
check(run.completed, `test replay completes level 1-1 (${run.ticks} ticks, ${run.final} points)`);

// direct database access for the test, through PHP/PDO so it works for SQLite and MySQL alike
const sqlPhp = '$c = require getenv("APP_CONFIG"); $p = new PDO($c["db_dsn"], $c["db_user"] ?? "", $c["db_password"] ?? "");'
  + ' $s = $p->prepare(getenv("Q")); $s->execute(json_decode(getenv("P"), true)); echo json_encode($s->columnCount() ? $s->fetchAll(PDO::FETCH_ASSOC) : []);';
const sql = (query, params = []) => JSON.parse(execFileSync(php, ['-r', sqlPhp],
  { env: { ...process.env, APP_CONFIG: cfg, Q: query, P: JSON.stringify(params) }, encoding: 'utf8', windowsHide: true }) || '[]');
const backdate = (runId, seconds) => sql('UPDATE runs SET issued_at = issued_at - ? WHERE id = ?', [seconds, runId]);
const claimed = { timeTicks: run.timeTicks, score: run.final, coins: run.coins };

try {
  // ------------------------------------------------------------------ first-time setup
  const admin = new Browser();
  let r = await admin.get('/');
  check(r.status === 303 && r.headers.get('location') === '/setup', 'not installed -> redirect to /setup');
  r = await admin.post('/setup', { token: 'wrong', username: 'boss', password: 'Very-Secret-Admin-42', password2: 'Very-Secret-Admin-42' });
  check(r.status === 403, 'setup rejects a wrong token');
  r = await admin.req('POST', '/setup', { form: { token: setupToken, username: 'boss', password: 'Very-Secret-Admin-42', password2: 'Very-Secret-Admin-42' } });
  check(r.status === 400, 'setup rejects a POST without CSRF token');
  r = await admin.post('/setup', { token: setupToken, username: 'boss', password: 'Very-Secret-Admin-42', password2: 'Very-Secret-Admin-42' });
  check(r.status === 303 && r.headers.get('location') === '/login', 'setup creates tables + admin', r.status + ' ' + r.text.slice(0, 200));
  r = await new Browser().get('/setup');
  check(r.status === 303, 'setup locks itself afterwards');

  // ------------------------------------------------------------------ pages + security headers
  r = await new Browser().get('/');
  check(r.status === 200 && r.text.includes('Penguin Jump') && r.text.includes('Game-win-x64.zip'), 'home page with download from version.json');
  const csp = r.headers.get('content-security-policy') || '';
  check(csp.includes("script-src 'self'") && !csp.includes('unsafe') && csp.includes("frame-ancestors 'none'"), 'strict Content-Security-Policy');
  check(r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY' && !r.headers.get('x-powered-by'), 'security headers');
  check(!/<script/i.test(r.text) && !/ style=/i.test(r.text), 'no inline scripts or styles on pages');
  const de = await new Browser().get('/', { headers: { 'Accept-Language': 'de-CH,de;q=0.9' } });
  const fr = await new Browser().get('/leaderboard', { headers: { 'Accept-Language': 'fr' } });
  check(de.text.includes('Im Browser spielen') && fr.text.includes('Classement'), 'German + French pages');
  r = await new Browser().get('/play/');
  check(r.status === 200 && r.text.includes('js/stage.js'), 'web game served under /play/');
  r = await new Browser().get('/nope');
  check(r.status === 404, '404 page');

  // ------------------------------------------------------------------ accounts
  let reg = await api('POST', '/auth/register', { username: 'pingu', password: 'password' });
  check(reg.status === 400 && reg.json?.error === 'password_short', 'weak password rejected');
  reg = await api('POST', '/auth/register', { username: 'admin', password: 'Long-Enough-Pass-1' });
  check(reg.status === 400, 'reserved username rejected');
  reg = await api('POST', '/auth/register', { username: 'pingu', password: 'Slippery-Ice-2026' });
  check(reg.status === 200 && reg.json.token && /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(reg.json.recoveryCode), 'register via API returns token + recovery code');
  const token = reg.json.token;
  r = await api('POST', '/auth/register', { username: 'PINGU', password: 'Slippery-Ice-2026' });
  check(r.status === 400 && r.json.error === 'username_taken', 'usernames are unique (case-insensitive)');
  r = await api('GET', '/auth/me', null, token);
  check(r.json?.username === 'pingu', 'token login works');
  r = await api('GET', '/auth/me', null, 'x'.repeat(40));
  check(r.status === 401, 'invalid token rejected');
  r = await api('POST', '/auth/login', { username: 'pingu', password: 'wrong-password-123' });
  check(r.status === 401, 'wrong password rejected');
  r = await new Browser().req('POST', '/api/v1/auth/login', { form: { username: 'pingu', password: 'Slippery-Ice-2026' } });
  check(r.status === 415, 'API only accepts JSON (no form-based CSRF)');

  // ------------------------------------------------------------------ highscores
  const start = async () => (await api('POST', '/runs', { level: '1-1' })).json.run;
  let runId = await start();
  check(/^[a-f0-9]{32}$/.test(runId), 'run id issued');
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, nickname: 'Speedy', result: claimed });
  check(r.status === 422 && r.json.error === 'rejected', 'submission faster than real time is rejected');
  runId = await start(); backdate(runId, 600);
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, nickname: 'Speedy', result: claimed, client: 'test' });
  check(r.status === 200 && r.json.accepted && r.json.timeTicks === run.timeTicks && r.json.score === run.final && r.json.rankTime === 1,
    'honest run accepted with server-computed time/score', JSON.stringify(r.json));
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, nickname: 'Speedy', result: claimed });
  check(r.status === 422 && r.json.error === 'bad_run', 'run id can only be used once');
  runId = await start(); backdate(runId, 600);
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, nickname: 'Cheater', result: { ...claimed, timeTicks: 100, score: 999999 } });
  check(r.status === 422, 'fake time/score claim rejected');
  runId = await start(); backdate(runId, 600);
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.shorter, nickname: 'Cheater', result: claimed });
  check(r.status === 422, 'replay that does not reach the goal rejected');
  runId = await start(); backdate(runId, 600);
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.longer, nickname: 'Cheater', result: claimed });
  check(r.status === 422, 'replay with extra inputs after the goal rejected');
  runId = await start(); backdate(runId, 600);
  r = await api('POST', '/scores', { run: runId, level: '1-2', replay: run.replay, nickname: 'Cheater', result: claimed });
  check(r.status === 422 && r.json.error === 'bad_run', 'run id is bound to its level');
  runId = await start(); backdate(runId, 600);
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: '////', nickname: 'Cheater', result: claimed });
  check(r.status === 422 && r.json.error === 'bad_replay', 'garbage replay rejected');
  runId = await start(); backdate(runId, 600);
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, nickname: 'Sh1tHead', result: claimed });
  check(r.status === 400 && r.json.error === 'nick_bad', 'offensive nickname rejected');
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, nickname: 'pingu', result: claimed });
  check(r.status === 400 && r.json.error === 'nick_taken', 'nobody can post under a registered username');
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, nickname: '<script>x</script>', result: claimed });
  check(r.status === 400 && r.json.error === 'nick_format', 'HTML in nickname rejected');
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, result: claimed }, token);
  check(r.status === 200 && r.json.accepted, 'logged-in player run accepted');

  r = await api('GET', '/scores?level=1-1&by=time');
  const names = (r.json?.entries || []).map(e => e.name);
  check(names.length === 2 && names.includes('Speedy') && names.includes('pingu') && r.json.entries.find(e => e.name === 'pingu').registered, 'leaderboard lists both players');
  r = await new Browser().get('/leaderboard?level=1-1');
  check(r.text.includes('Speedy') && r.text.includes(fmt(run.timeTicks)), 'website leaderboard shows entries');
  r = await api('GET', '/scores?level=../../etc/passwd');
  check(r.status === 400, 'level id validated');

  // CORS: only the Android app origin
  r = await api('OPTIONS', '/scores', null, null, { Origin: 'https://appassets.androidplatform.net', 'Access-Control-Request-Method': 'POST' });
  check(r.headers.get('access-control-allow-origin') === 'https://appassets.androidplatform.net', 'CORS allowed for the Android app');
  r = await api('OPTIONS', '/scores', null, null, { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' });
  check(!r.headers.get('access-control-allow-origin'), 'CORS denied for other sites');

  // ------------------------------------------------------------------ website account + admin with 2FA
  const user = new Browser();
  r = await user.post('/login', { username: 'pingu', password: 'Slippery-Ice-2026' });
  check(r.status === 303 && r.headers.get('location') === '/account', 'website login');
  r = await user.get('/account');
  check(r.status === 200 && r.text.includes('pingu'), 'account page');
  r = await user.get('/admin');
  check(r.status === 403, 'normal user cannot open admin');

  r = await admin.post('/login', { username: 'boss', password: 'Very-Secret-Admin-42' });
  check(r.headers.get('location') === '/admin/2fa', 'admin login requires 2FA setup');
  r = await admin.get('/admin');
  check(r.status === 403 || r.status === 303, 'admin area closed before 2FA');
  r = await admin.get('/admin/2fa');
  const secret = /<p class="code-box"><code>([A-Z2-7 ]+)<\/code>/.exec(r.text)?.[1].replace(/ /g, '');
  check(!!secret, 'TOTP secret shown');
  r = await admin.post('/admin/2fa', { code: '000000' }, '/admin/2fa');
  check(r.status === 400, 'wrong TOTP code rejected');
  r = await admin.post('/admin/2fa', { code: totp(secret) }, '/admin/2fa');
  check(r.status === 303 && r.headers.get('location') === '/admin', '2FA enabled with correct code');
  r = await admin.get('/admin');
  check(r.status === 200 && r.text.includes('Audit log') && r.text.includes('score_mismatch'), 'admin dashboard with audit log of cheat attempts');
  const scoreId = /name="id" value="(\d+)"><button class="link" name="action" value="hide"/.exec(r.text)?.[1];
  r = await admin.post('/admin/score', { id: scoreId, action: 'verify' }, '/admin');
  r = await admin.get('/admin');
  check(r.text.includes('replay OK'), 'admin can re-verify a stored replay');
  r = await admin.post('/admin/score', { id: scoreId, action: 'hide' }, '/admin');
  r = await api('GET', '/scores?level=1-1');
  check(r.json.entries.length === 1, 'hidden score disappears from the leaderboard');

  const admin2 = new Browser();
  await admin2.post('/login', { username: 'boss', password: 'Very-Secret-Admin-42' });
  r = await admin2.post('/login/2fa', { code: totp(secret) }, '/login/2fa');
  check(r.status === 400, 'a TOTP code cannot be used twice');

  // ------------------------------------------------------------------ brute force protection
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) limited = (await api('POST', '/auth/login', { username: 'pingu', password: 'guess-' + i + '-xxxxxx' })).status === 429;
  check(limited, 'login attempts are rate limited');

  // ------------------------------------------------------------------ account deletion
  r = await user.post('/account/delete', { password: 'Slippery-Ice-2026', confirm: 'yes' }, '/account');
  check(r.status === 303, 'account deleted');
  r = await api('GET', '/auth/me', null, token);
  check(r.status === 401, 'tokens of deleted account are invalid');
  const left = Number(sql('SELECT COUNT(*) AS n FROM scores WHERE nickname = ?', ['pingu'])[0].n);
  check(left === 0, 'scores of deleted account removed');
} catch (e) {
  fail++;
  console.log('FAIL exception: ' + e.stack);
} finally {
  cleanup();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* files may still be locked on Windows */ }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const o = mac[19] & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}
function fmt(ticks) { const cs = Math.floor(ticks * 100 / 120); return `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; }
