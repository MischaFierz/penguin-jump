'use strict';
// Player account panel: sign-in, registration (optional e-mail), password reset, own levels and entries.

const api = makeApi('api');
const TEXT = {
  de: {
    title: 'Mein Konto', login: 'Anmelden', register: 'Konto erstellen', logout: 'Abmelden', username: 'Benutzername', password: 'Passwort',
    password2: 'Passwort wiederholen', newPassword: 'Neues Passwort', oldPassword: 'Aktuelles Passwort', email: 'E-Mail (freiwillig)',
    emailHint: 'Nur für das Zurücksetzen eines vergessenen Passworts. Wird nie angezeigt oder weitergegeben.',
    usernameHint: '3–20 Zeichen: Buchstaben, Ziffern, _ und -', passwordHint: 'Mindestens 10 Zeichen',
    forgot: 'Passwort vergessen?', noAccount: 'Noch kein Konto?', haveAccount: 'Schon ein Konto?', back: 'Zurück',
    forgotTitle: 'Passwort vergessen', forgotText: 'Gib deinen Benutzernamen oder deine bestätigte E-Mail-Adresse ein. Wir senden dir einen Code.',
    who: 'Benutzername oder E-Mail', sendCode: 'Code senden', code: 'Code aus der E-Mail', setPassword: 'Passwort setzen',
    codeSent: 'Falls es ein Konto mit bestätigter E-Mail gibt, ist ein Code unterwegs. Er gilt 15 Minuten.',
    useRecovery: 'Keine E-Mail hinterlegt? Mit Wiederherstellungs-Code zurücksetzen', recoverTitle: 'Mit Wiederherstellungs-Code',
    recoveryCode: 'Wiederherstellungs-Code', recoveryTitle: 'Dein Wiederherstellungs-Code',
    recoveryText: 'Schreib diesen Code auf oder speichere ihn im Passwort-Manager. Damit setzt du dein Passwort zurück, falls du es vergisst – er wird nur einmal angezeigt.',
    saved: 'Ich habe den Code gespeichert', overview: 'Übersicht', levels: 'Meine Level', scores: 'Meine Einträge', security: 'Sicherheit',
    deleteTab: 'Konto löschen', hello: 'Angemeldet als {0}', since: 'Konto seit {0}', emailNone: 'Keine E-Mail hinterlegt.',
    emailIs: 'E-Mail: {0} (bestätigt)', emailAdd: 'E-Mail hinzufügen', emailChange: 'E-Mail ändern', emailRemove: 'E-Mail entfernen',
    emailSent: 'Wir haben dir einen Bestätigungs-Code geschickt.', confirm: 'Bestätigen', emailOk: 'E-Mail-Adresse bestätigt.',
    mailOff: 'E-Mail-Funktionen sind auf diesem Server nicht eingerichtet.', changePassword: 'Passwort ändern', passwordChanged: 'Passwort geändert. Andere Geräte wurden abgemeldet.',
    newRecovery: 'Neuen Wiederherstellungs-Code erstellen', newRecoveryText: 'Der alte Code wird ungültig.',
    deleteText: 'Löscht dein Konto, deine Level und alle Bestenlisten-Einträge endgültig.', deleteConfirm: 'Ja, alles endgültig löschen', deleted: 'Dein Konto wurde gelöscht.',
    noLevels: 'Du hast noch keine Level gebaut.', build: 'Level bauen', edit: 'Bearbeiten', play: 'Spielen', unpublish: 'Zurückziehen', delete: 'Löschen',
    published: 'veröffentlicht', draft: 'Entwurf', hidden: 'ausgeblendet', changed: 'Änderungen noch nicht veröffentlicht', sureDelete: 'Wirklich löschen?',
    noScores: 'Noch keine Einträge.', level: 'Level', time: 'Zeit', points: 'Punkte', date: 'Datum', mismatch: 'Die Passwörter stimmen nicht überein.',
    welcome: 'Willkommen! Du bist angemeldet.',
  },
  en: {
    title: 'My account', login: 'Log in', register: 'Create account', logout: 'Log out', username: 'Username', password: 'Password',
    password2: 'Repeat password', newPassword: 'New password', oldPassword: 'Current password', email: 'E-mail (optional)',
    emailHint: 'Only used to reset a forgotten password. Never shown or shared.',
    usernameHint: '3-20 characters: letters, digits, _ and -', passwordHint: 'At least 10 characters',
    forgot: 'Forgot your password?', noAccount: 'No account yet?', haveAccount: 'Already have an account?', back: 'Back',
    forgotTitle: 'Forgot password', forgotText: 'Enter your username or your confirmed e-mail address. We will send you a code.',
    who: 'Username or e-mail', sendCode: 'Send code', code: 'Code from the e-mail', setPassword: 'Set password',
    codeSent: 'If there is an account with a confirmed e-mail, a code is on its way. It is valid for 15 minutes.',
    useRecovery: 'No e-mail saved? Reset with your recovery code', recoverTitle: 'With recovery code',
    recoveryCode: 'Recovery code', recoveryTitle: 'Your recovery code',
    recoveryText: 'Write this code down or store it in a password manager. It resets your password if you forget it - it is shown only once.',
    saved: 'I have saved the code', overview: 'Overview', levels: 'My levels', scores: 'My entries', security: 'Security',
    deleteTab: 'Delete account', hello: 'Logged in as {0}', since: 'Account since {0}', emailNone: 'No e-mail saved.',
    emailIs: 'E-mail: {0} (confirmed)', emailAdd: 'Add e-mail', emailChange: 'Change e-mail', emailRemove: 'Remove e-mail',
    emailSent: 'We sent you a confirmation code.', confirm: 'Confirm', emailOk: 'E-mail address confirmed.',
    mailOff: 'E-mail features are not set up on this server.', changePassword: 'Change password', passwordChanged: 'Password changed. Other devices were logged out.',
    newRecovery: 'Create a new recovery code', newRecoveryText: 'The old code stops working.',
    deleteText: 'Deletes your account, your levels and all leaderboard entries permanently.', deleteConfirm: 'Yes, delete everything permanently', deleted: 'Your account has been deleted.',
    noLevels: 'You have not built a level yet.', build: 'Build a level', edit: 'Edit', play: 'Play', unpublish: 'Unpublish', delete: 'Delete',
    published: 'published', draft: 'draft', hidden: 'hidden', changed: 'changes not published yet', sureDelete: 'Really delete?',
    noScores: 'No entries yet.', level: 'Level', time: 'Time', points: 'Points', date: 'Date', mismatch: 'The passwords do not match.',
    welcome: 'Welcome! You are logged in.',
  },
  fr: {
    title: 'Mon compte', login: 'Se connecter', register: 'Créer un compte', logout: 'Se déconnecter', username: "Nom d'utilisateur", password: 'Mot de passe',
    password2: 'Répéter le mot de passe', newPassword: 'Nouveau mot de passe', oldPassword: 'Mot de passe actuel', email: 'E-mail (facultatif)',
    emailHint: "Sert uniquement à réinitialiser un mot de passe oublié. Jamais affiché ni transmis.",
    usernameHint: '3 à 20 caractères : lettres, chiffres, _ et -', passwordHint: 'Au moins 10 caractères',
    forgot: 'Mot de passe oublié ?', noAccount: 'Pas encore de compte ?', haveAccount: 'Déjà un compte ?', back: 'Retour',
    forgotTitle: 'Mot de passe oublié', forgotText: "Saisis ton nom d'utilisateur ou ton e-mail confirmé. Nous t'envoyons un code.",
    who: "Nom d'utilisateur ou e-mail", sendCode: 'Envoyer le code', code: "Code reçu par e-mail", setPassword: 'Définir le mot de passe',
    codeSent: "S'il existe un compte avec un e-mail confirmé, un code est en route. Il est valable 15 minutes.",
    useRecovery: 'Pas d’e-mail ? Réinitialiser avec le code de récupération', recoverTitle: 'Avec le code de récupération',
    recoveryCode: 'Code de récupération', recoveryTitle: 'Ton code de récupération',
    recoveryText: "Note ce code ou garde-le dans un gestionnaire de mots de passe. Il réinitialise ton mot de passe si tu l'oublies – il n'est affiché qu'une fois.",
    saved: "J'ai enregistré le code", overview: 'Aperçu', levels: 'Mes niveaux', scores: 'Mes résultats', security: 'Sécurité',
    deleteTab: 'Supprimer le compte', hello: 'Connecté en tant que {0}', since: 'Compte depuis le {0}', emailNone: 'Aucun e-mail enregistré.',
    emailIs: 'E-mail : {0} (confirmé)', emailAdd: 'Ajouter un e-mail', emailChange: "Changer l'e-mail", emailRemove: "Supprimer l'e-mail",
    emailSent: 'Nous t’avons envoyé un code de confirmation.', confirm: 'Confirmer', emailOk: 'Adresse e-mail confirmée.',
    mailOff: 'Les fonctions e-mail ne sont pas configurées sur ce serveur.', changePassword: 'Changer le mot de passe', passwordChanged: 'Mot de passe changé. Les autres appareils ont été déconnectés.',
    newRecovery: 'Créer un nouveau code de récupération', newRecoveryText: "L'ancien code ne fonctionne plus.",
    deleteText: 'Supprime définitivement ton compte, tes niveaux et tous tes résultats.', deleteConfirm: 'Oui, tout supprimer définitivement', deleted: 'Ton compte a été supprimé.',
    noLevels: "Tu n'as pas encore créé de niveau.", build: 'Créer un niveau', edit: 'Modifier', play: 'Jouer', unpublish: 'Retirer', delete: 'Supprimer',
    published: 'publié', draft: 'brouillon', hidden: 'masqué', changed: 'modifications pas encore publiées', sureDelete: 'Vraiment supprimer ?',
    noScores: 'Aucun résultat.', level: 'Niveau', time: 'Temps', points: 'Points', date: 'Date', mismatch: 'Les mots de passe ne correspondent pas.',
    welcome: 'Bienvenue ! Tu es connecté.',
  },
};
const ERR = {
  de: { login_failed: 'Benutzername oder Passwort falsch.', too_many: 'Zu viele Versuche. Bitte später nochmals.', username_format: 'Benutzername: 3–20 Zeichen, nur Buchstaben, Ziffern, _ und -.',
    username_taken: 'Dieser Benutzername ist nicht verfügbar.', password_short: 'Das Passwort braucht mindestens 10 Zeichen.', password_long: 'Das Passwort ist zu lang.',
    password_weak: 'Dieses Passwort ist zu leicht zu erraten.', recover_failed: 'Benutzername oder Code falsch.', code_wrong: 'Der Code ist falsch oder abgelaufen.',
    email_format: 'Das ist keine gültige E-Mail-Adresse.', email_taken: 'Diese E-Mail gehört schon zu einem anderen Konto.', mail_off: 'E-Mail ist auf diesem Server nicht eingerichtet.',
    mail_failed: 'Die E-Mail konnte nicht gesendet werden.', registration_closed: 'Neue Konten sind gerade nicht möglich.', account_disabled: 'Dieses Konto ist gesperrt.', network: 'Keine Verbindung zum Server.' },
  en: { login_failed: 'Username or password is wrong.', too_many: 'Too many attempts. Please try again later.', username_format: 'Username: 3-20 characters, only letters, digits, _ and -.',
    username_taken: 'This username is not available.', password_short: 'The password needs at least 10 characters.', password_long: 'The password is too long.',
    password_weak: 'This password is too easy to guess.', recover_failed: 'Username or code is wrong.', code_wrong: 'The code is wrong or has expired.',
    email_format: 'This is not a valid e-mail address.', email_taken: 'This e-mail belongs to another account.', mail_off: 'E-mail is not set up on this server.',
    mail_failed: 'The e-mail could not be sent.', registration_closed: 'New accounts are currently not possible.', account_disabled: 'This account is disabled.', network: 'No connection to the server.' },
  fr: { login_failed: "Nom d'utilisateur ou mot de passe incorrect.", too_many: 'Trop de tentatives. Réessaie plus tard.', username_format: "Nom d'utilisateur : 3 à 20 caractères, lettres, chiffres, _ et -.",
    username_taken: "Ce nom d'utilisateur n'est pas disponible.", password_short: 'Le mot de passe doit contenir au moins 10 caractères.', password_long: 'Le mot de passe est trop long.',
    password_weak: 'Ce mot de passe est trop facile à deviner.', recover_failed: "Nom d'utilisateur ou code incorrect.", code_wrong: 'Le code est faux ou expiré.',
    email_format: "Ce n'est pas une adresse e-mail valide.", email_taken: 'Cet e-mail appartient à un autre compte.', mail_off: "L'e-mail n'est pas configuré sur ce serveur.",
    mail_failed: "L'e-mail n'a pas pu être envoyé.", registration_closed: 'Les nouveaux comptes ne sont pas possibles pour le moment.', account_disabled: 'Ce compte est désactivé.', network: 'Pas de connexion au serveur.' },
};

const cookieLang = (document.cookie.match(/(?:^|; )lang=(de|en|fr)/) || [])[1];
let lang = cookieLang || ((navigator.language || 'en').slice(0, 2) in TEXT ? (navigator.language || 'en').slice(0, 2) : 'en');
const t = (k, ...a) => (TEXT[lang][k] || TEXT.en[k] || k).replace(/\{(\d)\}/g, (_, i) => a[i] ?? '');
const errText = e => (ERR[lang] || ERR.en)[e.error] || (e.error && e.error !== 'network' ? 'Error: ' + e.error : (ERR[lang] || ERR.en).network);
let state = null;
let tab = 'overview';

function status(text, kind = 'info') {
  const s = $('status');
  s.textContent = text;
  s.className = 'status ' + kind;
  clearTimeout(status.t);
  status.t = setTimeout(() => { s.textContent = ''; s.className = 'status'; }, kind === 'error' ? 9000 : 6000);
}
const main = (...n) => $('main').replaceChildren(...n);
const field = (name, label, type = 'text', autocomplete = 'off', hint = '', extra = {}) =>
  el('label', { class: 'field' }, el('span', {}, label), el('input', { name, type, autocomplete, ...extra }), hint ? el('small', { class: 'muted' }, hint) : null);
const link = (label, onclick) => el('a', { href: '#', onclick: e => { e.preventDefault(); onclick(); } }, label);
function form(title, fields, button, onsubmit, below = []) {
  const f = el('form', { class: 'card stack' }, el('h1', {}, title), ...fields, el('p', { class: 'error', role: 'alert' }), el('button', { type: 'submit', class: 'primary wide' }, button), ...below);
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    f.querySelector('.error').textContent = '';
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try { await onsubmit(Object.fromEntries(new FormData(f)), f); } catch (e) { f.querySelector('.error').textContent = errText(e); } finally { btn.disabled = false; }
  });
  return f;
}

function renderLangs() {
  $('langs').replaceChildren(...['de', 'en', 'fr'].map(l => el('button', { type: 'button', class: 'ghost small' + (l === lang ? ' active' : ''), onclick: () => {
    lang = l; document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`; render();
  } }, l.toUpperCase())));
}

async function load() {
  try { state = await api.get('/state'); } catch (e) { main(el('p', { class: 'error' }, errText(e))); return; }
  render();
}

function render() {
  document.documentElement.lang = lang;
  document.title = t('title') + ' – ' + state.game;
  $('game-name').textContent = state.game;
  renderLangs();
  if (!state.user) return viewLogin();
  viewAccount();
}

// ------------------------------------------------------------------ signed out
function viewLogin() {
  main(el('div', { class: 'signin-box' }, form(t('login'), [field('username', t('username'), 'text', 'username'), field('password', t('password'), 'password', 'current-password')], t('login'),
    async v => { await api.post('/login', v); await load(); status(t('welcome'), 'ok'); },
    [el('div', { class: 'links' }, link(t('forgot'), viewForgot), state.registration ? el('span', {}, t('noAccount'), ' ', link(t('register'), viewRegister)) : null)])));
}

function viewRegister() {
  main(form(t('register'), [
    field('username', t('username'), 'text', 'username', t('usernameHint')),
    field('password', t('password'), 'password', 'new-password', t('passwordHint')),
    field('password2', t('password2'), 'password', 'new-password'),
    state.mail ? field('email', t('email'), 'email', 'email', t('emailHint')) : null,
  ], t('register'), async v => {
    if (v.password !== v.password2) throw { error: 'mismatch_local' };
    const r = await api.post('/register', { username: v.username, password: v.password, email: v.email || '', lang });
    await load();
    showRecovery(r.recoveryCode, r.emailPending ? () => confirmEmailDialog() : null);
    if (r.emailError) status(errText({ error: r.emailError }), 'error');
  }, [el('div', { class: 'links' }, el('span', {}, t('haveAccount'), ' ', link(t('login'), viewLogin)))]));
}

function viewForgot() {
  if (!state.mail) return viewRecover();
  main(form(t('forgotTitle'), [el('p', { class: 'muted' }, t('forgotText')), field('who', t('who'), 'text', 'username')], t('sendCode'), async v => {
    await api.post('/forgot', { who: v.who, lang });
    status(t('codeSent'), 'ok');
    main(form(t('forgotTitle'), [el('p', { class: 'muted' }, t('codeSent')), field('code', t('code'), 'text', 'one-time-code', '', { inputmode: 'numeric' }),
      field('password', t('newPassword'), 'password', 'new-password', t('passwordHint')), field('password2', t('password2'), 'password', 'new-password')], t('setPassword'), async w => {
      if (w.password !== w.password2) throw { error: 'mismatch_local' };
      await api.post('/forgot/confirm', { who: v.who, code: w.code, password: w.password });
      status(t('passwordChanged'), 'ok');
      viewLogin();
    }, [el('div', { class: 'links' }, link(t('back'), viewLogin))]));
  }, [el('div', { class: 'links' }, link(t('useRecovery'), viewRecover), link(t('back'), viewLogin))]));
}

function viewRecover() {
  main(form(t('recoverTitle'), [field('username', t('username'), 'text', 'username'), field('code', t('recoveryCode'), 'text', 'off', '', { placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX' }),
    field('password', t('newPassword'), 'password', 'new-password', t('passwordHint')), field('password2', t('password2'), 'password', 'new-password')], t('setPassword'), async v => {
    if (v.password !== v.password2) throw { error: 'mismatch_local' };
    const r = await api.post('/recover', { username: v.username, code: v.code, password: v.password });
    showRecovery(r.recoveryCode, null, viewLogin);
    status(t('passwordChanged'), 'ok');
  }, [el('div', { class: 'links' }, link(t('back'), viewLogin))]));
}

function showRecovery(code, then, done = render) {
  main(el('div', { class: 'card stack' }, el('h1', {}, t('recoveryTitle')), el('p', {}, t('recoveryText')), el('p', { class: 'code' }, code),
    el('button', { type: 'button', class: 'primary wide', onclick: () => { done(); if (then) then(); } }, t('saved'))));
}

// ------------------------------------------------------------------ signed in
const TABS = ['overview', 'levels', 'scores', 'security', 'deleteTab'];
async function viewAccount() {
  const tabs = el('div', { class: 'konto-tabs' }, TABS.map(k => el('button', { type: 'button', class: 'ghost small' + (k === tab ? ' active' : ''), onclick: () => { tab = k; viewAccount(); } }, t(k))),
    el('button', { type: 'button', class: 'ghost small', onclick: async () => { await api.post('/logout'); await load(); } }, t('logout')));
  const body = el('div', { class: 'stack' });
  main(el('h1', {}, t('title')), tabs, body);
  try { await TABVIEWS[tab](body); } catch (e) { if (e.status === 401) load(); else status(errText(e), 'error'); }
}

function confirmEmailDialog() {
  tab = 'overview';
  viewAccount().then(() => status(t('emailSent'), 'ok'));
  confirmEmailDialog.pending = true;
}

const TABVIEWS = {
  async overview(body) {
    const u = state.user;
    body.append(el('div', { class: 'card stack' }, el('p', {}, el('b', {}, t('hello', u.username))), el('p', { class: 'muted' }, t('since', fmtDate(u.createdAt))),
      el('p', {}, u.email ? t('emailIs', u.email) : t('emailNone'))));
    if (!state.mail) { body.append(el('p', { class: 'muted' }, t('mailOff'))); return; }
    const codeForm = form(t('confirm'), [el('p', { class: 'muted' }, t('emailSent')), field('code', t('code'), 'text', 'one-time-code', '', { inputmode: 'numeric' })], t('confirm'), async v => {
      await api.post('/email/confirm', { code: v.code });
      await load();
      status(t('emailOk'), 'ok');
    });
    codeForm.hidden = !confirmEmailDialog.pending;
    body.append(form(u.email ? t('emailChange') : t('emailAdd'), [field('email', t('email'), 'email', 'email', t('emailHint'))], t('sendCode'), async v => {
      await api.post('/email', { email: v.email, lang });
      confirmEmailDialog.pending = true;
      codeForm.hidden = false;
      status(t('emailSent'), 'ok');
    }), codeForm);
    if (u.email) body.append(form(t('emailRemove'), [field('password', t('password'), 'password', 'current-password')], t('emailRemove'), async v => {
      await api.post('/email/remove', { password: v.password });
      await load();
    }));
  },

  async levels(body) {
    const { levels } = await api.get('/levels');
    body.append(el('p', {}, el('a', { href: '../play/?scene=editor' }, '✎ ' + t('build'))));
    if (!levels.length) { body.append(el('p', { class: 'muted' }, t('noLevels'))); return; }
    body.append(el('table', { class: 'grid' }, el('tbody', {}, levels.map(l => el('tr', {},
      el('td', {}, el('b', {}, l.title), el('br'), el('small', { class: 'muted' }, l.id)),
      el('td', {}, el('span', { class: 'badge ' + l.status }, t(l.status)), l.changed && l.status === 'published' ? el('small', { class: 'muted' }, ' ' + t('changed')) : null),
      el('td', {}, '♥ ' + l.likes + ' · ▶ ' + l.plays),
      el('td', { class: 'actions' },
        el('a', { href: '../play/?editor=' + encodeURIComponent(l.id) }, t('edit')), ' ',
        l.status === 'published' ? el('a', { href: '../play/?community=' + encodeURIComponent(l.id) }, t('play')) : null, ' ',
        l.status === 'published' ? el('button', { type: 'button', class: 'ghost small', onclick: async () => { await api.post(`/levels/${l.id}/unpublish`); viewAccount(); } }, t('unpublish')) : null,
        el('button', { type: 'button', class: 'danger small', onclick: async () => { if (confirm(t('sureDelete'))) { await api.post(`/levels/${l.id}/delete`); viewAccount(); } } }, t('delete'))))))));
  },

  async scores(body) {
    const { scores } = await api.get('/scores');
    if (!scores.length) { body.append(el('p', { class: 'muted' }, t('noScores'))); return; }
    body.append(el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, [t('level'), t('time'), t('points'), t('date')].map(h => el('th', {}, h)))),
      el('tbody', {}, scores.map(s => el('tr', {}, el('td', {}, el('a', { href: '../leaderboard?level=' + encodeURIComponent(s.level) }, s.level)),
        el('td', { class: 'num' }, fmtTicks(s.timeTicks)), el('td', { class: 'num' }, s.score), el('td', {}, fmtDate(s.at)))))));
  },

  async security(body) {
    body.append(form(t('changePassword'), [field('old', t('oldPassword'), 'password', 'current-password'), field('new', t('newPassword'), 'password', 'new-password', t('passwordHint')),
      field('new2', t('password2'), 'password', 'new-password')], t('changePassword'), async (v, f) => {
      if (v.new !== v.new2) throw { error: 'mismatch_local' };
      await api.post('/password', { old: v.old, new: v.new });
      f.reset();
      status(t('passwordChanged'), 'ok');
    }), form(t('newRecovery'), [el('p', { class: 'muted' }, t('newRecoveryText')), field('password', t('password'), 'password', 'current-password')], t('newRecovery'), async v => {
      const r = await api.post('/recovery', { password: v.password });
      showRecovery(r.recoveryCode, null, viewAccount);
    }));
  },

  async deleteTab(body) {
    body.append(form(t('deleteTab'), [el('p', {}, t('deleteText')), field('password', t('password'), 'password', 'current-password'),
      el('label', { class: 'checks' }, el('label', {}, el('input', { type: 'checkbox', name: 'confirm', value: '1', required: true }), ' ', t('deleteConfirm')))], t('deleteTab'), async v => {
      await api.post('/delete', { password: v.password, confirm: v.confirm === '1' });
      await load();
      status(t('deleted'), 'ok');
    }));
  },
};

ERR.de.mismatch_local = TEXT.de.mismatch; ERR.en.mismatch_local = TEXT.en.mismatch; ERR.fr.mismatch_local = TEXT.fr.mismatch;
load();
