import * as store from './store.js';
import * as board from './board.js';
import * as bg from './bg.js';
import * as cam from './cam.js';
import * as rec from './rec.js';
import { LEVELS, topicId, chLabel, inChapter, baseOf, sibling } from './syllabus.js';
import * as drive from './drive.js';
import * as ide from './ide.js';
import { notesPdf } from './export.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let cfg = { pageBg: '#0f0f13', pagePat: 'lined', finger: false, level: 'ol', last: null };
let topic = null;
let A = board, B2 = null, b2topic = null, selOwner = board;   // A = the window the side bars act on

/* ---------- toast ---------- */
let toastT = 0;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }
const saveCfg = () => store.put('kv', 'cfg', cfg).catch(() => {});

/* ---------- topics ---------- */
async function customTopics() { return (await store.get('kv', 'custom')) || []; }
// Your own names for chapters and topics (notes stay linked to the original topic, so renaming never loses anything)
// trash: deleted chapters/subtopics (data kept until "Delete forever"); gone: deleted forever; order: your drag-and-drop order
let NAMES = { ch: {}, tp: {}, hide: [], trash: [], gone: [], order: { ch: {}, tp: {} } };
async function loadNames() {
  NAMES = Object.assign({ ch: {}, tp: {}, hide: [], trash: [], gone: [], order: { ch: {}, tp: {} } }, (await store.get('kv', 'names')) || {});
  NAMES.order = Object.assign({ ch: {}, tp: {} }, NAMES.order || {});
  if (NAMES.hide.length) { for (const key of NAMES.hide) NAMES.trash.push({ kind: 'topic', key, name: NAMES.tp[key] || key.replace(/^\w+:/, '').replace(/-/g, ' '), at: Date.now() }); NAMES.hide = []; await saveNames(); }
}
const isOut = key => NAMES.trash.some(t => t.key === key) || NAMES.gone.includes(key);
const chKey = (lv, n) => 'ch:' + baseOf(lv) + ':' + n;
function sortedChapters(lv, p) {
  const ord = NAMES.order.ch[baseOf(lv) + ':' + p.id] || [];
  return p.chapters.filter(ch => !isOut(chKey(lv, ch.n))).map((ch, i) => [ch, ord.includes(ch.n) ? ord.indexOf(ch.n) : 1000 + i]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
}
function sortedNames(lv, ch, names) {
  const ord = NAMES.order.tp[baseOf(lv) + ':' + ch.n] || [];
  return names.map((n, i) => [n, ord.includes(nk(lv, n)) ? ord.indexOf(nk(lv, n)) : 1000 + i]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
}
const saveNames = () => store.put('kv', 'names', NAMES);
const chName = (lv, ch) => NAMES.ch[baseOf(lv) + ':' + ch.n] || ch.name;
const nk = (lv, name) => topicId(baseOf(lv), name);   // key for names, hiding and code (shared by both O Level batches)
const tpName = (id, name) => NAMES.tp[id] || name;
let libEdit = false;
async function allTopics() {
  const out = []; const custom = await customTopics();
  for (const lv of LEVELS) for (const p of lv.papers) for (const ch of sortedChapters(lv.id, p)) {
    const names = [...ch.topics, ...(ch.legacy || []), ...custom.filter(c => c.lv === baseOf(lv.id) && inChapter(ch, c.ch)).map(c => c.name)];
    for (const name of names) { const id = topicId(lv.id, name), key = nk(lv.id, name); if (isOut(key)) continue; out.push({ id, orig: name, codeScope: 't:' + key, name: tpName(key, name), level: lv.id, levelName: lv.name, chips: lv.chips, chapter: ch.n, chapterLabel: chLabel(ch), chapterName: chName(lv.id, ch), paper: p.id }); }
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

// codeCtx: which code space is open. scope = a level ("ol", "as", "a2") for the home Code Lab, or "t:<topic>" for a subtopic.
let codeCtx = null;
function setHeader(title, chips) {
  $('#title').textContent = title;
  const el = $('#chips'); el.innerHTML = ''; (chips || []).forEach(c => { const s = document.createElement('span'); s.textContent = c; el.appendChild(s); });
}
const hasCode = t => t && !t.codeLab && (t.paper === 'p2' || t.paper === 'p4');
const shortName = t => t.name.replace(/^\d+(\.\d+)?\s+/, '');
async function openCodeLab(lv) {
  await board.flush();
  if (!history.state || history.state.v !== 'board') history.pushState({ v: 'board' }, '');
  const L = LEVELS.find(l => l.id === lv);
  await closeSplit(); codeCtx = { scope: lv, level: lv, label: 'Code Lab · ' + (lv === 'ol' ? 'O Level' : L.name) };
  topic = codeTopic(lv); setHeader(codeCtx.label, topic.chips); $('#backCode').hidden = true; codeB.hidden = true;
  $('#lib').hidden = true; document.body.classList.remove('libopen'); setMode('code');
}
// the code space of the open subtopic (Paper 2 and Paper 4 only)
async function toggleTopicCode() {
  if (codeCtx && codeCtx.parent) { const p = codeCtx.parent; if (!$('#backCode').hidden) return backToCode(); codeCtx = null; return openTopic(p); }
  if (!hasCode(topic)) return;
  await board.flush();
  codeCtx = { scope: topic.codeScope || 't:' + topic.id, level: baseOf(topic.level), label: `Code · ${shortName(topic)}`, parent: topic };
  setHeader(codeCtx.label, topic.chips); codeB.classList.add('on'); setMode('code');
}
// turn the current program into PDF pages and open them as a pen board
async function startAnnotate() {
  if (!codeCtx || $('#ide').hidden) return; const L = LEVELS.find(l => l.id === codeCtx.level) || LEVELS[0];
  toast('Making pages from your code…');
  const snap = await ide.snapshotPdf(codeCtx.parent ? `${L.name.replace(' · Online', '')} · ${shortName(codeCtx.parent)}` : L.name.replace(' · Online', '')); if (!snap) { toast('Open a program first'); return; }
  await board.flush();
  topic = { id: `code:${codeCtx.scope}:${snap.prog}`, name: `${snap.prog} (annotated)`, level: codeCtx.parent ? codeCtx.parent.level : codeCtx.level, levelName: L.name, chips: (codeCtx.parent || L).chips, chapter: 0, chapterName: 'Code', codeLab: true, prog: snap.prog, parent: codeCtx.parent || null };
  setHeader(`${snap.name} · ${snap.lang === 'py' ? 'Python' : 'Pseudocode'}`, topic.chips);
  await board.load(topic); setMode('board'); $('#backCode').hidden = false; $('#hint').style.opacity = 0;
  const file = new File([snap.blob], snap.name + '.pdf', { type: 'application/pdf' });
  const prev = await store.get('kv', 'annlay:' + topic.id);
  let d;
  if (prev && board.hasPdf(prev.d)) { d = await board.replacePdf(file, prev.d, remapper(prev, snap)); toast('Code updated. Your writing stays next to the same lines.'); }
  else { if (board.pageCount() > 1 || (board.currentPage() && board.currentPage().k === 'pdf')) board.goPage(board.pageCount() - 1); d = await board.importPdf(file); }
  if (d >= 0) await store.put('kv', 'annlay:' + topic.id, { d, lines: snap.lines, layout: snap.layout, W: snap.W, LH: snap.LH });
}
// Works out where each pen stroke moves when the code changes: strokes stay with the code line they were written beside.
function remapper(prev, snap) {
  const A = prev.lines, B = snap.lines, n = A.length, m2 = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m2 + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m2 - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const map = new Array(n).fill(-1); for (let i = 0, j = 0; i < n && j < m2;) { if (A[i] === B[j]) { map[i] = j; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  // edited lines (not exact matches) sitting between two matched lines move with their neighbours
  for (let i = 0; i < n; i++) if (map[i] < 0) { let a = i - 1; while (a >= 0 && map[a] < 0) a--; const base = a >= 0 ? map[a] : -1; const guess = base + (i - a); if (guess < m2 && !map.includes(guess)) map[i] = guess; }
  const px = board.pageUnits() / prev.W, LH = prev.LH;
  const rowAt = (lay, yPx) => { let best = null, bd = 1e9; for (const r of lay) { const c = r.y - LH * .3, dd = Math.abs(c - yPx); if (dd < bd) { bd = dd; best = r; } } return bd <= LH * .9 ? best : null; };
  const findNew = (line, k) => { for (let pi = 0; pi < snap.layout.length; pi++) { const rs = snap.layout[pi].filter(r => r.n === line); if (rs.length) { const r = rs[Math.min(k, rs.length - 1)]; return { pi, y: r.y }; } } return null; };
  return (oi, st) => {
    const lay = prev.layout[oi]; if (!lay) return { page: oi, dy: 0 };
    const cy = (st.bb[1] + st.bb[3]) / 2 / px; const r = rowAt(lay, cy); if (!r) return { page: oi, dy: 0 };
    let ni = map[r.n - 1]; if (ni < 0) { let a = r.n - 2; while (a >= 0 && map[a] < 0) a--; ni = a >= 0 ? map[a] : 0; }
    const hit = findNew(ni + 1, r.k); if (!hit) return { page: oi, dy: 0 };
    return { page: hit.pi, dy: (hit.y - r.y) * px };
  };
}
async function backToCode() { if (!codeCtx) return; await board.flush(); topic = codeCtx.parent || codeTopic(codeCtx.level); setHeader(codeCtx.label, topic.chips); $('#backCode').hidden = true; setMode('code'); }
async function openTopic(t) {
  await board.flush();
  if (!history.state || history.state.v !== 'board') history.pushState({ v: 'board' }, '');
  await closeSplit(); codeCtx = null; $('#backCode').hidden = true; setMode('board');
  codeB.hidden = !hasCode(t); codeB.classList.remove('on');
  topic = t; cfg.last = t.id; saveCfg();
  // second O Level batch: offer to start from the other batch's pages
  const sib = sibling(t.level);
  if (sib && t.orig && !(await store.get('topics', t.id))) {
    const sid = topicId(sib, t.orig), sdoc = await store.get('topics', sid);
    if (sdoc && sdoc.pages && sdoc.pages.some(p => p.k === 'pdf' || (p.s && p.s.length))) {
      const pick = await askCopy(LEVELS.find(l => l.id === sib).name);
      if (pick) await copyTopic(sdoc, t.id, pick === 'all');
    }
  }
  $('#title').textContent = t.chapter ? `${t.name.replace(/^\d+(\.\d+)?\s+/, '')} · Chapter ${(t.chapterLabel || String(t.chapter)).replace(/^0/, '').replace('–0', '–')}` : t.name;
  const chips = $('#chips'); chips.innerHTML = ''; (t.chips || []).forEach(c => { const s = document.createElement('span'); s.textContent = c; chips.appendChild(s); });
  $('#lib').hidden = true; document.body.classList.remove('libopen');
  const has = await board.load(t); $('#hint').style.opacity = has ? 0 : 1;
}

/* ---------- library ---------- */
let libView = 'topics';
async function showLib(fromBack) {
  if (fromBack !== true && history.state && history.state.v === 'board') { history.back(); return; }
  document.querySelectorAll('.modalWrap').forEach(m => m.remove());
  board.clearSel(); if (B2) B2.clearSel(); selBar.hidden = true;
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
  $('#trashBtn').classList.toggle('primary', libView === 'trash');
  $('#recsBtn').classList.toggle('primary', libView === 'recs'); $('#upsBtn').classList.toggle('primary', libView === 'ups');
  if (libView === 'ups') { $('#tabs').hidden = true; $('#libbody').innerHTML = ''; $('#libsub').textContent = 'Files waiting for, or already sent to, Google Drive'; return renderUploads($('#libbody')); }
  const tabs = $('#tabs'), body = $('#libbody'); body.innerHTML = '';
  if (libView === 'recs') { tabs.hidden = true; $('#libsub').textContent = 'Every class you recorded, newest first'; return renderRecs(body, recs); }
  tabs.hidden = false; $('#libsub').textContent = 'Pick a topic to open its notes';
  tabs.innerHTML = '';
  LEVELS.forEach(lv => { const b = document.createElement('button'); b.role = 'tab'; b.textContent = lv.name; b.setAttribute('aria-selected', cfg.level === lv.id); b.onclick = () => { cfg.level = lv.id; saveCfg(); renderLib(); }; tabs.appendChild(b); });
  const q = $('#search').value.trim().toLowerCase();
  const custom = await customTopics(); await loadNames();
  $('#editBtn').classList.toggle('primary', libEdit); $('#editBtn').textContent = libEdit ? 'Done editing' : 'Edit';
  $('#trashBtn').textContent = 'Trash' + (NAMES.trash.length ? ` (${NAMES.trash.length})` : '');
  if (libView === 'trash') { tabs.hidden = true; $('#libsub').textContent = 'Deleted chapters and subtopics. Restore puts them back where they were.'; return renderTrash(body); }
  if (libEdit) { const tip = document.createElement('p'); tip.className = 'help'; tip.textContent = 'Drag ⠿ to change the order. Rename or delete chapters and subtopics; deleted ones go to Trash.'; body.appendChild(tip); }
  const levels = q ? LEVELS : LEVELS.filter(l => l.id === cfg.level);
  if (!q && !libEdit) {
    const lv = LEVELS.find(l => l.id === cfg.level), progs = (await store.getPrefix('kv', 'cp:' + baseOf(lv.id) + ':')).length;
    const cl = document.createElement('button'); cl.className = 'codecard';
    cl.innerHTML = `<span class="cic"><svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15"/></svg></span><span><small>CODE LAB · ${esc(baseOf(lv.id) === 'ol' ? 'O LEVEL (BOTH BATCHES)' : lv.name.toUpperCase())}</small><strong>${lv.id === 'a2' ? 'Python' : 'Pseudocode and Python'}</strong><em>Write, run and annotate programs. Text files included.</em></span><span class="meta">${progs ? progs + (progs === 1 ? ' program' : ' programs') : 'Open'}</span>`;
    cl.onclick = () => openCodeLab(baseOf(lv.id)); body.appendChild(cl);
  }
  let shown = 0;
  for (const lv of levels) for (const p of lv.papers) {
    const sec = document.createElement('section'); sec.className = 'paper';
    sec.innerHTML = `<h2>${esc(q ? lv.name + ' · ' : '')}${esc(p.name)}</h2>`; const grid = document.createElement('div'); grid.className = 'chgrid'; sec.appendChild(grid);
    for (const ch of sortedChapters(lv.id, p)) {
      // old subtopics of merged chapters only show if they already have notes or recordings
      const legacy = (ch.legacy || []).filter(n => { const id = topicId(lv.id, n); return metas[id] || recCount[id]; });
      const names = sortedNames(lv.id, ch, [...ch.topics, ...legacy, ...custom.filter(c => c.lv === baseOf(lv.id) && inChapter(ch, c.ch)).map(c => c.name)]);
      const cName = chName(lv.id, ch);
      const visible = names.filter(n => !isOut(nk(lv.id, n)));
      const match = visible.filter(n => !q || tpName(nk(lv.id, n), n).toLowerCase().includes(q) || cName.toLowerCase().includes(q));
      if (q && !match.length) continue;
      const card = document.createElement('div'); card.className = 'ch'; card.dataset.key = ch.n;
      card.innerHTML = `<h3>${libEdit ? '<span class="dh" aria-label="Drag to move this chapter">⠿</span>' : ''}<b>${chLabel(ch)}</b><span class="cn">${esc(cName)}</span></h3>`;
      const renCh = () => inlineEdit(card.querySelector('h3 .cn'), cName, async v => { const k = baseOf(lv.id) + ':' + ch.n; if (v && v !== ch.name) NAMES.ch[k] = v; else delete NAMES.ch[k]; await saveNames(); renderLib(); });
      const delCh = async () => { NAMES.trash.push({ kind: 'chapter', key: chKey(lv.id, ch.n), base: baseOf(lv.id), n: ch.n, paper: p.id, name: `${chLabel(ch)} ${cName}`, level: lv.name, at: Date.now() }); await saveNames(); toast('Chapter moved to Trash. Restore it from Trash with everything in it.'); renderLib(); };
      const saveChOrder = async keys => { NAMES.order.ch[baseOf(lv.id) + ':' + p.id] = keys.map(Number); await saveNames(); };
      if (!libEdit && !q) holdable(card.querySelector('h3'), card, grid, '.ch', true, saveChOrder, [['Rename chapter', renCh], ['Move to Trash', delCh, true]]);
      if (libEdit) {
        const pen = document.createElement('button'); pen.className = 'mini'; pen.textContent = 'Rename'; card.querySelector('h3').appendChild(pen);
        pen.onclick = () => inlineEdit(card.querySelector('h3 .cn'), cName, async v => { const k = baseOf(lv.id) + ':' + ch.n; if (v && v !== ch.name) NAMES.ch[k] = v; else delete NAMES.ch[k]; await saveNames(); renderLib(); });
        const del = document.createElement('button'); del.className = 'mini danger'; del.textContent = 'Delete'; card.querySelector('h3').appendChild(del);
        del.onclick = async () => { if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = 'Move to Trash?'; return; }
          NAMES.trash.push({ kind: 'chapter', key: chKey(lv.id, ch.n), base: baseOf(lv.id), n: ch.n, paper: p.id, name: `${chLabel(ch)} ${cName}`, level: lv.name, at: Date.now() }); await saveNames(); toast('Chapter moved to Trash. Restore it from Trash with everything in it.'); renderLib(); };
        dragSort(card.querySelector('.dh'), card, grid, '.ch', true, async keys => { NAMES.order.ch[baseOf(lv.id) + ':' + p.id] = keys.map(Number); await saveNames(); });
      }
      for (const orig of match) {
        const id = topicId(lv.id, orig), key = nk(lv.id, orig), name = tpName(key, orig), m = metas[id], rc = recCount[id] || 0; shown++;
        const b = document.createElement(libEdit ? 'div' : 'button'); b.className = 'tp'; b.dataset.key = key;
        const meta = [m ? m.pages + (m.pages === 1 ? ' PAGE' : ' PAGES') : '', rc ? rc + ' REC' : ''].filter(Boolean).join(' · ');
        b.innerHTML = `${libEdit ? '<span class="dh" aria-label="Drag to move this subtopic">⠿</span>' : ''}<span class="nm">${esc(name)}</span><span class="mt ${m && m.strokes ? 'has' : ''}">${meta || 'NEW'}</span>`;
        if (libEdit) {
          const rn = document.createElement('button'); rn.className = 'mini'; rn.textContent = 'Rename';
          rn.onclick = () => inlineEdit(b.querySelector('.nm'), name, async v => { if (v && v !== orig) NAMES.tp[key] = v; else delete NAMES.tp[key]; await saveNames(); renderLib(); });
          const hd = document.createElement('button'); hd.className = 'mini danger'; hd.textContent = 'Delete';
          hd.onclick = async () => { if (!hd.dataset.sure) { hd.dataset.sure = 1; hd.textContent = 'Move to Trash?'; return; }
            NAMES.trash.push({ kind: 'topic', key, base: baseOf(lv.id), ch: ch.n, orig, name, level: lv.name, chapter: cName, at: Date.now() }); await saveNames(); toast('Subtopic moved to Trash. Its notes and code are kept until you delete it forever.'); renderLib(); };
          b.append(rn, hd);
        } else {
          b.onclick = () => { if (b._held) { b._held = false; return; } openTopic({ id, orig, codeScope: 't:' + key, name, level: lv.id, levelName: lv.name, chips: lv.chips, chapter: ch.n, chapterLabel: chLabel(ch), chapterName: cName, paper: p.id }); };
          if (!q) holdable(b, b, card, '.tp', false, async keys => { NAMES.order.tp[baseOf(lv.id) + ':' + ch.n] = keys; await saveNames(); }, [
            ['Rename subtopic', () => inlineEdit(b.querySelector('.nm'), name, async v => { if (v && v !== orig) NAMES.tp[key] = v; else delete NAMES.tp[key]; await saveNames(); renderLib(); })],
            ['Move to Trash', async () => { NAMES.trash.push({ kind: 'topic', key, base: baseOf(lv.id), ch: ch.n, orig, name, level: lv.name, chapter: cName, at: Date.now() }); await saveNames(); toast('Subtopic moved to Trash. Its notes and code are kept until you delete it forever.'); renderLib(); }, true]]);
        }
        card.appendChild(b);
        if (libEdit) dragSort(b.querySelector('.dh'), b, card, '.tp', false, async keys => { NAMES.order.tp[baseOf(lv.id) + ':' + ch.n] = keys; await saveNames(); });
      }
      if (!q) {
        const add = document.createElement('button'); add.className = 'addt'; add.textContent = '+ Add a topic';
        add.onclick = () => {
          const row = document.createElement('div'); row.className = 'addrow';
          row.innerHTML = `<input placeholder="${ch.merged ? 'e.g. Lecture 1: Data types' : 'e.g. ' + ch.n + '.' + (ch.topics.length + 1) + ' Revision'}" aria-label="New topic name"><button class="primary">Add</button>`;
          add.replaceWith(row); const inp = row.querySelector('input'); inp.focus();
          const go = async () => { const v = inp.value.trim(); if (!v) return renderLib(); const c = await customTopics(); c.push({ lv: baseOf(lv.id), ch: ch.n, name: v }); await store.put('kv', 'custom', c); renderLib(); };
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
$('#trashBtn').onclick = () => { libView = libView === 'trash' ? 'topics' : 'trash'; renderLib(); };
// drag a ⠿ handle to reorder items inside their list (grid = chapters laid out in columns)
function dragSort(handle, item, container, selector, grid, done) {
  if (!handle) return; handle.style.touchAction = 'none';
  handle.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); item.classList.add('dragging');
    const mv = ev => {
      const sibs = [...container.querySelectorAll(':scope > ' + selector)].filter(x => x !== item); let target = null;
      for (const s of sibs) { const r = s.getBoundingClientRect(); if (grid ? (ev.clientY < r.top || (ev.clientY <= r.bottom && ev.clientX < r.left + r.width / 2)) : ev.clientY < r.top + r.height / 2) { target = s; break; } }
      if (target) { if (item.nextElementSibling !== target) container.insertBefore(item, target); } else if (sibs.length) sibs[sibs.length - 1].after(item);
    };
    // listen on the window: moving the item in the page would otherwise lose the pointer
    const end = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', end); removeEventListener('pointercancel', end); item.classList.remove('dragging');
      done([...container.querySelectorAll(':scope > ' + selector)].map(el => el.dataset.key)); };
    addEventListener('pointermove', mv); addEventListener('pointerup', end); addEventListener('pointercancel', end);
  });
}
// Press and hold an item: lift it (drag to move it), or let go without moving to see its options
let holdDrag = false;
document.addEventListener('touchmove', e => { if (holdDrag) e.preventDefault(); }, { passive: false });
function holdable(handle, item, container, selector, grid, saveOrder, menu) {
  handle.addEventListener('contextmenu', e => e.preventDefault());
  handle.addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('.mini,.inl,input')) return;
    const sx = e.clientX, sy = e.clientY; let lifted = false, dragged = false;
    const timer = setTimeout(() => { lifted = true; holdDrag = true; item.classList.add('dragging'); navigator.vibrate && navigator.vibrate(20); }, 450);
    const mv = ev => {
      if (!lifted) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) cleanup(); return; }
      if (!dragged && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return; dragged = true;
      const sibs = [...container.querySelectorAll(':scope > ' + selector)].filter(x => x !== item); let target = null;
      for (const s of sibs) { const r = s.getBoundingClientRect(); if (grid ? (ev.clientY < r.top || (ev.clientY <= r.bottom && ev.clientX < r.left + r.width / 2)) : ev.clientY < r.top + r.height / 2) { target = s; break; } }
      if (target) { if (item.nextElementSibling !== target) container.insertBefore(item, target); } else if (sibs.length) sibs[sibs.length - 1].after(item);
    };
    const upH = () => {
      const was = lifted, moved = dragged; cleanup();
      if (!was) return; item._held = true; handle._held = true; setTimeout(() => { item._held = false; handle._held = false; }, 400);
      if (moved) { saveOrder([...container.querySelectorAll(':scope > ' + selector)].map(el => el.dataset.key)); toast('Order saved'); }
      else showHoldMenu(handle, menu);
    };
    function cleanup() { clearTimeout(timer); holdDrag = false; item.classList.remove('dragging'); removeEventListener('pointermove', mv); removeEventListener('pointerup', upH); removeEventListener('pointercancel', upH); }
    addEventListener('pointermove', mv); addEventListener('pointerup', upH); addEventListener('pointercancel', upH);
  });
}
function showHoldMenu(anchor, items) {
  closePop(); pop = document.createElement('div'); pop.className = 'pop';
  items.forEach(([label, fn, danger]) => { const b = document.createElement('button'); b.className = 'opt' + (danger ? ' danger' : ''); b.textContent = label;
    b.onclick = () => { if (danger && !b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Tap again: ' + label.toLowerCase(); return; } closePop(); fn(); }; pop.appendChild(b); });
  const c = document.createElement('button'); c.className = 'opt'; c.textContent = 'Cancel'; c.onclick = closePop; pop.appendChild(c);
  const tip = document.createElement('p'); tip.className = 'phelp'; tip.textContent = 'Tip: hold and drag to move it.'; pop.appendChild(tip);
  document.body.appendChild(pop); const r = anchor.getBoundingClientRect();
  pop.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8)) + 'px'; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px'; pop.style.right = 'auto';
}
function renderTrash(body) {
  const list = NAMES.trash.slice().sort((a, b) => b.at - a.at);
  if (!list.length) { body.innerHTML = '<p class="empty">Trash is empty. Deleted chapters and subtopics appear here, with all their notes and code.</p>'; return; }
  const wrap = document.createElement('div'); wrap.className = 'recs';
  for (const t of list) {
    const row = document.createElement('div'); row.className = 'recrow';
    row.innerHTML = `<div class="info"><strong>${esc(t.name)}</strong><span>${t.kind === 'chapter' ? 'Chapter' : 'Subtopic'}${t.level ? ' · ' + esc(t.level) : ''}${t.chapter ? ' · ' + esc(t.chapter) : ''} · deleted ${new Date(t.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></div><div class="acts"></div>`;
    const a = row.querySelector('.acts'); const mk = (txt, c, f) => { const b = document.createElement('button'); b.className = c; b.textContent = txt; b.onclick = f; a.appendChild(b); return b; };
    mk('Restore', 'ghost primary', async () => { NAMES.trash = NAMES.trash.filter(x => x !== t); await saveNames(); toast('Restored to its old place'); renderLib(); });
    const fx = mk('Delete forever', 'ghost danger', async () => {
      if (!fx.dataset.sure) { fx.dataset.sure = 1; fx.textContent = 'Tap again: notes and code are erased'; return; }
      await purge(t); NAMES.trash = NAMES.trash.filter(x => x !== t); NAMES.gone.push(t.key); await saveNames(); toast('Deleted forever. Recordings are kept in Recordings.'); renderLib();
    });
    wrap.appendChild(row);
  }
  body.appendChild(wrap);
}
// erase the notes, sheets, PDFs, pictures' pages and code of a subtopic (in both O Level batches), or of a whole chapter
async function purgeNotes(id) {
  for (const s of (await store.get('kv', 'sheets:' + id)) || []) await purgeNotes(s.id);
  await store.del('topics', id); await store.del('kv', 'm:' + id); await store.delPrefix('blobs', 'pdf:' + id + ':'); await store.del('kv', 'sheets:' + id); await store.del('kv', 'sheetLast:' + id);
}
async function purgeTopic(base, orig, key) {
  for (const v of base === 'ol' ? ['ol', 'olg'] : [base]) await purgeNotes(topicId(v, orig));
  for (const p of ['cp:t:', 'cf:t:']) await store.delPrefix('kv', p + key + ':');
  for (const k of ['ideInit:t:', 'ideLast:t:']) await store.del('kv', k + key);
  for (const [id] of await store.getPrefix('topics', 'code:t:' + key + ':')) await purgeNotes(id);
  await store.delPrefix('kv', 'annlay:code:t:' + key + ':');
  const c = (await customTopics()).filter(x => !(x.lv === base && x.name === orig)); await store.put('kv', 'custom', c);
}
async function purge(t) {
  if (t.kind === 'topic') { if (t.orig) await purgeTopic(t.base, t.orig, t.key); return; }
  const lv = LEVELS.find(l => l.id === t.base), p = lv.papers.find(x => x.id === t.paper), ch = p && p.chapters.find(x => x.n === t.n); if (!ch) return;
  const custom = await customTopics();
  for (const orig of [...ch.topics, ...(ch.legacy || []), ...custom.filter(c => c.lv === t.base && inChapter(ch, c.ch)).map(c => c.name)]) await purgeTopic(t.base, orig, topicId(t.base, orig));
}
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
  split: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M12 4.5v15"/>',
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
const codeB = btn(L, svg('code') + '<small>Code</small>', 'Code for this subtopic', () => toggleTopicCode()); codeB.classList.add('homeb', 'codeb'); codeB.hidden = true;
hr(L);
COLORS.forEach((c, i) => colorBtns.push(btn(L, `<span class="sw" style="background:${c}"></span>`, CNAMES[i] + ' ink', () => {
  if (!$('#ide').hidden && $('#pane2').hidden) { startAnnotate(); }
  if (A.hasSel()) { A.selRecolor(c); return; }
  board.tool.c = c; if (['erase', 'laser', 'lasso'].includes(board.tool.t)) board.tool.t = 'pen'; paint(); })));
hr(L);
board.SIZES.forEach((s, i) => sizeBtns.push(btn(L, `<span class="dot" style="width:${5 + i * 4}px;height:${5 + i * 4}px"></span>`, ['Fine', 'Medium', 'Bold'][i] + ' line', () => { board.tool.sz = i; paint(); })));
[['pen', 'Pen'], ['hl', 'Highlighter'], ['shape', 'Shapes'], ['lasso', 'Select and move'], ['erase', 'Eraser'], ['laser', 'Laser pointer']].forEach(([k, l]) => toolBtns[k] = btn(R, svg(k), l, () => {
  if (!$('#ide').hidden && $('#pane2').hidden) { startAnnotate(); }
  if (k === 'shape' && board.tool.t === 'shape') return openShapePop(toolBtns.shape);
  if (k === 'erase' && board.tool.t === 'erase') return openEraserPop(toolBtns.erase);
  board.tool.t = k; if (k !== 'lasso') A.clearSel(); paint(); if (k === 'shape') openShapePop(toolBtns.shape); if (k === 'erase') openEraserPop(toolBtns.erase); }));
hr(R);
btn(R, svg('undo'), 'Undo', () => A.doUndo()); btn(R, svg('redo'), 'Redo', () => A.doRedo());
hr(R);
const addBtn = btn(R, svg('page'), 'Pages', () => openPop(addBtn));
btn(R, svg('grid'), 'Page overview', openOverview);
btn(R, svg('pdf'), 'Insert a PDF or picture', () => $('#file').click());
const splitB = btn(R, svg('split'), 'Second window side by side', () => toggleSplit());
hr(R);
btn(R, svg('full'), 'Full screen', () => { const d = document; (d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen({ navigationUI: 'hide' })).catch(() => toast('Full screen is not available here.')); });
btn(R, svg('set'), 'Settings and help', openSettings);
btn(R, svg('hide'), 'Hide tools', () => document.body.classList.add('hidden-ui'));
$('#show').onclick = () => document.body.classList.remove('hidden-ui');
function setMode(m) {
  const code = m === 'code'; $('#ide').hidden = !code; $('#board').hidden = code;
  if (code) { A.clearSel(); ide.open(codeCtx ? codeCtx.scope : 'ol', codeCtx ? codeCtx.level : 'ol').then(() => ide.prewarm()); }
}
function paint() {
  const t = board.tool; if (B2) Object.assign(B2.tool, t);
  colorBtns.forEach((b, i) => b.classList.toggle('on', COLORS[i] === t.c)); sizeBtns.forEach((b, i) => b.classList.toggle('on', i === t.sz));
  Object.entries(toolBtns).forEach(([k, b]) => b.classList.toggle('on', k === t.t)); toolBtns.pen.classList.toggle('auto', !!t.auto); store.put('kv', 'tool', { ...t }).catch(() => {});
}
$('#file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.type.startsWith('image/')) return A.insertImage(f);
  const target = A, n = await target.pdfPages(f).catch(() => 0); if (!n) return target.importPdf(f);
  const w = document.createElement('div'); w.className = 'modalWrap';
  w.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="pdH"><h2 id="pdH">${esc(f.name)}</h2><p class="help">${n} page${n > 1 ? 's' : ''}</p>
    <div class="row"><button class="primary" id="pdPages">Add as pages to write on</button></div>
    <div class="row"><button id="pdPic">Place a page on this page as a picture</button>${n > 1 ? `<label class="tog small" for="pdN">Page <input id="pdN" type="number" min="1" max="${n}" value="1" style="width:70px"></label>` : ''}</div>
    <p class="help">A picture can be moved and resized with your finger or pen. Pages fill the board so you can write on them.</p>
    <div class="row"><button id="pdNo">Cancel</button></div></div>`;
  document.body.appendChild(w); const q = s => w.querySelector(s);
  q('#pdNo').onclick = () => w.remove();
  q('#pdPages').onclick = () => { w.remove(); target.importPdf(f); };
  q('#pdPic').onclick = async () => { const pn = n > 1 ? +q('#pdN').value || 1 : 1; w.remove(); toast('Placing the page…'); target.insertImage(await target.pdfPageImage(f, pn)); };
});
let pop = null;
function closePop() { if (pop) { pop.remove(); pop = null; } }
function placePop(anchor) {
  document.body.appendChild(pop); const r = anchor.getBoundingClientRect();
  pop.style.top = Math.max(8, Math.min(r.top, innerHeight - pop.offsetHeight - 8)) + 'px'; pop.style.right = (innerWidth - r.left + 8) + 'px';
}
const PAGE_ICONS = { lined: '<path d="M4 8h16M4 12h16M4 16h16"/>', grid: '<path d="M4 8h16M4 12h16M4 16h16M8 4v16M12 4v16M16 4v16"/>', dots: '<circle cx="8" cy="8" r=".6"/><circle cx="12" cy="8" r=".6"/><circle cx="16" cy="8" r=".6"/><circle cx="8" cy="12" r=".6"/><circle cx="12" cy="12" r=".6"/><circle cx="16" cy="12" r=".6"/><circle cx="8" cy="16" r=".6"/><circle cx="12" cy="16" r=".6"/><circle cx="16" cy="16" r=".6"/>', plain: '' };
function openPop(anchor) {
  closePop(); pop = document.createElement('div'); pop.className = 'pop pagepop';
  const cur = A.currentPage() || {}; const isPdf = cur.k === 'pdf';
  const bg = isPdf ? cfg.pageBg : cur.bg, pat = isPdf ? cfg.pagePat : cur.pat;
  pop.innerHTML = `<button class="opt primary" id="pAdd">+ Add a page after this one</button>
    <div class="plabel">Page colour${isPdf ? ' (for new pages)' : ''}</div><div class="swrow" id="pCols"></div>
    <div class="plabel">Page lines</div><div class="swrow" id="pPats"></div>
    <label class="tog small"><input type="checkbox" id="pAll"> Apply to all my pages in this topic</label>
    <div class="prow"><button class="opt" id="pFit">Fit page width</button><button class="opt" id="pClear">Clear writing on this page</button></div>
    <div class="prow"><button class="opt danger" id="pDel">Delete this page</button>${isPdf ? '<button class="opt danger" id="pPdf">Remove this whole PDF</button>' : ''}</div>`;
  const apply = (nb, np) => { cfg.pageBg = nb; cfg.pagePat = np; saveCfg(); if (!isPdf) A.setPageStyle({ bg: nb, pat: np }, pop.querySelector('#pAll').checked); closePop(); };
  const cols = pop.querySelector('#pCols');
  board.PAGE_COLORS.forEach(([c, n]) => { const b = document.createElement('button'); b.className = 'psw' + (c === bg ? ' on' : ''); b.style.background = c; b.title = n; b.setAttribute('aria-label', n + ' page'); b.onclick = () => apply(c, pat); cols.appendChild(b); });
  const custom = document.createElement('label'); custom.className = 'psw custom'; custom.title = 'Any colour'; custom.innerHTML = '<input type="color" aria-label="Pick any page colour">+';
  custom.querySelector('input').value = /^#[0-9a-f]{6}$/i.test(bg) ? bg : '#0f0f13'; custom.querySelector('input').onchange = e => apply(e.target.value, pat); cols.appendChild(custom);
  const pats = pop.querySelector('#pPats');
  board.PATTERNS.forEach(([k, n]) => { const b = document.createElement('button'); b.className = 'ppat' + (k === pat ? ' on' : ''); b.innerHTML = `<svg viewBox="0 0 24 24">${PAGE_ICONS[k]}</svg><span>${n}</span>`; b.onclick = () => apply(bg, k); pats.appendChild(b); });
  pop.querySelector('#pAdd').onclick = () => { A.addPage(isPdf ? { bg: cfg.pageBg, pat: cfg.pagePat } : null); closePop(); };
  pop.querySelector('#pFit').onclick = () => { A.fit(); closePop(); };
  pop.querySelector('#pClear').onclick = () => { if (A.clearPage()) toast('Page cleared. Undo brings it back.'); closePop(); };
  pop.querySelector('#pDel').onclick = e => { const b = e.currentTarget; if (b.dataset.sure) { A.deletePage(); closePop(); } else { b.dataset.sure = 1; b.textContent = 'Tap again to delete'; } };
  if (isPdf) pop.querySelector('#pPdf').onclick = e => { const b = e.currentTarget; if (b.dataset.sure) { A.removePdf(); closePop(); } else { b.dataset.sure = 1; b.textContent = 'Tap again to remove the PDF'; } };
  placePop(anchor);
}
const GATES = [['and', 'AND', '<path d="M4 9h3M4 15h3M7 6h5a6 6 0 010 12H7z M18 12h3"/>'], ['nand', 'NAND', '<path d="M3 9h3M3 15h3M6 6h4.5a6 6 0 010 12H6z"/><circle cx="18" cy="12" r="1.6"/><path d="M19.6 12H22"/>'], ['or', 'OR', '<path d="M4 9h4M4 15h4M6 6c3 0 7 1 11 6-4 5-8 6-11 6 2-4 2-8 0-12zM17 12h4"/>'], ['nor', 'NOR', '<path d="M3 9h4M3 15h4M5 6c3 0 6 1 10 6-4 5-7 6-10 6 2-4 2-8 0-12z"/><circle cx="17" cy="12" r="1.6"/><path d="M18.6 12H22"/>'], ['xor', 'XOR', '<path d="M3 9h3M3 15h3M7 6c3 0 7 1 10 6-3 5-7 6-10 6 2-4 2-8 0-12zM4.5 6c2 4 2 8 0 12M17 12h4"/>'], ['not', 'NOT', '<path d="M3 12h4M7 6v12l9-6z"/><circle cx="17.6" cy="12" r="1.6"/><path d="M19.2 12H22"/>']];
const SHAPES = [['line', 'Line', '<path d="M4 20L20 4"/>'], ['arrow', 'Arrow', '<path d="M4 20L20 4M11 4h9v9"/>'], ['rect', 'Rectangle', '<rect x="3.5" y="6" width="17" height="12" rx="1"/>'], ['ellipse', 'Circle / ellipse', '<ellipse cx="12" cy="12" rx="9" ry="7"/>'], ['tri', 'Triangle', '<path d="M12 4l9 16H3z"/>']];
function openShapePop(anchor) {
  closePop(); pop = document.createElement('div'); pop.className = 'pop';
  pop.innerHTML = '<div class="plabel">Draw a shape</div><div class="swrow" id="shp"></div><div class="plabel">Logic gates</div><div class="swrow" id="gts"></div><label class="tog small"><input type="checkbox" id="auto"> Auto-shape my pen: straightens lines and tidies circles, rectangles and triangles</label>';
  GATES.forEach(([k, n, ic]) => { const b = document.createElement('button'); b.className = 'ppat' + (board.tool.shape === k ? ' on' : ''); b.innerHTML = `<svg viewBox="0 0 24 24">${ic}</svg><span>${n}</span>`; b.onclick = () => { board.tool.shape = k; board.tool.t = 'shape'; paint(); closePop(); }; pop.querySelector('#gts').appendChild(b); });
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
  await A.flush(); closePop();
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
    const info = A.pageInfo(), grid = q('#ovGrid'); grid.innerHTML = '';
    info.forEach(p => { const b = document.createElement('button'); b.type = 'button'; b.className = 'thumb' + (picked.has(p.i) ? ' on' : '') + (p.i === A.curPage ? ' cur' : '');
      b.setAttribute('aria-label', 'Page ' + (p.i + 1)); b.innerHTML = `<span class="tn">${p.i + 1}</span>${p.kind === 'pdf' ? '<span class="tw pdf">PDF</span>' : ''}`;
      // press and hold a page to start selecting (like Samsung); then taps add or remove pages
      let holdT = 0, held = false;
      b.addEventListener('pointerdown', () => { held = false; clearTimeout(holdT); holdT = setTimeout(() => { held = true; if (!selecting) { selecting = true; picked.clear(); } picked.add(p.i); [...q('#ovGrid').children].forEach((el, i) => el.classList.toggle('on', picked.has(i))); acts(); navigator.vibrate && navigator.vibrate(20); }, 450); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, () => clearTimeout(holdT)));
      b.addEventListener('contextmenu', e => e.preventDefault());
      b.onclick = () => { if (held) { held = false; return; } if (!selecting) { A.goPage(p.i); close(); return; } picked.has(p.i) ? picked.delete(p.i) : picked.add(p.i); b.classList.toggle('on'); acts(); };
      grid.appendChild(b); });
    (async () => { const boxes = [...grid.children]; for (const p of info) { if (!w.isConnected || !boxes[p.i]) return; try { const c = await A.renderPage(p.i, 180); c.className = 'tc'; boxes[p.i].prepend(c); } catch (e) {} } })();
    acts();
  };
  const acts = () => { if (selecting && !picked.size) selecting = false; q('#ovActs').hidden = !selecting; q('#ovSel').hidden = q('#ovAll').hidden = !selecting; q('#ovN').textContent = picked.size + ' selected'; };
  q('#ovSel').onclick = () => { selecting = false; picked.clear(); render(); };
  q('#ovAll').onclick = () => { picked = new Set(A.pageInfo().map(p => p.i)); [...q('#ovGrid').children].forEach(el => el.classList.add('on')); acts(); };
  q('#ovDel').onclick = e => { if (!picked.size) return toast('Pick pages first'); const b = e.currentTarget; if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = `Tap again to delete ${picked.size}`; return; } b.dataset.sure = ''; b.textContent = 'Delete selected'; A.deletePages([...picked]); picked.clear(); render(); };
  q('#ovAdd').onclick = () => { const at = picked.size ? Math.max(...picked) + 1 : A.pageCount(); A.insertPage(at, null); picked.clear(); render(); };
  q('#ovEnd').onclick = () => { A.insertPage(A.pageCount(), null); render(); };
  const shift = d => { if (picked.size !== 1) return toast('Pick one page to move'); const i = [...picked][0], j = i + d; if (j < 0 || j >= A.pageCount()) return; A.movePage(i, j); picked = new Set([j]); render(); };
  q('#ovUp').onclick = () => shift(-1); q('#ovDown').onclick = () => shift(1);
  render();
}
/* selection toolbar */
const selBar = document.createElement('div'); selBar.className = 'selbar'; selBar.hidden = true;
selBar.innerHTML = '<span id="selN"></span><button id="selDup">Duplicate</button><button id="selDel" class="danger">Delete</button><button id="selDone">Done</button>';
document.body.appendChild(selBar);
selBar.querySelector('#selDup').onclick = () => selOwner.selDuplicate();
selBar.querySelector('#selDel').onclick = () => selOwner.selDelete();
selBar.querySelector('#selDone').onclick = () => selOwner.clearSel();
function onSelection(r, inst = board) {
  if (!r) { if (selOwner === inst) selBar.hidden = true; return; }
  selOwner = inst;
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
   <h2 style="font-size:16px;margin-top:6px">Camera and microphone</h2>
   <label for="sCam">Camera for the camera window, recordings and live<select id="sCam"><option value="">Front camera (default)</option></select></label>
   <label for="sMic">Microphone for recordings and live<select id="sMic"><option value="">Tablet microphone (default)</option></select></label>
   <div class="row"><button id="sMicTest">Test microphone</button><span class="meter big" id="sMeter"><b></b></span></div>
   <p class="help">USB and Bluetooth microphones and USB cameras appear here once they are plugged in or paired.</p>
   <label class="tog" for="sMirror"><input type="checkbox" id="sMirror"> Mirror my camera</label>
   <label class="tog" for="sFinger"><input type="checkbox" id="sFinger"> Let my finger write too (off means a finger only scrolls)</label>
   <h2 style="font-size:16px;margin-top:6px">Google Drive</h2>
   <label for="dClient">Google Client ID<input id="dClient" placeholder="1234…apps.googleusercontent.com" autocomplete="off"></label>
   <label for="dRoot">Main Drive folder name<input id="dRoot"></label>
   <p id="dCheck" class="help"></p>
   <div class="row"><button id="dConn" class="primary">Connect Drive</button><span id="dStat" style="font-size:13px;color:var(--muted)"></span></div>
   <details class="helperbox"><summary><b>Stay connected to Drive (recommended)</b></summary>
     <p class="help">Google signs a web app out every hour. A small helper in your own Google account keeps the app connected, with no sign-in windows. Set it up once:</p>
     <ol class="help">
       <li>Tap <b>Copy helper script</b> below.</li>
       <li>Open <b>script.google.com</b>, tap <b>New project</b>, delete what is there, paste, and tap <b>Save</b>.</li>
       <li>Choose the function <b>authorize</b> at the top and tap <b>Run</b>. Allow access (Advanced › Go to project › Allow).</li>
       <li>Tap <b>Deploy › New deployment</b>, type <b>Web app</b>, Execute as <b>Me</b>, Who has access <b>Anyone</b>, then <b>Deploy</b>.</li>
       <li>Copy the <b>Web app URL</b>, paste it here and tap <b>Test</b>.</li>
     </ol>
     <div class="row"><button id="hCopy">Copy helper script</button></div>
     <label for="hUrl">Helper web app URL<input id="hUrl" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
     <div class="row"><button id="hTest" class="primary">Test</button><button id="hOff">Remove helper</button><span id="hStat" class="help"></span></div>
   </details>
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
  const dstat = () => { const d = drive.settings(); q('#dStat').textContent = d.helper ? 'Connected through the helper' + (d.email ? ' as ' + d.email : '') : d.email ? 'Connected as ' + d.email : (d.clientId ? 'Not connected yet' : 'Paste your Client ID, then tap Connect'); q('#dConn').textContent = d.email ? 'Reconnect' : 'Connect Drive'; };
  dstat();
  const idOk = v => /^\d{6,}-[a-z0-9]{10,}\.apps\.googleusercontent\.com$/i.test(v);
  const showId = () => { const v = q('#dClient').value.trim(); q('#dCheck').textContent = !v ? '' : idOk(v) ? `Looks right: ${v.length} characters, ends with .apps.googleusercontent.com` : (v.includes('…') || v.includes('...') ? 'This ID was copied shortened (it has “…”). Use the copy icon next to the full Client ID.' : v.startsWith('GOCSPX') ? 'This is the client secret. Copy the Client ID instead.' : 'This does not look like a full Client ID. It should be digits, a dash, letters, then .apps.googleusercontent.com'); q('#dCheck').className = 'help ' + (idOk(v) ? 'ok' : 'bad'); };
  q('#dClient').addEventListener('input', showId); showId();
  const keepDrive = () => drive.saveSettings({ clientId: q('#dClient').value.trim(), root: q('#dRoot').value.trim() || 'CSwithSR Classes' });
  const hs = drive.settings(); q('#hUrl').value = hs.helper || ''; q('#hStat').textContent = hs.helper ? 'Helper set up' : '';
  q('#hCopy').onclick = async () => {
    let k = drive.settings().hkey; if (!k) { k = drive.newKey(); await drive.saveSettings({ hkey: k }); }
    const txt = drive.helperScript(k);
    try { await navigator.clipboard.writeText(txt); toast('Helper script copied'); } catch (e) { const ta = document.createElement('textarea'); ta.value = txt; ta.className = 'copybox'; q('#hCopy').after(ta); ta.select(); toast('Select all and copy the text that appeared'); }
  };
  q('#hTest').onclick = async () => {
    const u = q('#hUrl').value.trim(); if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) { q('#hStat').textContent = 'Paste the Web app URL that starts with https://script.google.com/'; return; }
    await drive.saveSettings({ helper: u }); q('#hStat').textContent = 'Testing…';
    try { const em = await drive.testHelper(); q('#hStat').textContent = 'Connected as ' + em + '. Drive stays connected now.'; drive.pump(); dstat(); }
    catch (e) { q('#hStat').textContent = e.message + ' Check that access is set to Anyone and that you ran authorize once.'; }
  };
  q('#hOff').onclick = async () => { await drive.saveSettings({ helper: '' }); q('#hUrl').value = ''; q('#hStat').textContent = 'Helper removed'; };
  q('#dConn').onclick = async () => { await keepDrive(); try { await drive.signIn(true); toast('Google Drive connected'); } catch (e) { toast(e.message); } dstat(); };
  q('#sDone').onclick = async () => { await keepDrive(); close(); };
  // camera and microphone lists (names appear after camera/mic permission has been given once)
  const fillDevs = async () => {
    try {
      const dev = (await store.get('kv', 'dev')) || {}; let list = await navigator.mediaDevices.enumerateDevices();
      if (!list.some(d => d.label)) { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); s.getTracks().forEach(t => t.stop()); list = await navigator.mediaDevices.enumerateDevices(); } catch (e) {} }
      const put = (sel, kind, cur) => { list.filter(d => d.kind === kind).forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || (kind === 'videoinput' ? 'Camera ' : 'Microphone ') + (i + 1); sel.appendChild(o); }); sel.value = cur || ''; if (sel.value !== (cur || '')) sel.value = ''; };
      put(q('#sCam'), 'videoinput', dev.cam); put(q('#sMic'), 'audioinput', dev.mic);
    } catch (e) {}
  };
  fillDevs();
  const saveDev = async () => { await store.put('kv', 'dev', { cam: q('#sCam').value, mic: q('#sMic').value }); };
  q('#sCam').onchange = async () => { await saveDev(); cam.restart(); };
  q('#sMic').onchange = saveDev;
  let testS = null;
  q('#sMicTest').onclick = async () => {
    if (testS) { testS.getTracks().forEach(t => t.stop()); testS = null; q('#sMicTest').textContent = 'Test microphone'; return; }
    try {
      const c0 = q('#sMic').value ? { deviceId: { exact: q('#sMic').value } } : true; testS = await navigator.mediaDevices.getUserMedia({ audio: c0 });
      const ac = new AudioContext(), an = ac.createAnalyser(); ac.createMediaStreamSource(testS).connect(an); const buf = new Float32Array(an.fftSize);
      q('#sMicTest').textContent = 'Stop test';
      const loop = () => { if (!testS || !w.isConnected) { if (testS) testS.getTracks().forEach(t => t.stop()); testS = null; ac.close(); return; } an.getFloatTimeDomainData(buf); let s2 = 0; for (const v of buf) s2 += v * v; q('#sMeter b').style.width = Math.min(100, Math.sqrt(s2 / buf.length) * 600) + '%'; requestAnimationFrame(loop); };
      loop();
    } catch (e) { toast('That microphone could not be opened.'); }
  };
  q('#sPen').onclick = async () => { await keepDrive(); close(); penTest(); }; w.addEventListener('click', e => { if (e.target === w) close(); });
}

/* ---------- keep awake, keys ---------- */
let wake = null;
async function keepAwake() { try { if (!wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => wake = null); } } catch (e) {} }
document.addEventListener('pointerdown', keepAwake, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); else { board.flush(); if (B2) B2.flush(); } });
document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input,select,textarea')) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? A.doRedo() : A.doUndo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); A.doRedo(); }
});

/* ---------- start ---------- */
(async () => {
  Object.assign(cfg, (await store.get('kv', 'cfg').catch(() => null)) || {});
  Object.assign(board.tool, (await store.get('kv', 'tool').catch(() => null)) || {}); await loadNames();
  board.init({ toolChanged: paint, el: $('#board'), canvas: $('#ink'), toast, style: () => ({ bg: cfg.pageBg, pat: cfg.pagePat }), selection: onSelection, penInfo: t => { const el = document.getElementById('penInfo'); if (el) el.textContent = t; }, pullHint: pullHint, finger: () => cfg.finger, closePop,
    hint: v => { $('#hint').style.opacity = v ? 1 : 0; }, page: (c, n) => { $('#pg').textContent = c + ' / ' + n; } });
  bg.init($('#bg'), () => $('#lib').hidden ? $('#win').getBoundingClientRect() : null);
  await cam.init({ el: $('#cam'), toast });
  await rec.init({ toast, status: recStatus, bgCanvas: bg.canvas, boardCanvas: board.canvas, drawContent: ctx => drawContent(ctx) });
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
// Drive layout: CSwithSR Classes › O Level / AS Level / A2 Level › Paper › Chapter › Subtopic › Notes or Recordings
const LEVEL_FOLDER = { ol: 'O Level', olg: 'O Level', as: 'AS Level', a2: 'A2 Level' };
function levelFolder(t) { return LEVEL_FOLDER[t.level] || 'Other'; }
function paperFolder(t) { const lv = LEVELS.find(l => l.id === t.level), p = lv && lv.papers.find(x => x.id === t.paper); return p ? p.name.replace(' · ', ' - ') : 'Other'; }
const batchTag = t => t.level === 'olg' ? 'GreenHall' : t.level === 'ol' ? 'Online' : '';
function drivePath(t, kind = 'notes') {
  const leaf = kind === 'rec' ? 'Recordings' : 'Notes';
  if (t.codeLab) return t.parent ? drivePath(t.parent, kind) : [levelFolder(t), 'Code Lab', leaf];
  if (t.id === 'quick' || !t.paper) return ['Quick Board', leaf];
  return [levelFolder(t), paperFolder(t), `Chapter ${t.chapterLabel || String(t.chapter).padStart(2, '0')} - ${t.chapterName}`, t.subName || t.name, leaf];
}
function ranges(ix) {
  const out = []; let a = null, b = null; const push = () => out.push(a === b ? `${a + 1}` : `${a + 1}-${b + 1}`);
  for (const i of ix) { if (a === null) { a = b = i; } else if (i === b + 1) b = i; else { push(); a = b = i; } }
  if (a !== null) push(); return out.join(', ');
}
const clean = s => s.replace(/[\\/:*?"<>|]/g, '');
async function queueRec(r) {
  const js = await drive.jobs(); if (js.some(j => j.src.type === 'rec' && j.src.id === r.id && j.status !== 'error')) { toast('Already in the upload list'); return; }
  const t = r.topicObj || (await findTopic(r.topicId)) || { id: r.topicId, name: r.topic, level: 'ol', chapter: 0, chapterName: '' };
  const ext = r.mime.includes('mp4') ? 'mp4' : 'webm';
  const bt = batchTag(t);
  await drive.enqueue({ kind: 'rec', name: clean(`${r.topic}${bt ? ' - ' + bt : ''} - ${dayOf(r.started)} - Class recording.${ext}`), mime: r.mime.split(';')[0], path: drivePath(t, 'rec'), src: { type: 'rec', id: r.id }, label: r.topic });
  toast(drive.settings().clientId ? 'Added to the Drive upload list' : 'Added to the upload list. Connect Google Drive in Settings to start sending.');
}
async function openShare() {
  if (!topic) return;
  if (!$('#ide').hidden && A === board) { toast('Tap ✎ Annotate (or pick up a pen tool), write your notes, then tap the cloud button to send the PDF.'); return; }
  await A.flush();
  const info = A.pageInfo(), t = A === board ? topic : b2topic;
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
  (async () => { for (const p of info) { if (!w.isConnected) return; try { const c = await A.renderPage(p.i, 150); c.className = 'tc'; boxes[p.i].prepend(c); } catch (e) {} } })();
  if (recs.length) {
    const rr = q('#shRecs'); rr.innerHTML = '<strong style="font-size:14px">Recordings of this topic</strong>'; const td = today();
    recs.forEach(r => { const id = 'r' + r.id, d = new Date(r.started), lab = document.createElement('label'); lab.className = 'tog'; lab.htmlFor = id;
      lab.innerHTML = `<input type="checkbox" id="${id}" ${dayOf(r.started) === td && !queued.has(r.id) ? 'checked' : ''} ${queued.has(r.id) ? 'disabled' : ''}> ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · ${fmtDur(r.dur)} · ${fmtSize(r.size)}${queued.has(r.id) ? ' · already in the upload list' : ''}`;
      lab.querySelector('input').dataset.rid = r.id; rr.appendChild(lab); });
  }
  const makePdf = async () => {
    const ix = [...sel].sort((a, b) => a - b); if (!ix.length) return null; q('#shGo').disabled = q('#shSave').disabled = true;
    try { return { blob: await notesPdf(ix, `${t.name} · ${today()}`, (n, m) => { q('#shSel').textContent = `Making the PDF… page ${n + 1} of ${m}`; }, A), ix }; }
    finally { q('#shGo').disabled = q('#shSave').disabled = false; }
  };
  const pdfName = ix => clean(`${t.name}${batchTag(t) ? ' - ' + batchTag(t) : ''} - ${today()} - Notes (pages ${ranges(ix)}).pdf`);
  q('#shSave').onclick = async () => { const r = await makePdf(); if (!r) return toast('Pick at least one page');
    const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = pdfName(r.ix); document.body.appendChild(a); a.click(); a.remove(); paintSel(); toast('Saving the PDF to your Downloads folder'); };
  q('#shGo').onclick = async () => {
    const picks = [...w.querySelectorAll('input[data-rid]:checked')].map(i => recs.find(r => r.id === i.dataset.rid));
    if (!sel.size && !picks.length) return toast('Pick pages or a recording to send');
    let n = 0;
    if (sel.size) { const r = await makePdf(); const key = 'up:' + Date.now().toString(36); await store.put('blobs', key, r.blob);
      await drive.enqueue({ kind: 'notes', name: pdfName(r.ix), mime: 'application/pdf', path: drivePath(t, 'notes'), src: { type: 'blob', key }, label: t.name }); n++; }
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

function askCopy(from) {
  return new Promise(res => {
    const w = document.createElement('div'); w.className = 'modalWrap';
    w.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="cpH"><h2 id="cpH">Start from the ${esc(from)} notes?</h2>
      <p class="help">This topic is new for this batch. You already have pages for it in ${esc(from)}.</p>
      <div class="row"><button class="primary" data-v="pages">Copy pages and PDFs, without my writing</button></div>
      <div class="row"><button data-v="all">Copy everything, including my writing</button></div>
      <div class="row"><button data-v="">Start with a blank page</button></div></div>`;
    document.body.appendChild(w);
    w.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { w.remove(); res(b.dataset.v); });
  });
}
async function copyTopic(src, id, withInk) {
  const doc = JSON.parse(JSON.stringify(src)); doc.id = id; doc.today = null; doc.sy = -28; doc.updated = Date.now();
  if (!withInk) doc.pages.forEach(p => { p.s = []; }); doc.strokes = doc.pages.reduce((a, p) => a + p.s.length, 0);
  for (let d = 0; d < (src.pdfs || 0); d++) { const buf = await store.get('blobs', 'pdf:' + src.id + ':' + d); if (buf) await store.put('blobs', 'pdf:' + id + ':' + d, buf); }
  await store.put('topics', id, doc); await store.put('kv', 'm:' + id, { pages: doc.pages.length, strokes: doc.strokes, updated: Date.now() });
}

/* ---------- second window (side by side) ---------- */
function setActive(inst) { A = inst; $('#board').classList.toggle('act', inst === board && !$('#pane2').hidden); $('#pane2').classList.toggle('act', inst === B2); $('#ide').classList.toggle('act', false); }
$('#board').addEventListener('pointerdown', () => setActive(board), true);
$('#pane2').addEventListener('pointerdown', () => { if (B2) setActive(B2); }, true);
const sheetHost = () => (codeCtx && codeCtx.parent) || topic;
async function sheetsFor(t) { return (await store.get('kv', 'sheets:' + t.id)) || []; }
async function fillSheets(sel) {
  const t = sheetHost(), list = await sheetsFor(t), s = $('#p2sheet'); s.innerHTML = '';
  list.forEach(x => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.name; s.appendChild(o); }); s.value = sel || '';
}
async function loadSheet(id) {
  const t = sheetHost(), list = await sheetsFor(t), sh = list.find(x => x.id === id); if (!sh) return;
  if (B2) await B2.flush();
  b2topic = { ...t, id: sh.id, name: `${t.name} · ${sh.name}`, subName: t.subName || t.name, sheetOf: t.id };
  await B2.load(b2topic); await store.put('kv', 'sheetLast:' + t.id, id); await fillSheets(id); setActive(B2);
}
async function newSheet() {
  const t = sheetHost(), list = await sheetsFor(t); let n = list.length + 2; while (list.some(x => x.name === 'Sheet ' + n)) n++;
  const sh = { id: `${t.id}~${Date.now().toString(36)}`, name: list.length ? 'Sheet ' + n : 'Past papers' }; list.push(sh); await store.put('kv', 'sheets:' + t.id, list); await loadSheet(sh.id);
}
async function toggleSplit() { if (!$('#pane2').hidden) return closeSplit(); return openSplit(); }
async function openSplit() {
  if (!topic) return;
  if (!B2) {
    B2 = await import('./board.js?pane=2');
    B2.init({ el: $('#board2'), canvas: $('#ink2'), toast, style: () => ({ bg: cfg.pageBg, pat: cfg.pagePat }), selection: r => onSelection(r, B2), finger: () => cfg.finger, closePop,
      hint: () => {}, page: (c, n) => { $('#p2pg').textContent = c + ' / ' + n; }, penInfo: () => {}, pullHint: () => {}, toolChanged: () => { Object.assign(board.tool, B2.tool); paint(); } });
    Object.assign(B2.tool, board.tool);
  }
  $('#pane2').hidden = false; $('#app').classList.add('split'); splitB.classList.add('on');
  const t = sheetHost(), list = await sheetsFor(t), last = await store.get('kv', 'sheetLast:' + t.id);
  if (list.length) await loadSheet(list.find(x => x.id === last) ? last : list[0].id); else await newSheet();
}
async function closeSplit() {
  if ($('#pane2').hidden) return; if (B2) { await B2.flush(); B2.clearSel(); }
  $('#pane2').hidden = true; $('#app').classList.remove('split'); splitB.classList.remove('on'); setActive(board); b2topic = null;
}
$('#p2close').onclick = () => closeSplit();
$('#p2new').onclick = () => newSheet();
$('#p2sheet').onchange = e => loadSheet(e.target.value);
$('#p2ren').onclick = async () => {
  const t = sheetHost(), list = await sheetsFor(t), cur = list.find(x => x.id === $('#p2sheet').value); if (!cur) return;
  const s = $('#p2sheet'), inp = document.createElement('input'); inp.className = 'inl'; inp.value = cur.name; s.replaceWith(inp); inp.focus(); inp.select();
  let done = false; const fin = async () => { if (done) return; done = true; const v = inp.value.trim(); if (v) cur.name = v; await store.put('kv', 'sheets:' + t.id, list); inp.replaceWith(s); await fillSheets(cur.id); if (b2topic) b2topic.name = `${t.name} · ${cur.name}`; };
  inp.onkeydown = e => { if (e.key === 'Enter') fin(); }; inp.onblur = fin;
};
// recording: draw what each visible window shows
function drawContent(ctx) {
  const R = el => el.getBoundingClientRect();
  if (!$('#ide').hidden) ide.drawInto(ctx);
  else { const r = R($('#board')); ctx.save(); ctx.beginPath(); ctx.roundRect(r.left, r.top, r.width, r.height, $('#pane2').hidden ? [0, 0, 16, 16] : [0, 0, 0, 16]); ctx.clip(); ctx.drawImage($('#ink'), r.left, r.top, r.width, r.height); ctx.restore(); }
  if (!$('#pane2').hidden) {
    const p = R($('#pane2')), r = R($('#board2')), bar = R(document.querySelector('.p2bar'));
    const dv = R($('#divider')); ctx.fillStyle = '#16142a'; ctx.fillRect(dv.left, dv.top, dv.width, dv.height); ctx.fillStyle = '#2a2550'; ctx.fillRect(dv.left + 5, dv.top, 4, dv.height);
    ctx.fillStyle = '#16142a'; ctx.fillRect(bar.left, bar.top, bar.width, bar.height);
    const sel = $('#p2sheet'); ctx.fillStyle = '#F2B53A'; ctx.font = '700 13px "Space Grotesk", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '', bar.left + 12, bar.top + bar.height / 2);
    ctx.save(); ctx.beginPath(); ctx.roundRect(r.left, r.top, r.width, r.height, [0, 0, 16, 0]); ctx.clip(); ctx.drawImage($('#ink2'), r.left, r.top, r.width, r.height); ctx.restore();
  }
}

$('#p2del').onclick = async e => {
  const b = e.currentTarget, t = sheetHost(), list = await sheetsFor(t), id = $('#p2sheet').value, cur = list.find(x => x.id === id); if (!cur) return;
  if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Delete?'; b.classList.add('danger'); setTimeout(() => { b.dataset.sure = ''; b.textContent = '🗑'; b.classList.remove('danger'); }, 3000); return; }
  b.dataset.sure = ''; b.textContent = '🗑'; b.classList.remove('danger');
  await B2.flush(); await purgeNotes(id); const rest = list.filter(x => x.id !== id); await store.put('kv', 'sheets:' + t.id, rest);
  toast(`"${cur.name}" deleted`);
  if (rest.length) await loadSheet(rest[0].id); else await closeSplit();
};
/* divider between the two windows: hold and drag left or right */
(() => {
  const dv = $('#divider'); let saved = 0.5;
  store.get('kv', 'splitW').then(v => { if (v) { saved = v; $('#panes').style.setProperty('--p2', (v * 100) + '%'); } }).catch(() => {});
  dv.addEventListener('pointerdown', e => {
    e.preventDefault(); try { dv.setPointerCapture(e.pointerId); } catch (_) {} dv.classList.add('drag');
    const mv = ev => { const r = $('#panes').getBoundingClientRect(); saved = Math.max(.2, Math.min(.8, (r.right - ev.clientX) / r.width)); $('#panes').style.setProperty('--p2', (saved * 100) + '%'); };
    const end = () => { dv.removeEventListener('pointermove', mv); dv.removeEventListener('pointerup', end); dv.removeEventListener('pointercancel', end); dv.classList.remove('drag'); store.put('kv', 'splitW', saved).catch(() => {}); };
    dv.addEventListener('pointermove', mv); dv.addEventListener('pointerup', end); dv.addEventListener('pointercancel', end);
  });
})();
