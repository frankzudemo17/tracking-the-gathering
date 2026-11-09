// Kleine DOM-Helfer. Alle Werte in html`` werden escaped (Schutz vor XSS durch
// Namen, Gruppennamen usw.). Nur raw() oder verschachtelte html``-Ergebnisse
// werden unverändert eingesetzt.

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function part(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Ersetzt den Inhalt eines Elements. */
export function mount(el, content) { el.innerHTML = String(content); }

/** Event-Delegation: on(root, 'click', '[data-act="x"]', fn) */
export function on(root, type, sel, fn) {
  root.addEventListener(type, (e) => {
    const t = e.target.closest(sel);
    if (t && root.contains(t)) fn(e, t);
  });
}

/** Knopf während einer async-Aktion sperren. */
export async function busy(btn, fn) {
  if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }
  try { return await fn(); }
  finally { if (btn && btn.isConnected) { btn.removeAttribute('aria-busy'); btn.disabled = false; } }
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || '?').slice(0, 2).toUpperCase();
}
