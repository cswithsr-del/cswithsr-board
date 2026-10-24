// IndexedDB wrapper. Stores: kv (settings), topics (notes per topic), blobs (PDFs, recording chunks), recs (recording records)
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((ok, no) => {
    const r = indexedDB.open('cswithsr-board', 1);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ['kv', 'topics', 'blobs', 'recs']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  return dbp;
}
const tx = (s, mode, fn) => db().then(d => new Promise((ok, no) => {
  const t = d.transaction(s, mode); const st = t.objectStore(s); let out; const r = fn(st);
  if (r) r.onsuccess = () => { out = r.result; };
  t.oncomplete = () => ok(out); t.onerror = () => no(t.error); t.onabort = () => no(t.error);
}));
export const get = (s, k) => tx(s, 'readonly', st => st.get(k));
export const put = (s, k, v) => tx(s, 'readwrite', st => st.put(v, k));
export const del = (s, k) => tx(s, 'readwrite', st => st.delete(k));
export const delPrefix = (s, p) => tx(s, 'readwrite', st => st.delete(IDBKeyRange.bound(p, p + '￿')));
export const all = s => db().then(d => new Promise((ok, no) => {
  const out = []; const r = d.transaction(s).objectStore(s).openCursor();
  r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else ok(out); }; r.onerror = () => no(r.error);
}));
export const getPrefix = (s, p) => db().then(d => new Promise((ok, no) => {
  const out = []; const r = d.transaction(s).objectStore(s).openCursor(IDBKeyRange.bound(p, p + '￿'));
  r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else ok(out); }; r.onerror = () => no(r.error);
}));
export async function persist() { try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {} return false; }
