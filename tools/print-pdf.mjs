// Prints an HTML file to PDF with an invisible headless Edge/Chrome (A4, page numbers in the footer).
// Usage: node tools/print-pdf.mjs <input.html> <output.pdf> "<footer title>"
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [input, output, title = ''] = process.argv.slice(2);
const candidates = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'];
const exe = candidates.find(f => fs.existsSync(f));
if (!exe) { console.error('no Edge/Chrome found'); process.exit(1); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
const port = 9400 + Math.floor(Math.random() * 400);
const browser = spawn(exe, ['--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch { await sleep(200); } }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const cdp = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: pathToFileURL(path.resolve(input)).href });
  await sleep(1500);
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const r = await cdp('Page.printToPDF', {
    printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="font:7pt 'Segoe UI',Arial;width:100%;padding:0 17mm;display:flex;justify-content:space-between;color:#444"><span>${esc(title)}</span><span>Seite <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  if (!r.result) throw new Error(JSON.stringify(r.error));
  fs.writeFileSync(output, Buffer.from(r.result.data, 'base64'));
  console.log('written', output);
  ws.close();
} finally {
  browser.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
