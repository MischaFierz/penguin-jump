// End-to-end test of the PHP server with PHP's built-in web server and a temporary database.
// Covers setup, admin panel (sign-in, 2FA, permissions, main levels), community levels (playability check,
// likes, reports), highscore verification incl. attack attempts, the account panel with e-mail codes.
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
const check = (ok, name, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !extra ? '' : '  -> ' + String(extra).slice(0, 400)}`); };

// ------------------------------------------------------------------ setup: build site, config, server
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srvtest-'));
const site = path.join(tmp, 'website');
execFileSync(process.execPath, [path.join(root, 'tools/build-server.mjs'), site, '1.0.5'], { stdio: 'ignore' });
fs.writeFileSync(path.join(site, 'public/version.json'), JSON.stringify({ version: '1.0.5', downloads: { 'win-x64': { url: 'https://github.com/x/y/releases/download/v1.0.5/Game-win-x64.zip', sha256: 'ab'.repeat(32) } } }));
const dbFile = path.join(tmp, 'test.sqlite');
const outbox = path.join(tmp, 'outbox.txt');
const setupToken = crypto.randomBytes(24).toString('hex');
const cfg = path.join(tmp, 'config.php');
const dsn = process.env.TEST_DB_DSN || 'sqlite:' + dbFile.replace(/\\/g, '/');
const phpStr = v => JSON.stringify(String(v)).replace(/\$/g, '\\$'); // JSON string = valid PHP double-quoted string
fs.writeFileSync(cfg, `<?php return ['db_dsn' => ${phpStr(dsn)}, 'db_user' => ${phpStr(process.env.TEST_DB_USER || '')}, 'db_password' => ${phpStr(process.env.TEST_DB_PASS || '')},
  'app_secret' => '${crypto.randomBytes(48).toString('hex')}', 'setup_token' => '${setupToken}', 'force_https' => false,
  'api_cors_origins' => ['https://appassets.androidplatform.net'], 'mail' => ['outbox' => ${phpStr(outbox.replace(/\\/g, '/'))}]];`);
const port = 18000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', path.join(site, 'public'), path.join(site, 'public/index.php')],
  { env: { ...process.env, APP_CONFIG: cfg }, stdio: 'ignore', windowsHide: true });
const cleanup = () => { try { server.kill(); } catch { /* ignore */ } };
process.on('exit', cleanup);
for (let i = 0; i < 50; i++) { try { await fetch(base + '/privacy'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

// ------------------------------------------------------------------ http helpers
class Browser {
  cookies = new Map();
  csrf = '';
  async req(method, p, { form, json, headers = {} } = {}) {
    const h = { ...headers, Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) { body = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (json) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
    const r = await fetch(base + p, { method, headers: h, body, redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies.set(kv.slice(0, i), kv.slice(i + 1)); }
    const text = await r.text();
    const j = (() => { try { return JSON.parse(text); } catch { return null; } })();
    if (j && j.csrf) this.csrf = j.csrf;
    return { status: r.status, headers: r.headers, text, json: j };
  }
  get(p, o) { return this.req('GET', p, o); }
  async post(p, form, from = p) {
    const page = await this.get(from);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1] ?? '';
    return this.req('POST', p, { form: { _csrf: csrf, ...form } });
  }
  /** session-based JSON APIs (/konto/api, /admin/api) */
  japi(prefix) {
    return {
      get: p => this.req('GET', prefix + p),
      post: (p, json = {}) => this.req('POST', prefix + p, { json, headers: { 'X-CSRF-Token': this.csrf } }),
    };
  }
}
const api = (method, p, json, token, headers = {}) => new Browser().req(method, '/api/v1' + p, { json, headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

// ------------------------------------------------------------------ real runs from the JS game code
const ctx = vm.createContext({ T: 48, VW: 1280, VH: 720, Audio: { play() {}, playMusic() {} }, Loc: { t: k => k }, mix: () => [0, 0, 0], WHITE: [255, 255, 255], btoa, atob, Float64Array, BigUint64Array });
for (const f of ['web/js/stage.js', 'web/js/replay.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8').replace(/^const StageView = \{[\s\S]*$/m, ''), ctx);
const playRun = (levelText, inputs) => {
  ctx.inputs = inputs; ctx.levelText = levelText;
  return vm.runInContext(`(() => { const r = Replay.run(parseLevel('x', levelText), inputs); const t = inputs.slice(0, r.ticks);
    return { ...r, final: r.score + Replay.timeBonus(r.timeTicks), replay: Replay.encode(t), shorter: Replay.encode(t.slice(0, -1)), longer: Replay.encode(t.concat([2, 2])) }; })()`, ctx);
};
const bot = execFileSync(process.execPath, [path.join(root, 'tests/gen-inputs.mjs'), '1', '12000'], { encoding: 'utf8' }).trim().split('\n').map(Number);
const run = playRun(fs.readFileSync(path.join(root, 'shared/levels/level1_1.txt'), 'utf8'), bot);
check(run.completed, `test replay completes level 1-1 (${run.ticks} ticks, ${run.final} points)`);
const claimed = { timeTicks: run.timeTicks, score: run.final, coins: run.coins };
// a small community level: walk right to the igloo
const commRows = Array(15).fill('');
commRows[12] = '  @   o  o  o             G';
commRows[13] = '#'.repeat(30); commRows[14] = '#'.repeat(30);
const commRun = playRun('id=c\nworld=2\n---\n' + commRows.join('\n'), Array(3000).fill(2));
check(commRun.completed, `community test level can be finished (${commRun.ticks} ticks)`);

// direct database access for the test, through PHP/PDO so it works for SQLite and MySQL alike
const sqlPhp = '$c = require getenv("APP_CONFIG"); $p = new PDO($c["db_dsn"], $c["db_user"] ?? "", $c["db_password"] ?? "");'
  + ' $s = $p->prepare(getenv("Q")); $s->execute(json_decode(getenv("P"), true)); echo json_encode($s->columnCount() ? $s->fetchAll(PDO::FETCH_ASSOC) : []);';
const sql = (query, params = []) => JSON.parse(execFileSync(php, ['-r', sqlPhp],
  { env: { ...process.env, APP_CONFIG: cfg, Q: query, P: JSON.stringify(params) }, encoding: 'utf8', windowsHide: true }) || '[]');
const backdate = (runId, seconds) => sql('UPDATE runs SET issued_at = issued_at - ? WHERE id = ?', [seconds, runId]);
const mailCode = () => { const m = [...fs.readFileSync(outbox, 'utf8').matchAll(/^\s{4}(\d{6})$/gm)]; return m.length ? m[m.length - 1][1] : null; };

try {
  // ------------------------------------------------------------------ first-time setup
  let r = await new Browser().get('/');
  check(r.status === 303 && r.headers.get('location') === '/setup', 'not installed -> redirect to /setup');
  const setup = new Browser();
  r = await setup.post('/setup', { token: 'wrong', username: 'boss', password: 'Very-Secret-Admin-42', password2: 'Very-Secret-Admin-42' });
  check(r.status === 403, 'setup rejects a wrong token');
  r = await setup.req('POST', '/setup', { form: { token: setupToken, username: 'boss', password: 'Very-Secret-Admin-42', password2: 'Very-Secret-Admin-42' } });
  check(r.status === 400, 'setup rejects a POST without CSRF token');
  r = await setup.post('/setup', { token: setupToken, username: 'boss', password: 'Very-Secret-Admin-42', password2: 'Very-Secret-Admin-42' });
  check(r.status === 303 && r.headers.get('location') === '/admin/', 'setup creates tables, main levels and the owner', r.status + ' ' + r.text.slice(0, 300));
  r = await new Browser().get('/setup');
  check(r.status === 303, 'setup locks itself afterwards');

  // ------------------------------------------------------------------ pages + headers
  r = await new Browser().get('/');
  check(r.status === 200 && r.text.includes('Penguin Jump') && r.text.includes('Game-win-x64.zip'), 'home page with download from version.json');
  const csp = r.headers.get('content-security-policy') || '';
  check(csp.includes("script-src 'self'") && !csp.includes('unsafe') && csp.includes("frame-ancestors 'none'"), 'strict Content-Security-Policy');
  check(r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY' && !r.headers.get('x-powered-by'), 'security headers');
  check(!/<script/i.test(r.text) && !/ style=/i.test(r.text), 'no inline scripts or styles on pages');
  const de = await new Browser().get('/', { headers: { 'Accept-Language': 'de-CH,de;q=0.9' } });
  check(de.text.includes('Im Browser spielen') && de.text.includes('/konto/'), 'German page with account link');
  for (const p of ['/play/', '/konto/', '/admin/']) { r = await new Browser().get(p); check(r.status === 200 && /<script src=/.test(r.text) && !/<script>/.test(r.text), `${p} served without inline scripts`); }

  // ------------------------------------------------------------------ main level pack
  r = await api('GET', '/levels/main');
  check(r.status === 200 && r.json.levels.length === 12 && r.json.levels[0].id === '1-1' && r.json.levels[0].data.includes('---'), '12 main levels delivered from the database');
  const packVersion = r.json.version;
  r = await api('GET', '/levels/main', null, null, { 'If-None-Match': `"${packVersion}"` });
  check(r.status === 304, 'level pack supports ETag caching');

  // ------------------------------------------------------------------ admin panel sign-in
  const admin = new Browser(), A = admin.japi('/admin/api');
  await A.get('/state');
  r = await A.post('/login', { username: 'boss', password: 'wrong-password-1' });
  check(r.status === 401, 'admin login with wrong password rejected');
  r = await A.post('/login', { username: 'boss', password: 'Very-Secret-Admin-42' });
  check(r.json?.stage === '2fa-setup', 'first admin login asks for 2FA setup');
  r = await A.get('/overview');
  check(r.status === 401, 'panel closed before 2FA');
  r = await A.get('/2fa/setup');
  const secret = r.json?.secret;
  check(/^[A-Z2-7]{32}$/.test(secret || ''), 'TOTP secret issued');
  r = await A.post('/2fa/setup', { code: '000000' });
  check(r.status === 400, 'wrong TOTP code rejected');
  r = await A.post('/2fa/setup', { code: totp(secret) });
  check(r.json?.stage === 'ready', '2FA set up, panel open');
  r = await admin.req('POST', '/admin/api/logout', { json: {} });
  check(r.status === 403, 'admin API rejects POST without CSRF header');
  r = await A.get('/overview');
  check(r.status === 200 && r.json.mainLevels === 12, 'overview');

  // new moderator: forced password change, then 2FA, then limited rights
  r = await A.post('/users', { username: 'mod1', password: 'Temp-Password-123', role: 'moderator', displayName: 'Moderator' });
  check(r.status === 200, 'owner creates a moderator');
  const mod = new Browser(), M = mod.japi('/admin/api');
  await M.get('/state');
  r = await M.post('/login', { username: 'mod1', password: 'Temp-Password-123' });
  check(r.json?.stage === 'password', 'moderator must set an own password first');
  r = await M.post('/password', { new: 'Own-Secret-Pass-77' });
  check(r.json?.stage === '2fa-setup', 'then set up 2FA');
  const modSecret = (await M.get('/2fa/setup')).json.secret;
  r = await M.post('/2fa/setup', { code: totp(modSecret) });
  check(r.json?.stage === 'ready', 'moderator signed in');
  r = await M.get('/levels/main');
  check(r.status === 403, 'moderator may not edit main levels');
  r = await M.get('/users');
  check(r.status === 403, 'moderator may not manage panel users');

  // ------------------------------------------------------------------ admin edits and publishes a main level
  r = await A.get('/levels/main/1-2');
  const rows12 = r.json.rows.slice();
  rows12[3] = (rows12[3] || '').padEnd(10, ' ').slice(0, 9) + 'o';
  r = await A.post('/levels/main/1-2', { title: 'Coin test', world: 1, rows: rows12, signs: r.json.signs });
  check(r.status === 200, 'admin saves a main level draft');
  r = await A.post('/levels/main/1-2', { title: '', world: 1, rows: ['@'] });
  check(r.status === 400 && /Startpunkt|breit/.test(r.json.message || ''), 'invalid level rejected with explanation');
  r = await api('GET', '/levels/main');
  check(r.json.version === packVersion, 'draft is not visible to players');
  r = await A.post('/levels/main/1-2/publish');
  check(r.status === 200, 'admin publishes');
  r = await api('GET', '/levels/main');
  const lines12 = r.json.levels.find(l => l.id === '1-2').data.split('\n');
  check(r.json.version !== packVersion && lines12[lines12.indexOf('---') + 4].charAt(9) === 'o', 'published change reaches the games');
  r = await A.post('/levels/main', { id: '5-1', world: 4, title: 'New' });
  check(r.status === 200, 'admin creates a new main level (draft)');
  r = await api('GET', '/levels/main');
  check(r.json.levels.length === 12, 'new draft level not yet delivered');

  // ------------------------------------------------------------------ accounts (games)
  let reg = await api('POST', '/auth/register', { username: 'pingu', password: 'password' });
  check(reg.status === 400 && reg.json?.error === 'password_short', 'weak password rejected');
  reg = await api('POST', '/auth/register', { username: 'admin', password: 'Long-Enough-Pass-1' });
  check(reg.status === 400, 'reserved username rejected');
  reg = await api('POST', '/auth/register', { username: 'pingu', password: 'Slippery-Ice-2026' });
  check(reg.status === 200 && reg.json.token && /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(reg.json.recoveryCode), 'register via API returns token + recovery code');
  const token = reg.json.token;
  r = await api('GET', '/auth/me', null, token);
  check(r.json?.username === 'pingu', 'token login works');
  r = await new Browser().req('POST', '/api/v1/auth/login', { form: { username: 'pingu', password: 'Slippery-Ice-2026' } });
  check(r.status === 415, 'API only accepts JSON (no form-based CSRF)');

  // ------------------------------------------------------------------ highscores (main level 1-1)
  const start = async (level = '1-1') => (await api('POST', '/runs', { level })).json.run;
  let runId = await start();
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, nickname: 'Speedy', result: claimed });
  check(r.status === 422 && r.json.error === 'rejected', 'submission faster than real time is rejected');
  runId = await start(); backdate(runId, 600);
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, nickname: 'Speedy', result: claimed, client: 'test' });
  check(r.status === 200 && r.json.accepted && r.json.timeTicks === run.timeTicks && r.json.score === run.final && r.json.rankTime === 1, 'honest run accepted', JSON.stringify(r.json));
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, nickname: 'Speedy', result: claimed });
  check(r.status === 422 && r.json.error === 'bad_run', 'run id can only be used once');
  for (const [name, body] of [['fake time/score claim', { replay: run.replay, result: { ...claimed, timeTicks: 100, score: 999999 } }],
    ['replay that does not reach the goal', { replay: run.shorter, result: claimed }], ['replay with extra inputs after the goal', { replay: run.longer, result: claimed }]]) {
    runId = await start(); backdate(runId, 600);
    r = await api('POST', '/scores', { run: runId, level: '1-1', nickname: 'Cheater', ...body });
    check(r.status === 422, name + ' rejected');
  }
  runId = await start(); backdate(runId, 600);
  r = await api('POST', '/scores', { run: runId, level: '1-3', replay: run.replay, nickname: 'Cheater', result: claimed });
  check(r.status === 422 && r.json.error === 'bad_run', 'run id is bound to its level');
  runId = await start(); backdate(runId, 600);
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, nickname: 'Sh1tHead', result: claimed });
  check(r.status === 400 && r.json.error === 'nick_bad', 'offensive nickname rejected');
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, nickname: 'pingu', result: claimed });
  check(r.status === 400 && r.json.error === 'nick_taken', 'nobody can post under a registered username');
  r = await api('POST', '/scores', { run: runId, level: '1-1', replay: run.replay, result: claimed }, token);
  check(r.status === 200 && r.json.accepted, 'logged-in player run accepted');
  r = await api('GET', '/scores?level=1-1&by=time');
  check(r.json?.entries.length === 2, 'leaderboard lists both players');
  r = await new Browser().get('/leaderboard?level=1-1');
  check(r.text.includes('Speedy') && r.text.includes(fmt(run.timeTicks)), 'website leaderboard shows entries');

  // ------------------------------------------------------------------ community levels
  r = await api('POST', '/my/levels', { title: 'Easy Walk', world: 2, rows: commRows });
  check(r.status === 401, 'saving a level needs an account');
  r = await api('POST', '/my/levels', { title: 'Easy Walk', world: 2, rows: ['@@'] }, token);
  check(r.status === 400, 'invalid level rejected');
  r = await api('POST', '/my/levels', { title: 'Easy Walk', world: 2, rows: commRows }, token);
  check(r.status === 200 && /^c\d+$/.test(r.json.id) && r.json.status === 'draft', 'player saves a draft');
  const code = r.json.id;
  r = await api('GET', '/community');
  check(r.json.total === 0, 'drafts are not public');
  let vrun = (await api('POST', '/runs', { level: code, purpose: 'verify' }, token)).json.run;
  backdate(vrun, 60);
  r = await api('POST', `/my/levels/${code}/publish`, { run: vrun, replay: commRun.shorter, result: { timeTicks: commRun.timeTicks, score: commRun.final } }, token);
  check(r.status === 422, 'cannot publish without finishing the level');
  const other = (await api('POST', '/auth/register', { username: 'waddler', password: 'Another-Pass-2026' })).json.token;
  r = await api('POST', '/runs', { level: code, purpose: 'verify' }, other);
  check(r.status === 404, 'others cannot test-run a draft');
  r = await api('POST', `/my/levels/${code}`, { title: 'Hacked', world: 1, rows: commRows }, other);
  check(r.status === 404, 'others cannot change a level');
  vrun = (await api('POST', '/runs', { level: code, purpose: 'verify' }, token)).json.run;
  backdate(vrun, 60);
  r = await api('POST', `/my/levels/${code}/publish`, { run: vrun, replay: commRun.replay, result: { timeTicks: commRun.timeTicks, score: commRun.final } }, token);
  check(r.status === 200 && r.json.published, 'finished level gets published', JSON.stringify(r.json));
  r = await api('GET', '/community?sort=new');
  check(r.json.total === 1 && r.json.levels[0].title === 'Easy Walk' && r.json.levels[0].author === 'pingu', 'community list');
  r = await api('GET', '/community?q=walk');
  check(r.json.total === 1, 'community search');
  r = await api('GET', `/community/${code}`);
  check(r.json?.data?.includes('id=' + code), 'community level downloadable');
  r = await api('POST', `/community/${code}/like`, {}, other);
  check(r.json?.liked === true && r.json.likes === 1, 'like');
  r = await api('POST', `/community/${code}/like`, {}, other);
  check(r.json?.liked === false && r.json.likes === 0, 'unlike');
  await api('POST', `/community/${code}/like`, {}, other);
  runId = await start(code); backdate(runId, 60);
  r = await api('POST', '/scores', { run: runId, level: code, replay: commRun.replay, result: { timeTicks: commRun.timeTicks, score: commRun.final } }, other);
  check(r.status === 200 && r.json.rankTime === 1, 'leaderboard on a community level');
  r = await api('GET', '/community?sort=plays');
  check(r.json.levels[0].plays >= 1, 'plays are counted');
  // editing the draft does not change the public version until it is verified again
  const edited = commRows.slice(); edited[11] = '          o';
  await api('POST', `/my/levels/${code}`, { title: 'Easy Walk 2', world: 2, rows: edited }, token);
  r = await api('GET', `/community/${code}`);
  check(!r.json.data.split('\n')[14].includes('o'), 'public version stays until the new draft is verified');
  r = await api('POST', `/community/${code}/report`, { reason: 'test report' });
  check(r.status === 200, 'anyone can report a level');

  // moderator handles the report
  r = await M.get('/levels/community?filter=reported');
  check(r.json?.levels?.[0]?.id === code && r.json.levels[0].reports === 1, 'report shows up for the moderator');
  r = await M.post(`/levels/community/${code}/hide`);
  r = await api('GET', '/community');
  check(r.json.total === 0, 'hidden level disappears');
  await M.post(`/levels/community/${code}/show`);
  await M.post(`/levels/community/${code}/reports-done`);
  r = await api('GET', '/community');
  check(r.json.total === 1, 'level shown again');
  r = await new Browser().get('/community');
  check(r.text.includes('Easy Walk'), 'website community page');

  // ------------------------------------------------------------------ account panel with e-mail codes
  const player = new Browser(), K = player.japi('/konto/api');
  r = await K.get('/state');
  check(r.json?.mail === true && r.json.user === null, 'account panel state');
  r = await player.req('POST', '/konto/api/login', { json: { username: 'pingu', password: 'Slippery-Ice-2026' } });
  check(r.status === 403, 'account API needs the CSRF header');
  r = await K.post('/register', { username: 'mailuser', password: 'Mail-User-Pass-9', email: 'player@example.com', lang: 'de' });
  check(r.status === 200 && r.json.emailPending && r.json.recoveryCode, 'register with e-mail sends a code');
  const code1 = mailCode();
  check(!!code1 && fs.readFileSync(outbox, 'utf8').includes('Bestätigungs-Code'), 'German confirmation mail written');
  r = await K.post('/email/confirm', { code: '000000' });
  check(r.status === 400 && r.json.error === 'code_wrong', 'wrong code rejected');
  r = await K.post('/email/confirm', { code: code1 });
  check(r.status === 200, 'e-mail confirmed');
  r = await K.get('/state');
  check(r.json.user?.email === 'player@example.com', 'confirmed address shown');
  await K.post('/logout');
  r = await K.post('/forgot', { who: 'nobody-here', lang: 'en' });
  check(r.status === 200, 'reset request does not reveal unknown names');
  r = await K.post('/forgot', { who: 'player@example.com', lang: 'en' });
  const code2 = mailCode();
  check(code2 && code2 !== code1, 'reset code mailed');
  r = await K.post('/forgot/confirm', { who: 'player@example.com', code: code2, password: 'short' });
  check(r.status === 400 && r.json.error === 'password_short', 'weak new password rejected before using up the code');
  r = await K.post('/forgot/confirm', { who: 'player@example.com', code: code2, password: 'Brand-New-Pass-55' });
  check(r.status === 200, 'password reset with e-mail code');
  r = await K.post('/login', { username: 'mailuser', password: 'Brand-New-Pass-55' });
  check(r.status === 200, 'login with the new password');
  r = await K.get('/levels');
  check(r.status === 200 && Array.isArray(r.json.levels), 'own levels in the account panel');
  const pk = new Browser(), PK = pk.japi('/konto/api');
  await PK.get('/state');
  await PK.post('/login', { username: 'pingu', password: 'Slippery-Ice-2026' });
  r = await PK.get('/levels');
  check(r.json?.levels?.[0]?.id === code && r.json.levels[0].changed === true, 'author sees the level with unpublished changes');

  // ------------------------------------------------------------------ admin: scores, accounts, audit, settings
  r = await A.get('/scores?q=Speedy');
  const sid = r.json?.scores?.[0]?.id;
  r = await A.post(`/scores/${sid}/verify`);
  check(r.json?.ok === true, 'admin re-verifies a stored replay');
  await A.post(`/scores/${sid}/hide`);
  r = await api('GET', '/scores?level=1-1');
  check(r.json.entries.length === 1, 'hidden score disappears from the leaderboard');
  r = await A.get('/audit?q=score_mismatch');
  check(r.json?.entries?.length >= 1, 'cheat attempts are in the history');
  r = await A.post('/settings', { name: 'registration_open', value: false });
  r = await api('POST', '/auth/register', { username: 'latecomer', password: 'Late-Comer-Pass-1' });
  check(r.status === 403, 'registration can be switched off');
  await A.post('/settings', { name: 'registration_open', value: true });

  // ------------------------------------------------------------------ CORS, brute force, deletion
  r = await api('OPTIONS', '/scores', null, null, { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' });
  check(!r.headers.get('access-control-allow-origin'), 'CORS denied for other sites');
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) limited = (await api('POST', '/auth/login', { username: 'pingu', password: 'guess-' + i + '-xxxxxx' })).status === 429;
  check(limited, 'login attempts are rate limited');
  r = await PK.post('/delete', { password: 'Slippery-Ice-2026', confirm: true });
  check(r.status === 200, 'player deletes the account');
  r = await api('GET', `/community/${code}`);
  check(r.status === 404, 'levels of a deleted account are gone');
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
