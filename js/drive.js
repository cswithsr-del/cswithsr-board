// Google Drive upload queue. Jobs are saved on the tablet, uploaded in 8 MB pieces with Drive's resumable upload,
// paused when the internet drops and continued from the last saved piece when it returns (also after the app restarts).
import * as store from './store.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CHUNK = 8 * 1024 * 1024;
let cfg = { clientId: '', root: 'CSwithSR Classes', email: '' };
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
  // anything interrupted mid-upload goes back to the queue
  for (const j of await jobs()) if (j.status === 'uploading') { j.status = 'queued'; await saveJob(j); }
  addEventListener('online', () => pump());
  addEventListener('offline', () => setState({ msg: 'Waiting for internet' }));
  setInterval(() => pump(), 30000);
  pump();
}
export async function saveSettings(s) { Object.assign(cfg, s); await store.put('kv', 'drive', cfg); emit(); }
export const connected = () => !!cfg.clientId && !!cfg.email;

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
        token = r.access_token; tokenExp = Date.now() + (r.expires_in - 120) * 1000;
        try { const u = await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } })).json(); if (u.email) cfg.email = u.email; await store.put('kv', 'drive', cfg); } catch (e) {}
        setState({ needsSignIn: false, msg: '' }); ok(); pump();
      },
      error_callback: e => no(new Error(e && e.type === 'popup_closed' ? 'Sign-in window was closed.' : 'Google sign-in could not open. Tap again.'))
    });
    client.requestAccessToken({ prompt: interactive && !cfg.email ? 'consent' : '', login_hint: cfg.email || undefined });
  });
}
export async function signOut() {
  try { if (token && window.google) google.accounts.oauth2.revoke(token, () => {}); } catch (e) {}
  token = null; tokenExp = 0; cfg.email = ''; await store.put('kv', 'drive', cfg); await store.del('kv', 'dfolders'); emit();
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
export async function retry(id) { const j = await store.get('kv', 'job:' + id); if (j) { j.status = 'queued'; j.err = ''; await saveJob(j); emit(); pump(); } }

export async function pump() {
  if (running) return; running = true;
  try {
    while (true) {
      const next = (await jobs()).find(j => j.status === 'queued' || j.status === 'uploading');
      if (!next) { setState({ msg: '' }); break; }
      if (!navigator.onLine) { setState({ msg: 'Waiting for internet' }); break; }
      if (!cfg.clientId) { setState({ msg: 'Connect Google Drive in Settings to start uploading' }); break; }
      if (!haveToken()) { setState({ needsSignIn: true, msg: 'Tap “Connect Drive” to continue uploading' }); break; }
      try { await upload(next); }
      catch (e) {
        if (e.auth) { token = null; setState({ needsSignIn: true, msg: 'Tap “Connect Drive” to continue uploading' }); break; }
        if (e.net || !navigator.onLine) { next.status = 'queued'; await saveJob(next); setState({ msg: 'Waiting for internet' }); break; }
        next.status = 'error'; next.err = e.message; await saveJob(next); emit();
      }
    }
  } finally { running = false; }
}

async function call(url, init = {}) {
  let r;
  try { r = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) } }); }
  catch (e) { const er = new Error('Network'); er.net = true; throw er; }
  if (r.status === 401) { const er = new Error('Signed out'); er.auth = true; throw er; }
  return r;
}
async function folderFor(path) {
  const cache = (await store.get('kv', 'dfolders')) || {};
  let parent = 'root', key = '';
  for (const name of path) {
    key += '/' + name;
    if (cache[key]) { parent = cache[key]; continue; }
    const q = `name='${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
    const r = await call('https://www.googleapis.com/drive/v3/files?fields=files(id)&q=' + encodeURIComponent(q));
    if (!r.ok) throw new Error('Drive folder lookup failed (' + r.status + ')');
    const f = (await r.json()).files || [];
    let id = f[0] && f[0].id;
    if (!id) {
      const c = await call('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) });
      if (!c.ok) throw new Error('Could not create Drive folder (' + c.status + ')');
      id = (await c.json()).id;
    }
    cache[key] = parent = id; await store.put('kv', 'dfolders', cache);
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
  if (!j.session) {
    const parent = await folderFor([cfg.root || 'CSwithSR Classes', ...j.path]);
    const r = await call('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': j.mime, 'X-Upload-Content-Length': String(total) },
      body: JSON.stringify({ name: j.name, parents: [parent], mimeType: j.mime }) });
    if (!r.ok) throw new Error('Drive refused the upload (' + r.status + ')');
    j.session = r.headers.get('Location'); j.offset = 0; if (!j.session) throw new Error('Drive did not return an upload address.');
    await saveJob(j);
  }
  while (j.offset < total) {
    const end = Math.min(j.offset + CHUNK, total);
    const r = await call(j.session, { method: 'PUT', headers: { 'Content-Range': `bytes ${j.offset}-${end - 1}/${total}` }, body: blob.slice(j.offset, end) });
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
// used by automated tests only
export function _testToken(t) { token = t; tokenExp = Date.now() + 3e6; cfg.email = cfg.email || 'test@example.com'; }
