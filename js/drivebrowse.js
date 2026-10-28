// Google Drive inside the app: browse, preview, rename, move, copy, delete, new folder, upload.
// Every change is made on the real Drive straight away.
import * as drive from './drive.js';
import * as store from './store.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,parents)';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = n => !n ? '' : n < 1e6 ? Math.max(1, Math.round(n / 1e3)) + ' KB' : n < 1e9 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1e9).toFixed(2) + ' GB';
const fmtDate = s => { try { return new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };
const kindOf = f => f.mimeType === FOLDER ? 'folder' : /pdf/.test(f.mimeType) ? 'pdf' : /^image\//.test(f.mimeType) ? 'image' : /^video\//.test(f.mimeType) ? 'video' : /^audio\//.test(f.mimeType) ? 'audio' : /google-apps/.test(f.mimeType) ? 'doc' : 'file';
const ICON = { folder: '📁', pdf: '📕', image: '🖼', video: '🎬', audio: '🎵', doc: '📄', file: '📄' };

async function ok(r, what) {
  if (r.ok) return r.status === 204 ? null : r.json().catch(() => null);
  let m = ''; try { const j = await r.json(); m = j.error && j.error.message || ''; } catch (e) {}
  if (r.status === 404) m = 'Not found. It may have been deleted, or this app is not allowed to see it.';
  if (r.status === 403 && /insufficient|permission/i.test(m)) m = 'This app is not allowed to change that item.';
  throw new Error(what + (m ? ': ' + m : ' (' + r.status + ')'));
}
async function list(id) {
  let out = [], page = '';
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
    const r = await drive.api(`${API}?q=${q}&pageSize=200&orderBy=folder,name_natural&fields=${encodeURIComponent(FIELDS)}${page ? '&pageToken=' + page : ''}`);
    const j = await ok(r, 'Could not open the folder'); out = out.concat(j.files || []); page = j.nextPageToken || '';
  } while (page);
  return out;
}
const patch = (id, body, qs = '') => drive.api(`${API}/${id}?fields=id,name,parents${qs}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function mkdir(name, parent) { return ok(await drive.api(`${API}?fields=id,name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) }), 'Could not make the folder'); }
async function copyItem(f, dest, progress) {
  if (f.mimeType !== FOLDER) { progress(f.name); return ok(await drive.api(`${API}/${f.id}/copy?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, parents: [dest] }) }), 'Could not copy ' + f.name); }
  const nf = await mkdir(f.name, dest);   // Drive cannot copy a folder in one step, so copy what is inside it
  for (const c of await list(f.id)) await copyItem(c, nf.id, progress);
  return nf;
}

let w, opt, crumbs = [], items = [], clip = null, view = 'grid', busy = false, unsub = null;
export async function open(o) {
  opt = o; if (w) return;
  try { view = (await store.get('kv', 'dview')) || 'grid'; } catch (e) {}
  w = document.createElement('div'); w.className = 'modalWrap dbw';
  w.innerHTML = `<div class="modal dbrowse" role="dialog" aria-modal="true" aria-labelledby="dbH">
    <div class="dbtop"><h2 id="dbH">Google Drive</h2>
      <div class="dbacts"><button class="ghost" id="dbNew">+ New folder</button><button class="ghost" id="dbUp">⇪ Upload here</button><button class="ghost" id="dbView" aria-label="Change view"></button><button class="ghost" id="dbRef" aria-label="Refresh">⟳</button><button class="ghost" id="dbX">Close</button></div></div>
    <nav class="dbcrumbs" aria-label="Folder path"></nav>
    <div class="dbclip" hidden></div>
    <div class="dbbody"></div>
    <input type="file" id="dbFile" multiple hidden>
  </div>`;
  document.body.appendChild(w);
  const q = s => w.querySelector(s);
  q('#dbX').onclick = close; w.addEventListener('pointerdown', e => { if (e.target === w) close(); });
  q('#dbRef').onclick = () => go(crumbs.length - 1);
  q('#dbView').onclick = () => { view = view === 'grid' ? 'list' : 'grid'; store.put('kv', 'dview', view).catch(() => {}); draw(); };
  q('#dbNew').onclick = async () => { const n = await ask('New folder', 'Folder name', ''); if (!n) return; await act(async () => { await mkdir(n, cur().id); }, 'Folder made'); };
  q('#dbUp').onclick = () => q('#dbFile').click();
  q('#dbFile').onchange = async e => {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    for (const f of files) { const key = 'up:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); await store.put('blobs', key, f);
      await drive.enqueue({ kind: 'file', name: f.name, mime: f.type || 'application/octet-stream', path: [], parentId: cur().id, src: { type: 'blob', key }, label: cur().name }); }
    opt.toast(files.length + (files.length > 1 ? ' files are' : ' file is') + ' uploading to ' + cur().name + '. They appear here when done.');
  };
  let t = 0; unsub = drive.onChange(() => { clearTimeout(t); t = setTimeout(async () => { const js = await drive.jobs(); if (w && js.some(j => j.parentId === cur().id && j.status === 'done' && j.done > (w._seen || 0))) { w._seen = Date.now(); go(crumbs.length - 1, true); } }, 800); });
  w._seen = Date.now();
  q('.dbbody').innerHTML = '<p class="empty">Opening Drive…</p>';
  try {
    const rootId = await drive.rootFolderId();
    crumbs = drive.fullAccess() ? [{ id: 'root', name: 'My Drive' }] : [{ id: rootId, name: 'CSwithSR Classes' }];
    if (drive.fullAccess()) { crumbs.push({ id: rootId, name: 'CSwithSR Classes' }); }
    await go(crumbs.length - 1);
  } catch (e) { q('.dbbody').innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}
function close() { if (!w) return; closeMenu(); unsub && unsub(); w.remove(); w = null; clip = null; }
const cur = () => crumbs[crumbs.length - 1];

async function go(i, quiet) {
  crumbs = crumbs.slice(0, i + 1); const body = w.querySelector('.dbbody');
  if (!quiet) body.innerHTML = '<p class="empty">Loading…</p>';
  try { items = await list(cur().id); draw(); }
  catch (e) { body.innerHTML = `<p class="empty">${esc(e.message)}</p>`; drawCrumbs(); }
}
async function into(f) { crumbs.push({ id: f.id, name: f.name }); await go(crumbs.length - 1); }

function drawCrumbs() {
  const n = w.querySelector('.dbcrumbs'); n.innerHTML = '';
  crumbs.forEach((c, i) => { if (i) n.insertAdjacentHTML('beforeend', '<span aria-hidden="true">›</span>');
    const b = document.createElement('button'); b.className = 'crumb' + (i === crumbs.length - 1 ? ' on' : ''); b.textContent = c.name; b.onclick = () => go(i); n.appendChild(b); });
  if (!drive.fullAccess()) n.insertAdjacentHTML('beforeend', '<small class="dbnote">Showing files made by this app. Set up the Drive helper in Settings to see your whole Drive.</small>');
}
function draw() {
  if (!w) return; drawCrumbs(); drawClip();
  w.querySelector('#dbView').textContent = view === 'grid' ? '☰ List' : '▦ Grid';
  const body = w.querySelector('.dbbody'); body.innerHTML = '';
  if (!items.length) { body.innerHTML = '<p class="empty">This folder is empty.</p>'; return; }
  const box = document.createElement('div'); box.className = view === 'grid' ? 'dbgrid' : 'dblist';
  for (const f of items) {
    const k = kindOf(f), el = document.createElement('div'); el.className = 'dbitem ' + k; el.tabIndex = 0; el.setAttribute('role', 'button');
    const thumb = f.thumbnailLink && view === 'grid' ? `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(f.thumbnailLink)}">` : `<span class="ic" aria-hidden="true">${ICON[k]}</span>`;
    el.innerHTML = `<div class="th">${thumb}</div><div class="nm"><strong title="${esc(f.name)}">${esc(f.name)}</strong><span>${k === 'folder' ? 'Folder' : [fmtSize(+f.size), fmtDate(f.modifiedTime)].filter(Boolean).join(' · ')}</span></div><button class="more" aria-label="Options for ${esc(f.name)}">⋯</button>`;
    const img = el.querySelector('img'); if (img) img.onerror = () => { img.replaceWith(Object.assign(document.createElement('span'), { className: 'ic', textContent: ICON[k] })); };
    let held = false, tm = 0;
    el.addEventListener('pointerdown', e => { if (e.target.closest('.more')) return; held = false; tm = setTimeout(() => { held = true; navigator.vibrate && navigator.vibrate(20); menu(f, el); }, 480); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => el.addEventListener(t, () => clearTimeout(tm)));
    el.addEventListener('pointermove', e => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) clearTimeout(tm); });
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.onclick = e => { if (held || e.target.closest('.more')) return; k === 'folder' ? into(f) : preview(f); };
    el.onkeydown = e => { if (e.key === 'Enter') el.click(); };
    el.querySelector('.more').onclick = e => { e.stopPropagation(); menu(f, e.currentTarget); };
    box.appendChild(el);
  }
  body.appendChild(box);
}

let mEl = null;
function closeMenu() { if (mEl) { mEl.remove(); mEl = null; } }
function menu(f, anchor) {
  closeMenu(); mEl = document.createElement('div'); mEl.className = 'pop dbmenu'; mEl.setAttribute('role', 'menu');
  const opts = [
    f.mimeType === FOLDER ? ['Open', () => into(f)] : ['Preview', () => preview(f)],
    ['Open in Google Drive', () => window.open(f.webViewLink || `https://drive.google.com/open?id=${f.id}`, '_blank')],
    ['Rename', () => rename(f)],
    ['Move', () => setClip('move', f)],
    ['Make a copy', () => setClip('copy', f)],
    ['Delete', () => del(f), 'danger'],
  ];
  for (const [t, fn, c] of opts) { const b = document.createElement('button'); b.textContent = t; b.setAttribute('role', 'menuitem'); if (c) b.className = c; b.onclick = () => { closeMenu(); fn(); }; mEl.appendChild(b); }
  w.appendChild(mEl);
  const r = anchor.getBoundingClientRect(), mw = 220, mh = opts.length * 44 + 12;
  mEl.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw)) + 'px';
  mEl.style.top = (r.bottom + mh < innerHeight - 8 ? r.bottom + 4 : Math.max(8, r.top - mh - 4)) + 'px';
  setTimeout(() => addEventListener('pointerdown', function h(e) { if (mEl && !mEl.contains(e.target)) { closeMenu(); removeEventListener('pointerdown', h, true); } }, true), 0);
  mEl.querySelector('button').focus();
}

async function act(fn, done) {
  if (busy) return; busy = true; w.classList.add('busy');
  try { await fn(); done && opt.toast(done); await go(crumbs.length - 1, true); }
  catch (e) { opt.toast(e.message); }
  finally { busy = false; w && w.classList.remove('busy'); }
}
async function rename(f) {
  const n = await ask('Rename', 'New name', f.name); if (!n || n === f.name) return;
  await act(async () => ok(await patch(f.id, { name: n }), 'Could not rename'), 'Renamed in Drive');
}
async function del(f) {
  const yes = await ask('Delete from Drive?', null, null, `<b>${esc(f.name)}</b>${f.mimeType === FOLDER ? ' and everything inside it' : ''} will be moved to the bin in your Google Drive. You can restore it from drive.google.com (Bin) for 30 days.`, 'Delete');
  if (!yes) return;
  await act(async () => ok(await patch(f.id, { trashed: true }), 'Could not delete'), 'Deleted from Drive');
}
function setClip(mode, f) { clip = { mode, f, from: cur().id }; drawClip(); opt.toast('Open the folder you want, then tap “' + (mode === 'move' ? 'Move here' : 'Copy here') + '”'); }
function drawClip() {
  const c = w.querySelector('.dbclip'); if (!clip) { c.hidden = true; return; }
  c.hidden = false; c.innerHTML = `<span>${clip.mode === 'move' ? 'Moving' : 'Copying'} <b>${esc(clip.f.name)}</b>. Open the folder you want, then:</span><button class="primary" id="dbHere">${clip.mode === 'move' ? 'Move here' : 'Copy here'}</button><button class="ghost" id="dbCancel">Cancel</button>`;
  c.querySelector('#dbCancel').onclick = () => { clip = null; drawClip(); };
  c.querySelector('#dbHere').onclick = async () => {
    const { mode, f, from } = clip, dest = cur().id;
    if (crumbs.some(x => x.id === f.id)) return opt.toast('A folder cannot go inside itself. Pick another folder.');
    if (mode === 'move' && dest === from) return opt.toast('It is already in this folder.');
    clip = null;
    if (mode === 'move') await act(async () => ok(await patch(f.id, {}, `&addParents=${dest}&removeParents=${(f.parents || [from]).join(',')}`), 'Could not move'), 'Moved in Drive');
    else { let n = 0; await act(async () => { await copyItem(f, dest, () => { n++; if (n % 3 === 1) opt.toast('Copying… ' + n); }); }, 'Copied in Drive'); }
  };
}

function preview(f) {
  const k = kindOf(f), p = document.createElement('div'); p.className = 'modalWrap dbprev';
  p.innerHTML = `<div class="modal dbpv" role="dialog" aria-modal="true" aria-label="${esc(f.name)}"><div class="dbtop"><h2>${esc(f.name)}</h2><div class="dbacts">
    ${k === 'pdf' || k === 'image' ? '<button class="primary" id="pvBoard">Open on a board</button>' : ''}<button class="ghost" id="pvDrive">Open in Drive</button><button class="ghost" id="pvX">Close</button></div></div>
    <iframe title="Preview of ${esc(f.name)}" src="https://drive.google.com/file/d/${f.id}/preview" allow="autoplay; fullscreen" allowfullscreen></iframe>
    <p class="help">If the preview stays blank, sign in to Google in Chrome once, or tap Open in Drive.</p></div>`;
  document.body.appendChild(p);
  const x = () => p.remove();
  p.querySelector('#pvX').onclick = x; p.addEventListener('pointerdown', e => { if (e.target === p) x(); });
  p.querySelector('#pvDrive').onclick = () => window.open(f.webViewLink || `https://drive.google.com/open?id=${f.id}`, '_blank');
  const b = p.querySelector('#pvBoard');
  if (b) b.onclick = async () => {
    b.disabled = true; b.textContent = 'Downloading…';
    try {
      const r = await drive.api(`${API}/${f.id}?alt=media`); if (!r.ok) await ok(r, 'Could not download');
      const blob = await r.blob(); const file = new File([blob], f.name, { type: f.mimeType });
      x(); close(); opt.openFile(file);
    } catch (e) { opt.toast(e.message); b.disabled = false; b.textContent = 'Open on a board'; }
  };
}

// small text / confirm box in the app's own style
function ask(title, label, value, html, okText = 'Save') {
  return new Promise(res => {
    const m = document.createElement('div'); m.className = 'modalWrap'; m.style.zIndex = 60;
    m.innerHTML = `<form class="modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2>${html ? `<p class="help">${html}</p>` : ''}${label ? `<label>${esc(label)}<input name="v" autocomplete="off"></label>` : ''}
      <div class="row"><button class="primary${okText === 'Delete' ? ' danger' : ''}" type="submit">${esc(okText)}</button><button class="ghost" type="button" data-x>Cancel</button></div></form>`;
    document.body.appendChild(m);
    const inp = m.querySelector('input'); if (inp) { inp.value = value || ''; inp.focus(); inp.select(); } else m.querySelector('button').focus();
    const done = v => { m.remove(); res(v); };
    m.querySelector('[data-x]').onclick = () => done(null);
    m.querySelector('form').onsubmit = e => { e.preventDefault(); done(inp ? inp.value.trim() : true); };
  });
}
