// Builds a notes PDF from chosen board pages (PDF background + your writing). Works offline.
import * as board from './board.js';
let jsp = null;
export function lib() {
  if (!jsp) jsp = new Promise((ok, no) => {
    if (window.jspdf) return ok(window.jspdf.jsPDF);
    const s = document.createElement('script'); s.src = 'vendor/jspdf.umd.min.js'; s.onload = () => ok(window.jspdf.jsPDF); s.onerror = () => no(new Error('PDF maker missing')); document.head.appendChild(s);
  });
  return jsp;
}
export async function notesPdf(indexes, label, progress) {
  const JsPDF = await lib(); let doc = null;
  for (let n = 0; n < indexes.length; n++) {
    progress && progress(n, indexes.length);
    const c = await board.renderPage(indexes[n], 1500);
    const w = 595, h = Math.round(595 * c.height / c.width);
    if (!doc) doc = new JsPDF({ unit: 'pt', format: [w, h], orientation: h >= w ? 'portrait' : 'landscape', compress: true });
    else doc.addPage([w, h], h >= w ? 'portrait' : 'landscape');
    doc.addImage(c.toDataURL('image/jpeg', 0.86), 'JPEG', 0, 0, w, h, undefined, 'FAST');
    doc.setFontSize(7); doc.setTextColor(140, 140, 150);
    doc.text(`CSwithSR · ${label} · page ${n + 1} of ${indexes.length}`, w - 12, h - 8, { align: 'right' });
  }
  doc.setProperties({ title: label, author: 'CSwithSR' });
  return doc.output('blob');
}
