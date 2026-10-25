// Code workspace: editor with highlighting, console with keyboard input, and text files shared by Python and pseudocode.
import * as store from './store.js';
import * as pseudo from './pseudo.js';
import { lib as pdfLib } from './export.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let opts, root, ta, hl, gut, out, inWrap, inBox, list;
let cur = null;               // { kind: 'prog'|'txt', name, lang }
let LV = 'ol', LEVEL = 'ol', size = 20, running = null, worker = null, pyReady = false, waitInput = null;

const PS_KW = /\b(DECLARE|CONSTANT|INPUT|OUTPUT|PRINT|IF|THEN|ELSE|ENDIF|CASE|OF|OTHERWISE|ENDCASE|FOR|TO|STEP|NEXT|WHILE|DO|ENDWHILE|REPEAT|UNTIL|PROCEDURE|ENDPROCEDURE|CALL|FUNCTION|RETURNS|RETURN|ENDFUNCTION|BYREF|BYVAL|ARRAY|TYPE|ENDTYPE|OPENFILE|READFILE|WRITEFILE|CLOSEFILE|READ|WRITE|APPEND)\b/;
const PS_TYPES = /\b(INTEGER|REAL|STRING|CHAR|BOOLEAN|DATE|TRUE|FALSE|AND|OR|NOT|DIV|MOD)\b/;
const PY_KW = /\b(def|return|if|elif|else|for|while|in|not|and|or|is|break|continue|pass|import|from|as|class|try|except|finally|with|lambda|None|True|False|global|raise|yield|del)\b/;
const PY_BI = /\b(print|input|int|float|str|len|range|open|list|dict|set|tuple|round|abs|min|max|sum|sorted|enumerate|type|bool|ord|chr|random|split|strip|append|readline|readlines|write|close)\b/;
// colours shared by the screen and the recording
const COL = { kw: '#F2B53A', ty: '#5CE1FF', str: '#7CF29A', num: '#ff9f6b', com: '#7b7896', op: '#5CE1FF', fn: '#c9a7ff', txt: '#F5F1EA' };
function tokens(line, lang) {
  if (lang === 'txt') return [[line, 'txt']];
  const out = []; let i = 0;
  const push = (s, c) => { if (s) out.push([s, c]); };
  while (i < line.length) {
    const rest = line.slice(i);
    let m;
    if ((lang === 'py' && rest[0] === '#') || (lang === 'ps' && rest.startsWith('//'))) { push(rest, 'com'); break; }
    if ((m = /^("[^"]*"?|'[^']*'?)/.exec(rest))) { push(m[0], 'str'); i += m[0].length; continue; }
    if ((m = /^\d+(\.\d+)?/.exec(rest))) { push(m[0], 'num'); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_]\w*/.exec(rest))) {
      const w = m[0]; let c = 'txt';
      if (lang === 'ps') { if (PS_KW.test(w) && w === w.toUpperCase() && new RegExp('^' + PS_KW.source + '$').test(w)) c = 'kw'; else if (new RegExp('^' + PS_TYPES.source + '$').test(w)) c = 'ty'; }
      else { if (new RegExp('^' + PY_KW.source + '$').test(w)) c = 'kw'; else if (new RegExp('^' + PY_BI.source + '$').test(w)) c = 'fn'; }
      push(w, c); i += w.length; continue;
    }
    if ((m = /^(←|<-|<=|>=|<>|==|!=|[=<>+\-*/^&%])/.exec(rest))) { push(m[0], 'op'); i += m[0].length; continue; }
    push(rest[0], 'txt'); i++;
  }
  return out;
}

/* ---------- storage ---------- */
// every level (O Level, AS, A2) has its own programs and text files
const PP = () => `cp:${LV}:`, FP = () => `cf:${LV}:`;
const progKey = n => PP() + n, fileKey = n => FP() + n;
export async function listProgs() { const p = PP(); return (await store.getPrefix('kv', p)).map(([k, v]) => ({ name: k.slice(p.length), ...v })).sort((a, b) => b.updated - a.updated); }
export async function listFiles() { const p = FP(); return (await store.getPrefix('kv', p)).map(([k, v]) => ({ name: k.slice(p.length), text: v })); }
const readFile = async n => { const v = await store.get('kv', fileKey(n)); return v === undefined ? null : v; };
const writeFile = (n, t) => store.put('kv', fileKey(n), t);

const SAMPLES = {
  'Marks.txt': { txt: '45\n78\n90\n62\n' },
  'Average marks (pseudocode)': { lang: 'ps', code: `// Reads marks from a text file, then writes a report file
DECLARE Line : STRING
DECLARE Total, Count : INTEGER
Total <- 0
Count <- 0
OPENFILE "Marks.txt" FOR READ
WHILE NOT EOF("Marks.txt")
    READFILE "Marks.txt", Line
    Total <- Total + STR_TO_NUM(Line)
    Count <- Count + 1
ENDWHILE
CLOSEFILE "Marks.txt"
OUTPUT "Average: ", Total / Count
OPENFILE "Report.txt" FOR WRITE
WRITEFILE "Report.txt", "Students: " & NUM_TO_STR(Count)
WRITEFILE "Report.txt", "Average: " & NUM_TO_STR(Total / Count)
CLOSEFILE "Report.txt"
OUTPUT "Report.txt written"
` },
  'Average marks (Python)': { lang: 'py', code: `# Reads marks from a text file, then writes a report file
total = 0
count = 0
with open("Marks.txt", "r") as f:
    for line in f:
        total += int(line)
        count += 1
print("Average:", total / count)

name = input("Your name: ")
with open("Report.txt", "w") as f:
    f.write("Checked by " + name + "\\n")
    f.write("Average: " + str(total / count) + "\\n")
print("Report.txt written")
` },
};
async function ensureSamples() {
  if (await store.get('kv', 'ideInit:' + LV)) return;
  if (LV.startsWith('t:')) { await store.put('kv', 'ideInit:' + LV, 1); return; }   // a subtopic starts empty
  if (LV === 'ol') { // programs made before levels existed move into O Level
    for (const [k, v] of await store.getPrefix('kv', 'prog:')) { await store.put('kv', progKey(k.slice(5)), v); await store.del('kv', k); }
    for (const [k, v] of await store.getPrefix('kv', 'file:')) { await store.put('kv', fileKey(k.slice(5)), v); await store.del('kv', k); }
  }
  for (const [n, v] of Object.entries(SAMPLES)) {
    if (LV === 'a2' && v.lang === 'ps') continue;
    if (v.txt) { if ((await readFile(n)) === null) await writeFile(n, v.txt); }
    else if (!(await store.get('kv', progKey(n)))) await store.put('kv', progKey(n), { lang: v.lang, code: v.code, updated: Date.now() });
  }
  await store.put('kv', 'ideInit:' + LV, 1);
}

/* ---------- UI ---------- */
export function init(o) {
  opts = o; root = $('#ide');
  root.innerHTML = `
  <div class="ide-bar">
    <div class="seg" role="tablist" aria-label="Language"><button data-lang="ps">Pseudocode</button><button data-lang="py">Python</button></div>
    <button class="ib" id="ideFiles" aria-label="Show programs and text files">☰ Files</button>
    <span class="ide-name" id="ideName"></span>
    <span class="ide-sp"></span>
    <button class="ib" data-ins="←" aria-label="Insert arrow">←</button><button class="ib" data-ins="    " aria-label="Insert indent">⇥</button>
    <button class="ib" data-ins=":">:</button><button class="ib" data-ins='"'>"</button><button class="ib" data-ins="()">( )</button><button class="ib" data-ins="[]">[ ]</button>
    <button class="ib" id="ideSm" aria-label="Smaller text">A−</button><button class="ib" id="ideLg" aria-label="Bigger text">A+</button>
    <button class="ib ann" id="ideAnn" aria-label="Annotate this program with the pen">✎ Annotate</button>
    <button class="run" id="ideRun">▶ Run</button><button class="stop" id="ideStop" hidden>■ Stop</button>
  </div>
  <div class="ide-main">
    <aside class="ide-side" id="ideSide"></aside>
    <div class="ed" id="ideEd"><div class="gut" id="ideGut"></div><div class="edw"><pre class="hl" id="ideHl" aria-hidden="true"></pre><textarea id="ideTa" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="Code editor"></textarea></div></div>
  </div>
  <div class="ide-con"><div class="con-head"><span>Output</span><button class="ib" id="ideClr">Clear</button></div><div class="con-out" id="ideOut"></div></div>`;
  ta = $('#ideTa'); hl = $('#ideHl'); gut = $('#ideGut'); out = $('#ideOut'); list = $('#ideSide');
  ta.addEventListener('input', () => { paint(); saveSoon(); });
  ta.addEventListener('scroll', syncScroll);
  ta.addEventListener('keydown', keys);
  root.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => setLang(b.dataset.lang));
  root.querySelectorAll('[data-ins]').forEach(b => b.onclick = () => insert(b.dataset.ins));
  $('#ideRun').onclick = runIt; $('#ideStop').onclick = stopIt; $('#ideClr').onclick = () => { out.innerHTML = ''; };
  $('#ideSm').onclick = () => setSize(size - 2); $('#ideLg').onclick = () => setSize(size + 2);
  $('#ideFiles').onclick = () => { root.classList.toggle('noside'); store.put('kv', 'ideSide', !root.classList.contains('noside')).catch(() => {}); };
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener && 0;
}
export async function open(lv, level) {
  if (lv !== LV || !cur) { await saveNow(); LV = lv; cur = null; out.innerHTML = ''; }
  LEVEL = level || lv; const defaultLang = LEVEL === 'a2' ? 'py' : 'ps';
  await ensureSamples();
  size = (await store.get('kv', 'ideSize')) || 20; setSize(size);
  if ((await store.get('kv', 'ideSide')) === false) root.classList.add('noside');
  const last = await store.get('kv', 'ideLast:' + LV);
  if (!cur) {
    const progs = await listProgs();
    const pick = (last && progs.find(p => p.name === last)) || progs.find(p => p.lang === defaultLang) || progs[0];
    if (pick) await openDoc({ kind: 'prog', name: pick.name, lang: pick.lang }); else await newProgram(defaultLang);
  }
  await renderSide(); paint();
}
function setSize(s) { size = Math.max(12, Math.min(40, s)); root.style.setProperty('--fs', size + 'px'); store.put('kv', 'ideSize', size).catch(() => {}); paint(); }
async function openDoc(d) {
  await saveNow(); cur = d;
  if (d.kind === 'prog') { const p = await store.get('kv', progKey(d.name)); ta.value = p ? p.code : ''; cur.lang = p ? p.lang : d.lang; store.put('kv', 'ideLast:' + LV, d.name).catch(() => {}); }
  else { ta.value = (await readFile(d.name)) || ''; }
  root.querySelectorAll('[data-lang]').forEach(b => b.classList.toggle('on', cur.kind === 'prog' && b.dataset.lang === cur.lang));
  $('#ideName').textContent = d.kind === 'prog' ? d.name + (cur.lang === 'py' ? '.py' : '') : '📄 ' + d.name;
  $('#ideRun').disabled = d.kind !== 'prog';
  ta.scrollTop = 0; paint(); renderSide(); opts.changed && opts.changed();
}
async function setLang(l) {
  if (cur && cur.kind === 'prog') { cur.lang = l; await saveNow(); openDoc(cur); }
  else { const progs = await listProgs(); const p = progs.find(x => x.lang === l); if (p) openDoc({ kind: 'prog', name: p.name, lang: l }); else newProgram(l); }
}
let saveT = 0;
function saveSoon() { clearTimeout(saveT); saveT = setTimeout(saveNow, 600); }
async function saveNow() {
  clearTimeout(saveT); if (!cur) return;
  if (cur.kind === 'prog') await store.put('kv', progKey(cur.name), { lang: cur.lang, code: ta.value, updated: Date.now() });
  else await writeFile(cur.name, ta.value);
}
async function newProgram(lang) {
  const progs = await listProgs(); let n = 1; while (progs.some(p => p.name === 'Program ' + n)) n++;
  const name = 'Program ' + n; await store.put('kv', progKey(name), { lang, code: lang === 'py' ? 'print("Hello from CSwithSR")\n' : 'OUTPUT "Hello from CSwithSR"\n', updated: Date.now() });
  await openDoc({ kind: 'prog', name, lang });
}
async function renderSide() {
  const progs = await listProgs(), files = await listFiles();
  list.innerHTML = `<div class="sh">Programs <button class="ib sm" id="sNewP">+ New</button></div>
    ${progs.map(p => `<div class="si ${cur && cur.kind === 'prog' && cur.name === p.name ? 'on' : ''}" data-p="${esc(p.name)}"><span class="lg ${p.lang}">${p.lang === 'py' ? 'PY' : 'PS'}</span><span class="nm">${esc(p.name)}</span><button class="x" data-ren="${esc(p.name)}" aria-label="Rename">✎</button><button class="x" data-del="${esc(p.name)}" aria-label="Delete">✕</button></div>`).join('')}
    <div class="sh">Text files <button class="ib sm" id="sNewF">+ New</button></div>
    ${files.map(f => `<div class="si ${cur && cur.kind === 'txt' && cur.name === f.name ? 'on' : ''}" data-f="${esc(f.name)}"><span class="lg txt">TXT</span><span class="nm">${esc(f.name)}</span><button class="x" data-fdel="${esc(f.name)}" aria-label="Delete">✕</button></div>`).join('') || '<p class="hint">No text files yet</p>'}`;
  list.querySelectorAll('[data-p]').forEach(el => el.onclick = e => { if (e.target.closest('.x')) return; const p = progs.find(x => x.name === el.dataset.p); openDoc({ kind: 'prog', name: p.name, lang: p.lang }); });
  list.querySelectorAll('[data-f]').forEach(el => el.onclick = e => { if (e.target.closest('.x')) return; openDoc({ kind: 'txt', name: el.dataset.f }); });
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (b.dataset.sure) { await store.del('kv', progKey(b.dataset.del)); if (cur && cur.name === b.dataset.del) { cur = null; const ps = await listProgs(); if (ps[0]) await openDoc({ kind: 'prog', name: ps[0].name, lang: ps[0].lang }); else await newProgram('ps'); } renderSide(); } else { b.dataset.sure = 1; b.textContent = 'Delete?'; b.classList.add('sure'); } });
  list.querySelectorAll('[data-fdel]').forEach(b => b.onclick = async () => { if (b.dataset.sure) { await store.del('kv', fileKey(b.dataset.fdel)); if (cur && cur.kind === 'txt' && cur.name === b.dataset.fdel) { cur = null; const ps = await listProgs(); if (ps[0]) await openDoc({ kind: 'prog', name: ps[0].name, lang: ps[0].lang }); } renderSide(); } else { b.dataset.sure = 1; b.textContent = 'Delete?'; b.classList.add('sure'); } });
  list.querySelectorAll('[data-ren]').forEach(b => b.onclick = () => askName('Rename program', b.dataset.ren, async v => { if (!v || v === b.dataset.ren) return; const p = await store.get('kv', progKey(b.dataset.ren)); await store.put('kv', progKey(v), p); await store.del('kv', progKey(b.dataset.ren)); if (cur && cur.name === b.dataset.ren) cur.name = v; openDoc({ kind: 'prog', name: v, lang: p.lang }); }));
  $('#sNewP').onclick = () => askName('New program name', '', async v => { if (!v) return; const lang = (cur && cur.lang) || 'ps'; await store.put('kv', progKey(v), { lang, code: '', updated: Date.now() }); openDoc({ kind: 'prog', name: v, lang }); });
  $('#sNewF').onclick = () => askName('New text file name', 'Data.txt', async v => { if (!v) return; if (!/\.\w+$/.test(v)) v += '.txt'; if ((await readFile(v)) === null) await writeFile(v, ''); openDoc({ kind: 'txt', name: v }); });
}
function askName(title, value, done) {
  const row = document.createElement('div'); row.className = 'askrow';
  row.innerHTML = `<label>${esc(title)}<input value="${esc(value)}"></label><button class="ib run">OK</button><button class="ib">Cancel</button>`;
  list.prepend(row); const inp = row.querySelector('input'); inp.focus(); inp.select();
  const fin = v => { row.remove(); done(v); };
  row.querySelectorAll('button')[0].onclick = () => fin(inp.value.trim().replace(/[\\/:*?"<>|]/g, ''));
  row.querySelectorAll('button')[1].onclick = () => fin('');
  inp.onkeydown = e => { if (e.key === 'Enter') fin(inp.value.trim().replace(/[\\/:*?"<>|]/g, '')); };
}

/* ---------- editor ---------- */
const langOf = () => !cur ? 'ps' : cur.kind === 'txt' ? 'txt' : cur.lang;
function paint() {
  if (!ta) return; const lines = ta.value.split('\n'), L = langOf();
  hl.innerHTML = lines.map(l => tokens(l, L).map(([s, c]) => c === 'txt' ? esc(s) : `<span style="color:${COL[c]}">${esc(s)}</span>`).join('')).join('\n') + '\n';
  gut.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
  syncScroll();
}
function syncScroll() { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; opts && opts.changed && opts.changed(); }
function insert(text) {
  const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
  const pair = text === '()' || text === '[]'; const ins = pair ? text[0] + v.slice(a, b) + text[1] : text;
  ta.value = v.slice(0, a) + ins + v.slice(b); const caret = pair ? a + 1 + (b - a) : a + ins.length;
  ta.focus(); ta.setSelectionRange(caret, caret); paint(); saveSoon();
}
function keys(e) {
  if (e.key === 'Tab') { e.preventDefault(); insert('    '); return; }
  if (e.key === 'Enter') {
    const a = ta.selectionStart, v = ta.value, ls = v.lastIndexOf('\n', a - 1) + 1, line = v.slice(ls, a);
    let ind = (/^\s*/.exec(line) || [''])[0]; const t = line.trim();
    if (langOf() === 'py' && /:\s*(#.*)?$/.test(t)) ind += '    ';
    if (langOf() === 'ps' && (/^(IF|ELSE|FOR|WHILE|REPEAT|PROCEDURE|FUNCTION|CASE|TYPE|THEN)\b/.test(t) || /\b(THEN|DO)$/.test(t)) && !/ENDIF|ENDWHILE|NEXT/.test(t)) ind += '    ';
    e.preventDefault(); insert('\n' + ind);
  }
}

/* ---------- console ---------- */
function write(text, cls) {
  let last = out.lastElementChild;
  if (!last || last.tagName !== 'SPAN' || last.className !== (cls || '')) { last = document.createElement('span'); if (cls) last.className = cls; out.appendChild(last); }
  last.textContent += text;
  if (out.textContent.length > 200000) out.firstElementChild && out.firstElementChild.remove();
  out.scrollTop = out.scrollHeight; opts.changed && opts.changed();
}
function askInput() {
  return new Promise(res => {
    const box = document.createElement('input'); box.className = 'con-in'; box.setAttribute('aria-label', 'Program input'); box.autocapitalize = 'off'; box.autocomplete = 'off';
    out.appendChild(box); box.focus(); out.scrollTop = out.scrollHeight;
    waitInput = v => { box.remove(); waitInput = null; write(v + '\n', 'in'); res(v); };
    box.onkeydown = e => { if (e.key === 'Enter') waitInput(box.value); };
  });
}
function setRunning(r) { running = r; $('#ideRun').hidden = !!r; $('#ideStop').hidden = !r; opts.changed && opts.changed(); }

async function runIt() {
  if (running || !cur || cur.kind !== 'prog') return;
  await saveNow(); out.innerHTML = '';
  if (cur.lang === 'ps') return runPseudo();
  return runPython();
}
async function runPseudo() {
  const state = { stop: false }; setRunning(state);
  try {
    await pseudo.run(ta.value, {
      output: t => write(t + '\n'), input: () => askInput(), stopped: () => state.stop,
      files: { read: readFile, write: writeFile }, fileChanged: () => renderSide(),
    });
    write('\n— Program finished —\n', 'dim');
  } catch (e) {
    if (e.message === 'Program stopped') write('\n— Stopped —\n', 'dim');
    else { write(`\nError${e.line ? ' on line ' + e.line : ''}: ${e.message}\n`, 'err'); if (e.line) markLine(e.line); }
  }
  setRunning(null); renderSide();
}
function markLine(n) { const lines = ta.value.split('\n'); const a = lines.slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0); ta.focus(); ta.setSelectionRange(a, a + (lines[n - 1] || '').length); }
function ensureWorker() {
  if (worker) return worker;
  pyReady = false; worker = new Worker('js/pyworker.js');
  worker.onmessage = async e => {
    const m = e.data;
    if (m.t === 'status') write(m.s + (navigator.onLine ? '' : ' (offline)') + '\n', 'dim');
    else if (m.t === 'ready') { pyReady = true; const last = out.lastElementChild; if (last && last.className === 'dim' && /Loading Python/.test(last.textContent)) last.remove(); }
    else if (m.t === 'fatal') { write(m.s + '\n', 'err'); worker.terminate(); worker = null; setRunning(null); }
    else if (m.t === 'out') write(m.s);
    else if (m.t === 'err') write(m.s, 'err');
    else if (m.t === 'input') { const v = await askInput(); const sw = navigator.serviceWorker && navigator.serviceWorker.controller; if (sw) sw.postMessage({ t: 'stdin', id: m.id, text: v }); else write('input() needs the installed app.\n', 'err'); }
    else if (m.t === 'done') {
      const before = Object.fromEntries((await listFiles()).map(f => [f.name, f.text]));
      for (const [n, t] of Object.entries(m.files)) if (before[n] !== t) await writeFile(n, t);
      write('\n— Program finished —\n', 'dim'); setRunning(null); renderSide();
      if (cur && cur.kind === 'txt' && m.files[cur.name] !== undefined) { ta.value = m.files[cur.name]; paint(); }
    }
  };
  return worker;
}
async function runPython() {
  const files = Object.fromEntries((await listFiles()).map(f => [f.name, f.text]));
  setRunning({ py: true }); ensureWorker().postMessage({ t: 'run', code: ta.value, files });
}
function stopIt() {
  if (!running) return;
  if (running.py) { if (worker) worker.terminate(); worker = null; if (waitInput) { const b = out.querySelector('.con-in'); b && b.remove(); waitInput = null; } write('\n— Stopped —\n', 'dim'); setRunning(null); }
  else running.stop = true;
}
// warm Python up in the background when the code tab opens on Python
export function prewarm() { if (cur && cur.lang === 'py') ensureWorker(); }
export const visible = () => !root.hidden;

/* ---------- draw the workspace into the recording ---------- */
export function drawInto(ctx) {
  const R = el => el.getBoundingClientRect();
  const box = R(root), bar = R(root.querySelector('.ide-bar')), ed = R($('#ideEd')), con = R(root.querySelector('.ide-con')), side = R(list);
  ctx.save(); ctx.beginPath(); ctx.roundRect(box.left, box.top, box.width, box.height, [0, 0, 16, 16]); ctx.clip();
  ctx.fillStyle = '#0f0f13'; ctx.fillRect(box.left, box.top, box.width, box.height);
  ctx.fillStyle = '#16142a'; ctx.fillRect(bar.left, bar.top, bar.width, bar.height);
  ctx.textBaseline = 'middle'; ctx.font = '700 14px "Space Grotesk", sans-serif'; ctx.fillStyle = '#F2B53A'; ctx.textAlign = 'left';
  ctx.fillText((cur && cur.kind === 'prog' ? (cur.lang === 'py' ? 'Python' : 'Pseudocode') + ' · ' : '') + $('#ideName').textContent, bar.left + 14, bar.top + bar.height / 2);
  if (running) { ctx.fillStyle = '#7CF29A'; ctx.textAlign = 'right'; ctx.fillText('● Running', bar.right - 14, bar.top + bar.height / 2); }
  if (!root.classList.contains('noside') && side.width > 10) {
    ctx.fillStyle = '#121022'; ctx.fillRect(side.left, side.top, side.width, side.height); ctx.textAlign = 'left'; ctx.font = '600 13px "Space Grotesk", sans-serif';
    for (const el of list.querySelectorAll('.sh,.si')) { const r = R(el); if (r.bottom < side.top || r.top > side.bottom) continue; ctx.fillStyle = el.classList.contains('sh') ? '#5CE1FF' : el.classList.contains('on') ? '#F2B53A' : '#d9d4f0'; ctx.fillText(el.classList.contains('sh') ? el.firstChild.textContent.trim().toUpperCase() : el.querySelector('.nm').textContent, r.left + (el.classList.contains('sh') ? 6 : 44), r.top + r.height / 2); }
  }
  // code
  const cs = getComputedStyle(ta), fs = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight) || fs * 1.5, padT = parseFloat(cs.paddingTop), padL = parseFloat(cs.paddingLeft);
  const taR = R(ta), gr = R(gut); ctx.font = `${fs}px "JetBrains Mono", ui-monospace, monospace`; const cw = ctx.measureText('M').width;
  ctx.fillStyle = '#121022'; ctx.fillRect(gr.left, ed.top, gr.width, ed.height);
  const lines = ta.value.split('\n'), first = Math.max(0, Math.floor((ta.scrollTop - padT) / lh)), L = langOf();
  ctx.save(); ctx.beginPath(); ctx.rect(ed.left, ed.top, ed.width, ed.height); ctx.clip();
  for (let i = first; i < lines.length; i++) {
    const y = taR.top + padT + i * lh - ta.scrollTop + lh / 2; if (y - lh > ed.bottom) break;
    ctx.textAlign = 'right'; ctx.fillStyle = '#5d5a78'; ctx.fillText(String(i + 1), gr.right - 8, y); ctx.textAlign = 'left';
    let x = taR.left + padL - ta.scrollLeft;
    for (const [s, c] of tokens(lines[i], L)) { ctx.fillStyle = COL[c] || COL.txt; ctx.fillText(s, x, y); x += cw * s.length; }
  }
  ctx.restore();
  // console
  ctx.fillStyle = '#0a0918'; ctx.fillRect(con.left, con.top, con.width, con.height);
  ctx.fillStyle = '#5CE1FF'; ctx.font = '700 12px "JetBrains Mono", monospace'; ctx.fillText('OUTPUT', con.left + 14, con.top + 16);
  const ofs = parseFloat(getComputedStyle(out).fontSize), olh = ofs * 1.45; ctx.font = `${ofs}px "JetBrains Mono", monospace`;
  const segs = []; let curLine = []; for (const sp of out.children) { if (sp.tagName !== 'SPAN') continue; const parts = sp.textContent.split('\n'); parts.forEach((p, k) => { if (k) { segs.push(curLine); curLine = []; } if (p) curLine.push([p, sp.className]); }); } segs.push(curLine);
  const box2 = R(out), maxL = Math.floor(box2.height / olh); const show = segs.slice(-maxL);
  ctx.save(); ctx.beginPath(); ctx.rect(box2.left, box2.top, box2.width, box2.height); ctx.clip();
  show.forEach((ln, k) => { let x = box2.left + 14; const y = box2.top + 8 + k * olh + olh / 2; for (const [s, c] of ln) { ctx.fillStyle = c === 'err' ? '#ff8a84' : c === 'in' ? '#5CE1FF' : c === 'dim' ? '#7b7896' : '#F5F1EA'; ctx.fillText(s, x, y); x += ctx.measureText(s).width; } });
  if (waitInput) { const y = box2.top + 8 + show.length * olh - olh / 2; ctx.fillStyle = '#F2B53A'; ctx.fillRect(box2.left + 14 + (show.length ? ctx.measureText(show[show.length - 1].map(s => s[0]).join('')).width : 0), y - ofs / 2, 2, ofs); }
  ctx.restore(); ctx.restore();
}

/* ---------- annotation pages: the program as PDF pages with room to write ---------- */
export const current = () => cur && { ...cur, level: LV };
export async function snapshotPdf(levelLabel) {
  if (!cur || cur.kind !== 'prog') return null;
  await saveNow();
  try { await document.fonts.load('24px "JetBrains Mono"'); await document.fonts.load('700 30px "Space Grotesk"'); } catch (e) {}
  const JsPDF = await pdfLib();
  const W = 1240, H = 1754, codeX = 120, noteX = 960, top0 = 210, bottom = H - 110, LH = 46, FS = 22;
  const lang = cur.lang, L = lang, code = ta.value.replace(/\t/g, '    ').split('\n');
  while (code.length && !code[code.length - 1].trim()) code.pop();
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.font = `${FS}px "JetBrains Mono", monospace`; const cw = x.measureText('M').width, maxC = Math.max(20, Math.floor((noteX - 30 - codeX) / cw));
  // wrap long lines
  const rows = [];
  let kk = 0;
  code.forEach((ln, i) => {
    kk = 0;
    // wrap at a space where possible; continuation lines keep the indent plus 4
    let rest = ln, first = true; const ind = (/^\s*/.exec(ln) || [''])[0] + '    ';
    do {
      const room = first ? maxC : maxC - ind.length; let cut = rest.length <= room ? rest.length : rest.lastIndexOf(' ', room);
      if (cut <= room * .4) cut = Math.min(room, rest.length);
      rows.push({ n: first ? i + 1 : null, src: i + 1, k: kk++, t: (first ? '' : ind) + rest.slice(0, cut) }); rest = rest.slice(cut).replace(/^ /, ''); first = false;
    } while (rest.length);
  });
  const outText = out.innerText.replace(/\n?— Program finished —\n?/g, '').trim();
  const perPage = Math.floor((bottom - top0) / LH);
  const pages = []; for (let k = 0; k < rows.length || !pages.length; k += perPage) pages.push(rows.slice(k, k + perPage));
  const title = cur.name + (lang === 'py' ? '.py' : ''), doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const frame = (pn, total) => {
    x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#0b1230'; x.fillRect(0, 0, W, H);
    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.fillStyle = '#d4a537'; x.font = '700 20px "JetBrains Mono", monospace'; x.fillText(`CSWITHSR · CODE LAB · ${levelLabel.toUpperCase()}`, codeX - 60, 78);
    x.fillStyle = '#eef1fa'; x.font = '700 40px "Space Grotesk", sans-serif'; x.fillText(title, codeX - 60, 132);
    x.fillStyle = lang === 'py' ? '#7CF29A' : '#5CE1FF'; x.font = '700 20px "JetBrains Mono", monospace'; x.textAlign = 'right'; x.fillText(lang === 'py' ? 'PYTHON' : 'PSEUDOCODE', W - 60, 78);
    x.fillStyle = '#8f97b8'; x.font = '500 20px "Space Grotesk", sans-serif'; x.fillText(date, W - 60, 132);
    x.strokeStyle = 'rgba(212,165,55,.5)'; x.lineWidth = 2; x.beginPath(); x.moveTo(codeX - 60, 160); x.lineTo(W - 60, 160); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.12)'; x.setLineDash([6, 8]); x.beginPath(); x.moveTo(noteX, top0 - 20); x.lineTo(noteX, bottom); x.stroke(); x.setLineDash([]);
    x.fillStyle = 'rgba(255,255,255,.28)'; x.font = '700 16px "JetBrains Mono", monospace'; x.textAlign = 'left'; x.fillText('NOTES', noteX + 20, top0 - 2);
    x.fillStyle = '#8f97b8'; x.font = '500 18px "Space Grotesk", sans-serif'; x.textAlign = 'left'; x.fillText('@cswithsr', codeX - 60, H - 50);
    x.textAlign = 'right'; x.fillText(`Page ${pn} of ${total}`, W - 60, H - 50);
  };
  // the program output, if it was run, goes after the code
  const outRows = outText ? outText.split('\n').flatMap(l => { const r = []; for (let k = 0; k < Math.max(1, l.length); k += maxC) r.push(l.slice(k, k + maxC)); return r; }).slice(0, 200) : [];
  let outPages = []; if (outRows.length) { const lastRoom = perPage - pages[pages.length - 1].length - 2; if (lastRoom >= Math.min(outRows.length, 4)) { pages[pages.length - 1].outFrom = 0; } }
  const plan = pages.map(p => ({ code: p, out: [] }));
  if (outRows.length) {
    let rest = outRows.slice(); const lp = plan[plan.length - 1]; const room = perPage - lp.code.length - 2;
    if (room >= 3) { lp.out = rest.slice(0, room); rest = rest.slice(room); }
    while (rest.length) { plan.push({ code: [], out: rest.slice(0, perPage - 1) }); rest = rest.slice(perPage - 1); }
  }
  const layout = [];
  plan.forEach((pg, i) => {
    frame(i + 1, plan.length); let y = top0 + LH * .7; const lay = []; layout.push(lay);
    x.font = `${FS}px "JetBrains Mono", monospace`;
    for (const r of pg.code) {
      lay.push({ n: r.src, k: r.k, y });
      if (r.n) { x.textAlign = 'right'; x.fillStyle = '#5d6690'; x.fillText(String(r.n), codeX - 24, y); }
      x.textAlign = 'left'; let cx = codeX; for (const [t, col] of tokens(r.t, L)) { x.fillStyle = COL[col] || '#eef1fa'; x.fillText(t, cx, y); cx += cw * t.length; }
      y += LH;
    }
    if (pg.out.length) {
      y += LH * .3; const bh = (pg.out.length + 1) * LH * .8 + 20;
      x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.roundRect(codeX - 40, y - LH * .7, noteX - codeX + 10, bh, 12); x.fill();
      x.fillStyle = '#5CE1FF'; x.font = '700 18px "JetBrains Mono", monospace'; x.fillText('OUTPUT', codeX - 20, y - 6); y += LH * .8;
      x.font = `${FS * .9}px "JetBrains Mono", monospace`; x.fillStyle = '#eef1fa';
      for (const o of pg.out) { x.fillText(o, codeX - 20, y); y += LH * .8; }
    }
    if (i) doc.addPage('a4', 'portrait');
    doc.addImage(c.toDataURL('image/jpeg', .9), 'JPEG', 0, 0, 595.28, 841.89, undefined, 'FAST');
  });
  return { blob: doc.output('blob'), name: title, lang, prog: cur.name, lines: code, layout, W, LH };
}
