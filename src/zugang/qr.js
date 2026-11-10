// QR-Code für den Einladungslink (Spec P9b G). Kodierer: qrcode-generator 2.0.4 (MIT, vendor/).
// Byte-Modus, Fehlerkorrektur M, Version automatisch. Text wird als UTF-8 kodiert (Umlaute in Gruppennamen
// oder Links), die Bibliothek bekommt die Bytes als Zeichenkette mit Codes 0–255 (ihr stringToBytes nimmt c & 0xff).
// SVG immer dunkel auf Weiß (#000 auf #fff, in keinem Look getönt), Ruhezone 4 Module.
import qrcode from './vendor/qrcode-generator.mjs';
import { html, raw } from '../lib/dom.js';

export const QUIET = 4;

const utf8Bytes = (text) => {
  const b = new TextEncoder().encode(text);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return s;
};

/**
 * Modul-Matrix ohne Ruhezone: true = dunkles Modul.
 * @param {string} text
 * @returns {boolean[][]}
 */
export function qrMatrix(text) {
  if (typeof text !== 'string' || text.length === 0) throw new Error('QR: leerer Text');
  const qr = qrcode(0, 'M');
  qr.addData(utf8Bytes(text), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const m = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    m.push(row);
  }
  return m;
}

/**
 * SVG des QR-Codes (quadratisch, Kantenlänge size px, Ruhezone QUIET Module).
 * @param {string} text
 * @param {{ size?: number, label?: string }} [o]
 */
export function qrSvg(text, { size = 256, label = 'QR-Code' } = {}) {
  const m = qrMatrix(text);
  const n = m.length + QUIET * 2;
  let d = '';
  m.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) { c++; continue; }
      let w = 1;
      while (c + w < row.length && row[c + w]) w++;
      d += `M${c + QUIET} ${r + QUIET}h${w}v1h-${w}z`;
      c += w;
    }
  });
  return html`<svg class="qr" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${label}" data-modules="${m.length}" data-quiet="${QUIET}"><rect width="${n}" height="${n}" fill="#fff"/><path fill="#000" d="${raw(d)}"/></svg>`;
}
