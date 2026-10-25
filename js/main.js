import * as store from './store.js';
import * as board from './board.js';
import * as bg from './bg.js';
import * as cam from './cam.js';
import * as rec from './rec.js';
import { LEVELS, topicId } from './syllabus.js';
import * as drive from './drive.js';
import * as ide from './ide.js';
import { notesPdf } from './export.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let cfg = { pageBg: '#0f0f13', pagePat: 'lined', finger: false, level: 'ol', last: null };
let topic = null;

/* ---------- toast ---------- */
let toastT = 0;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }
const saveCfg = () => store.put('kv', 'cfg', cfg).catch(() => {});

/* ---------- topics ---------- */
async function customTopics() { return (await store.get('kv', 'custom')) || []; }
// Your own names for chapters and topics (notes stay linked to the original topic, so renaming never loses anything)
let NAMES = { ch: {}, tp: {}, hide: [] };
async function loadNames() { NAMES = Object.assign({ ch: {}, tp: {}, hide: [] }, (await store.get('kv', 'names')) || {}); }
const saveNames = () => store.put('kv', 'names', NAMES);
const chName = (lv, ch) => NAMES.ch[lv + ':' + ch.n] || ch.name;
const tpName = (id, name) => NAMES.tp[id] || name;
let libEdit = false;
async function allTopics() {
  const out = []; const custom = await customTopics();
  for (const lv of LEVELS) for (const p of lv.papers) for (const ch of p.chapters) {
    const names = [...ch.topics, ...custom.filter(c => c.lv === lv.id && c.ch === ch.n).map(c => c.name)];
    for (const name of names) { const id = topicId(lv.id, name); if (NAMES.hide.includes(id)) continue; out.push({ id, name: tpName(id, name), level: lv.id, levelName: lv.name, chips: lv.chips, chapter: ch.n, chapterName: chName(lv.id, ch), paper: p.id }); }
  }
  return out;
}
const QUICK = { id: 'quick', name: 'Quick Board', level: 'ol', levelName: '', chips: LEVELS[0].chips, chapter: 0, chapterName: '' };
function codeTopic(lv, prog) {
  const L = LEVELS.find(l => l.id === lv) || LEVELS[0];
  return prog ? { id: `code:${lv}:${prog}`, name: `${prog} (annotated)`, level: lv, levelName: L.name, chips: L.chips, chapter: 0, chapterName: 'Code Lab', codeLab: true, prog }
    : { id: 'codelab:' + lv, name: 'Code Lab · ' + L.name, level: lv, levelName: L.name, chips: L.chips, chapter: 0, chapterName: 'Code Lab', codeLab: true };
}
async function findTopic(id) {
  if (id === 'quick') return QUICK;
  if (id.startsWith('codelab:')) return codeTopic(id.slice(8));
  if (id.startsWith('code:')) { const [, lv, ...rest] = id.split(':'); return codeTopic(lv, rest.join(':')); }
  return (await allTopics()).find(t => t.id === id) || null; }

let codeLab = null;   // level id while the Code Lab is open
function setHeader(title, chips) {
  $('#title').textContent = title;
  const el = $('#chips'); el.innerHTML = ''; (chips || []).forEach(c => { const s = document.createElement('span'); s.textContent = c; el.appendChild(s); });
}
async function openCodeLab(lv) {
  await board.flush();
  if (!history.state || history.state.v !== 'board') history.pushState({ v: 'board' }, '');
  codeLab = lv; topic = codeTopic(lv); setHeader(topic.name, topic.chips); $('#backCode').hidden = true;
  $('#lib').hidden = true; document.body.classList.remove('libopen'); setMode('code');
}
// turn the current program into PDF pages and open them as a pen board
async function startAnnotate() {
  if (!codeLab || $('#ide').hidden) return; const L = LEVELS.find(l => l.id === codeLab);
  toast('Making pages from your code…');
  const snap = await ide.snapshotPdf(L.name); if (!snap) { toast('Open a program first'); return; }
  await board.flush(); topic = codeTopic(codeLab, snap.prog);
  setHeader(`${snap.name} · ${snap.lang === 'py' ? 'Python' : 'Pseudocode'}`, topic.chips);
  await board.load(topic); setMode('board'); $('#backCode').hidden = false; $('#hint').style.opacity = 0;
  if (board.pageCount() > 1 || (board.currentPage() && board.currentPage().k === 'pdf')) board.goPage(board.pageCount() - 1);
  await board.importPdf(new File([snap.blob], snap.name + '.pdf', { type: 'application/pdf' }));
}
async function backToCode() { await board.flush(); topic = codeTopic(codeLab); setHeader(topic.name, topic.chips); $('#backCode').hidden = true; setMode('code'); }
async function openTopic(t) {
  await board.flush();
  if (!history.state || history.state.v !== 'board') history.pushState({ v: 'board' }, '');
  codeLab = null; $('#backCode').hidden = true; setMode('board');
  topic = t; cfg.last = t.id; saveCfg();
  $('#title').textContent = t.chapter ? `${t.name.replace(/^\d+(\.\d+)?\s+/, '')} · Chapter ${t.chapter}` : t.name;
  const chips = $('#chips'); chips.innerHTML = ''; (t.chips || []).forEach(c => { const s = document.createElement('span'); s.textContent = c; chips.appendChild(s); });
  $('#lib').hidden = true; document.body.classList.remove('libopen');
  const has = await board.load(t); $('#hint').style.opacity = has ? 0 : 1;
}

/* ---------- library ---------- */
let libView = 'topics';
async function showLib(fromBack) {
  if (fromBack !== true && history.state && history.state.v === 'board') { history.back(); return; }
  document.querySelectorAll('.modalWrap').forEach(m => m.remove());
  await board.flush();
  $('#lib').hidden = false; document.body.classList.add('libopen'); renderLib();
}
async function renderLib() {
  const metas = Object.fromEntries((await store.getPrefix('kv', 'm:')).map(([k, v]) => [k.slice(2), v]));
  const recs = (await store.all('recs')).map(([, v]) => v);
  const recCount = {}; recs.forEach(r => recCount[r.topicId] = (recCount[r.topicId] || 0) + 1);
  // continue card
  const cont = $('#cont'); cont.innerHTML = '';
  if (cfg.last) { const t = await findTopic(cfg.last); if (t) {
    const b = document.createElement('button'); b.className = 'cont';
    const m = metas[t.id];
    b.innerHTML = `<div><small>CONTINUE</small><strong>${esc(t.name)}</strong></div><span class="meta">${t.chapterName ? esc(t.levelName + ' · ' + t.chapterName) : ''}${m ? ' · ' + m.pages + (m.pages === 1 ? ' page' : ' pages') : ''}</span>`;
    b.onclick = () => openTopic(t); cont.appendChild(b); } }
  $('#recsBtn').classList.toggle('primary', libView === 'recs'); $('#upsBtn').classList.toggle('primary', libView === 'ups');
  if (libView === 'ups') { $('#tabs').hidden = true; $('#libbody').innerHTML = ''; $('#libsub').textContent = 'Files waiting for, or already sent to, Google Drive'; return renderUploads($('#libbody')); }
  const tabs = $('#tabs'), body = $('#libbody'); body.innerHTML = '';
  if (libView === 'recs') { tabs.hidden = true; $('#libsub').textContent = 'Every class you recorded, newest first'; return renderRecs(body, recs); }
  tabs.hidden = false; $('#libsub').textContent = 'Pick a topic to open its notes';
  tabs.innerHTML = '';
  LEVELS.forEach(lv => { const b = document.createElement('button'); b.role = 'tab'; b.textContent = lv.name; b.setAttribute('aria-selected', cfg.level === lv.id); b.onclick = () => { cfg.level = lv.id; saveCfg(); renderLib(); }; tabs.appendChild(b); });
  const q = $('#search').value.trim().toLowerCase();
  const custom = await customTopics(); await loadNames();
  $('#editBtn').classList.toggle('primary', libEdit); $('#editBtn').textContent = libEdit ? 'Done editing' : 'Edit names';
  const levels = q ? LEVELS : LEVELS.filter(l => l.id === cfg.level);
  if (!q && !libEdit) {
    const lv = LEVELS.find(l => l.id === cfg.level), progs = (await store.getPrefix('kv', 'cp:' + lv.id + ':')).length;
    const cl = document.createElement('button'); cl.className = 'codecard';
    cl.innerHTML = `<span class="cic"><svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15"/></svg></span><span><small>CODE LAB · ${esc(lv.name.toUpperCase())}</small><strong>${lv.id === 'a2' ? 'Python' : 'Pseudocode and Python'}</strong><em>Write, run and annotate programs. Text files included.</em></span><span class="meta">${progs ? progs + (progs === 1 ? ' program' : ' programs') : 'Open'}</span>`;
    cl.onclick = () => openCodeLab(lv.id); body.appendChild(cl);
  }
  let shown = 0;
  for (const lv of levels) for (const p of lv.papers) {
    const sec = document.createElement('section'); sec.className = 'paper';
    sec.innerHTML = `<h2>${esc(q ? lv.name + ' · ' : '')}${esc(p.name)}</h2>`; const grid = document.createElement('div'); grid.className = 'chgrid'; sec.appendChild(grid);
    for (const ch of p.chapters) {
      const names = [...ch.topics, ...custom.filter(c => c.lv === lv.id && c.ch === ch.n).map(c => c.name)];
      const cName = chName(lv.id, ch);
      const visible = names.filter(n => !NAMES.hide.includes(topicId(lv.id, n)));
      const match = visible.filter(n => !q || tpName(topicId(lv.id, n), n).toLowerCase().includes(q) || cName.toLowerCase().includes(q));
      if (q && !match.length) continue;
      const card = document.createElement('div'); card.className = 'ch';
      card.innerHTML = `<h3><b>${String(ch.n).padStart(2, '0')}</b><span class="cn">${esc(cName)}</span></h3>`;
      if (libEdit) {
        const pen = document.createElement('button'); pen.className = 'mini'; pen.textContent = 'Rename'; card.querySelector('h3').appendChild(pen);
        pen.onclick = () => inlineEdit(card.querySelector('h3 .cn'), cName, async v => { if (v && v !== ch.name) NAMES.ch[lv.id + ':' + ch.n] = v; else delete NAMES.ch[lv.id + ':' + ch.n]; await saveNames(); renderLib(); });
      }
      for (const orig of match) {
        const id = topicId(lv.id, orig), name = tpName(id, orig), m = metas[id], rc = recCount[id] || 0; shown++;
        const b = document.createElement(libEdit ? 'div' : 'button'); b.className = 'tp';
        const meta = [m ? m.pages + (m.pages === 1 ? ' PAGE' : ' PAGES') : '', rc ? rc + ' REC' : ''].filter(Boolean).join(' · ');
        b.innerHTML = `<span class="nm">${esc(name)}</span><span class="mt ${m && m.strokes ? 'has' : ''}">${meta || 'NEW'}</span>`;
        if (libEdit) {
          const rn = document.createElement('button'); rn.className = 'mini'; rn.textContent = 'Rename';
          rn.onclick = () => inlineEdit(b.querySelector('.nm'), name, async v => { if (v && v !== orig) NAMES.tp[id] = v; else delete NAMES.tp[id]; await saveNames(); renderLib(); });
          const hd = document.createElement('button'); hd.className = 'mini danger'; hd.textContent = 'Hide';
          hd.onclick = async () => { NAMES.hide.push(id); await saveNames(); toast('Topic hidden. Its notes are kept; “Show hidden” brings it back.'); renderLib(); };
          b.append(rn, hd);
        } else b.onclick = () => openTopic({ id, name, level: lv.id, levelName: lv.name, chips: lv.chips, chapter: ch.n, chapterName: cName, paper: p.id });
        card.appendChild(b);
      }
      const hidden = names.filter(n => NAMES.hide.includes(topicId(lv.id, n)));
      if (libEdit && hidden.length) { const sh = document.createElement('button'); sh.className = 'addt'; sh.textContent = `Show hidden (${hidden.length})`;
        sh.onclick = async () => { NAMES.hide = NAMES.hide.filter(x => !hidden.some(n => topicId(lv.id, n) === x)); await saveNames(); renderLib(); }; card.appendChild(sh); }
      if (!q) {
        const add = document.createElement('button'); add.className = 'addt'; add.textContent = '+ Add a topic';
        add.onclick = () => {
          const row = document.createElement('div'); row.className = 'addrow';
          row.innerHTML = `<input placeholder="e.g. ${ch.n}.${ch.topics.length + 1} Revision" aria-label="New topic name"><button class="primary">Add</button>`;
          add.replaceWith(row); const inp = row.querySelector('input'); inp.focus();
          const go = async () => { const v = inp.value.trim(); if (!v) return renderLib(); const c = await customTopics(); c.push({ lv: lv.id, ch: ch.n, name: v }); await store.put('kv', 'custom', c); renderLib(); };
          row.querySelector('button').onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); };
        };
        card.appendChild(add);
      }
      grid.appendChild(card);
    }
    if (grid.children.length) body.appendChild(sec);
  }
  if (!shown && q) body.innerHTML = `<p class="empty">No topic matches “${esc(q)}”.</p>`;
}
const fmtDur = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(0) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
function renderRecs(body, recs) {
  recs.sort((a, b) => b.started - a.started);
  if (!recs.length) { body.innerHTML = '<p class="empty">No recordings yet. Open a topic and tap the red record button on the left.</p>'; return; }
  const list = document.createElement('div'); list.className = 'recs';
  for (const r of recs) {
    const row = document.createElement('div'); row.className = 'recrow';
    const d = new Date(r.started);
    row.innerHTML = `<div class="info"><strong>${esc(r.topic)}</strong><span>${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · ${fmtDur(r.dur)} · ${fmtSize(r.size)}${r.status === 'recording' ? ' · recording now' : ''}${r.note ? ' · ' + esc(r.note) : ''}</span></div><div class="acts"></div>`;
    const acts = row.querySelector('.acts');
    const mk = (txt, cls, fn) => { const b = document.createElement('button'); b.className = cls; b.textContent = txt; b.onclick = fn; acts.appendChild(b); return b; };
    if (r.status !== 'recording') {
      mk('Play', 'ghost', () => playRec(r));
      if (r.drive) mk('On Drive ✓', 'ghost', () => r.drive.startsWith('http') && window.open(r.drive, '_blank'));
      else mk('Send to Drive', 'ghost', async () => { await queueRec(r); renderLib(); });
      mk('Save to tablet', 'ghost', () => saveRec(r));
      const del = mk('Delete', 'ghost danger', () => {
        acts.innerHTML = '<span>Delete this recording?</span>';
        mk('Yes, delete', 'ghost danger', async () => { await rec.remove(r.id); renderLib(); toast('Recording deleted'); });
        mk('Keep', 'ghost', () => renderLib());
      });
    }
    list.appendChild(row);
  }
  body.appendChild(list);
}
function recName(r) { const d = new Date(r.started); const ext = r.mime.includes('mp4') ? 'mp4' : 'webm'; return `CSwithSR ${r.topic.replace(/[\\/:*?"<>|]/g, '')} ${d.toISOString().slice(0, 10)}.${ext}`; }
async function saveRec(r) { const b = await rec.blobFor(r.id); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = recName(r); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); toast('Saving to your Downloads folder'); }
async function playRec(r) {
  const b = await rec.blobFor(r.id); const url = URL.createObjectURL(b);
  const w = document.createElement('div'); w.className = 'modalWrap';
  w.innerHTML = `<div class="modal"><h2>${esc(r.topic)}</h2><video controls playsinline src="${url}"></video><div class="row"><button class="primary">Close</button></div></div>`;
  document.body.appendChild(w); const close = () => { URL.revokeObjectURL(url); w.remove(); };
  w.querySelector('.primary').onclick = close; w.addEventListener('click', e => { if (e.target === w) close(); });
}
$('#search').addEventListener('input', () => { libView = 'topics'; renderLib(); });
$('#quick').onclick = () => openTopic(QUICK);
$('#editBtn').onclick = () => { libEdit = !libEdit; libView = 'topics'; renderLib(); };
function inlineEdit(el, value, done) {
  const inp = document.createElement('input'); inp.value = value; inp.className = 'inl'; inp.setAttribute('aria-label', 'New name');
  el.replaceWith(inp); inp.focus(); inp.select(); let fin = false;
  const go = () => { if (fin) return; fin = true; done(inp.value.trim()); };
  inp.onkeydown = e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') { fin = true; renderLib(); } }; inp.onblur = go;
}
$('#recsBtn').onclick = () => { libView = libView === 'recs' ? 'topics' : 'recs'; renderLib(); };
$('#upsBtn').onclick = () => { libView = libView === 'ups' ? 'topics' : 'ups'; renderLib(); };

/* ---------- rails ---------- */
const IC = {
  cloud: '<path d="M7 18.5a4.5 4.5 0 01-.6-9A6 6 0 0118 8.5a4 4 0 01-.5 10"/><path d="M12 12v8M9 15l3-3 3 3"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  cam: '<rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5"/>',
  rec: '<circle cx="12" cy="12" r="7"/>', stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  lasso: '<path d="M12 4c5 0 9 2.6 9 6s-4 6-9 6c-1.4 0-2.7-.2-3.8-.5"/><path d="M5.2 13.8C3.8 12.8 3 11.5 3 10c0-3.4 4-6 9-6" stroke-dasharray="2.5 2.5"/><path d="M6 15c-1.5 1-1.8 2.8-.5 3.8 1 .8 2.5.4 3-1"/>',
  shape: '<rect x="3" y="11" width="9" height="9" rx="1"/><circle cx="16.5" cy="7.5" r="4.5"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15"/>',
  pen: '<path d="M4 20l4.5-1L19 8.5 15.5 5 5 15.5 4 20z"/><path d="M13.5 7l3.5 3.5"/>',
  hl: '<path d="M14.5 4.5l5 5-7.5 7.5h-5v-5z"/><path d="M7 17l-3 3h6"/>',
  erase: '<path d="M8 20h12"/><path d="M4.5 15.5l9-9 6 6-7.5 7.5H8.5z"/><path d="M9 11l6 6"/>',
  laser: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
  page: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M12.5 10.5v7M9 14h7"/>',
  pdf: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14.5 3v4.5H19"/><path d="M9 13h6M9 16.5h4"/>',
  fit: '<path d="M3 12h18"/><path d="M6.5 8.5L3 12l3.5 3.5M17.5 8.5L21 12l-3.5 3.5"/>',
  clear: '<path d="M4 7h16M9.5 7V4h5v3"/><path d="M6 7l1 13h10l1-13"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  set: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  hide: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.6 9.6 0 0112 6c6 0 10 6 10 6a16 16 0 01-3.3 3.8M6.6 7.6C3.9 9.4 2 12 2 12s4 6 10 6a9 9 0 004.5-1.2"/>'
};
const svg = k => '<svg viewBox="0 0 24 24">' + IC[k] + '</svg>';
const COLORS = ['#ffffff', '#7CF29A', '#FF5A5A', '#F2B53A', '#5CE1FF', '#4D7CFF', '#111111'];
const CNAMES = ['White', 'Green', 'Red', 'Yellow', 'Cyan', 'Blue', 'Black'];
function btn(parent, html, label, fn) { const b = document.createElement('button'); b.type = 'button'; b.innerHTML = html; b.setAttribute('aria-label', label); b.title = label; b.addEventListener('click', fn); parent.appendChild(b); return b; }
const hr = p => p.appendChild(document.createElement('hr'));
const L = $('#railL'), R = $('#railR'); const colorBtns = [], sizeBtns = [], toolBtns = {};
const homeB = btn(L, svg('home') + '<small>Topics</small>', 'Back to topics', () => showLib()); homeB.classList.add('homeb');
const camBtn = btn(L, svg('cam'), 'Camera', async () => { camBtn.classList.toggle('on', await cam.toggle()); });
const recBtn = btn(L, svg('rec'), 'Start recording', toggleRec); recBtn.classList.add('recb');
const pauseBtn = btn(L, svg('pause'), 'Pause recording', () => rec.pause()); pauseBtn.hidden = true;
const recTime = document.createElement('span'); recTime.className = 'rectime'; recTime.hidden = true; L.appendChild(recTime);
const meter = document.createElement('span'); meter.className = 'meter'; meter.innerHTML = '<b></b>'; meter.hidden = true; L.appendChild(meter);
const shareB = btn(L, svg('cloud'), 'Send this class to Drive', openShare);
hr(L);
COLORS.forEach((c, i) => colorBtns.push(btn(L, `<span class="sw" style="background:${c}"></span>`, CNAMES[i] + ' ink', () => {
  if (!$('#ide').hidden) { startAnnotate(); }
  if (board.hasSel()) { board.selRecolor(c); return; }
  board.tool.c = c; if (['erase', 'laser', 'lasso'].includes(board.tool.t)) board.tool.t = 'pen'; paint(); })));
hr(L);
board.SIZES.forEach((s, i) => sizeBtns.push(btn(L, `<span class="dot" style="width:${5 + i * 4}px;height:${5 + i * 4}px"></span>`, ['Fine', 'Medium', 'Bold'][i] + ' line', () => { board.tool.sz = i; paint(); })));
[['pen', 'Pen'], ['hl', 'Highlighter'], ['shape', 'Shapes'], ['lasso', 'Select and move'], ['erase', 'Eraser'], ['laser', 'Laser pointer']].forEach(([k, l]) => toolBtns[k] = btn(R, svg(k), l, () => {
  if (!$('#ide').hidden) { startAnnotate(); }
  if (k === 'shape' && board.tool.t === 'shape') return openShapePop(toolBtns.shape);
  if (k === 'erase' && board.tool.t === 'erase') return openEraserPop(toolBtns.erase);
  board.tool.t = k; if (k !== 'lasso') board.clearSel(); paint(); if (k === 'shape') openShapePop(toolBtns.shape); if (k === 'erase') openEraserPop(toolBtns.erase); }));
hr(R);
btn(R, svg('undo'), 'Undo', board.doUndo); btn(R, svg('redo'), 'Redo', board.doRedo);
hr(R);
const addBtn = btn(R, svg('page'), 'Pages', () => openPop(addBtn));
btn(R, svg('grid'), 'Page overview', openOverview);
btn(R, svg('pdf'), 'Open a PDF', () => $('#file').click());
hr(R);
btn(R, svg('full'), 'Full screen', () => { const d = document; (d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen({ navigationUI: 'hide' })).catch(() => toast('Full screen is not available here.')); });
btn(R, svg('set'), 'Settings and help', openSettings);
btn(R, svg('hide'), 'Hide tools', () => document.body.classList.add('hidden-ui'));
$('#show').onclick = () => document.body.classList.remove('hidden-ui');
function setMode(m) {
  const code = m === 'code'; $('#ide').hidden = !code; $('#board').hidden = code;
  if (code) { board.clearSel(); ide.open(codeLab || 'ol').then(() => ide.prewarm()); }
}
function paint() {
  const t = board.tool;
  colorBtns.forEach((b, i) => b.classList.toggle('on', COLORS[i] === t.c)); sizeBtns.forEach((b, i) => b.classList.toggle('on', i === t.sz));
  Object.entries(toolBtns).forEach(([k, b]) => b.classList.toggle('on', k === t.t)); toolBtns.pen.classList.toggle('auto', !!t.auto); store.put('kv', 'tool', { ...t }).catch(() => {});
}
$('#file').addEventListener('change', e => { const f = e.target.files[0]; if (f) board.importPdf(f); e.target.value = ''; });
let pop = null;
function closePop() { if (pop) { pop.remove(); pop = null; } }
function placePop(anchor) {
  document.body.appendChild(pop); const r = anchor.getBoundingClientRect();
  pop.style.top = Math.max(8, Math.min(r.top, innerHeight - pop.offsetHeight - 8)) + 'px'; pop.style.right = (innerWidth - r.left + 8) + 'px';
}
const PAGE_ICONS = { lined: '<path d="M4 8h16M4 12h16M4 16h16"/>', grid: '<path d="M4 8h16M4 12h16M4 16h16M8 4v16M12 4v16M16 4v16"/>', dots: '<circle cx="8" cy="8" r=".6"/><circle cx="12" cy="8" r=".6"/><circle cx="16" cy="8" r=".6"/><circle cx="8" cy="12" r=".6"/><circle cx="12" cy="12" r=".6"/><circle cx="16" cy="12" r=".6"/><circle cx="8" cy="16" r=".6"/><circle cx="12" cy="16" r=".6"/><circle cx="16" cy="16" r=".6"/>', plain: '' };
function openPop(anchor) {
  closePop(); pop = document.createElement('div'); pop.className = 'pop pagepop';
  const cur = board.currentPage() || {}; const isPdf = cur.k === 'pdf';
  const bg = isPdf ? cfg.pageBg : cur.bg, pat = isPdf ? cfg.pagePat : cur.pat;
  pop.innerHTML = `<button class="opt primary" id="pAdd">+ Add a page after this one</button>
    <div class="plabel">Page colour${isPdf ? ' (for new pages)' : ''}</div><div class="swrow" id="pCols"></div>
    <div class="plabel">Page lines</div><div class="swrow" id="pPats"></div>
    <label class="tog small"><input type="checkbox" id="pAll"> Apply to all my pages in this topic</label>
    <div class="prow"><button class="opt" id="pFit">Fit page width</button><button class="opt" id="pClear">Clear writing on this page</button></div>
    <div class="prow"><button class="opt danger" id="pDel">Delete this page</button>${isPdf ? '<button class="opt danger" id="pPdf">Remove this whole PDF</button>' : ''}</div>`;
  const apply = (nb, np) => { cfg.pageBg = nb; cfg.pagePat = np; saveCfg(); if (!isPdf) board.setPageStyle({ bg: nb, pat: np }, pop.querySelector('#pAll').checked); closePop(); };
  const cols = pop.querySelector('#pCols');
  board.PAGE_COLORS.forEach(([c, n]) => { const b = document.createElement('button'); b.className = 'psw' + (c === bg ? ' on' : ''); b.style.background = c; b.title = n; b.setAttribute('aria-label', n + ' page'); b.onclick = () => apply(c, pat); cols.appendChild(b); });
  const custom = document.createElement('label'); custom.className = 'psw custom'; custom.title = 'Any colour'; custom.innerHTML = '<input type="color" aria-label="Pick any page colour">+';
  custom.querySelector('input').value = /^#[0-9a-f]{6}$/i.test(bg) ? bg : '#0f0f13'; custom.querySelector('input').onchange = e => apply(e.target.value, pat); cols.appendChild(custom);
  const pats = pop.querySelector('#pPats');
  board.PATTERNS.forEach(([k, n]) => { const b = document.createElement('button'); b.className = 'ppat' + (k === pat ? ' on' : ''); b.innerHTML = `<svg viewBox="0 0 24 24">${PAGE_ICONS[k]}</svg><span>${n}</span>`; b.onclick = () => apply(bg, k); pats.appendChild(b); });
  pop.querySelector('#pAdd').onclick = () => { board.addPage(isPdf ? { bg: cfg.pageBg, pat: cfg.pagePat } : null); closePop(); };
  pop.querySelector('#pFit').onclick = () => { board.fit(); closePop(); };
  pop.querySelector('#pClear').onclick = () => { if (board.clearPage()) toast('Page cleared. Undo brings it back.'); closePop(); };
  pop.querySelector('#pDel').onclick = e => { const b = e.currentTarget; if (b.dataset.sure) { board.deletePage(); closePop(); } else { b.dataset.sure = 1; b.textContent = 'Tap again to delete'; } };
  if (isPdf) pop.querySelector('#pPdf').onclick = e => { const b = e.currentTarget; if (b.dataset.sure) { board.removePdf(); closePop(); } else { b.dataset.sure = 1; b.textContent = 'Tap again to remove the PDF'; } };
  placePop(anchor);
}
const SHAPES = [['line', 'Line', '<path d="M4 20L20 4"/>'], ['arrow', 'Arrow', '<path d="M4 20L20 4M11 4h9v9"/>'], ['rect', 'Rectangle', '<rect x="3.5" y="6" width="17" height="12" rx="1"/>'], ['ellipse', 'Circle / ellipse', '<ellipse cx="12" cy="12" rx="9" ry="7"/>'], ['tri', 'Triangle', '<path d="M12 4l9 16H3z"/>']];
function openShapePop(anchor) {
  closePop(); pop = document.createElement('div'); pop.className = 'pop';
  pop.innerHTML = '<div class="plabel">Draw a shape</div><div class="swrow" id="shp"></div><label class="tog small"><input type="checkbox" id="auto"> Auto-shape my pen: straightens lines and tidies circles, rectangles and triangles</label>';
  SHAPES.forEach(([k, n, ic]) => { const b = document.createElement('button'); b.className = 'ppat' + (board.tool.shape === k ? ' on' : ''); b.innerHTML = `<svg viewBox="0 0 24 24">${ic}</svg><span>${n}</span>`; b.onclick = () => { board.tool.shape = k; board.tool.t = 'shape'; paint(); closePop(); }; pop.querySelector('#shp').appendChild(b); });
  const au = pop.querySelector('#auto'); au.checked = !!board.tool.auto; au.onchange = () => { board.tool.auto = au.checked; paint(); toast(au.checked ? 'Auto-shape is on for the pen' : 'Auto-shape is off'); };
  placePop(anchor);
}
document.addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target) && !addBtn.contains(e.target) && !toolBtns.shape.contains(e.target) && !toolBtns.erase.contains(e.target)) closePop(); });
function openEraserPop(anchor) {
  closePop(); pop = document.createElement('div'); pop.className = 'pop';
  pop.innerHTML = '<div class="plabel">Eraser</div><div class="swrow" id="erm"></div><div class="plabel">Size (area eraser)</div><div class="swrow" id="ers"></div><p class="phelp">Tip: hold the S Pen side button to erase at any time, touching or hovering.</p>';
  [['stroke', 'Whole stroke', '<path d="M4 17c3-6 5-6 8-2s5 4 8-2"/><path d="M3 3l18 18"/>'], ['area', 'Area', '<circle cx="12" cy="12" r="7"/><path d="M4 18c3-4 6-2 8-6"/>']].forEach(([k, n, ic]) => {
    const b = document.createElement('button'); b.className = 'ppat' + (board.tool.er === k ? ' on' : ''); b.innerHTML = `<svg viewBox="0 0 24 24">${ic}</svg><span>${n}</span>`;
    b.onclick = () => { board.tool.er = k; board.tool.t = 'erase'; paint(); closePop(); }; pop.querySelector('#erm').appendChild(b); });
  ['Small', 'Medium', 'Large'].forEach((n, i) => { const b = document.createElement('button'); b.className = 'ppat' + (board.tool.erSz === i ? ' on' : '');
    b.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="${3 + i * 3.5}"/></svg><span>${n}</span>`;
    b.onclick = () => { board.tool.erSz = i; board.tool.er = 'area'; board.tool.t = 'erase'; paint(); closePop(); }; pop.querySelector('#ers').appendChild(b); });
  placePop(anchor);
}
/* page overview grid */
async function openOverview() {
  await board.flush(); closePop();
  const w = document.createElement('div'); w.className = 'modalWrap';
  w.innerHTML = `<div class="modal ov" role="dialog" aria-modal="true" aria-labelledby="ovH">
    <div class="row"><h2 id="ovH" style="flex:1">Pages</h2><button id="ovSel" hidden>Cancel</button><button id="ovAll" hidden>Select all</button><button class="primary" id="ovClose">Close</button></div>
    <p class="help" id="ovTip">Tap a page to go to it. Press and hold a page to select it, then tap more pages to delete, move or add after them.</p>
    <div class="thumbs big" id="ovGrid"></div>
    <div class="row" id="ovActs" hidden><span id="ovN" class="help"></span><button id="ovUp">Move earlier</button><button id="ovDown">Move later</button><button id="ovAdd">Add page after</button><button class="danger" id="ovDel">Delete selected</button></div>
    <div class="row"><button id="ovEnd">+ Add page at the end</button></div></div>`;
  document.body.appendChild(w); const q = s => w.querySelector(s);
  let selecting = false, picked = new Set();
  const close = () => w.remove(); q('#ovClose').onclick = close; w.addEventListener('click', e => { if (e.target === w) close(); });
  const render = () => {
    const info = board.pageInfo(), grid = q('#ovGrid'); grid.innerHTML = '';
    info.forEach(p => { const b = document.createElement('button'); b.type = 'button'; b.className = 'thumb' + (picked.has(p.i) ? ' on' : '') + (p.i === board.curPage ? ' cur' : '');
      b.setAttribute('aria-label', 'Page ' + (p.i + 1)); b.innerHTML = `<span class="tn">${p.i + 1}</span>${p.kind === 'pdf' ? '<span class="tw pdf">PDF</span>' : ''}`;
      // press and hold a page to start selecting (like Samsung); then taps add or remove pages
      let holdT = 0, held = false;
      b.addEventListener('pointerdown', () => { held = false; clearTimeout(holdT); holdT = setTimeout(() => { held = true; if (!selecting) { selecting = true; picked.clear(); } picked.add(p.i); [...q('#ovGrid').children].forEach((el, i) => el.classList.toggle('on', picked.has(i))); acts(); navigator.vibrate && navigator.vibrate(20); }, 450); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, () => clearTimeout(holdT)));
      b.addEventListener('contextmenu', e => e.preventDefault());
      b.onclick = () => { if (held) { held = false; return; } if (!selecting) { board.goPage(p.i); close(); return; } picked.has(p.i) ? picked.delete(p.i) : picked.add(p.i); b.classList.toggle('on'); acts(); };
      grid.appendChild(b); });
    (async () => { const boxes = [...grid.children]; for (const p of info) { if (!w.isConnected || !boxes[p.i]) return; try { const c = await board.renderPage(p.i, 180); c.className = 'tc'; boxes[p.i].prepend(c); } catch (e) {} } })();
    acts();
  };
  const acts = () => { if (selecting && !picked.size) selecting = false; q('#ovActs').hidden = !selecting; q('#ovSel').hidden = q('#ovAll').hidden = !selecting; q('#ovN').textContent = picked.size + ' selected'; };
  q('#ovSel').onclick = () => { selecting = false; picked.clear(); render(); };
  q('#ovAll').onclick = () => { picked = new Set(board.pageInfo().map(p => p.i)); [...q('#ovGrid').children].forEach(el => el.classList.add('on')); acts(); };
  q('#ovDel').onclick = e => { if (!picked.size) return toast('Pick pages first'); const b = e.currentTarget; if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = `Tap again to delete ${picked.size}`; return; } b.dataset.sure = ''; b.textContent = 'Delete selected'; board.deletePages([...picked]); picked.clear(); render(); };
  q('#ovAdd').onclick = () => { const at = picked.size ? Math.max(...picked) + 1 : board.pageCount(); board.insertPage(at, null); picked.clear(); render(); };
  q('#ovEnd').onclick = () => { board.insertPage(board.pageCount(), null); render(); };
  const shift = d => { if (picked.size !== 1) return toast('Pick one page to move'); const i = [...picked][0], j = i + d; if (j < 0 || j >= board.pageCount()) return; board.movePage(i, j); picked = new Set([j]); render(); };
  q('#ovUp').onclick = () => shift(-1); q('#ovDown').onclick = () => shift(1);
  render();
}
/* selection toolbar */
const selBar = document.createElement('div'); selBar.className = 'selbar'; selBar.hidden = true;
selBar.innerHTML = '<span id="selN"></span><button id="selDup">Duplicate</button><button id="selDel" class="danger">Delete</button><button id="selDone">Done</button>';
document.body.appendChild(selBar);
selBar.querySelector('#selDup').onclick = () => board.selDuplicate();
selBar.querySelector('#selDel').onclick = () => board.selDelete();
selBar.querySelector('#selDone').onclick = () => board.clearSel();
function onSelection(r) {
  if (!r) { selBar.hidden = true; return; }
  selBar.hidden = false; selBar.querySelector('#selN').textContent = r.count + ' selected · tap a colour to recolour';
  const w = selBar.offsetWidth, h = selBar.offsetHeight; let top = r.top - h - 10; if (top < 8) top = Math.min(innerHeight - h - 8, r.bottom + 10);
  selBar.style.left = Math.max(8, Math.min(innerWidth - w - 8, (r.left + r.right) / 2 - w / 2)) + 'px'; selBar.style.top = top + 'px';
}

/* ---------- recording ---------- */
async function toggleRec() {
  if (rec.isRecording()) {
    recBtn.disabled = true; const m = await rec.stop(); recBtn.disabled = false;
    recBtn.innerHTML = svg('rec'); recBtn.classList.remove('live'); recBtn.title = 'Start recording'; recBtn.setAttribute('aria-label', 'Start recording');
    pauseBtn.hidden = recTime.hidden = meter.hidden = true;
    if (m) toast(`Recording saved (${fmtDur(m.dur)}). Find it in the library under Recordings.`);
    return;
  }
  if (!topic) return;
  try { await rec.start(topic); } catch (e) { toast('Recording could not start: ' + e.message); return; }
  recBtn.innerHTML = svg('stop'); recBtn.classList.add('live'); recBtn.title = 'Stop recording'; recBtn.setAttribute('aria-label', 'Stop recording');
  pauseBtn.hidden = recTime.hidden = meter.hidden = false; toast('Recording started');
}
function recStatus(s) {
  if (!s) return; recTime.textContent = (s.paused ? 'II ' : '') + fmtDur(s.t);
  meter.firstChild.style.width = Math.round(s.level * 100) + '%';
  pauseBtn.classList.toggle('on', s.paused); pauseBtn.innerHTML = s.paused ? svg('rec') : svg('pause');
}
addEventListener('beforeunload', e => { if (rec.isRecording()) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- settings ---------- */
async function openSettings() {
  const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const w = document.createElement('div'); w.className = 'modalWrap';
  w.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="st">
   <h2 id="st">Settings</h2>
   <label for="sCamSize">Camera window size<select id="sCamSize"><option value=".14">Small</option><option value=".19">Medium</option><option value=".26">Large</option><option value=".34">Extra large</option></select></label>
   <label for="sShape">Camera window shape<select id="sShape"><option value="rounded">Rounded rectangle</option><option value="circle">Circle</option></select></label>
   <label class="tog" for="sMirror"><input type="checkbox" id="sMirror"> Mirror my camera</label>
   <label class="tog" for="sFinger"><input type="checkbox" id="sFinger"> Let my finger write too (off means a finger only scrolls)</label>
   <h2 style="font-size:16px;margin-top:6px">Google Drive</h2>
   <label for="dClient">Google Client ID<input id="dClient" placeholder="1234…apps.googleusercontent.com" autocomplete="off"></label>
   <label for="dRoot">Main Drive folder name<input id="dRoot"></label>
   <p id="dCheck" class="help"></p>
   <div class="row"><button id="dConn" class="primary">Connect Drive</button><span id="dStat" style="font-size:13px;color:var(--muted)"></span></div>
   <p class="help"><b>Teaching on Zoom:</b> open a topic here, then in Google Meet tap Share screen (or Zoom: Share › Screen). Keep the meeting's own camera off and use this camera button instead.<br>
   <b>Recording your voice:</b> use <b>Google Meet</b> for live classes. It lets this app record your voice while you share the screen. Zoom keeps the microphone to itself during a call, so with Zoom the recording is silent.<br>
   <b>Camera window:</b> drag it to move it, drag its corner to resize it, double-tap it to switch between a rectangle and a circle.<br>
   <b>S Pen:</b> hold the side button while writing to erase. One finger scrolls, two fingers zoom. Pull up past the last page to add a new one.<br>
   <b>S Pen button:</b> if pressing it opens a Samsung menu or does something else, turn off <i>Air command</i> and <i>Air actions</i> in <i>Settings › Advanced features › S Pen</i>, then use the pen test below.<br>
   <b>Recording</b> saves on this tablet even without internet.${est ? ` Space used: ${fmtSize(est.usage || 0)} of ${fmtSize(est.quota || 0)}.` : ''}</p>
   <div class="row"><button id="sPen">Open pen button test</button><button class="primary" id="sDone">Done</button></div></div>`;
  document.body.appendChild(w);
  const q = s => w.querySelector(s);
  q('#sCamSize').value = ['.14', '.19', '.26', '.34'].reduce((a, v) => Math.abs(v - cam.state.w) < Math.abs(a - cam.state.w) ? v : a, '.19'); q('#sShape').value = cam.state.shape; q('#sMirror').checked = cam.state.mirror; q('#sFinger').checked = cfg.finger;
  const close = () => { cam.setSize(+q('#sCamSize').value); cfg.finger = q('#sFinger').checked; cam.setShape(q('#sShape').value); cam.setMirror(q('#sMirror').checked); saveCfg(); w.remove(); };
  const ds = drive.settings(); q('#dClient').value = ds.clientId; q('#dRoot').value = ds.root;
  const dstat = () => { const d = drive.settings(); q('#dStat').textContent = d.email ? 'Connected as ' + d.email : (d.clientId ? 'Not connected yet' : 'Paste your Client ID, then tap Connect'); q('#dConn').textContent = d.email ? 'Reconnect' : 'Connect Drive'; };
  dstat();
  const idOk = v => /^\d{6,}-[a-z0-9]{10,}\.apps\.googleusercontent\.com$/i.test(v);
  const showId = () => { const v = q('#dClient').value.trim(); q('#dCheck').textContent = !v ? '' : idOk(v) ? `Looks right: ${v.length} characters, ends with .apps.googleusercontent.com` : (v.includes('…') || v.includes('...') ? 'This ID was copied shortened (it has “…”). Use the copy icon next to the full Client ID.' : v.startsWith('GOCSPX') ? 'This is the client secret. Copy the Client ID instead.' : 'This does not look like a full Client ID. It should be digits, a dash, letters, then .apps.googleusercontent.com'); q('#dCheck').className = 'help ' + (idOk(v) ? 'ok' : 'bad'); };
  q('#dClient').addEventListener('input', showId); showId();
  const keepDrive = () => drive.saveSettings({ clientId: q('#dClient').value.trim(), root: q('#dRoot').value.trim() || 'CSwithSR Classes' });
  q('#dConn').onclick = async () => { await keepDrive(); try { await drive.signIn(true); toast('Google Drive connected'); } catch (e) { toast(e.message); } dstat(); };
  q('#sDone').onclick = async () => { await keepDrive(); close(); };
  q('#sPen').onclick = async () => { await keepDrive(); close(); penTest(); }; w.addEventListener('click', e => { if (e.target === w) close(); });
}

/* ---------- keep awake, keys ---------- */
let wake = null;
async function keepAwake() { try { if (!wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => wake = null); } } catch (e) {} }
document.addEventListener('pointerdown', keepAwake, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); else board.flush(); });
document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input,select,textarea')) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? board.doRedo() : board.doUndo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); board.doRedo(); }
});

/* ---------- start ---------- */
(async () => {
  Object.assign(cfg, (await store.get('kv', 'cfg').catch(() => null)) || {});
  Object.assign(board.tool, (await store.get('kv', 'tool').catch(() => null)) || {}); await loadNames();
  board.init({ el: $('#board'), canvas: $('#ink'), toast, style: () => ({ bg: cfg.pageBg, pat: cfg.pagePat }), selection: onSelection, penInfo: t => { const el = document.getElementById('penInfo'); if (el) el.textContent = t; }, pullHint: pullHint, finger: () => cfg.finger, closePop,
    hint: v => { $('#hint').style.opacity = v ? 1 : 0; }, page: (c, n) => { $('#pg').textContent = c + ' / ' + n; } });
  bg.init($('#bg'), () => $('#lib').hidden ? $('#win').getBoundingClientRect() : null);
  await cam.init({ el: $('#cam'), toast });
  await rec.init({ toast, status: recStatus, bgCanvas: bg.canvas, boardCanvas: board.canvas, ideVisible: () => !$('#ide').hidden, drawIde: ctx => ide.drawInto(ctx) });
  ide.init({ toast });
  await drive.init({ blobSource: src => src.type === 'rec' ? rec.blobFor(src.id) : store.get('blobs', src.key) });
  drive.onChange(driveStatus); driveStatus();
  history.replaceState({ v: 'lib' }, '');
  addEventListener('popstate', () => { if ($('#lib').hidden) showLib(true); });
  paint();
  store.persist();
  showLib(true);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();

/* ---------- send a class to Drive ---------- */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayOf = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function levelFolder(t) { const lv = LEVELS.find(l => l.id === t.level); return lv ? `${lv.name.replace(/\//g, '-')} (${lv.code.replace(/ · /g, '-')})` : 'Other'; }
function drivePath(t) { if (t.codeLab) return [levelFolder(t), 'Code Lab', ...(t.prog ? [t.prog] : [])]; return t.id === 'quick' ? ['Quick Board'] : [levelFolder(t), `Chapter ${String(t.chapter).padStart(2, '0')} - ${t.chapterName}`, t.name]; }
function ranges(ix) {
  const out = []; let a = null, b = null; const push = () => out.push(a === b ? `${a + 1}` : `${a + 1}-${b + 1}`);
  for (const i of ix) { if (a === null) { a = b = i; } else if (i === b + 1) b = i; else { push(); a = b = i; } }
  if (a !== null) push(); return out.join(', ');
}
const clean = s => s.replace(/[\\/:*?"<>|]/g, '');
async function queueRec(r) {
  const js = await drive.jobs(); if (js.some(j => j.src.type === 'rec' && j.src.id === r.id && j.status !== 'error')) { toast('Already in the upload list'); return; }
  const t = (await findTopic(r.topicId)) || { id: r.topicId, name: r.topic, level: 'ol', chapter: 0, chapterName: '' };
  const ext = r.mime.includes('mp4') ? 'mp4' : 'webm';
  await drive.enqueue({ kind: 'rec', name: clean(`${r.topic} - ${dayOf(r.started)} - Class recording.${ext}`), mime: r.mime.split(';')[0], path: drivePath(t), src: { type: 'rec', id: r.id }, label: r.topic });
  toast(drive.settings().clientId ? 'Added to the Drive upload list' : 'Added to the upload list. Connect Google Drive in Settings to start sending.');
}
async function openShare() {
  if (!topic) return;
  if (!$('#ide').hidden) { toast('Tap ✎ Annotate (or pick up a pen tool), write your notes, then tap the cloud button to send the PDF.'); return; }
  await board.flush();
  const info = board.pageInfo(), t = topic;
  const touchedIx = info.filter(p => p.touched).map(p => p.i);
  let sel = new Set(); if (touchedIx.length) for (let i = Math.min(...touchedIx); i <= Math.max(...touchedIx); i++) sel.add(i);
  const recs = (await store.all('recs')).map(([, v]) => v).filter(r => r.topicId === t.id && r.status === 'done' && !r.drive).sort((a, b) => b.started - a.started);
  const queued = new Set((await drive.jobs()).filter(j => j.src.type === 'rec').map(j => j.src.id));
  const w = document.createElement('div'); w.className = 'modalWrap';
  w.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="shH">
    <h2 id="shH">Send this class to Drive</h2>
    <p class="help">Goes to <b>${esc([drive.settings().root || 'CSwithSR Classes', ...drivePath(t)].join(' › '))}</b></p>
    <div class="row"><strong style="font-size:14px">Notes pages</strong><span id="shSel" class="help"></span></div>
    <div class="row"><button id="shT1">Pages I wrote on in this class</button><button id="shAll">All pages</button><button id="shNone">None</button></div>
    <div class="thumbs" id="thumbs"></div>
    <div id="shRecs" style="display:grid;gap:8px"></div>
    <div class="row"><button class="primary" id="shGo">Send to Drive</button><button id="shSave">Save PDF to tablet</button><button id="shClose">Cancel</button></div>
  </div>`;
  document.body.appendChild(w); const q = s => w.querySelector(s);
  const close = () => w.remove(); q('#shClose').onclick = close; w.addEventListener('click', e => { if (e.target === w) close(); });
  const boxes = [];
  info.forEach(p => { const b = document.createElement('button'); b.type = 'button'; b.className = 'thumb'; b.setAttribute('aria-label', 'Page ' + (p.i + 1));
    b.innerHTML = `<span class="tn">${p.i + 1}</span>${p.touched ? '<span class="tw">this class</span>' : ''}`;
    b.onclick = () => { sel.has(p.i) ? sel.delete(p.i) : sel.add(p.i); paintSel(); }; q('#thumbs').appendChild(b); boxes.push(b); });
  const paintSel = () => { boxes.forEach((b, i) => b.classList.toggle('on', sel.has(i))); const ix = [...sel].sort((a, b) => a - b);
    q('#shSel').textContent = ix.length ? `${ix.length} selected (pages ${ranges(ix)})` : 'No pages selected'; };
  paintSel();
  q('#shT1').onclick = () => { sel = new Set(touchedIx); paintSel(); if (!touchedIx.length) toast('You have not written on any page since opening this topic'); };
  q('#shAll').onclick = () => { sel = new Set(info.map(p => p.i)); paintSel(); };
  q('#shNone').onclick = () => { sel = new Set(); paintSel(); };
  (async () => { for (const p of info) { if (!w.isConnected) return; try { const c = await board.renderPage(p.i, 150); c.className = 'tc'; boxes[p.i].prepend(c); } catch (e) {} } })();
  if (recs.length) {
    const rr = q('#shRecs'); rr.innerHTML = '<strong style="font-size:14px">Recordings of this topic</strong>'; const td = today();
    recs.forEach(r => { const id = 'r' + r.id, d = new Date(r.started), lab = document.createElement('label'); lab.className = 'tog'; lab.htmlFor = id;
      lab.innerHTML = `<input type="checkbox" id="${id}" ${dayOf(r.started) === td && !queued.has(r.id) ? 'checked' : ''} ${queued.has(r.id) ? 'disabled' : ''}> ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · ${fmtDur(r.dur)} · ${fmtSize(r.size)}${queued.has(r.id) ? ' · already in the upload list' : ''}`;
      lab.querySelector('input').dataset.rid = r.id; rr.appendChild(lab); });
  }
  const makePdf = async () => {
    const ix = [...sel].sort((a, b) => a - b); if (!ix.length) return null; q('#shGo').disabled = q('#shSave').disabled = true;
    try { return { blob: await notesPdf(ix, `${t.name} · ${today()}`, (n, m) => { q('#shSel').textContent = `Making the PDF… page ${n + 1} of ${m}`; }), ix }; }
    finally { q('#shGo').disabled = q('#shSave').disabled = false; }
  };
  const pdfName = ix => clean(`${t.name} - ${today()} - Notes (pages ${ranges(ix)}).pdf`);
  q('#shSave').onclick = async () => { const r = await makePdf(); if (!r) return toast('Pick at least one page');
    const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = pdfName(r.ix); document.body.appendChild(a); a.click(); a.remove(); paintSel(); toast('Saving the PDF to your Downloads folder'); };
  q('#shGo').onclick = async () => {
    const picks = [...w.querySelectorAll('input[data-rid]:checked')].map(i => recs.find(r => r.id === i.dataset.rid));
    if (!sel.size && !picks.length) return toast('Pick pages or a recording to send');
    let n = 0;
    if (sel.size) { const r = await makePdf(); const key = 'up:' + Date.now().toString(36); await store.put('blobs', key, r.blob);
      await drive.enqueue({ kind: 'notes', name: pdfName(r.ix), mime: 'application/pdf', path: drivePath(t), src: { type: 'blob', key }, label: t.name }); n++; }
    for (const r of picks) { await queueRec(r); n++; }
    close(); toast(n + (n > 1 ? ' files' : ' file') + (drive.settings().clientId ? ' added to the Drive upload list' : ' saved for upload. Connect Google Drive in Settings to start sending.'));
  };
}
async function renderUploads(body) {
  const st = drive.status(), list = await drive.jobs(), ds = drive.settings();
  const head = document.createElement('div'); head.className = 'recrow';
  head.innerHTML = `<div class="info"><strong>${ds.email ? 'Google Drive: ' + esc(ds.email) : 'Google Drive is not connected'}</strong><span>${esc(st.msg || (navigator.onLine ? 'All caught up' : 'Offline. Uploads continue when the internet is back.'))}</span></div><div class="acts"></div>`;
  if (!ds.email || st.needsSignIn) { const cb = document.createElement('button'); cb.className = 'primary'; cb.textContent = ds.clientId ? 'Connect Drive' : 'Set up Drive';
    cb.onclick = async () => { if (!ds.clientId) return openSettings(); try { await drive.signIn(true); toast('Drive connected. Uploading.'); } catch (e) { toast(e.message); } renderLib(); };
    head.querySelector('.acts').appendChild(cb); }
  body.appendChild(head);
  if (!list.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Nothing waiting. Use the cloud button on a board to send a class.'; body.appendChild(p); return; }
  const wrap = document.createElement('div'); wrap.className = 'recs';
  for (const j of list.reverse()) {
    const row = document.createElement('div'); row.className = 'recrow'; const pct = j.total ? Math.round(100 * j.offset / j.total) : 0;
    const stTxt = { queued: j.offset ? `Paused at ${pct}%` : 'Waiting', uploading: `Uploading ${pct}%`, done: 'Sent ✓', error: 'Problem: ' + (j.err || '') }[j.status] || j.status;
    row.innerHTML = `<div class="info"><strong>${esc(j.name)}</strong><span>${esc(stTxt)}${j.total ? ' · ' + fmtSize(j.total) : ''}</span><div class="prog"><b style="width:${j.status === 'done' ? 100 : pct}%"></b></div></div><div class="acts"></div>`;
    const a = row.querySelector('.acts'); const mk = (txt, c, f) => { const b = document.createElement('button'); b.className = c; b.textContent = txt; b.onclick = f; a.appendChild(b); };
    if (j.status === 'done' && j.link) mk('Open', 'ghost', () => window.open(j.link, '_blank'));
    if (j.status === 'error') mk('Retry', 'ghost', async () => { await drive.retry(j.id); renderLib(); });
    mk(j.status === 'done' ? 'Clear' : 'Remove', 'ghost', async () => { await drive.remove(j.id); renderLib(); });
    wrap.appendChild(row);
  }
  body.appendChild(wrap);
}
let upT = 0;
function driveStatus() {
  const st = drive.status(); shareB.title = st.msg || 'Send this class to Drive'; shareB.classList.toggle('warn', !!st.needsSignIn);
  if (!$('#lib').hidden && libView === 'ups') { clearTimeout(upT); upT = setTimeout(renderLib, 400); }
}

const pullEl = document.createElement('div'); pullEl.className = 'pullhint'; pullEl.hidden = true; document.getElementById('board').appendChild(pullEl);
function pullHint(v) { pullEl.hidden = !v; pullEl.textContent = v === 2 ? 'Let go to add a new page' : 'Keep pulling to add a page'; pullEl.classList.toggle('ready', v === 2); }

/* pen button test: shows exactly what the S Pen sends to the app */
function penTest() {
  const w = document.createElement('div'); w.className = 'modalWrap';
  w.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="ptH"><h2 id="ptH">Pen button test</h2>
    <p class="help">1. Draw a short line in the box with the pen (no button).<br>2. Now press and hold the side button and draw again, touching the box.<br>3. Hold the button and move the pen just above the box without touching.<br>Then take a screenshot of this window and send it to Claude.</p>
    <div id="ptPad" style="height:200px;border:2px dashed var(--cy);border-radius:12px;touch-action:none;display:grid;place-items:center;color:var(--muted)">Test area</div>
    <pre id="ptLog" style="font:12px var(--mono);background:#0b0726;border-radius:10px;padding:10px;max-height:28vh;overflow:auto;margin:0;white-space:pre-wrap"></pre>
    <div class="row"><button class="primary" id="ptDone">Close</button></div></div>`;
  document.body.appendChild(w);
  const pad = w.querySelector('#ptPad'), log = w.querySelector('#ptLog'); const lines = []; let lastKey = '';
  const add = t => { if (t === lastKey) return; lastKey = t; lines.unshift(t); lines.length = Math.min(lines.length, 40); log.textContent = lines.join('\n'); };
  const ev = e => { const b = e.buttons, k = `${e.type} · ${e.pointerType || '-'} · button ${e.button} · buttons ${b}${e.pressure != null ? ' · pressure ' + (+e.pressure).toFixed(2) : ''}`;
    if (e.type === 'pointermove' && e.pointerType === 'pen' && !b && !lines.length) add('hover detected (pen above screen)'); else if (e.type !== 'pointermove' || b) add(k); };
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'auxclick', 'click'].forEach(t => pad.addEventListener(t, ev));
  pad.addEventListener('contextmenu', e => { e.preventDefault(); add('contextmenu · ' + (e.pointerType || '-') + ' · button ' + e.button); });
  const kd = e => add(`${e.type} · key "${e.key}" · code "${e.code}" · keyCode ${e.keyCode}`);
  addEventListener('keydown', kd, true); addEventListener('keyup', kd, true);
  w.querySelector('#ptDone').onclick = () => { removeEventListener('keydown', kd, true); removeEventListener('keyup', kd, true); w.remove(); };
}

$('#backCode').onclick = backToCode;
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#ideAnn')) startAnnotate(); });
