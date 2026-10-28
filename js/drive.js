// Google Drive upload queue. Jobs are saved on the tablet, uploaded in 8 MB pieces with Drive's resumable upload,
// paused when the internet drops and continued from the last saved piece when it returns (also after the app restarts).
import * as store from './store.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CHUNK = 8 * 1024 * 1024;
let cfg = { clientId: '', root: 'CSwithSR Classes', email: '', helper: '', hkey: '' };
let token = null, tokenExp = 0, gisP = null, client = null;
let running = false, listeners = new Set(), state = { msg: '', needsSignIn: false };
let blobSource = null;

export const settings = () => ({ ...cfg });
export const status = () => ({ ...state });
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(f => { try { f(); } catch (e) {} });
const setState = s => { Object.assign(state, s); emit(); };

export async function init(o) {
  blobSource = o.blobSource;
  Object.assign(cfg, (await store.get('kv', 'drive')) || {});
  // a sign-in from earlier today is still valid after the app is reopened
  const saved = await store.get('kv', 'dtok'); if (saved && saved.exp > Date.now() + 60000) { token = saved.token; tokenExp = saved.exp; }
  // anything interrupted mid-upload goes back to the queue
  for (const j of await jobs()) if (j.status === 'uploading') { j.status = 'queued'; await saveJob(j); }
  addEventListener('online', () => pump());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pump(); });   // try again whenever the app comes back to the front
  addEventListener('offline', () => setState({ msg: 'Waiting for internet' }));
  setInterval(() => pump(), 30000);
  pump();
}
export async function saveSettings(s) { Object.assign(cfg, s); await store.put('kv', 'drive', cfg); emit(); }
export const connected = () => !!cfg.helper || (!!cfg.clientId && !!cfg.email);
const keepToken = () => store.put('kv', 'dtok', { token, exp: tokenExp }).catch(() => {});
// The Drive helper is a small Google Apps Script in your own Google account. It hands the app a fresh Drive key
// whenever needed, so the app stays connected without sign-in windows.
async function helperToken() {
  const r = await fetch(cfg.helper + (cfg.helper.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(cfg.hkey), { cache: 'no-store' });
  const j = await r.json(); if (!j.token) throw new Error(j.error === 'denied' ? 'The Drive helper refused the key. Copy the helper script again from Settings.' : 'The Drive helper did not answer.');
  token = j.token; tokenExp = Date.now() + 45 * 60000; if (j.email && cfg.email !== j.email) { cfg.email = j.email; await store.put('kv', 'drive', cfg); }
  keepToken(); setState({ needsSignIn: false }); return true;
}
export async function ensureToken() {
  if (haveToken()) return true;
  if (cfg.helper && cfg.hkey) { try { return await helperToken(); } catch (e) { setState({ msg: e.message }); return false; } }
  return false;
}
export async function testHelper() {
  token = null; tokenExp = 0; await helperToken();
  try {   // does the helper's pass include Drive? (the Drive box must be ticked when allowing the script)
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token));
    if (r.ok) { const j = await r.json(); if (!/auth\/drive(\s|$)/.test(j.scope || '')) { token = null; tokenExp = 0; throw new Error('The helper works but has no Drive permission. In your script tap Run on authorize again and tick “Select all” (the Drive box) before Continue. If it does not ask, first remove the script at myaccount.google.com/connections.'); } }
  } catch (e) { if (/no Drive permission/.test(e.message)) throw e; }
  return cfg.email;
}
export function newKey() { const a = new Uint8Array(24); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); }
export const helperScript = key => `// CSwithSR Board: Drive helper. Keep this key secret.
const KEY = '${key}';
function doGet(e) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (!e || !e.parameter || e.parameter.key !== KEY) return out({ error: 'denied' });
  return out({ token: ScriptApp.getOAuthToken(), email: Session.getEffectiveUser().getEmail() });
}
// Run this once from the editor to give permission.
function authorize() { DriveApp.getRootFolder(); Logger.log(ScriptApp.getOAuthToken() ? 'Ready' : 'Not ready'); }
// Never runs. It only tells Google that the helper needs to add files to Drive.
function needsDrive_() { DriveApp.createFolder('x').setTrashed(true); }
`;

/* ---------- sign-in (Google Identity Services) ---------- */
function loadGis() {
  if (!gisP) gisP = new Promise((ok, no) => {
    if (window.google && google.accounts && google.accounts.oauth2) return ok();
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = ok; s.onerror = () => { gisP = null; no(new Error('Could not reach Google. Check the internet connection.')); };
    document.head.appendChild(s);
  });
  return gisP;
}
// Must be called from a tap (Google opens a small sign-in window).
export async function signIn(interactive = true) {
  if (!cfg.clientId) throw new Error('Add your Google Client ID in Settings first.');
  await loadGis();
  return new Promise((ok, no) => {
    client = google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId, scope: SCOPE + ' https://www.googleapis.com/auth/userinfo.email',
      callback: async r => {
        if (r.error) return no(new Error(r.error_description || r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) { token = null; return no(new Error('Google Drive permission was not ticked. Tap Connect Drive again and tick the box that lets CSwithSR Board use its Drive files.')); }
        token = r.access_token; tokenExp = Date.now() + (r.expires_in - 120) * 1000; keepToken();
        try { const u = await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } })).json(); if (u.email) cfg.email = u.email; await store.put('kv', 'drive', cfg); } catch (e) {}
        setState({ needsSignIn: false, msg: '' }); ok(); pump();
      },
      error_callback: e => no(new Error(e && e.type === 'popup_closed' ? 'Sign-in window was closed.' : 'Google sign-in could not open. Tap again.'))
    });
    client.requestAccessToken({ prompt: interactive ? 'consent' : '', login_hint: cfg.email || undefined });
  });
}
export async function signOut() {
  try { if (token && window.google) google.accounts.oauth2.revoke(token, () => {}); } catch (e) {}
  token = null; tokenExp = 0; cfg.email = ''; await store.put('kv', 'drive', cfg); await store.del('kv', 'dfolders'); await store.del('kv', 'dtok'); emit();
}
const haveToken = () => token && Date.now() < tokenExp;

/* ---------- queue ---------- */
export async function jobs() { return (await store.getPrefix('kv', 'job:')).map(([, v]) => v).sort((a, b) => a.created - b.created); }
const saveJob = j => store.put('kv', 'job:' + j.id, j);
export async function enqueue(job) {
  const j = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: Date.now(), status: 'queued', offset: 0, session: null, ...job };
  await saveJob(j); emit(); pump(); return j;
}
export async function remove(id) { const j = await store.get('kv', 'job:' + id); if (j && j.src.type === 'blob') await store.del('blobs', j.src.key); await store.del('kv', 'job:' + id); emit(); }
export async function retry(id) { const j = await store.get('kv', 'job:' + id); if (j) { j.status = 'queued'; j.err = ''; delete j._reset; fails = 0; await saveJob(j); emit(); pump(); } }

let fails = 0, retryT = 0;
export async function pump() {
  if (running) return; running = true; clearTimeout(retryT);
  try {
    while (true) {
      const next = (await jobs()).find(j => j.status === 'queued' || j.status === 'uploading');
      if (!next) { setState({ msg: '' }); break; }
      if (!navigator.onLine) { setState({ msg: 'Waiting for internet' }); clearTimeout(retryT); retryT = setTimeout(pump, 15000); break; }
      if (!cfg.clientId && !cfg.helper) { setState({ msg: 'Connect Google Drive in Settings to start uploading' }); break; }
      if (!(await ensureToken())) { setState({ needsSignIn: !cfg.helper, msg: cfg.helper ? state.msg || 'Drive helper not reachable' : 'Tap “Connect Drive” to continue uploading' }); break; }
      try { await upload(next); fails = 0; }
      catch (e) {
        if (e.auth) { token = null; tokenExp = 0; if (cfg.helper && !next._authRetry) { next._authRetry = 1; continue; } setState({ needsSignIn: !cfg.helper, msg: 'Tap “Connect Drive” to continue uploading' }); break; }
        if (e.net || !navigator.onLine) {
          // Is the internet really down, or did only this upload's link fail? Ask Drive something small.
          let netOk = false;
          if (navigator.onLine) { try { const p = await call('https://www.googleapis.com/drive/v3/about?fields=user'); netOk = p.ok; } catch (x) {} }
          if (netOk && !next._reset) { next._reset = 1; next.session = null; next.offset = 0; next.status = 'queued'; await saveJob(next); continue; }   // start this file's upload again
          if (netOk) { next.status = 'error'; next.err = 'The internet works, but Drive keeps refusing this file. Tap Retry. If it fails again, take a screenshot of this message and send it to Claude. [' + (e.where || '?') + ': ' + (e.detail || e.message) + ']'; await saveJob(next); emit(); continue; }
          next.status = 'queued'; await saveJob(next);
          fails++; const wait = Math.min(60, [5, 10, 20, 30, 60][Math.min(fails - 1, 4)]);
          setState({ msg: (navigator.onLine ? 'Connection to Drive failed. Trying again in ' + wait + ' s' : 'Waiting for internet') + (e.message && e.message !== 'Network' ? ' (' + e.message + ')' : '') });
          clearTimeout(retryT); retryT = setTimeout(pump, wait * 1000); break;
        }
        next.status = 'error'; next.err = e.message; await saveJob(next); emit();
      }
    }
  } finally { running = false; }
}

async function call(url, init = {}) {
  let r;
  try { r = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) } }); }
  catch (e) { const er = new Error('Network'); er.net = true; er.where = /upload_id|uploadType/.test(url) ? 'upload' : /about/.test(url) ? 'check' : 'folders'; er.detail = e.message; throw er; }
  if (r.status === 401) { const er = new Error('Signed out'); er.auth = true; throw er; }
  return r;
}
async function why(r, what) {
  let msg = '', reason = '';
  try { const j = await r.json(); msg = j.error && j.error.message || ''; reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || (j.error && j.error.status) || ''; } catch (e) {}
  if (r.status === 403 && /insufficient|scope|PERMISSION_DENIED/i.test(reason + msg) && !/has not been used|disabled/i.test(msg)) { token = null; tokenExp = 0;
    if (cfg.helper) { setState({ msg: 'The Drive helper has no Drive permission' }); throw new Error('The Drive helper has no Drive permission. Open your script, Run authorize, tick “Select all”, then tap Test in Settings and Retry here.'); }
    setState({ needsSignIn: true, msg: 'Drive permission missing. Tap Connect Drive and tick the Drive box.' }); const e = new Error('Drive permission missing: tap Connect Drive and tick the Drive box, then Retry.'); throw e; }
  if (/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(msg + reason)) throw new Error('The Google Drive API is not switched on in your Google Cloud project. Enable it, wait 2 minutes, then Retry.');
  throw new Error(`${what} (${r.status}${msg ? ': ' + msg.slice(0, 140) : ''})`);
}
async function folderFor(path) {
  const cache = (await store.get('kv', 'dfolders' + (cfg.helper ? ':h' : ''))) || {};
  let parent = 'root', key = '';
  for (const name of path) {
    key += '/' + name;
    if (cache[key]) { parent = cache[key]; continue; }
    const q = `name='${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
    const r = await call('https://www.googleapis.com/drive/v3/files?fields=files(id)&q=' + encodeURIComponent(q));
    if (!r.ok) await why(r, 'Drive folder lookup failed');
    const f = (await r.json()).files || [];
    let id = f[0] && f[0].id;
    if (!id) {
      const c = await call('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) });
      if (!c.ok) await why(c, 'Could not create Drive folder');
      id = (await c.json()).id;
    }
    cache[key] = parent = id; await store.put('kv', 'dfolders' + (cfg.helper ? ':h' : ''), cache);
  }
  return parent;
}
async function upload(j) {
  const blob = await blobSource(j.src); if (!blob) throw new Error('The file is no longer on this tablet.');
  const total = blob.size; j.total = total; j.status = 'uploading'; await saveJob(j); emit();
  setState({ msg: 'Uploading ' + j.name });
  if (j.session) {   // ask Drive how much it already has
    const r = await call(j.session, { method: 'PUT', headers: { 'Content-Range': 'bytes */' + total } });
    if (r.status === 200 || r.status === 201) return finish(j, await r.json());
    if (r.status === 308) { const rg = r.headers.get('Range'); j.offset = rg ? +rg.split('-')[1] + 1 : 0; }
    else { j.session = null; j.offset = 0; }
  }
  if (!j.session && j.lec && !j.lec.done) { await nameLecture(j); await saveJob(j); emit(); setState({ msg: 'Uploading ' + j.name }); }
  if (!j.session) {
    const parent = j.parentId || await folderFor([cfg.root || 'CSwithSR Classes', ...j.path]);
    const r = await call('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': j.mime, 'X-Upload-Content-Length': String(total) },
      body: JSON.stringify({ name: j.name, parents: [parent], mimeType: j.mime, ...(j.lec && j.lec.done ? { appProperties: { lec: String(j.lec.n), lecPart: String(j.lec.part || ''), lecDate: j.lec.date } } : {}) }) });
    if (!r.ok) await why(r, 'Drive refused the upload');
    j.session = r.headers.get('Location'); j.offset = 0; if (!j.session) throw new Error('Drive did not return an upload address.');
    await saveJob(j);
  }
  while (j.offset < total) {
    const end = Math.min(j.offset + CHUNK, total);
    let body;   // read this piece first, so a damaged file on the tablet is not mistaken for no internet
    try { body = await blob.slice(j.offset, end).arrayBuffer(); } catch (x) { throw new Error('This recording could not be read from the tablet storage. Record again or download it from Recordings.'); }
    const r = await call(j.session, { method: 'PUT', headers: { 'Content-Range': `bytes ${j.offset}-${end - 1}/${total}` }, body });
    if (r.status === 200 || r.status === 201) return finish(j, await r.json());
    if (r.status === 308) { const rg = r.headers.get('Range'); j.offset = rg ? +rg.split('-')[1] + 1 : end; }
    else if (r.status === 404 || r.status === 410) { j.session = null; j.offset = 0; await saveJob(j); throw new Error('Upload expired. Tap Retry to start it again.'); }
    else if (r.status >= 500) { const er = new Error('Drive busy'); er.net = true; throw er; }
    else throw new Error('Upload failed (' + r.status + ')');
    await saveJob(j); emit();
  }
}
async function finish(j, info) {
  j.status = 'done'; j.offset = j.total; j.fileId = info.id; j.link = info.webViewLink || ''; j.done = Date.now(); j.session = null;
  await saveJob(j); if (j.src.type === 'blob') await store.del('blobs', j.src.key);
  if (j.src.type === 'rec') { const m = await store.get('recs', j.src.id); if (m) { m.drive = j.link || 'uploaded'; await store.put('recs', m.id, m); } }
  emit();
}
// ---- Lecture numbers: continue from the highest "<prefix> Chap <x> Lecture N" already in Drive ----
const norm = s => s.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const localDay = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export async function lectureFiles(prefix, chap) {
  const base = norm(`${prefix} Chap ${chap} Lecture`);
  const re = new RegExp('^' + reEsc(base) + '\\s*(\\d+)(?:\\.(\\d+))?(\\s*notes)?(?![\\d])', 'i');
  let out = [], page = '';
  do {
    const r = await call('https://www.googleapis.com/drive/v3/files?pageSize=1000&q=' + encodeURIComponent("name contains 'Lecture' and trashed=false") + '&fields=' + encodeURIComponent('nextPageToken,files(id,name,createdTime,appProperties)') + (page ? '&pageToken=' + page : ''));
    if (!r.ok) await why(r, 'Could not read your Drive to find the lecture number');
    const js = await r.json(); page = js.nextPageToken || '';
    for (const f of js.files || []) { const m = norm(f.name).match(re); if (m) out.push({ id: f.id, name: f.name, n: +m[1], part: m[2] ? +m[2] : 0, notes: !!m[3], date: (f.appProperties && f.appProperties.lecDate) || localDay(f.createdTime) }); }
  } while (page);
  return out;
}
async function nameLecture(j) {
  const L = j.lec, base = `${L.prefix} Chap ${L.chap} Lecture `;
  const all = await lectureFiles(L.prefix, L.chap);
  const maxN = all.reduce((a, e) => Math.max(a, e.n), 0), atMax = all.filter(e => e.n === maxN);
  const sameDay = maxN > 0 && atMax.some(e => e.date === L.date);
  let n = sameDay ? maxN : maxN + 1, part = 0, name;
  if (L.kind === 'notes') {
    name = `${base}${n} Notes`; const taken = new Set(all.filter(e => e.notes && e.n === n).map(e => norm(e.name).replace(/\.[^.]+$/, '').toLowerCase()));
    for (let k = 2; taken.has(norm(name).toLowerCase()); k++) name = `${base}${n} Notes (${k})`;
  } else {
    const recs = sameDay ? atMax.filter(e => !e.notes) : [];
    if (recs.length) {
      for (const e of recs.filter(e => !e.part)) {   // the earlier recording of today becomes N.1
        const nn = e.name.replace(new RegExp('(Lecture\\s*' + n + ')(?!\\d)(?!\\.\\d)'), '$1.1');
        if (nn !== e.name) { const r = await call(`https://www.googleapis.com/drive/v3/files/${e.id}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nn, appProperties: { lec: String(n), lecPart: '1', lecDate: L.date } }) }); if (r.ok) e.part = 1; }
      }
      part = Math.max(1, ...recs.map(e => e.part || 1)) + 1;
    }
    name = `${base}${n}${part ? '.' + part : ''}`;
  }
  j.name = name.replace(/[\\/:*?"<>|]/g, '') + '.' + L.ext; L.n = n; L.part = part; L.done = true;
}

// Drive browser: a signed-in request, and the app's own top folder
export async function api(url, init = {}) {
  if (!(await ensureToken())) { const e = new Error(cfg.helper ? 'Drive helper not reachable. Check the internet.' : 'Connect Google Drive first (Drive uploads, then Connect Drive).'); e.auth = true; throw e; }
  try { return await call(url, init); }
  catch (e) { if (e.auth) { token = null; tokenExp = 0; if (await ensureToken()) return call(url, init); } if (e.net) throw new Error('Could not reach Google Drive. Check the internet.'); throw e; }
}
export const rootFolderId = () => folderFor([cfg.root || 'CSwithSR Classes']);
export const fullAccess = () => !!cfg.helper;
// used by automated tests only
export function _testToken(t) { token = t; tokenExp = Date.now() + 3e6; cfg.email = cfg.email || 'test@example.com'; }
