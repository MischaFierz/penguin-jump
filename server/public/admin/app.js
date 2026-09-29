'use strict';
// Admin panel: sign-in (password -> new password -> 2FA) and the areas the user has permissions for.

const api = makeApi('api');
const P = { MAIN: 1, COMMUNITY: 2, SCORES: 4, ACCOUNTS: 8, USERS: 16, GROUPS: 32, AUDIT: 64, SETTINGS: 128 };
let state = null;
let current = 'overview';

// ------------------------------------------------------------------ status line + dialogs
function status(text, kind = 'info') {
  const s = $('status');
  s.textContent = text;
  s.className = 'status ' + kind;
  clearTimeout(status.t);
  if (kind !== 'error') status.t = setTimeout(() => { s.textContent = ''; s.className = 'status'; }, 6000);
}
const fail = e => status(e.message || ({ network: 'Keine Verbindung zum Server.', forbidden: 'Dafür fehlt dir das Recht.' })[e.error] || 'Fehler: ' + e.error, 'error');

/** Dialog with optional fields; resolves with the field values or null. */
function ask(title, fields = [], okText = 'OK', text = '') {
  return new Promise(resolve => {
    $('dialog-title').textContent = title;
    const body = $('dialog-body');
    body.replaceChildren();
    if (text) body.append(el('p', {}, text));
    const inputs = {};
    for (const f of fields) {
      let input;
      if (f.type === 'select') input = el('select', {}, f.options.map(([v, l]) => el('option', { value: v, selected: v === f.value }, l)));
      else if (f.type === 'checks') {
        input = el('div', { class: 'checks' }, Object.entries(f.options).map(([bit, label]) =>
          el('label', {}, el('input', { type: 'checkbox', value: bit, checked: (f.value & bit) !== 0 }), ' ', label)));
      } else if (f.type === 'multi') {
        input = el('div', { class: 'checks' }, f.options.map(([v, label]) =>
          el('label', {}, el('input', { type: 'checkbox', value: v, checked: f.value.includes(v) }), ' ', label)));
      } else input = el('input', { type: f.type || 'text', value: f.value ?? '', autocomplete: f.autocomplete || 'off', required: f.required });
      inputs[f.name] = input;
      body.append(el('label', { class: 'field' }, el('span', {}, f.label), input));
    }
    $('dialog-ok').textContent = okText;
    const d = $('dialog');
    d.onclose = () => {
      if (d.returnValue !== 'ok') return resolve(null);
      const v = {};
      for (const f of fields) {
        const i = inputs[f.name];
        v[f.name] = f.type === 'multi' ? [...i.querySelectorAll('input:checked')].map(c => Number(c.value)) : f.type === 'checks' ? [...i.querySelectorAll('input:checked')].reduce((a, c) => a | Number(c.value), 0) : i.value;
      }
      resolve(v);
    };
    d.returnValue = '';
    d.showModal();
  });
}
const confirmIt = (title, text, ok = 'Ja') => ask(title, [], ok, text).then(v => v !== null);

// ------------------------------------------------------------------ sign-in
async function start() {
  try {
    state = await api.get('/state');
  } catch (e) {
    document.body.append(el('p', { class: 'error' }, 'Server nicht erreichbar.'));
    return;
  }
  $('brand-name').textContent = state.game;
  document.title = 'Admin – ' + state.game;
  if (state.stage === 'ready') showPanel(); else showSignin();
}

async function showSignin() {
  $('app').hidden = true;
  $('signin').hidden = false;
  const fields = $('signin-fields');
  fields.replaceChildren();
  $('signin-error').textContent = '';
  $('signin-cancel').hidden = state.stage === 'login';
  const input = (name, label, type = 'text', autocomplete = 'off') =>
    el('label', { class: 'field' }, el('span', {}, label), el('input', { name, type, autocomplete, required: true }));
  const set = (title, text, button) => { $('signin-title').textContent = title; $('signin-text').textContent = text; $('signin-submit').textContent = button; };
  if (state.stage === 'login') {
    set(state.game + ' – Admin', 'Anmeldung für das Admin-Panel.', 'Anmelden');
    fields.append(input('username', 'Benutzername', 'text', 'username'), input('password', 'Passwort', 'password', 'current-password'));
  } else if (state.stage === 'password') {
    set('Neues Passwort setzen', 'Dein Passwort wurde von einem Admin gesetzt. Wähle jetzt ein eigenes (mindestens 10 Zeichen).', 'Passwort setzen');
    fields.append(input('new', 'Neues Passwort', 'password', 'new-password'), input('new2', 'Wiederholen', 'password', 'new-password'));
  } else if (state.stage === '2fa-setup') {
    set('Zwei-Faktor einrichten', 'Füge diesen Schlüssel in einer Authenticator-App hinzu (z. B. Aegis, 2FAS, Google oder Microsoft Authenticator) und gib den angezeigten Code ein.', 'Bestätigen');
    try {
      const s = await api.get('/2fa/setup');
      fields.append(el('p', { class: 'code' }, s.secret.match(/.{1,4}/g).join(' ')), el('details', {}, el('summary', {}, 'otpauth-Link'), el('code', { class: 'break' }, s.uri)));
    } catch (e) { fail(e); }
    fields.append(input('code', '6-stelliger Code', 'text', 'one-time-code'));
  } else {
    set('Zwei-Faktor-Anmeldung', 'Gib den Code aus deiner Authenticator-App ein.', 'Weiter');
    fields.append(input('code', '6-stelliger Code', 'text', 'one-time-code'));
  }
  const first = fields.querySelector('input');
  if (first) first.focus();
}

$('signin-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const v = Object.fromEntries(new FormData(ev.target));
  $('signin-error').textContent = '';
  try {
    if (state.stage === 'login') state.stage = (await api.post('/login', { username: v.username, password: v.password })).stage;
    else if (state.stage === 'password') {
      if (v.new !== v.new2) { $('signin-error').textContent = 'Die Passwörter stimmen nicht überein.'; return; }
      state.stage = (await api.post('/password', { new: v.new })).stage;
    } else if (state.stage === '2fa-setup') state.stage = (await api.post('/2fa/setup', { code: v.code })).stage;
    else state.stage = (await api.post('/2fa', { code: v.code })).stage;
    await start();
  } catch (e) {
    $('signin-error').textContent = e.message || (e.error === 'login_failed' ? 'Benutzername oder Passwort falsch.' : 'Fehler: ' + e.error);
  }
});
$('signin-cancel').addEventListener('click', async () => { await api.post('/logout'); start(); });
$('logout').addEventListener('click', async () => { await api.post('/logout'); start(); });

// ------------------------------------------------------------------ panel
const SECTIONS = [
  ['overview', 'Übersicht', 0],
  ['main', 'Hauptlevel', P.MAIN],
  ['community', 'Community-Level', P.COMMUNITY],
  ['scores', 'Bestenlisten', P.SCORES],
  ['accounts', 'Spielerkonten', P.ACCOUNTS],
  ['users', 'Admin-Benutzer', P.USERS],
  ['groups', 'Gruppen', P.GROUPS],
  ['audit', 'Verlauf', P.AUDIT],
  ['settings', 'Einstellungen', P.SETTINGS],
  ['me', 'Mein Zugang', 0],
];
const can = bit => (state.user.effective & bit) === bit;

function showPanel() {
  $('signin').hidden = true;
  $('app').hidden = false;
  $('me-name').textContent = state.user.displayName || state.user.username;
  const nav = $('nav');
  nav.replaceChildren(...SECTIONS.filter(s => !s[2] || can(s[2])).map(([id, label]) =>
    el('a', { href: '#' + id, class: id === current ? 'active' : '', onclick: e => { e.preventDefault(); go(id); } }, label)));
  go(location.hash.slice(1) || current);
}

function go(id) {
  const s = SECTIONS.find(x => x[0] === id && (!x[2] || can(x[2]))) || SECTIONS[0];
  current = s[0];
  history.replaceState(null, '', '#' + current);
  for (const a of $('nav').children) a.className = a.getAttribute('href') === '#' + current ? 'active' : '';
  $('page-title').textContent = s[1];
  $('page').replaceChildren(el('p', { class: 'muted' }, 'Lädt …'));
  VIEWS[current]().catch(e => { if (e.status === 401) start(); else fail(e); });
}
const page = (...nodes) => $('page').replaceChildren(...nodes);
const btn = (label, onclick, cls = 'ghost small') => el('button', { type: 'button', class: cls, onclick }, label);
const table = (head, rows) => el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, head.map(h => el('th', {}, h)))), el('tbody', {}, rows));
const searchBox = (value, onsearch, placeholder = 'Suchen …') => {
  const i = el('input', { type: 'search', value, placeholder });
  i.addEventListener('keydown', e => { if (e.key === 'Enter') onsearch(i.value); });
  return el('div', { class: 'toolbar' }, i, btn('Suchen', () => onsearch(i.value), 'primary small'));
};
async function act(promise, ok, reload = true) {
  try { const r = await promise; if (ok) status(typeof ok === 'function' ? ok(r) : ok, 'ok'); if (reload) go(current); return r; } catch (e) { fail(e); return null; }
}

const VIEWS = {
  async overview() {
    const o = await api.get('/overview');
    const tile = (n, label, warn) => el('div', { class: 'tile' + (warn ? ' warn' : '') }, el('b', {}, String(n)), el('span', {}, label));
    page(el('div', { class: 'tiles' },
      tile(o.accounts, 'Spielerkonten'), tile(o.mainLevels, 'Hauptlevel veröffentlicht'), tile(o.communityLevels, 'Community-Level'),
      tile(o.openReports, 'offene Meldungen', o.openReports > 0), tile(o.scores24h, 'Bestzeiten (24 h)'), tile(o.rejected24h, 'abgelehnte Läufe (24 h)', o.rejected24h > 0)),
      el('p', { class: 'muted' }, o.mail ? 'E-Mail-Versand ist eingerichtet.' : 'E-Mail-Versand ist nicht eingerichtet (config.php → mail). Konten funktionieren trotzdem, nur ohne E-Mail.'));
  },

  async main() {
    const { levels } = await api.get('/levels/main');
    const order = levels.map(l => l.id);
    const move = async (i, d) => { const o = order.slice(); [o[i], o[i + d]] = [o[i + d], o[i]]; await act(api.post('/levels/main/order', { ids: o }), 'Reihenfolge gespeichert.'); };
    const rows = levels.map((l, i) => el('tr', {},
      el('td', {}, el('b', {}, l.id)), el('td', {}, l.title || '–'), el('td', {}, 'Welt ' + l.world),
      el('td', {}, el('span', { class: 'badge ' + l.status }, l.status === 'published' ? 'veröffentlicht' : 'Entwurf'), l.changed && l.status === 'published' ? el('span', { class: 'badge draft' }, 'Änderungen offen') : null),
      el('td', {}, fmtDate(l.updatedAt, true)),
      el('td', { class: 'actions' },
        btn('Bearbeiten', () => window.open('../play/?admin-edit=' + encodeURIComponent(l.id), '_blank', 'noopener')),
        btn('Veröffentlichen', async () => { if (await confirmIt('Level ' + l.id + ' veröffentlichen?', 'Der aktuelle Entwurf wird sofort für alle Spieler aktiv. Die Bestenliste beginnt für diese Fassung neu.')) act(api.post(`/levels/main/${l.id}/publish`), 'Veröffentlicht.'); }, 'primary small'),
        l.status === 'published' ? btn('Zurückziehen', async () => { if (await confirmIt('Level ' + l.id + ' zurückziehen?', 'Das Level verschwindet aus dem Spiel, bis es wieder veröffentlicht wird.')) act(api.post(`/levels/main/${l.id}/unpublish`), 'Zurückgezogen.'); }) : null,
        btn('Fassungen', () => versions(l.id)),
        i > 0 ? btn('↑', () => move(i, -1)) : null, i < levels.length - 1 ? btn('↓', () => move(i, 1)) : null,
        btn('Löschen', async () => { if (await confirmIt('Level ' + l.id + ' löschen?', 'Das Level und seine Bestenliste werden endgültig gelöscht.', 'Löschen')) act(api.post(`/levels/main/${l.id}/delete`), 'Gelöscht.'); }, 'danger small'))));
    page(el('p', { class: 'muted' }, 'Bearbeiten öffnet den Level-Editor in einem neuen Tab. Gespeichert wird als Entwurf; erst „Veröffentlichen“ macht die Änderung für alle Spieler sichtbar (die Spiele laden die Hauptlevel beim Start vom Server).'),
      el('div', { class: 'toolbar' }, btn('Neues Hauptlevel', async () => {
        const v = await ask('Neues Hauptlevel', [{ name: 'id', label: 'Nummer (Welt-Level, z. B. 5-1)', required: true }, { name: 'title', label: 'Titel (optional)' },
          { name: 'world', label: 'Welt / Aussehen', type: 'select', value: '1', options: [['1', '1 – Schnee'], ['2', '2 – Höhle'], ['3', '3 – Polarlicht'], ['4', '4 – Lava']] }], 'Anlegen');
        if (v) act(api.post('/levels/main', { id: v.id.trim(), title: v.title, world: Number(v.world) }), 'Angelegt. Jetzt „Bearbeiten“.');
      }, 'primary')),
      table(['Nr.', 'Titel', 'Welt', 'Stand', 'Entwurf geändert', ''], rows));
  },

  async community(q = '', filter = 'reported') {
    const r = await api.get(`/levels/community?filter=${filter}&q=${encodeURIComponent(q)}`);
    const filters = [['reported', 'Gemeldet'], ['published', 'Veröffentlicht'], ['hidden', 'Ausgeblendet'], ['all', 'Alle']];
    const rows = r.levels.map(l => el('tr', {},
      el('td', {}, l.id), el('td', {}, l.title), el('td', {}, l.author),
      el('td', {}, el('span', { class: 'badge ' + l.status }, { published: 'öffentlich', draft: 'Entwurf', hidden: 'ausgeblendet' }[l.status] || l.status)),
      el('td', {}, '♥ ' + l.likes + ' · ▶ ' + l.plays), el('td', {}, l.reports ? el('span', { class: 'badge warn' }, l.reports + ' Meldung(en)') : '–'),
      el('td', { class: 'actions' },
        btn('Ansehen', () => communityDetail(l.id)),
        l.status === 'hidden' ? btn('Einblenden', () => act(api.post(`/levels/community/${l.id}/show`), 'Eingeblendet.')) : btn('Ausblenden', () => act(api.post(`/levels/community/${l.id}/hide`), 'Ausgeblendet.')),
        l.reports ? btn('Meldungen erledigt', () => act(api.post(`/levels/community/${l.id}/reports-done`), 'Erledigt.')) : null,
        btn('Löschen', async () => { if (await confirmIt('„' + l.title + '“ löschen?', 'Das Level wird endgültig gelöscht.', 'Löschen')) act(api.post(`/levels/community/${l.id}/delete`), 'Gelöscht.'); }, 'danger small'))));
    VIEWS.community.q = q;
    page(el('div', { class: 'toolbar' }, filters.map(([f, label]) => btn(label, () => VIEWS.community(q, f).catch(fail), f === filter ? 'primary small' : 'ghost small'))),
      searchBox(q, v => VIEWS.community(v, filter).catch(fail), 'Titel, Ersteller oder Nummer'),
      r.levels.length ? table(['Nr.', 'Titel', 'Ersteller', 'Stand', 'Beliebtheit', 'Meldungen', ''], rows) : el('p', { class: 'muted' }, 'Keine Level.'));
  },

  async scores(q = '') {
    const r = await api.get('/scores?q=' + encodeURIComponent(q));
    const rows = r.scores.map(s => el('tr', { class: s.hidden ? 'dim' : '' },
      el('td', {}, '#' + s.id), el('td', {}, s.level), el('td', {}, s.name, s.registered ? ' ✓' : ''), el('td', { class: 'num' }, fmtTicks(s.timeTicks)),
      el('td', { class: 'num' }, s.score), el('td', {}, s.client), el('td', {}, fmtDate(s.at, true)),
      el('td', { class: 'actions' },
        btn('Prüfen', () => act(api.post(`/scores/${s.id}/verify`), r => r.message, false)),
        btn(s.hidden ? 'Einblenden' : 'Ausblenden', () => act(api.post(`/scores/${s.id}/${s.hidden ? 'show' : 'hide'}`), 'Gespeichert.')),
        btn('Löschen', async () => { if (await confirmIt('Eintrag löschen?', s.name + ' – ' + s.level)) act(api.post(`/scores/${s.id}/delete`), 'Gelöscht.'); }, 'danger small'))));
    page(searchBox(q, v => VIEWS.scores(v).catch(fail), 'Name'), table(['', 'Level', 'Name', 'Zeit', 'Punkte', 'Gerät', 'Datum', ''], rows));
  },

  async accounts(q = '') {
    const r = await api.get('/accounts?q=' + encodeURIComponent(q));
    const rows = r.accounts.map(a => el('tr', { class: a.disabled ? 'dim' : '' },
      el('td', {}, a.username), el('td', {}, a.email ? a.email + (a.emailVerified ? '' : ' (unbestätigt)') : '–'),
      el('td', {}, fmtDate(a.createdAt)), el('td', {}, fmtDate(a.lastLoginAt)), el('td', { class: 'num' }, a.levels), el('td', { class: 'num' }, a.scores),
      el('td', { class: 'actions' },
        btn(a.disabled ? 'Entsperren' : 'Sperren', () => act(api.post(`/accounts/${a.id}/${a.disabled ? 'enable' : 'disable'}`), 'Gespeichert.')),
        btn('Neuer Wiederherstellungs-Code', async () => {
          if (!await confirmIt('Wiederherstellungs-Code für ' + a.username, 'Der alte Code wird ungültig und das Konto auf allen Geräten abgemeldet. Gib den neuen Code der Person auf sicherem Weg weiter.')) return;
          const res = await act(api.post(`/accounts/${a.id}/reset`), null, false);
          if (res) ask('Neuer Code für ' + a.username, [], 'Schliessen', res.recoveryCode);
        }),
        btn('Einträge ausblenden', () => act(api.post(`/accounts/${a.id}/hide-scores`), 'Ausgeblendet.')),
        btn('Löschen', async () => { if (await confirmIt('Konto ' + a.username + ' löschen?', 'Konto, Level und Bestenlisten-Einträge werden endgültig gelöscht.', 'Löschen')) act(api.post(`/accounts/${a.id}/delete`), 'Gelöscht.'); }, 'danger small'))));
    page(searchBox(q, v => VIEWS.accounts(v).catch(fail), 'Name oder E-Mail'), table(['Name', 'E-Mail', 'Seit', 'Zuletzt', 'Level', 'Einträge', ''], rows));
  },

  async users() {
    const [{ users }, { groups }] = await Promise.all([api.get('/users'), can(P.GROUPS) ? api.get('/groups') : Promise.resolve({ groups: [] })]);
    const roleOpts = Object.entries(state.roles).filter(([k]) => k !== 'owner' || state.user.role === 'owner').map(([k, r]) => [k, r.name]);
    const edit = async u => {
      const v = await ask('Benutzer ' + u.username, [
        { name: 'displayName', label: 'Anzeigename', value: u.displayName },
        { name: 'role', label: 'Stufe', type: 'select', value: u.role, options: roleOpts },
        { name: 'permissions', label: 'Zusätzliche Rechte', type: 'checks', value: u.permissions, options: state.permissions },
        { name: 'disabled', label: 'Gesperrt', type: 'select', value: u.disabled ? '1' : '0', options: [['0', 'nein'], ['1', 'ja']] },
        ...groups.length ? [{ name: 'groups', label: 'Gruppen', type: 'multi', value: u.groups, options: groups.map(g => [g.id, g.name]) }] : [],
      ], 'Speichern');
      if (!v) return;
      act(api.post('/users/' + u.id, { displayName: v.displayName, role: v.role, permissions: v.permissions, disabled: v.disabled === '1', groups: v.groups || [] }), 'Gespeichert.');
    };
    const rows = users.map(u => el('tr', { class: u.disabled ? 'dim' : '' },
      el('td', {}, u.username), el('td', {}, u.displayName || '–'), el('td', {}, state.roles[u.role]?.name || u.role),
      el('td', {}, u.has2fa ? '✓' : 'noch nicht'), el('td', {}, fmtDate(u.lastLoginAt, true)),
      el('td', { class: 'actions' }, btn('Ändern', () => edit(u)),
        btn('Passwort setzen', async () => { const v = await ask('Passwort für ' + u.username, [{ name: 'password', label: 'Vorläufiges Passwort (muss bei der Anmeldung geändert werden)', type: 'password', autocomplete: 'new-password' }], 'Setzen'); if (v) act(api.post(`/users/${u.id}/password`, v), 'Passwort gesetzt.'); }),
        btn('2FA zurücksetzen', async () => { if (await confirmIt('2FA zurücksetzen?', u.username + ' richtet bei der nächsten Anmeldung neu ein.')) act(api.post(`/users/${u.id}/reset-2fa`), 'Zurückgesetzt.'); }),
        btn('Löschen', async () => { if (await confirmIt('Benutzer ' + u.username + ' löschen?', '', 'Löschen')) act(api.post(`/users/${u.id}/delete`), 'Gelöscht.'); }, 'danger small'))));
    page(el('div', { class: 'toolbar' }, btn('Neuer Benutzer', async () => {
      const v = await ask('Neuer Admin-Benutzer', [{ name: 'username', label: 'Benutzername', required: true }, { name: 'displayName', label: 'Anzeigename' },
        { name: 'role', label: 'Stufe', type: 'select', value: 'moderator', options: roleOpts },
        { name: 'password', label: 'Vorläufiges Passwort (wird bei der ersten Anmeldung ersetzt)', type: 'password', autocomplete: 'new-password', required: true }], 'Anlegen');
      if (v) act(api.post('/users', v), 'Angelegt. Die Person setzt bei der ersten Anmeldung ein eigenes Passwort und richtet 2FA ein.');
    }, 'primary')),
    el('p', { class: 'muted' }, 'Stufen: ' + Object.values(state.roles).map(r => r.name).join(', ') + '. Die Stufe bringt Grundrechte; einzelne Rechte und Gruppen kommen dazu.'),
    table(['Benutzer', 'Name', 'Stufe', '2FA', 'Zuletzt angemeldet', ''], rows));
  },

  async groups() {
    const { groups } = await api.get('/groups');
    const edit = async g => {
      const v = await ask(g ? 'Gruppe ' + g.name : 'Neue Gruppe', [{ name: 'name', label: 'Name', value: g ? g.name : '', required: true },
        { name: 'permissions', label: 'Rechte', type: 'checks', value: g ? g.permissions : 0, options: state.permissions }], 'Speichern');
      if (v) act(api.post(g ? '/groups/' + g.id : '/groups', v), 'Gespeichert.');
    };
    page(el('div', { class: 'toolbar' }, btn('Neue Gruppe', () => edit(null), 'primary')),
      table(['Gruppe', 'Rechte', 'Mitglieder', ''], groups.map(g => el('tr', {}, el('td', {}, g.name),
        el('td', {}, Object.entries(state.permissions).filter(([b]) => g.permissions & b).map(([, l]) => l).join(', ') || '–'),
        el('td', {}, g.members.join(', ') || '–'),
        el('td', { class: 'actions' }, btn('Ändern', () => edit(g)), btn('Löschen', async () => { if (await confirmIt('Gruppe ' + g.name + ' löschen?')) act(api.post(`/groups/${g.id}/delete`), 'Gelöscht.'); }, 'danger small'))))));
  },

  async audit(q = '') {
    const r = await api.get('/audit?q=' + encodeURIComponent(q));
    page(searchBox(q, v => VIEWS.audit(v).catch(fail), 'Aktion, Name oder Detail'),
      table(['Zeit', 'Aktion', 'Wer', 'Detail', 'IP-Pseudonym'], r.entries.map(e => el('tr', {},
        el('td', {}, fmtDate(e.at, true)), el('td', {}, e.action), el('td', {}, e.panelUser ? '🛡 ' + e.panelUser : e.account || '–'), el('td', {}, e.detail), el('td', { class: 'mono' }, e.ip)))));
  },

  async settings() {
    const r = await api.get('/settings');
    const labels = { registration_open: 'Neue Spielerkonten erlauben', community_open: 'Community-Level veröffentlichen erlauben', leaderboards_open: 'Bestenlisten-Einträge annehmen' };
    page(...Object.entries(labels).map(([k, label]) => el('label', { class: 'switch' },
      el('input', { type: 'checkbox', checked: r.settings[k], onchange: e => act(api.post('/settings', { name: k, value: e.target.checked }), 'Gespeichert.', false) }), ' ', label)),
      el('h2', {}, 'E-Mail'),
      el('p', { class: 'muted' }, r.mail ? 'Der Versand ist in config.php eingerichtet.' : 'Kein Postfach in config.php eingetragen – E-Mail-Funktionen sind aus.'),
      r.mail ? btn('Test-E-Mail senden', async () => { const v = await ask('Test-E-Mail', [{ name: 'to', label: 'An', type: 'email', required: true }], 'Senden'); if (v) act(api.post('/settings/testmail', v), 'Gesendet.', false); }, 'primary') : null);
  },

  async me() {
    page(el('p', {}, 'Angemeldet als ', el('b', {}, state.user.username), ' (', state.roles[state.user.role]?.name || state.user.role, ').'),
      btn('Passwort ändern', async () => {
        const v = await ask('Passwort ändern', [{ name: 'old', label: 'Aktuelles Passwort', type: 'password', autocomplete: 'current-password' },
          { name: 'new', label: 'Neues Passwort', type: 'password', autocomplete: 'new-password' }, { name: 'new2', label: 'Wiederholen', type: 'password', autocomplete: 'new-password' }], 'Ändern');
        if (!v) return;
        if (v.new !== v.new2) return status('Die Passwörter stimmen nicht überein.', 'error');
        act(api.post('/password', { old: v.old, new: v.new }), 'Passwort geändert.', false);
      }, 'primary'));
  },
};

async function versions(code) {
  const l = await api.get('/levels/main/' + code).catch(fail);
  if (!l) return;
  const body = el('div', {}, levelPreview(l.rows), el('p', { class: 'muted' }, 'Aktueller Entwurf. Frühere Fassungen:'),
    el('ul', { class: 'plain' }, l.versions.map(v => el('li', {}, fmtDate(v.at, true), ' · ', v.hash, v.id === l.currentVersion ? ' (veröffentlicht) ' : ' ',
      btn('In den Entwurf holen', async () => { $('dialog').close(); if (await confirmIt('Fassung wiederherstellen?', 'Der Entwurf wird durch diese Fassung ersetzt. Veröffentlichen musst du danach selbst.')) act(api.post(`/levels/main/${code}/revert`, { version: v.id }), 'Entwurf ersetzt.'); })))));
  $('dialog-title').textContent = 'Level ' + code;
  $('dialog-body').replaceChildren(body);
  $('dialog-ok').textContent = 'Schliessen';
  $('dialog').onclose = null;
  $('dialog').showModal();
}

async function communityDetail(code) {
  const l = await api.get('/levels/community/' + code).catch(fail);
  if (!l) return;
  $('dialog-title').textContent = l.title + ' (' + code + ')';
  $('dialog-body').replaceChildren(levelPreview(l.rows),
    el('p', {}, el('a', { href: '../play/?community=' + encodeURIComponent(code), target: '_blank', rel: 'noopener' }, 'Im Spiel öffnen')),
    el('h3', {}, 'Meldungen'),
    l.reports.length ? el('ul', { class: 'plain' }, l.reports.map(r => el('li', { class: r.handled ? 'dim' : '' }, fmtDate(r.at, true), ': ', r.reason || '(ohne Text)'))) : el('p', { class: 'muted' }, 'Keine.'));
  $('dialog-ok').textContent = 'Schliessen';
  $('dialog').onclose = null;
  $('dialog').showModal();
}

// back/forward buttons and links like /admin/#community
window.addEventListener('hashchange', () => { if (state && state.stage === 'ready' && location.hash.slice(1) !== current) go(location.hash.slice(1)); });

start();
