// Cambridge pseudocode interpreter (O Level 2210 / IGCSE 0478 and AS & A Level 9618 styles).
// run(source, io) where io = { output(text), input() -> Promise<string>, stopped() -> bool, files: { read(name) -> string|null, write(name, text) } }

const KW = new Set(('DECLARE CONSTANT INPUT OUTPUT PRINT IF THEN ELSE ENDIF CASE OF OTHERWISE ENDCASE FOR TO STEP NEXT WHILE DO ENDWHILE REPEAT UNTIL ' +
  'PROCEDURE ENDPROCEDURE CALL FUNCTION RETURNS RETURN ENDFUNCTION BYREF BYVAL ARRAY TYPE ENDTYPE AND OR NOT DIV MOD TRUE FALSE ' +
  'OPENFILE READFILE WRITEFILE CLOSEFILE READ WRITE APPEND').split(' '));
const TYPES = new Set(['INTEGER', 'REAL', 'STRING', 'CHAR', 'BOOLEAN', 'DATE']);

export class PseudoError extends Error { constructor(msg, line) { super(msg); this.line = line; } }
const err = (msg, line) => { throw new PseudoError(msg, line); };

/* ---------------- tokenizer ---------------- */
function tokenize(src) {
  const toks = []; const lines = src.replace(/\r/g, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\t/g, '    ').split('\n');
  lines.forEach((raw, li) => {
    const line = li + 1; let i = 0; const s = raw; let any = false;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') { i++; continue; }
      if (c === '/' && s[i + 1] === '/') break;
      any = true;
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1]))) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; toks.push({ k: 'num', v: parseFloat(s.slice(i, j)), line }); i = j; continue; }
      if (c === '"') { let j = i + 1; while (j < s.length && s[j] !== '"') j++; if (j >= s.length) err('A string is missing its closing quote "', line); toks.push({ k: 'str', v: s.slice(i + 1, j), line }); i = j + 1; continue; }
      if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) err("A character is missing its closing quote '", line); toks.push({ k: 'str', v: s.slice(i + 1, j), ch: true, line }); i = j + 1; continue; }
      if (/[A-Za-z_]/.test(c)) { let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++; const w = s.slice(i, j); toks.push({ k: KW.has(w) ? 'kw' : 'id', v: w, line }); i = j; continue; }
      const two = s.slice(i, i + 2);
      if (['<-', '<=', '>=', '<>', '!='].includes(two)) { toks.push({ k: 'op', v: two === '<-' ? '←' : two === '!=' ? '<>' : two, line }); i += 2; continue; }
      if ('←=<>+-*/^&()[],:.'.includes(c)) { toks.push({ k: 'op', v: c, line }); i++; continue; }
      if (c === '≠') { toks.push({ k: 'op', v: '<>', line }); i++; continue; }
      if (c === '≤' || c === '≥') { toks.push({ k: 'op', v: c === '≤' ? '<=' : '>=', line }); i++; continue; }
      err(`Unexpected character "${c}"`, line);
    }
    if (any) toks.push({ k: 'nl', line });
  });
  toks.push({ k: 'eof', line: lines.length });
  return toks;
}

/* ---------------- parser ---------------- */
function parse(src) {
  const T = tokenize(src); let p = 0;
  const peek = (o = 0) => T[p + o], line = () => T[p].line;
  const is = (k, v) => T[p].k === k && (v === undefined || T[p].v === v);
  const isKw = v => is('kw', v), isOp = v => is('op', v);
  const take = () => T[p++];
  const want = (k, v, what) => { if (!is(k, v)) err(`Expected ${what || v || k} but found ${T[p].k === 'nl' ? 'end of line' : T[p].k === 'eof' ? 'end of program' : '"' + T[p].v + '"'}`, line()); return take(); };
  const skipNl = () => { while (is('nl')) p++; };
  const endLine = () => { if (!is('nl') && !is('eof')) err(`Unexpected "${T[p].v}" at the end of this line`, line()); skipNl(); };

  function type() {
    if (isKw('ARRAY')) {
      take(); want('op', '['); const dims = [];
      do { const lo = expr(); want('op', ':'); const hi = expr(); dims.push([lo, hi]); } while (isOp(',') && take());
      want('op', ']'); want('kw', 'OF'); return { array: true, dims, of: type() };
    }
    const t = take(); if (t.k !== 'id') err('Expected a data type such as INTEGER, REAL, STRING, CHAR or BOOLEAN', t.line);
    return TYPES.has(t.v) ? { base: t.v } : { user: t.v };
  }
  // expressions
  function expr() { return orE(); }
  function bin(next, ops) { return () => { let l = next(); while ((is('op') || is('kw')) && ops.includes(T[p].v)) { const o = take(); const r = next(); l = { e: 'bin', o: o.v, l, r, line: o.line }; } return l; }; }
  const powE = () => { const l = unary(); if (isOp('^')) { const o = take(); return { e: 'bin', o: '^', l, r: powE(), line: o.line }; } return l; };
  const mulE = bin(powE, ['*', '/', 'DIV', 'MOD']);
  const addE = bin(mulE, ['+', '-', '&']);
  function cmpE() { const l = addE(); if (is('op') && ['=', '<>', '<', '>', '<=', '>='].includes(T[p].v)) { const o = take(); return { e: 'bin', o: o.v, l, r: addE(), line: o.line }; } return l; }
  function notE() { if (isKw('NOT')) { const o = take(); return { e: 'not', x: notE(), line: o.line }; } return cmpE(); }
  const andE = bin(notE, ['AND']); const orE = bin(andE, ['OR']);
  function unary() { if (isOp('-')) { const o = take(); return { e: 'neg', x: unary(), line: o.line }; } if (isOp('+')) { take(); return unary(); } return postfix(primary()); }
  function args() { want('op', '('); const a = []; if (!isOp(')')) do a.push(expr()); while (isOp(',') && take()); want('op', ')'); return a; }
  function postfix(x) {
    for (;;) {
      if (isOp('[')) { const l = line(); take(); const ix = []; do ix.push(expr()); while (isOp(',') && take()); want('op', ']'); x = { e: 'idx', a: x, ix, line: l }; }
      else if (isOp('.') && peek(1).k === 'id') { take(); x = { e: 'fld', r: x, f: take().v, line: x.line }; }
      else return x;
    }
  }
  function primary() {
    const t = T[p];
    if (t.k === 'num') { take(); return { e: 'lit', v: t.v, line: t.line }; }
    if (t.k === 'str') { take(); return { e: 'lit', v: t.v, line: t.line }; }
    if (t.k === 'kw' && (t.v === 'TRUE' || t.v === 'FALSE')) { take(); return { e: 'lit', v: t.v === 'TRUE', line: t.line }; }
    if (t.k === 'kw' && (t.v === 'DIV' || t.v === 'MOD') && peek(1).k === 'op' && peek(1).v === '(') { take(); return { e: 'call', name: t.v, args: args(), line: t.line }; }
    if (t.k === 'op' && t.v === '(') { take(); const x = expr(); want('op', ')'); return x; }
    if (t.k === 'id') { take(); if (isOp('(')) return { e: 'call', name: t.v, args: args(), line: t.line }; return { e: 'var', name: t.v, line: t.line }; }
    err(t.k === 'nl' || t.k === 'eof' ? 'This line ends too early: a value is missing' : `Unexpected "${t.v}" in an expression`, t.line);
  }
  function lvalue() { const t = want('id', undefined, 'a variable name'); return postfix({ e: 'var', name: t.v, line: t.line }); }

  // statements
  function block(...ends) { const out = []; skipNl(); while (!(is('kw') && ends.includes(T[p].v))) { if (is('eof')) err(`Missing ${ends.join(' or ')}`, line()); out.push(stmt()); skipNl(); } return out; }
  function params() {
    const out = []; if (!isOp('(')) return out; take(); let byref = false;
    if (!isOp(')')) do {
      if (isKw('BYREF')) { take(); byref = true; } else if (isKw('BYVAL')) { take(); byref = false; }
      const n = want('id', undefined, 'a parameter name').v; want('op', ':'); out.push({ name: n, type: type(), byref });
    } while (isOp(',') && take());
    want('op', ')'); return out;
  }
  function isCaseLabel() {
    if (isKw('OTHERWISE') || isKw('ENDCASE')) return true;
    const save = p; try { expr(); if (isKw('TO')) { take(); expr(); } while (isOp(',')) { take(); expr(); if (isKw('TO')) { take(); expr(); } } const ok = isOp(':'); p = save; return ok; } catch (e) { p = save; return false; }
  }
  function stmt() {
    const t = T[p], l = t.line;
    if (t.k === 'kw') switch (t.v) {
      case 'DECLARE': { take(); const names = []; do names.push(want('id', undefined, 'a variable name').v); while (isOp(',') && take()); want('op', ':', '":" then a data type'); const ty = type(); endLine(); return { s: 'decl', names, type: ty, line: l }; }
      case 'CONSTANT': { take(); const n = want('id', undefined, 'a constant name').v; if (isOp('=') || isOp('←')) take(); else err('Write CONSTANT Name = value', l); const v = expr(); endLine(); return { s: 'const', name: n, x: v, line: l }; }
      case 'INPUT': case 'READ': { take(); const tg = lvalue(); endLine(); return { s: 'input', tg, line: l }; }
      case 'OUTPUT': case 'PRINT': { take(); const xs = []; do xs.push(expr()); while (isOp(',') && take()); endLine(); return { s: 'output', xs, line: l }; }
      case 'IF': { take(); const c = expr(); skipNl(); want('kw', 'THEN'); const th = block('ELSE', 'ENDIF'); let el = [];
        if (isKw('ELSE')) { take(); el = isKw('IF') ? [stmt(), ...block('ENDIF')] : block('ENDIF'); }
        want('kw', 'ENDIF'); endLine(); return { s: 'if', c, th, el, line: l }; }
      case 'CASE': { take(); want('kw', 'OF'); const subj = expr(); endLine(); const arms = []; let other = null;
        for (;;) {
          skipNl(); if (isKw('ENDCASE')) break;
          if (isKw('OTHERWISE')) { take(); if (isOp(':')) take(); other = []; skipNl(); while (!isKw('ENDCASE')) { if (is('eof')) err('Missing ENDCASE', l); other.push(stmt()); skipNl(); } break; }
          const vals = []; do { const a = expr(); if (isKw('TO')) { take(); vals.push({ lo: a, hi: expr() }); } else vals.push({ v: a }); } while (isOp(',') && take());
          want('op', ':', '":" after the CASE value'); const body = []; if (!is('nl')) body.push(stmt()); skipNl();
          while (!isCaseLabel()) { if (is('eof')) err('Missing ENDCASE', l); body.push(stmt()); skipNl(); }
          arms.push({ vals, body });
        }
        want('kw', 'ENDCASE'); endLine(); return { s: 'case', subj, arms, other, line: l }; }
      case 'FOR': { take(); const v = want('id', undefined, 'the loop counter').v; if (!isOp('←') && !isOp('=')) err('Write FOR Counter ← start TO end', l); take(); const a = expr(); want('kw', 'TO'); const b = expr(); let st = null; if (isKw('STEP')) { take(); st = expr(); }
        const body = block('NEXT'); take(); if (is('id')) take(); endLine(); return { s: 'for', v, a, b, st, body, line: l }; }
      case 'WHILE': { take(); const c = expr(); if (isKw('DO')) take(); const body = block('ENDWHILE'); take(); endLine(); return { s: 'while', c, body, line: l }; }
      case 'REPEAT': { take(); const body = block('UNTIL'); take(); const c = expr(); endLine(); return { s: 'repeat', c, body, line: l }; }
      case 'PROCEDURE': { take(); const n = want('id', undefined, 'a procedure name').v; const ps = params(); const body = block('ENDPROCEDURE'); take(); endLine(); return { s: 'proc', name: n, ps, body, line: l }; }
      case 'FUNCTION': { take(); const n = want('id', undefined, 'a function name').v; const ps = params(); want('kw', 'RETURNS'); const rt = type(); const body = block('ENDFUNCTION'); take(); endLine(); return { s: 'func', name: n, ps, rt, body, line: l }; }
      case 'CALL': { take(); const n = want('id', undefined, 'a procedure name').v; const a = isOp('(') ? args() : []; endLine(); return { s: 'call', name: n, args: a, line: l }; }
      case 'RETURN': { take(); const x = is('nl') || is('eof') ? null : expr(); endLine(); return { s: 'return', x, line: l }; }
      case 'TYPE': { take(); const n = want('id', undefined, 'a type name').v; endLine(); const fields = [];
        while (!isKw('ENDTYPE')) { if (is('eof')) err('Missing ENDTYPE', l); want('kw', 'DECLARE'); const names = []; do names.push(want('id').v); while (isOp(',') && take()); want('op', ':'); const ty = type(); endLine(); names.forEach(nm => fields.push({ name: nm, type: ty })); }
        take(); endLine(); return { s: 'type', name: n, fields, line: l }; }
      case 'OPENFILE': { take(); const f = expr(); want('kw', 'FOR', 'FOR READ, FOR WRITE or FOR APPEND'); const m = take(); if (!['READ', 'WRITE', 'APPEND'].includes(m.v)) err('Use FOR READ, FOR WRITE or FOR APPEND', l); endLine(); return { s: 'open', f, mode: m.v, line: l }; }
      case 'READFILE': { take(); const f = expr(); want('op', ','); const tg = lvalue(); endLine(); return { s: 'readf', f, tg, line: l }; }
      case 'WRITEFILE': { take(); const f = expr(); want('op', ','); const xs = []; do xs.push(expr()); while (isOp(',') && take()); endLine(); return { s: 'writef', f, xs, line: l }; }
      case 'CLOSEFILE': { take(); const f = expr(); endLine(); return { s: 'close', f, line: l }; }
      default: err(`"${t.v}" cannot start a line here`, l);
    }
    if (t.k === 'id') {
      const tg = lvalue();
      if (isOp('←') || isOp('=')) { const o = take(); if (o.v === '=') err('Use ← (or <-) to assign a value, not =', l); const x = expr(); endLine(); return { s: 'assign', tg, x, line: l }; }
      if (tg.e === 'var' && isOp('(')) err(`To run the procedure ${tg.name}, write CALL ${tg.name}(...)`, l);
      err(`Expected ← after ${t.v}`, l);
    }
    err(`Unexpected "${t.v}"`, l);
  }
  const prog = []; skipNl(); while (!is('eof')) { prog.push(stmt()); skipNl(); }
  return prog;
}

/* ---------------- runtime ---------------- */
class Ret { constructor(v) { this.v = v; } }
const fmt = v => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(12));
  if (typeof v === 'object') return v.t === 'arr' ? '[array]' : '[record]';
  return String(v);
};
const clone = v => v && typeof v === 'object' ? (v.t === 'arr' ? { ...v, data: v.data.map(clone) } : { t: 'rec', type: v.type, f: Object.fromEntries(Object.entries(v.f).map(([k, x]) => [k, clone(x)])) }) : v;

export async function run(src, io) {
  const prog = parse(src);
  const procs = {}, funcs = {}, types = {};
  const global = { vars: new Map(), parent: null };
  const files = {};
  let steps = 0;
  let lastYield = performance.now();
  const tick = async () => {
    if (io.stopped()) throw new PseudoError('Program stopped');
    if (++steps % 50 === 0 && performance.now() - lastYield > 25) { await new Promise(r => setTimeout(r, 0)); lastYield = performance.now(); if (io.stopped()) throw new PseudoError('Program stopped'); }
  };

  for (const s of prog) { if (s.s === 'proc') procs[s.name] = s; if (s.s === 'func') funcs[s.name] = s; if (s.s === 'type') types[s.name] = s; }

  async function make(type, line, env) {
    if (type.array) {
      const dims = []; for (const [a, b] of type.dims) { const lo = await ev(a, env), hi = await ev(b, env); if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) err('Array bounds must be whole numbers with the lower bound first', line); dims.push([lo, hi]); }
      const n = dims.reduce((m, [lo, hi]) => m * (hi - lo + 1), 1); if (n > 1e6) err('This array is too big', line);
      const data = []; for (let i = 0; i < n; i++) data.push(type.of.user || type.of.array ? await make(type.of, line, env) : null);
      return { t: 'arr', dims, data, of: type.of };
    }
    if (type.user) {
      const T = types[type.user]; if (!T) err(`Unknown data type ${type.user}`, line);
      const f = {}; for (const fd of T.fields) f[fd.name] = fd.type.user || fd.type.array ? await make(fd.type, line, env) : null;
      return { t: 'rec', type: type.user, f };
    }
    return null;
  }
  const lookup = (env, name) => { for (let e = env; e; e = e.parent) if (e.vars.has(name)) return e.vars.get(name); return null; };
  function check(type, v, line, name) {
    if (!type || !type.base || v === null) return v;
    const b = type.base;
    if ((b === 'INTEGER') && !(typeof v === 'number' && Number.isInteger(v))) err(`${name} is an INTEGER, so it cannot store ${typeof v === 'string' ? '"' + v + '"' : fmt(v)}`, line);
    if (b === 'REAL' && typeof v !== 'number') err(`${name} is REAL, so it cannot store ${typeof v === 'string' ? '"' + v + '"' : fmt(v)}`, line);
    if ((b === 'STRING' || b === 'CHAR') && typeof v !== 'string') err(`${name} is a ${b}, so it needs a value in quotes`, line);
    if (b === 'CHAR' && v.length !== 1) err(`${name} is a CHAR, so it holds exactly one character`, line);
    if (b === 'BOOLEAN' && typeof v !== 'boolean') err(`${name} is BOOLEAN, so it can only be TRUE or FALSE`, line);
    return v;
  }
  function arrIndex(a, ix, line) {
    if (ix.length !== a.dims.length) err(`This array has ${a.dims.length} dimension${a.dims.length > 1 ? 's' : ''}`, line);
    let k = 0; for (let d = 0; d < ix.length; d++) { const [lo, hi] = a.dims[d]; const i = ix[d]; if (!Number.isInteger(i)) err('An array index must be a whole number', line); if (i < lo || i > hi) err(`Index ${i} is outside the array (${lo} to ${hi})`, line); k = k * (hi - lo + 1) + (i - lo); }
    return k;
  }
  // a "cell" is anything with get v / set v, so BYREF can point at variables, array elements or record fields
  async function ref(x, env, forWrite) {
    if (x.e === 'var') {
      let c = lookup(env, x.name);
      if (!c) { if (!forWrite) err(`${x.name} has not been declared or given a value`, x.line); c = { v: null, type: null, name: x.name }; global.vars.set(x.name, c); }
      if (forWrite && c.constant) err(`${x.name} is a CONSTANT and cannot be changed`, x.line);
      return c;
    }
    if (x.e === 'idx') {
      const base = await ref(x.a, env, false); const a = base.v; if (!a || a.t !== 'arr') err(`${x.a.name || 'This'} is not an array`, x.line);
      const ix = []; for (const i of x.ix) ix.push(await ev(i, env)); const k = arrIndex(a, ix, x.line);
      const name = `${x.a.name || 'array'}[${ix.join(',')}]`;
      return { get v() { return a.data[k]; }, set v(val) { a.data[k] = check(a.of, val, x.line, name); }, type: a.of, name };
    }
    if (x.e === 'fld') {
      const base = await ref(x.r, env, false); const r = base.v; if (!r || r.t !== 'rec') err('This is not a record', x.line);
      if (!(x.f in r.f)) err(`The record type ${r.type} has no field ${x.f}`, x.line);
      const fd = types[r.type].fields.find(f => f.name === x.f);
      return { get v() { return r.f[x.f]; }, set v(val) { r.f[x.f] = check(fd.type, val, x.line, x.f); }, type: fd.type, name: x.f };
    }
    err('You can only assign to a variable, an array element or a record field', x.line);
  }
  const num = (v, line, what) => { if (typeof v !== 'number') err(`${what || 'This'} needs a number, but got ${typeof v === 'string' ? '"' + v + '"' : fmt(v)}`, line); return v; };
  const str = (v, line, what) => { if (typeof v !== 'string') err(`${what || 'This'} needs a string`, line); return v; };

  const BUILTIN = {
    LENGTH: (a, l) => str(a[0], l, 'LENGTH').length,
    LEFT: (a, l) => str(a[0], l, 'LEFT').slice(0, num(a[1], l)),
    RIGHT: (a, l) => { const s = str(a[0], l, 'RIGHT'), n = num(a[1], l); return n <= 0 ? '' : s.slice(-n); },
    MID: (a, l) => str(a[0], l, 'MID').substr(num(a[1], l) - 1, num(a[2], l)),
    SUBSTRING: (a, l) => str(a[0], l, 'SUBSTRING').substr(num(a[1], l) - 1, num(a[2], l)),
    UCASE: (a, l) => str(a[0], l, 'UCASE').toUpperCase(), LCASE: (a, l) => str(a[0], l, 'LCASE').toLowerCase(),
    TO_UPPER: (a, l) => str(a[0], l, 'TO_UPPER').toUpperCase(), TO_LOWER: (a, l) => str(a[0], l, 'TO_LOWER').toLowerCase(),
    NUM_TO_STR: (a, l) => fmt(num(a[0], l, 'NUM_TO_STR')),
    STR_TO_NUM: (a, l) => { const s = str(a[0], l, 'STR_TO_NUM'); if (s.trim() === '' || isNaN(+s)) err(`"${s}" is not a number`, l); return +s; },
    IS_NUM: (a, l) => { const s = str(a[0], l, 'IS_NUM'); return s.trim() !== '' && !isNaN(+s); },
    ASC: (a, l) => str(a[0], l, 'ASC').charCodeAt(0), CHR: (a, l) => String.fromCharCode(num(a[0], l, 'CHR')),
    INT: (a, l) => Math.trunc(num(a[0], l, 'INT')),
    ROUND: (a, l) => { const x = num(a[0], l, 'ROUND'), d = a.length > 1 ? num(a[1], l) : 0; return +x.toFixed(d); },
    RAND: (a, l) => Math.random() * num(a[0], l, 'RAND'),
    RANDOM: () => Math.random(),
    DIV: (a, l) => { const d = num(a[1], l); if (d === 0) err('Division by zero', l); return Math.trunc(num(a[0], l) / d); },
    MOD: (a, l) => { const d = num(a[1], l); if (d === 0) err('Division by zero', l); return num(a[0], l) % d; },
    EOF: (a, l) => { const f = files[fname(a[0], l)]; if (!f) err(`The file ${a[0]} is not open`, l); if (f.mode !== 'READ') err(`EOF needs the file to be open FOR READ`, l); return f.pos >= f.lines.length; },
  };
  const fname = (v, l) => { if (typeof v !== 'string' || !v) err('A file name must be a string, for example "Data.txt"', l); return v; };

  async function callUser(def, argXs, env, line) {
    if (argXs.length !== def.ps.length) err(`${def.name} needs ${def.ps.length} parameter${def.ps.length === 1 ? '' : 's'} but got ${argXs.length}`, line);
    const local = { vars: new Map(), parent: global };
    for (let i = 0; i < def.ps.length; i++) {
      const pd = def.ps[i], ax = argXs[i];
      if (pd.byref) { if (!['var', 'idx', 'fld'].includes(ax.e)) err(`${pd.name} is BYREF, so pass a variable, not a value`, line); local.vars.set(pd.name, await ref(ax, env, true)); }
      else local.vars.set(pd.name, { v: check(pd.type, clone(await ev(ax, env)), line, pd.name), type: pd.type, name: pd.name });
    }
    try { await exec(def.body, local); } catch (e) { if (e instanceof Ret) return e.v; throw e; }
    if (def.s === 'func') err(`FUNCTION ${def.name} finished without a RETURN`, line);
    return null;
  }

  async function ev(x, env) {
    switch (x.e) {
      case 'lit': return x.v;
      case 'var': { const c = await ref(x, env, false); if (c.v === null || c.v === undefined) err(`${x.name} has no value yet`, x.line); return c.v; }
      case 'idx': case 'fld': { const c = await ref(x, env, false); if (c.v === null || c.v === undefined) err(`${c.name} has no value yet`, x.line); return c.v; }
      case 'neg': return -num(await ev(x.x, env), x.line);
      case 'not': { const v = await ev(x.x, env); if (typeof v !== 'boolean') err('NOT needs TRUE or FALSE', x.line); return !v; }
      case 'call': {
        if (funcs[x.name]) return callUser(funcs[x.name], x.args, env, x.line);
        if (procs[x.name]) err(`${x.name} is a PROCEDURE, so use CALL ${x.name}(...) on its own line`, x.line);
        const b = BUILTIN[x.name] || BUILTIN[x.name.toUpperCase()]; if (!b) err(`There is no function called ${x.name}`, x.line);
        const a = []; for (const y of x.args) a.push(await ev(y, env)); return b(a, x.line);
      }
      case 'bin': {
        if (x.o === 'AND' || x.o === 'OR') {
          const l = await ev(x.l, env); if (typeof l !== 'boolean') err(`${x.o} needs TRUE or FALSE on both sides`, x.line);
          if (x.o === 'AND' && !l) return false; if (x.o === 'OR' && l) return true;
          const r = await ev(x.r, env); if (typeof r !== 'boolean') err(`${x.o} needs TRUE or FALSE on both sides`, x.line); return r;
        }
        const l = await ev(x.l, env), r = await ev(x.r, env);
        switch (x.o) {
          case '&': return fmt(l) + fmt(r);
          case '+': if (typeof l === 'string' || typeof r === 'string') err('Use & to join strings, not +', x.line); return num(l, x.line) + num(r, x.line);
          case '-': return num(l, x.line) - num(r, x.line);
          case '*': return num(l, x.line) * num(r, x.line);
          case '/': if (num(r, x.line) === 0) err('Division by zero', x.line); return num(l, x.line) / r;
          case 'DIV': if (num(r, x.line) === 0) err('Division by zero', x.line); return Math.trunc(num(l, x.line) / r);
          case 'MOD': if (num(r, x.line) === 0) err('Division by zero', x.line); return num(l, x.line) % r;
          case '^': return Math.pow(num(l, x.line), num(r, x.line));
          case '=': return l === r; case '<>': return l !== r;
          case '<': case '>': case '<=': case '>=': {
            if (typeof l !== typeof r) err(`Cannot compare ${fmt(l)} with ${fmt(r)}`, x.line);
            return x.o === '<' ? l < r : x.o === '>' ? l > r : x.o === '<=' ? l <= r : l >= r;
          }
        }
      }
    }
    err('Cannot work out this expression', x.line);
  }
  const truth = (v, line, what) => { if (typeof v !== 'boolean') err(`${what} needs a condition that is TRUE or FALSE`, line); return v; };

  async function exec(stmts, env) { for (const s of stmts) { await tick(); try { await one(s, env); } catch (e) { if (e instanceof PseudoError && !e.line) e.line = s.line; throw e; } } }
  async function one(s, env) {
    switch (s.s) {
      case 'proc': case 'func': case 'type': return;
      case 'decl': for (const n of s.names) env.vars.set(n, { v: await make(s.type, s.line, env), type: s.type.array || s.type.user ? null : s.type, name: n }); return;
      case 'const': { const v = await ev(s.x, env); env.vars.set(s.name, { v, type: null, name: s.name, constant: true }); return; }
      case 'assign': { const c = await ref(s.tg, env, true); c.v = check(c.type, clone(await ev(s.x, env)), s.line, c.name); return; }
      case 'input': {
        const c = await ref(s.tg, env, true); const raw = await io.input(); const b = c.type && c.type.base;
        let v = raw;
        if (b === 'INTEGER') { if (!/^\s*[-+]?\d+\s*$/.test(raw)) err(`${c.name} is an INTEGER, but "${raw}" is not a whole number`, s.line); v = parseInt(raw, 10); }
        else if (b === 'REAL') { if (raw.trim() === '' || isNaN(+raw)) err(`${c.name} is REAL, but "${raw}" is not a number`, s.line); v = +raw; }
        else if (b === 'BOOLEAN') { const u = raw.trim().toUpperCase(); if (u !== 'TRUE' && u !== 'FALSE') err(`${c.name} is BOOLEAN, so type TRUE or FALSE`, s.line); v = u === 'TRUE'; }
        else if (!b && raw.trim() !== '' && !isNaN(+raw)) v = +raw;
        c.v = check(c.type, v, s.line, c.name); return;
      }
      case 'output': { let out = ''; for (const x of s.xs) out += fmt(await ev(x, env)); io.output(out); return; }
      case 'if': return exec(truth(await ev(s.c, env), s.line, 'IF') ? s.th : s.el, env);
      case 'case': {
        const v = await ev(s.subj, env);
        for (const arm of s.arms) for (const m of arm.vals) {
          if (m.v ? v === await ev(m.v, env) : (v >= await ev(m.lo, env) && v <= await ev(m.hi, env))) return exec(arm.body, env);
        }
        if (s.other) return exec(s.other, env); return;
      }
      case 'for': {
        const c = await ref({ e: 'var', name: s.v, line: s.line }, env, true);
        const a = num(await ev(s.a, env), s.line, 'FOR'), b = num(await ev(s.b, env), s.line, 'FOR'), st = s.st ? num(await ev(s.st, env), s.line, 'STEP') : 1;
        if (st === 0) err('STEP cannot be 0', s.line);
        for (let i = a; st > 0 ? i <= b : i >= b; i += st) { await tick(); c.v = check(c.type, i, s.line, s.v); await exec(s.body, env); }
        return;
      }
      case 'while': while (truth(await ev(s.c, env), s.line, 'WHILE')) { await tick(); await exec(s.body, env); } return;
      case 'repeat': do { await tick(); await exec(s.body, env); } while (!truth(await ev(s.c, env), s.line, 'UNTIL')); return;
      case 'call': { const d = procs[s.name]; if (!d) err(funcs[s.name] ? `${s.name} is a FUNCTION, so use its value, for example X ← ${s.name}(...)` : `There is no procedure called ${s.name}`, s.line); await callUser(d, s.args, env, s.line); return; }
      case 'return': throw new Ret(s.x ? await ev(s.x, env) : null);
      case 'open': {
        const n = fname(await ev(s.f, env), s.line); if (files[n]) err(`${n} is already open. CLOSEFILE it first`, s.line);
        if (s.mode === 'READ') { const t = await io.files.read(n); if (t === null || t === undefined) err(`There is no file called ${n}. Create it in Files first, or write it FOR WRITE`, s.line); const lines = t.replace(/\r/g, '').split('\n'); if (lines.length && lines[lines.length - 1] === '') lines.pop(); files[n] = { mode: 'READ', lines, pos: 0 }; }
        else if (s.mode === 'WRITE') files[n] = { mode: 'WRITE', out: [] };
        else { const t = (await io.files.read(n)) || ''; const lines = t.replace(/\r/g, '').split('\n'); if (lines.length && lines[lines.length - 1] === '') lines.pop(); files[n] = { mode: 'APPEND', out: lines }; }
        return;
      }
      case 'readf': {
        const n = fname(await ev(s.f, env), s.line), f = files[n]; if (!f) err(`${n} is not open. Use OPENFILE ${n} FOR READ first`, s.line); if (f.mode !== 'READ') err(`${n} is open FOR ${f.mode}, not FOR READ`, s.line);
        if (f.pos >= f.lines.length) err(`There are no more lines in ${n}. Check EOF("${n}") before reading`, s.line);
        const c = await ref(s.tg, env, true); let v = f.lines[f.pos++]; const b = c.type && c.type.base;
        if (b === 'INTEGER' || b === 'REAL') { if (v.trim() === '' || isNaN(+v)) err(`${c.name} is ${b}, but the line "${v}" is not a number`, s.line); v = +v; }
        else if (b === 'BOOLEAN') v = v.trim().toUpperCase() === 'TRUE';
        c.v = check(c.type, v, s.line, c.name); return;
      }
      case 'writef': {
        const n = fname(await ev(s.f, env), s.line), f = files[n]; if (!f) err(`${n} is not open. Use OPENFILE ${n} FOR WRITE first`, s.line); if (f.mode === 'READ') err(`${n} is open FOR READ, so you cannot write to it`, s.line);
        let line = ''; for (const x of s.xs) line += fmt(await ev(x, env)); f.out.push(line); return;
      }
      case 'close': {
        const n = fname(await ev(s.f, env), s.line), f = files[n]; if (!f) err(`${n} is not open`, s.line);
        if (f.mode !== 'READ') await io.files.write(n, f.out.join('\n') + (f.out.length ? '\n' : ''));
        delete files[n]; io.fileChanged && io.fileChanged(n); return;
      }
    }
  }

  try { await exec(prog, global); }
  catch (e) { if (e instanceof Ret) err('RETURN can only be used inside a FUNCTION', null); throw e; }
  finally {
    // files left open are saved so work is not lost
    for (const [n, f] of Object.entries(files)) if (f.mode !== 'READ') { await io.files.write(n, f.out.join('\n') + (f.out.length ? '\n' : '')); io.output(`(Note: ${n} was not closed with CLOSEFILE, so it was saved automatically.)`); }
  }
}
export { parse, tokenize };
