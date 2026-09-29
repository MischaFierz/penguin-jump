'use strict';
// Shared helpers of the account panel (/konto/) and the admin panel (/admin/).
// DOM is always built with el() and textContent - never innerHTML with data - so nothing a user
// types (names, level titles, report texts) can ever run as code.

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

const $ = id => document.getElementById(id);

/** JSON API with CSRF header; throws {status, error, message} on failure. */
function makeApi(base) {
  const api = {
    csrf: '',
    async call(method, path, body) {
      const headers = { Accept: 'application/json' };
      if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = api.csrf; }
      let r;
      try {
        r = await fetch(base + path, { method, headers, body: method !== 'GET' ? JSON.stringify(body || {}) : undefined, credentials: 'same-origin', cache: 'no-store' });
      } catch (e) {
        throw { status: 0, error: 'network', message: 'Keine Verbindung zum Server.' };
      }
      const j = await r.json().catch(() => ({}));
      if (j && j.csrf) api.csrf = j.csrf;
      if (!r.ok) throw { status: r.status, error: j.error || 'error', message: j.message };
      return j;
    },
    get: p => api.call('GET', p),
    post: (p, b) => api.call('POST', p, b),
  };
  return api;
}

function fmtDate(ts, withTime = false) {
  if (!ts) return '–';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(document.documentElement.lang || 'de-CH') + (withTime ? ' ' + d.toLocaleTimeString(document.documentElement.lang || 'de-CH', { hour: '2-digit', minute: '2-digit' }) : '');
}

function fmtTicks(ticks) {
  const cs = Math.floor(ticks * 100 / 120);
  return `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** Small colour preview of a level (15 rows of tile characters) on a canvas. */
const TILE_COLORS = {
  '#': '#6b8fc7', B: '#9fc7ec', '?': '#f2b632', F: '#f2b632', S: '#f2b632', W: '#f2b632', H: '#f2b632', E: '#b98b52',
  o: '#ffd24a', '-': '#8a6a4a', x: '#bfe6ff', '^': '#c9cfd8', '~': '#ff6a3a', M: '#a3784a', V: '#a3784a', '*': '#ff4f7b',
  C: '#39d98a', G: '#ffffff', '@': '#20263c', e: '#a877e6', s: '#e05656', b: '#57c1ff', h: '#76d35b', i: '#dff4ff', '!': '#c69a5b',
};
function levelPreview(rows, px = 6) {
  const w = Math.max(20, ...rows.map(r => r.length));
  const c = el('canvas', { width: w * px, height: 15 * px, class: 'preview' });
  const g = c.getContext('2d');
  g.fillStyle = '#cfe6ff'; g.fillRect(0, 0, c.width, c.height);
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { const col = TILE_COLORS[r[x]]; if (col) { g.fillStyle = col; g.fillRect(x * px, y * px, px, px); } } });
  return c;
}
