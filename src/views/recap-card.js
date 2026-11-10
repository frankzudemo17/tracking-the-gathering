// Teilen-Karte des Abend-Rückblicks (P19): PNG 1080 × 1350 per <canvas>.
// Rein: Layout (`cardLayout`), Textumbruch (`wrapLines`, `fitText`), Zeichnen (`drawCard`) — Eingabe ist das fertige
// Karten-Modell (Texte schon formatiert, Namen/Bilder aufgelöst) und die Token-Werte des aktiven Looks.
// DOM nur in `readTheme`/`loadImage`/`makeCard` (Browser). Keine Zahl wird hier gerechnet außer Karten-Geometrie.
// Commander-Bilder ungetönt: oben frei, unten Verlauf in die Kachelfläche (--sf), Text steht auf der Fläche.
import { I } from '../lib/icons.js';

export const CARD_W = 1080;
export const CARD_H = 1350;
const PAD = 72;
const GAP = 24;
const ELL = '…';

/**
 * @typedef {{ label: string, name: string, initials: string, sub: string, deck: string|null, avatarUrl: string|null, artUrl: string|null, colors: string[] }} KingTile
 * @typedef {{ label: string, name: string, sub: string, filled: number }} SaltTile
 * @typedef {{ label: string, name: string, sub: string }} TurnTile
 * @typedef {{ label: string, name: string, sub: string, quote: string }} PotgTile
 * @typedef {{ brand: string, tag: string, title: string, date: string, location: string|null, king: KingTile|null, salt: SaltTile|null, turn: TurnTile|null, potg: PotgTile|null, foot: string }} CardModel
 * @typedef {{ bg: string, sf: string, sf2: string, ink: string, mu: string, ln: string, hi: string, fDisplay: string, fBody: string, mana: Record<string, string>, logo: string }} CardTheme
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 */

// ---------------------------------------------------------------------------
// Text (rein; `measure(text) ⇒ Breite` kommt vom Aufrufer, im Browser ctx.measureText)

/**
 * Text auf Breite kürzen (mit „…“).
 * @param {(s: string) => number} measure
 * @param {string} text
 * @param {number} maxW
 */
export function fitText(measure, text, maxW) {
  const s = String(text ?? '');
  if (measure(s) <= maxW) return s;
  let lo = 0; let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(s.slice(0, mid).trimEnd() + ELL) <= maxW) lo = mid; else hi = mid - 1;
  }
  return s.slice(0, lo).trimEnd() + ELL;
}

/**
 * Wortumbruch auf höchstens `maxLines` Zeilen; was nicht passt, endet mit „…“. Überlange Wörter werden zeichenweise getrennt.
 * @param {(s: string) => number} measure
 * @param {string} text
 * @param {number} maxW
 * @param {number} maxLines
 * @returns {string[]}
 */
export function wrapLines(measure, text, maxW, maxLines) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length || maxLines < 1) return [];
  // Überlange Wörter vorher in Stücke ≤ maxW teilen
  /** @type {string[]} */
  const tokens = [];
  for (const w of words) {
    let rest = w;
    while (rest.length > 1 && measure(rest) > maxW) {
      let n = rest.length - 1;
      while (n > 1 && measure(rest.slice(0, n)) > maxW) n--;
      tokens.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    tokens.push(rest);
  }
  /** @type {string[]} */
  const lines = [];
  let cur = '';
  for (const w of tokens) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || measure(next) <= maxW) { cur = next; continue; }
    lines.push(cur);
    cur = w;
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  // Letzte Zeile + Anfang der nächsten ist zu breit ⇒ fitText kürzt und setzt „…“
  kept[maxLines - 1] = fitText(measure, `${kept[maxLines - 1]} ${lines[maxLines]}`, maxW);
  return kept;
}

// ---------------------------------------------------------------------------
// Layout (rein)

export const KING_H = 300;
export const PAIR_H = 200;
export const QUOTE_LINE = 38;
const PAD_B = 56;

/**
 * Kachel-Rechtecke von oben nach unten; fehlende Kacheln fallen weg, eine einzelne Halb-Kachel nimmt die ganze Breite.
 * @param {{ king: boolean, salt: boolean, turn: boolean, potg: boolean, quoteLines?: number }} has
 * @returns {{ header: Rect, king: Rect|null, salt: Rect|null, turn: Rect|null, potg: Rect|null, foot: Rect, bottom: number }}
 */
export function cardLayout(has) {
  const w = CARD_W - 2 * PAD;
  const header = { x: PAD, y: PAD, w, h: 210 };
  let y = header.y + header.h + GAP;
  /** @type {Rect|null} */ let king = null;
  /** @type {Rect|null} */ let salt = null;
  /** @type {Rect|null} */ let turn = null;
  /** @type {Rect|null} */ let potg = null;
  // Freier Platz bis zum Fuß geht an das Commander-Bild des Tageskönigs (groß, ungetönt)
  const lines = Math.max(1, Math.min(4, has.quoteLines ?? 1));
  const potgH = 178 + lines * QUOTE_LINE;
  const used = (has.king ? KING_H + GAP : 0) + (has.salt || has.turn ? PAIR_H + GAP : 0) + (has.potg ? potgH + GAP : 0);
  const limit = CARD_H - PAD_B - 40 - 28 - 32; // Oberkante Fußlinie minus Abstand
  const spare = Math.max(0, limit - (y + used - GAP));
  if (has.king) { const h = KING_H + spare; king = { x: PAD, y, w, h }; y += h + GAP; }
  if (has.salt && has.turn) {
    const half = (w - GAP) / 2;
    salt = { x: PAD, y, w: half, h: PAIR_H };
    turn = { x: PAD + half + GAP, y, w: half, h: PAIR_H };
    y += PAIR_H + GAP;
  } else if (has.salt || has.turn) {
    const r = { x: PAD, y, w, h: PAIR_H };
    if (has.salt) salt = r; else turn = r;
    y += PAIR_H + GAP;
  }
  if (has.potg) {
    potg = { x: PAD, y, w, h: potgH };
    y += potgH + GAP;
  }
  const foot = { x: PAD, y: CARD_H - PAD_B - 40, w, h: 40 };
  return { header, king, salt, turn, potg, foot, bottom: y - GAP };
}

// ---------------------------------------------------------------------------
// Icons (Phosphor-Inhalt aus icons.js ⇒ Path2D, viewBox 256)

/**
 * @param {string} inner innere SVG-Elemente (aus `I`)
 * @returns {Array<{ kind: 'path', d: string, stroke: number }|{ kind: 'circle', cx: number, cy: number, r: number }>}
 */
export function iconShapes(inner) {
  const out = [];
  for (const m of String(inner || '').matchAll(/<(path|circle)\b([^>]*?)\/?>/g)) {
    /** @type {Record<string, string>} */
    const a = {};
    for (const x of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) a[x[1]] = x[2];
    if (m[1] === 'path' && a.d) out.push({ kind: /** @type {const} */ ('path'), d: a.d, stroke: a.fill === 'none' ? Number(a['stroke-width'] || 16) : 0 });
    if (m[1] === 'circle') out.push({ kind: /** @type {const} */ ('circle'), cx: Number(a.cx), cy: Number(a.cy), r: Number(a.r) });
  }
  return out;
}

function drawIcon(ctx, name, x, y, size, color) {
  const shapes = iconShapes(I[name]);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 256, size / 256);
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of shapes) {
    if (s.kind === 'circle') { ctx.beginPath(); ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2); ctx.fill(); continue; }
    const p = new Path2D(s.d);
    if (s.stroke) { ctx.lineWidth = s.stroke; ctx.stroke(p); } else ctx.fill(p);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Zeichnen (rein bis auf das übergebene ctx)

/** Farbe mit Deckkraft (Token sind #RRGGBB; sonst unverändert). */
export function withAlpha(color, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Bild wie `background-size: cover`, Fokus `fy` (0 = oben). */
function cover(ctx, img, x, y, w, h, fy = 0.22) {
  const iw = img.naturalWidth || img.width; const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s; const sh = h / s;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) * fy, sw, sh, x, y, w, h);
}

function font(theme, weight, size, display = false, italic = false) {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${display ? theme.fDisplay : theme.fBody}`;
}

function text(ctx, s, x, y, f, color, { align = 'left', maxW = 0, spacing = 0 } = {}) {
  ctx.font = f; ctx.fillStyle = color; ctx.textAlign = /** @type {CanvasTextAlign} */ (align); ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  const out = maxW ? fitText((t) => ctx.measureText(t).width, s, maxW) : s;
  ctx.fillText(out, x, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function avatarDisc(ctx, theme, x, y, d, img, initials) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2 + 6, 0, Math.PI * 2); ctx.fillStyle = theme.sf; ctx.fill();
  ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); ctx.closePath();
  ctx.fillStyle = theme.sf2; ctx.fill();
  if (img) { ctx.clip(); cover(ctx, img, x, y, d, d, 0.5); }
  ctx.restore();
  if (!img) {
    ctx.font = font(theme, 700, Math.round(d * 0.36), true);
    ctx.fillStyle = theme.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(initials, x + d / 2, y + d / 2 + 2);
    ctx.textBaseline = 'alphabetic';
  }
}

/**
 * Karte zeichnen. `imgs` = bereits geladene Bilder (oder null): { logo, art, avatar }.
 * @param {CanvasRenderingContext2D} ctx
 * @param {CardModel} m
 * @param {CardTheme} theme
 * @param {{ logo?: any, art?: any, avatar?: any }} [imgs]
 */
export function drawCard(ctx, m, theme, imgs = {}) {
  const measure = (f) => (s) => { ctx.font = f; return ctx.measureText(s).width; };
  const quoteFont = font(theme, 450, 30, false, true);
  const quoteW = CARD_W - 2 * PAD - 2 * 40 - 44; // Kachel-Innenrand links/rechts, Einzug hinter dem Zitat-Icon
  const quote = m.potg ? wrapLines(measure(quoteFont), `„${m.potg.quote}“`, quoteW, 4) : [];
  const L = cardLayout({ king: !!m.king, salt: !!m.salt, turn: !!m.turn, potg: !!m.potg, quoteLines: quote.length });

  // Fläche
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Kopf: Logo + Marke, Titel, Datum · Ort
  const h = L.header;
  if (imgs.logo) ctx.drawImage(imgs.logo, h.x, h.y, 64, 64);
  text(ctx, m.brand.toUpperCase(), h.x + (imgs.logo ? 84 : 0), h.y + 42, font(theme, 700, 22), theme.mu, { spacing: 4 });
  text(ctx, m.tag, h.x + h.w, h.y + 42, font(theme, 700, 24), theme.mu, { align: 'right', spacing: 2 });
  text(ctx, m.title, h.x, h.y + 150, font(theme, 700, 84, true), theme.ink, { maxW: h.w, spacing: -2 });
  const line = m.location ? `${m.date} · ${m.location}` : m.date;
  text(ctx, line, h.x, h.y + 198, font(theme, 500, 34), theme.mu, { maxW: h.w });

  const tile = (r) => { rr(ctx, r.x, r.y, r.w, r.h, 36); ctx.fillStyle = theme.sf; ctx.fill(); };
  const label = (s, x, y, color = theme.mu) => text(ctx, s.toUpperCase(), x, y, font(theme, 700, 22), color, { spacing: 3 });

  // Tageskönig: Commander-Bild ungetönt, unten Verlauf in die Fläche
  if (m.king && L.king) {
    const r = L.king;
    tile(r);
    const artH = r.h - 96;
    ctx.save();
    rr(ctx, r.x, r.y, r.w, r.h, 36); ctx.clip();
    if (imgs.art) cover(ctx, imgs.art, r.x, r.y, r.w, artH);
    else {
      const cols = (m.king.colors || []).map((c) => theme.mana[c]).filter(Boolean);
      const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + artH);
      const stops = cols.length ? cols : [theme.sf2];
      if (stops.length === 1) stops.push(theme.sf2);
      stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
      ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, artH);
    }
    const fade = ctx.createLinearGradient(0, r.y + artH * 0.42, 0, r.y + artH);
    fade.addColorStop(0, withAlpha(theme.sf, 0));
    fade.addColorStop(0.6, withAlpha(theme.sf, 0.78));
    fade.addColorStop(1, theme.sf);
    ctx.fillStyle = fade; ctx.fillRect(r.x, r.y, r.w, artH);
    ctx.restore();
    const d = 120; const ax = r.x + 36; const ay = r.y + r.h - 36 - d;
    avatarDisc(ctx, theme, ax, ay, d, imgs.avatar || null, m.king.initials);
    const tx = ax + d + 32; const tw = r.x + r.w - 40 - tx;
    drawIcon(ctx, 'crown', tx, ay - 4, 30, theme.hi);
    label(m.king.label, tx + 42, ay + 22, theme.hi);
    text(ctx, m.king.name, tx, ay + 86, font(theme, 700, 60, true), theme.ink, { maxW: tw, spacing: -1 });
    const sub = m.king.deck ? `${m.king.sub} · ${m.king.deck}` : m.king.sub;
    text(ctx, sub, tx, ay + 124, font(theme, 500, 28), theme.mu, { maxW: tw });
  }

  const small = (r, ic, t, extra) => {
    tile(r);
    const x = r.x + 36; const w = r.w - 72;
    drawIcon(ctx, ic, x, r.y + 30, 40, theme.mu);
    label(t.label, x, r.y + 102);
    text(ctx, t.name, x, r.y + 150, font(theme, 700, 46, true), theme.ink, { maxW: w, spacing: -1 });
    text(ctx, t.sub, x, r.y + 184, font(theme, 500, 26), theme.mu, { maxW: w });
    extra?.(x, w);
  };
  if (m.salt && L.salt) {
    const s = m.salt;
    small(L.salt, 'salt', s, () => {
      const r = /** @type {Rect} */ (L.salt);
      for (let i = 0; i < 5; i++) drawIcon(ctx, 'salt', r.x + r.w - 36 - (5 - i) * 30, r.y + 36, 26, i < s.filled ? theme.ink : withAlpha(theme.mu, 0.35));
    });
  }
  if (m.turn && L.turn) small(L.turn, 'timer', m.turn);

  // Play of the Game
  if (m.potg && L.potg) {
    const r = L.potg;
    tile(r);
    const x = r.x + 40; const w = r.w - 80;
    drawIcon(ctx, 'starFill', x, r.y + 38, 30, theme.hi);
    label(m.potg.label, x + 42, r.y + 62, theme.hi);
    text(ctx, m.potg.sub, x + w, r.y + 62, font(theme, 600, 26), theme.mu, { align: 'right' });
    const nameW = w;
    text(ctx, m.potg.name, x, r.y + 122, font(theme, 700, 50, true), theme.ink, { maxW: nameW, spacing: -1 });
    drawIcon(ctx, 'quotes', x, r.y + 152, 28, theme.mu);
    quote.forEach((q, i) => text(ctx, q, x + 44, r.y + 178 + i * QUOTE_LINE, quoteFont, theme.ink));
  }

  // Fuß
  const f = L.foot;
  ctx.fillStyle = theme.ln; ctx.fillRect(f.x, f.y - 28, f.w, 2);
  text(ctx, m.foot, f.x, f.y + 28, font(theme, 600, 30), theme.mu);
  text(ctx, m.tag, f.x + f.w, f.y + 28, font(theme, 700, 30), theme.mu, { align: 'right', spacing: 2 });
}

// ---------------------------------------------------------------------------
// Browser-Teil

/** Token-Werte des aktiven Looks. @returns {CardTheme} */
export function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k) => cs.getPropertyValue(k).trim();
  const logoFile = /logo-(light|dark)\.png/.exec(v('--logo'))?.[0] || 'logo-light.png';
  return {
    bg: v('--bg'), sf: v('--sf'), sf2: v('--sf2'), ink: v('--ink'), mu: v('--mu'), ln: v('--ln'), hi: v('--hi'),
    fDisplay: v('--f-display') || 'system-ui, sans-serif', fBody: v('--f-body') || 'system-ui, sans-serif',
    mana: { W: v('--mana-W'), U: v('--mana-U'), B: v('--mana-B'), R: v('--mana-R'), G: v('--mana-G') },
    logo: `assets/icons/${logoFile}`,
  };
}

/** Bild laden; fremde Hosts mit CORS (`anonymous`). Fehler ⇒ null (Kachel ohne Bild). Zeitgrenze 8 s. */
export function loadImage(url, ms = 8000) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; resolve(null); }, ms);
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); console.warn('Karte: Bild ohne CORS oder nicht ladbar', url); resolve(null); };
    img.src = url;
  });
}

function isTainted(ctx) {
  try { ctx.getImageData(0, 0, 1, 1); return false; } catch { return true; }
}

/**
 * Karte als PNG-Blob. Schriften abwarten, Bilder per CORS laden; ist die Fläche danach „tainted“, ohne Bilder neu zeichnen.
 * @param {CardModel} model
 * @returns {Promise<{ blob: Blob, withImages: boolean }>}
 */
export async function makeCard(model) {
  const theme = readTheme();
  try {
    await Promise.all([
      document.fonts?.load?.(`700 64px ${theme.fDisplay}`),
      document.fonts?.load?.(`500 30px ${theme.fBody}`),
      document.fonts?.load?.(`italic 450 30px ${theme.fBody}`),
    ]);
    await document.fonts?.ready;
  } catch { /* Schriften sind Beiwerk */ }
  const [logo, art, avatar] = await Promise.all([
    loadImage(theme.logo), loadImage(model.king?.artUrl || null), loadImage(model.king?.avatarUrl || null),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W; canvas.height = CARD_H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  drawCard(ctx, model, theme, { logo, art, avatar });
  let withImages = !!(art || avatar);
  if (isTainted(ctx)) {
    console.warn('Karte: Fläche durch Fremdbild gesperrt, zeichne ohne Bilder neu');
    ctx.reset?.();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawCard(ctx, model, theme, { logo: null });
    withImages = false;
    if (isTainted(ctx)) throw new Error('Karte gesperrt');
  }
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob leer'))), 'image/png'));
  return { blob: /** @type {Blob} */ (blob), withImages };
}

/** Dateiname `ttg-abend-<YYYY-MM-DD>.png` (ungültiges Datum ⇒ ohne Datum). */
export const cardFileName = (playedOn) => (/^\d{4}-\d{2}-\d{2}$/.test(String(playedOn)) ? `ttg-abend-${playedOn}.png` : 'ttg-abend.png');
