import * as store from './store.js';
import * as board from './board.js';
import * as bg from './bg.js';
import * as cam from './cam.js';
import * as rec from './rec.js';
import { LEVELS, topicId } from './syllabus.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let cfg = { style: 'dark', finger: false, level: 'ol', last: null };
let topic = null;

/* ---------- toast ---------- */
let toastT = 0;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }
const saveCfg = () => store.put('kv', 'cfg', cfg).catch(() => {});

/* ---------- topics ---------- */
async function customTopics() { return (await store.get('kv', 'custom')) || []; }
async function allTopics() {
  const out = []; const custom = await customTopics();
  for (const lv of LEVELS) for (const p of lv.papers) for (const ch of p.chapters) {
    const names = [...ch.topics, ...custom.filter(c => c.lv === lv.id && c.ch === ch.n).map(c => c.name)];
    for (const name of names) out.push({ id: topicId(lv.id, name), name, level: lv.id, levelName: lv.name, chips: lv.chips, chapter: ch.n, chapterName: ch.name, paper: p.id });
  }
  return out;
}
const QUICK = { id: 'quick', name: 'Quick Board', level: 'ol', levelName: '', chips: LEVELS[0].chips, chapter: 0, chapterName: '' };
async function findTopic(id) { if (id === 'quick') return QUICK; return (await allTopics()).find(t => t.id === id) || null; }

async function openTopic(t) {
  await board.flush();
  topic = t; cfg.last = t.id; saveCfg();
  $('#title').textContent = t.chapter ? `${t.name.replace(/^\d+(\.\d+)?\s+/, '')} · Chapter ${t.chapter}` : t.name;
  const chips = $('#chips'); chips.innerHTML = ''; (t.chips || []).forEach(c => { const s = document.createElement('span'); s.textContent = c; chips.appendChild(s); });
  $('#lib').hidden = true; document.body.classList.remove('libopen');
  const has = await board.load(t); $('#hint').style.opacity = has ? 0 : 1;
}

/* ---------- library ---------- */
let libView = 'topics';
async function showLib() {
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
  $('#recsBtn').classList.toggle('primary', libView === 'recs');
  const tabs = $('#tabs'), body = $('#libbody'); body.innerHTML = '';
  if (libView === 'recs') { tabs.hidden = true; $('#libsub').textContent = 'Every class you recorded, newest first'; return renderRecs(body, recs); }
  tabs.hidden = false; $('#libsub').textContent = 'Pick a topic to open its notes';
  tabs.innerHTML = '';
  LEVELS.forEach(lv => { const b = document.createElement('button'); b.role = 'tab'; b.textContent = lv.name; b.setAttribute('aria-selected', cfg.level === lv.id); b.onclick = () => { cfg.level = lv.id; saveCfg(); renderLib(); }; tabs.appendChild(b); });
  const q = $('#search').value.trim().toLowerCase();
  const custom = await customTopics();
  const levels = q ? LEVELS : LEVELS.filter(l => l.id === cfg.level);
  let shown = 0;
  for (const lv of levels) for (const p of lv.papers) {
    const sec = document.createElement('section'); sec.className = 'paper';
    sec.innerHTML = `<h2>${esc(q ? lv.name + ' · ' : '')}${esc(p.name)}</h2>`; const grid = document.createElement('div'); grid.className = 'chgrid'; sec.appendChild(grid);
    for (const ch of p.chapters) {
      const names = [...ch.topics, ...custom.filter(c => c.lv === lv.id && c.ch === ch.n).map(c => c.name)];
      const match = names.filter(n => !q || n.toLowerCase().includes(q) || ch.name.toLowerCase().includes(q));
      if (q && !match.length) continue;
      const card = document.createElement('div'); card.className = 'ch';
      card.innerHTML = `<h3><b>${String(ch.n).padStart(2, '0')}</b>${esc(ch.name)}</h3>`;
      for (const name of match) {
        const id = topicId(lv.id, name), m = metas[id], rc = recCount[id] || 0; shown++;
        const b = document.createElement('button'); b.className = 'tp';
        const meta = [m ? m.pages + (m.pages === 1 ? ' PAGE' : ' PAGES') : '', rc ? rc + ' REC' : ''].filter(Boolean).join(' · ');
        b.innerHTML = `<span class="nm">${esc(name)}</span><span class="mt ${m && m.strokes ? 'has' : ''}">${meta || 'NEW'}</span>`;
        b.onclick = () => openTopic({ id, name, level: lv.id, levelName: lv.name, chips: lv.chips, chapter: ch.n, chapterName: ch.name, paper: p.id });
        card.appendChild(b);
      }
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
const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(0) + ' MB';
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
$('#recsBtn').onclick = () => { libView = libView === 'recs' ? 'topics' : 'recs'; renderLib(); };

/* ---------- rails ---------- */
const IC = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  cam: '<rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5"/>',
  rec: '<circle cx="12" cy="12" r="7"/>', stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
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
btn(L, svg('home'), 'Lesson library', showLib);
const camBtn = btn(L, svg('cam'), 'Camera', async () => { camBtn.classList.toggle('on', await cam.toggle()); });
const recBtn = btn(L, svg('rec'), 'Start recording', toggleRec); recBtn.classList.add('recb');
const pauseBtn = btn(L, svg('pause'), 'Pause recording', () => rec.pause()); pauseBtn.hidden = true;
const recTime = document.createElement('span'); recTime.className = 'rectime'; recTime.hidden = true; L.appendChild(recTime);
const meter = document.createElement('span'); meter.className = 'meter'; meter.innerHTML = '<b></b>'; meter.hidden = true; L.appendChild(meter);
hr(L);
COLORS.forEach((c, i) => colorBtns.push(btn(L, `<span class="sw" style="background:${c}"></span>`, CNAMES[i] + ' ink', () => { board.tool.c = c; if (board.tool.t === 'erase' || board.tool.t === 'laser') board.tool.t = 'pen'; paint(); })));
hr(L);
board.SIZES.forEach((s, i) => sizeBtns.push(btn(L, `<span class="dot" style="width:${5 + i * 4}px;height:${5 + i * 4}px"></span>`, ['Fine', 'Medium', 'Bold'][i] + ' line', () => { board.tool.sz = i; paint(); })));
[['pen', 'Pen'], ['hl', 'Highlighter'], ['erase', 'Eraser'], ['laser', 'Laser pointer']].forEach(([k, l]) => toolBtns[k] = btn(R, svg(k), l, () => { board.tool.t = k; paint(); }));
hr(R);
btn(R, svg('undo'), 'Undo', board.doUndo); btn(R, svg('redo'), 'Redo', board.doRedo);
hr(R);
const addBtn = btn(R, svg('page'), 'Add page', () => openPop(addBtn));
btn(R, svg('pdf'), 'Open a PDF', () => $('#file').click());
btn(R, svg('fit'), 'Fit page width', board.fit);
btn(R, svg('clear'), 'Clear this page', () => { if (board.clearPage()) toast('Page cleared. Undo brings it back.'); });
hr(R);
btn(R, svg('full'), 'Full screen', () => { const d = document; (d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen({ navigationUI: 'hide' })).catch(() => toast('Full screen is not available here.')); });
btn(R, svg('set'), 'Settings and help', openSettings);
btn(R, svg('hide'), 'Hide tools', () => document.body.classList.add('hidden-ui'));
$('#show').onclick = () => document.body.classList.remove('hidden-ui');
function paint() {
  const t = board.tool;
  colorBtns.forEach((b, i) => b.classList.toggle('on', COLORS[i] === t.c)); sizeBtns.forEach((b, i) => b.classList.toggle('on', i === t.sz));
  Object.entries(toolBtns).forEach(([k, b]) => b.classList.toggle('on', k === t.t)); store.put('kv', 'tool', { ...t }).catch(() => {});
}
$('#file').addEventListener('change', e => { const f = e.target.files[0]; if (f) board.importPdf(f); e.target.value = ''; });
let pop = null;
function closePop() { if (pop) { pop.remove(); pop = null; } }
function openPop(anchor) {
  closePop(); pop = document.createElement('div'); pop.className = 'pop';
  [['dark', 'Dark lined page'], ['white', 'White lined page'], ['grid', 'Dark grid page'], ['plain', 'Dark plain page']].forEach(([k, l]) => {
    const b = document.createElement('button'); b.className = 'opt'; b.textContent = l; b.onclick = () => { board.addPage(k); closePop(); }; pop.appendChild(b); });
  document.body.appendChild(pop); const r = anchor.getBoundingClientRect();
  pop.style.top = Math.max(8, Math.min(r.top, innerHeight - pop.offsetHeight - 8)) + 'px'; pop.style.right = (innerWidth - r.left + 8) + 'px';
}
document.addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target) && !addBtn.contains(e.target)) closePop(); });

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
   <label for="sStyle">Style of new pages<select id="sStyle"><option value="dark">Dark lined</option><option value="white">White lined</option><option value="grid">Dark grid</option><option value="plain">Dark plain</option></select></label>
   <label for="sShape">Camera window shape<select id="sShape"><option value="rounded">Rounded rectangle</option><option value="circle">Circle</option></select></label>
   <label class="tog" for="sMirror"><input type="checkbox" id="sMirror"> Mirror my camera</label>
   <label class="tog" for="sFinger"><input type="checkbox" id="sFinger"> Let my finger write too (off means a finger only scrolls)</label>
   <p class="help"><b>Teaching on Zoom:</b> open a topic here, then in Zoom tap Share › Screen. Keep Zoom's own camera off and use this camera button instead.<br>
   <b>Camera window:</b> drag it to move it, drag its corner to resize it, double-tap it to switch between a rectangle and a circle.<br>
   <b>S Pen:</b> hold the side button to erase. One finger scrolls, two fingers zoom.<br>
   <b>Recording</b> saves on this tablet even without internet.${est ? ` Space used: ${fmtSize(est.usage || 0)} of ${fmtSize(est.quota || 0)}.` : ''}</p>
   <div class="row"><button class="primary" id="sDone">Done</button></div></div>`;
  document.body.appendChild(w);
  const q = s => w.querySelector(s);
  q('#sStyle').value = cfg.style; q('#sShape').value = cam.state.shape; q('#sMirror').checked = cam.state.mirror; q('#sFinger').checked = cfg.finger;
  const close = () => { cfg.style = q('#sStyle').value; cfg.finger = q('#sFinger').checked; cam.setShape(q('#sShape').value); cam.setMirror(q('#sMirror').checked); saveCfg(); w.remove(); };
  q('#sDone').onclick = close; w.addEventListener('click', e => { if (e.target === w) close(); });
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
  Object.assign(board.tool, (await store.get('kv', 'tool').catch(() => null)) || {});
  board.init({ el: $('#board'), canvas: $('#ink'), toast, style: () => cfg.style, finger: () => cfg.finger, closePop,
    hint: v => { $('#hint').style.opacity = v ? 1 : 0; }, page: (c, n) => { $('#pg').textContent = c + ' / ' + n; } });
  bg.init($('#bg'), () => $('#lib').hidden ? $('#win').getBoundingClientRect() : null);
  await cam.init({ el: $('#cam'), toast });
  await rec.init({ toast, status: recStatus, bgCanvas: bg.canvas, boardCanvas: board.canvas });
  paint();
  store.persist();
  showLib();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
