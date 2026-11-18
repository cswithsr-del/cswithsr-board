// Makes browser recordings normal, seekable video files that phones, players and editors (DaVinci Resolve, Premiere, CapCut) accept.
// - MP4 from Chrome's MediaRecorder is "fragmented" (moof/mdat pieces, no sample index, no duration). It is rebuilt
//   into a plain MP4: one moov with full sample tables, the media bytes untouched (no re-encoding, done in seconds).
// - WebM from MediaRecorder has no Duration. It is added to the Segment Info.
// Only small headers are read into memory, so hour-long recordings work on a tablet. On any doubt the original is returned.

const u32 = (d, o) => d.getUint32(o), u64 = (d, o) => d.getUint32(o) * 2 ** 32 + d.getUint32(o + 4);
const str = (d, o) => String.fromCharCode(d.getUint8(o), d.getUint8(o + 1), d.getUint8(o + 2), d.getUint8(o + 3));
async function read(blob, a, b) { return new DataView(await blob.slice(a, Math.min(b, blob.size)).arrayBuffer()); }

// top-level boxes: [{type, start, size, hdr}]
async function topBoxes(blob) {
  const out = []; let o = 0;
  while (o + 8 <= blob.size) {
    const h = await read(blob, o, o + 16); let size = u32(h, 0), hdr = 8; const type = str(h, 4);
    if (size === 1) { size = u64(h, 8); hdr = 16; } else if (size === 0) size = blob.size - o;
    if (size < hdr) throw new Error('bad box');
    out.push({ type, start: o, size, hdr }); o += size;
  }
  return out;
}
function kids(d, start, end) { // child boxes inside a DataView range
  const out = []; let o = start;
  while (o + 8 <= end) { let size = u32(d, o), hdr = 8; const type = str(d, o + 4); if (size === 1) { size = u64(d, o + 8); hdr = 16; } else if (size === 0) size = end - o; if (size < hdr) break; out.push({ type, s: o, e: o + size, b: o + hdr }); o += size; }
  return out;
}
const find = (d, box, type) => kids(d, box.b, box.e).find(k => k.type === type);
const bytes = (d, box) => new Uint8Array(d.buffer, d.byteOffset + box.s, box.e - box.s);

function mk(type, ...parts) { // build a box from Uint8Arrays
  const len = 8 + parts.reduce((s, p) => s + p.length, 0), b = new Uint8Array(len), v = new DataView(b.buffer);
  v.setUint32(0, len); for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  let o = 8; for (const p of parts) { b.set(p, o); o += p.length; } return b;
}
function full(type, ver, flags, body) { const h = new Uint8Array(4); h[0] = ver; h[1] = flags >> 16; h[2] = flags >> 8 & 255; h[3] = flags & 255; return mk(type, h, body); }
function u32s(arr) { const b = new Uint8Array(arr.length * 4), v = new DataView(b.buffer); arr.forEach((x, i) => v.setUint32(i * 4, x >>> 0)); return b; }
function setDur(src, ver, at32, at64, val) { // copy of a full box (mvhd/tkhd/mdhd) with its duration set
  const b = src.slice(), v = new DataView(b.buffer);
  if (ver === 1) { v.setUint32(at64, Math.floor(val / 2 ** 32)); v.setUint32(at64 + 4, val >>> 0); } else v.setUint32(at32, Math.min(val, 0xffffffff)); return b;
}

export async function fixMp4(blob) {
  const top = await topBoxes(blob);
  const ftyp = top.find(b => b.type === 'ftyp'), moov = top.find(b => b.type === 'moov'), firstMoof = top.find(b => b.type === 'moof');
  if (!ftyp || !moov || !firstMoof) return blob; // already a plain MP4 (or not one we understand)
  const md = await read(blob, moov.start, moov.start + moov.size); const M = { s: 0, e: md.byteLength, b: moov.hdr };
  const mvhd = find(md, M, 'mvhd'), mvex = find(md, M, 'mvex');
  const movieScale = u32(md, mvhd.b + (md.getUint8(mvhd.b) === 1 ? 20 : 12));
  const trex = {}; if (mvex) for (const t of kids(md, mvex.b, mvex.e)) if (t.type === 'trex') trex[u32(md, t.b + 4)] = { dur: u32(md, t.b + 12), size: u32(md, t.b + 16), flags: u32(md, t.b + 20) };
  const tracks = {};
  for (const tk of kids(md, M.b, M.e).filter(k => k.type === 'trak')) {
    const tkhd = find(md, tk, 'tkhd'), id = u32(md, tkhd.b + (md.getUint8(tkhd.b) === 1 ? 20 : 12));
    const mdia = find(md, tk, 'mdia'), mdhd = find(md, mdia, 'mdhd'), scale = u32(md, mdhd.b + (md.getUint8(mdhd.b) === 1 ? 20 : 12));
    const hdlr = find(md, mdia, 'hdlr'), minf = find(md, mdia, 'minf'), stbl = find(md, minf, 'stbl'), stsd = find(md, stbl, 'stsd');
    tracks[id] = { id, tk, tkhd, mdia, mdhd, hdlr, minf, stsd, scale, video: str(md, hdlr.b + 8) === 'vide', t: null,
      size: [], dur: [], off: [], cto: [], sync: [] };
  }
  // walk every fragment
  for (const box of top) {
    if (box.type !== 'moof') continue;
    const d = await read(blob, box.start, box.start + box.size); const R = { s: 0, e: d.byteLength, b: box.hdr };
    let prevEnd = box.start;
    for (const traf of kids(d, R.b, R.e).filter(k => k.type === 'traf')) {
      const tfhd = find(d, traf, 'tfhd'), fl = u32(d, tfhd.b) & 0xffffff, id = u32(d, tfhd.b + 4), T = tracks[id], X = trex[id] || {};
      if (!T) continue; let o = tfhd.b + 8, base = null, dDur = X.dur || 0, dSize = X.size || 0, dFlags = X.flags || 0;
      if (fl & 1) { base = u64(d, o); o += 8; } if (fl & 2) o += 4; if (fl & 8) { dDur = u32(d, o); o += 4; } if (fl & 16) { dSize = u32(d, o); o += 4; } if (fl & 32) { dFlags = u32(d, o); o += 4; }
      if (base === null) base = (fl & 0x20000) ? box.start : prevEnd;
      const tfdt = find(d, traf, 'tfdt');
      if (tfdt) { const t0 = d.getUint8(tfdt.b) === 1 ? u64(d, tfdt.b + 4) : u32(d, tfdt.b + 4);
        if (T.t === null) T.t = t0; else if (t0 > T.t && T.dur.length) { T.dur[T.dur.length - 1] += t0 - T.t; T.t = t0; } }
      for (const trun of kids(d, traf.b, traf.e).filter(k => k.type === 'trun')) {
        const ver = d.getUint8(trun.b), tf = u32(d, trun.b) & 0xffffff, n = u32(d, trun.b + 4); let p = trun.b + 8, pos = base, firstFlags = null;
        if (tf & 1) { pos = base + d.getInt32(p); p += 4; } if (tf & 4) { firstFlags = u32(d, p); p += 4; }
        for (let i = 0; i < n; i++) {
          const dur = tf & 0x100 ? u32(d, (p += 4) - 4) : dDur, size = tf & 0x200 ? u32(d, (p += 4) - 4) : dSize;
          let flags = tf & 0x400 ? u32(d, (p += 4) - 4) : dFlags; if (i === 0 && firstFlags !== null) flags = firstFlags;
          const cto = tf & 0x800 ? (ver ? d.getInt32((p += 4) - 4) : u32(d, (p += 4) - 4)) : 0;
          T.size.push(size); T.dur.push(dur); T.off.push(pos); T.cto.push(cto); T.sync.push(!(flags & 0x10000)); pos += size; T.t = (T.t || 0) + dur;
        }
        prevEnd = pos;
      }
    }
  }
  const list = Object.values(tracks).filter(T => T.size.length);
  if (!list.length) return blob;
  // build the new moov; media offsets move by the same amount for every sample
  const build = shift => {
    let movieDur = 0;
    const traks = list.map(T => {
      const dur = T.dur.reduce((a, b) => a + b, 0), mdur = Math.round(dur * movieScale / T.scale); movieDur = Math.max(movieDur, mdur);
      const stts = []; for (const x of T.dur) { const l = stts[stts.length - 1]; if (l && l[1] === x) l[0]++; else stts.push([1, x]); }
      const anyCto = T.cto.some(c => c), ctts = []; if (anyCto) for (const x of T.cto) { const l = ctts[ctts.length - 1]; if (l && l[1] === x) l[0]++; else ctts.push([1, x]); }
      const syncIdx = T.sync.every(Boolean) ? null : T.sync.map((s, i) => s ? i + 1 : 0).filter(Boolean);
      const co = new Uint8Array(4 + T.off.length * 8), cv = new DataView(co.buffer); cv.setUint32(0, T.off.length);
      T.off.forEach((x, i) => { const v = x + shift; cv.setUint32(4 + i * 8, Math.floor(v / 2 ** 32)); cv.setUint32(8 + i * 8, v >>> 0); });
      const stbl = mk('stbl', bytes(md, T.stsd),
        full('stts', 0, 0, u32s([stts.length, ...stts.flat()])),
        ...(anyCto ? [full('ctts', 1, 0, u32s([ctts.length, ...ctts.flat()]))] : []),
        full('stsc', 0, 0, u32s([1, 1, 1, 1])),
        full('stsz', 0, 0, u32s([0, T.size.length, ...T.size])),
        full('co64', 0, 0, co),
        ...(syncIdx ? [full('stss', 0, 0, u32s([syncIdx.length, ...syncIdx]))] : []));
      const minfKids = kids(md, T.minf.b, T.minf.e).filter(k => k.type !== 'stbl').map(k => bytes(md, k));
      const tv = md.getUint8(T.tkhd.b), mv = md.getUint8(T.mdhd.b);
      const tkhd = setDur(bytes(md, T.tkhd), tv, 28, 36, mdur), mdhd = setDur(bytes(md, T.mdhd), mv, 24, 32, dur);
      return mk('trak', tkhd, mk('mdia', mdhd, bytes(md, T.hdlr), mk('minf', ...minfKids, stbl)));
    });
    const mvv = md.getUint8(mvhd.b);
    const others = kids(md, M.b, M.e).filter(k => k.type === 'udta').map(k => bytes(md, k));
    return mk('moov', setDur(bytes(md, mvhd), mvv, 24, 32, movieDur), ...traks, ...others);
  };
  const ftypBytes = new Uint8Array(await blob.slice(ftyp.start, ftyp.start + ftyp.size).arrayBuffer());
  const moovLen = build(0).length, dataStart = ftyp.size + moovLen;
  const newMoov = build(dataStart - firstMoof.start);
  // media after the old header, every moof renamed to 'free' so players read only the new index
  const parts = [ftypBytes, newMoov]; let o = firstMoof.start;
  const free = new TextEncoder().encode('free');
  for (const b of top) {
    if (b.start < firstMoof.start || b.type !== 'moof') continue;
    parts.push(blob.slice(o, b.start + 4), free); o = b.start + 8;
  }
  parts.push(blob.slice(o));
  return new Blob(parts, { type: 'video/mp4' });
}

// ---- WebM: add the Duration ----
function vint(d, o) { const f = d.getUint8(o); let len = 1, m = 0x80; while (len <= 8 && !(f & m)) { len++; m >>= 1; } let v = f & (m - 1), all = v === m - 1; for (let i = 1; i < len; i++) { const x = d.getUint8(o + i); v = v * 256 + x; if (x !== 255) all = false; } return { len, v, unknown: all }; }
function id(d, o) { const f = d.getUint8(o); const len = f & 0x80 ? 1 : f & 0x40 ? 2 : f & 0x20 ? 3 : 4; let v = 0; for (let i = 0; i < len; i++) v = v * 256 + d.getUint8(o + i); return { len, v }; }
export async function fixWebm(blob, durMs) {
  if (!durMs) return blob;
  const head = await read(blob, 0, 262144); let o = 0;
  const e0 = id(head, o); if (e0.v !== 0x1A45DFA3) return blob; o += e0.len; const s0 = vint(head, o); o += s0.len + s0.v;
  const seg = id(head, o); if (seg.v !== 0x18538067) return blob; o += seg.len; const ss = vint(head, o); o += ss.len;
  if (!ss.unknown) return blob; // a known Segment size would have to change too; MediaRecorder writes "unknown"
  while (o < head.byteLength - 12) {
    const e = id(head, o), s = vint(head, o + e.len), body = o + e.len + s.len;
    if (e.v === 0x114D9B74) return blob; // SeekHead positions would shift: leave the file alone
    if (e.v === 0x1F43B675) return blob; // reached a Cluster without finding Info
    if (e.v === 0x1549A966) { // Info
      let scale = 1e6, p = body, hasDur = false;
      while (p < body + s.v) { const c = id(head, p), cs = vint(head, p + c.len), cb = p + c.len + cs.len; if (c.v === 0x2AD7B1) { scale = 0; for (let i = 0; i < cs.v; i++) scale = scale * 256 + head.getUint8(cb + i); } if (c.v === 0x4489) hasDur = true; p = cb + cs.v; }
      if (hasDur) return blob;
      const durEl = new Uint8Array(11), dv = new DataView(durEl.buffer); durEl[0] = 0x44; durEl[1] = 0x89; durEl[2] = 0x88; dv.setFloat64(3, durMs * 1e6 / scale);
      const newSize = s.v + 11, sizeField = new Uint8Array(8); sizeField[0] = 0x01; let x = newSize; for (let i = 7; i >= 1; i--) { sizeField[i] = x & 255; x = Math.floor(x / 256); }
      return new Blob([blob.slice(0, o + e.len), sizeField, blob.slice(body, body + s.v), durEl, blob.slice(body + s.v)], { type: 'video/webm' });
    }
    if (s.unknown) return blob; o = body + s.v;
  }
  return blob;
}

// any recording or any file the user picks
export async function fixVideo(blob, durMs) {
  try {
    const h = await read(blob, 0, 12);
    if (h.byteLength >= 8 && str(h, 4) === 'ftyp') return await fixMp4(blob);
    if (h.byteLength >= 4 && u32(h, 0) === 0x1A45DFA3) return await fixWebm(blob, durMs || await webmDurMs(blob));
  } catch (e) { console.warn('fixVideo', e); }
  return blob;
}
// for a picked WebM file with no saved duration: let the browser find it (it scans to the end)
function webmDurMs(blob) {
  return new Promise(res => {
    const v = document.createElement('video'), url = URL.createObjectURL(blob); v.preload = 'metadata'; v.muted = true; v.src = url;
    const done = ms => { URL.revokeObjectURL(url); v.remove(); res(ms); };
    v.onloadedmetadata = () => { if (isFinite(v.duration)) return done(v.duration * 1000); v.currentTime = 1e9; v.ontimeupdate = () => { if (isFinite(v.duration)) done(v.duration * 1000); }; };
    v.onerror = () => done(0); setTimeout(() => done(0), 60000);
  });
}
