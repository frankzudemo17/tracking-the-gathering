// Bausteine der Profil- und Deck-Statistik (P18): reine HTML-Erzeuger, keine Daten, keine Kennzahlen.
// Zahlen kommen fertig aus src/lib/stats.js (memberProfile, deckProfile), Anzeige nur über src/lib/format.js
// (WELLE ttg-ende-statistik, UI-Regeln 6). Einzige Rechnung hier: Diagramm-Geometrie (Punkte-Linie).
// Diagramme in Akzent-Token --acc2, keine Spielerfarben (UI-Regel 2).
import { html } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { fmtAvg } from '../lib/format.js';
import { t } from '../i18n/index.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Kennzahlen-Kacheln in der bestehenden .stats-Reihe (fünf statt vier Spalten).
 * @param {{ v: string|number, l: string }[]} items
 */
export function kpis(items) {
  return html`<div class="stats st-5">${items.map((s) => html`<div class="stat"><b>${s.v}</b><span>${s.l}</span></div>`)}</div>`;
}

/** Abschnitt mit Überschrift (Muster .section/.section-title aus components.css). */
export function section(title, body, extra = '') {
  return html`<div class="section st-sec ${extra}"><h3 class="section-title">${title}</h3>${body}</div>`;
}

/**
 * Stimmungs-Zeilen: Icon · Bezeichnung · Wert · Balken (Breite = Wert/5, per CSS aus --v).
 * @param {{ icon: string, label: string, value: number|null, sub?: string }[]} rows
 * @param {string} lang
 */
export function moodRows(rows, lang) {
  return html`<div class="card st-moods">${rows.map((r) => html`
    <div class="st-mood">
      <span class="st-ic" aria-hidden="true">${icon(r.icon, 20)}</span>
      <span class="st-mood-txt"><span>${r.label}</span>${r.sub ? html`<span class="tiny muted">${r.sub}</span>` : ''}</span>
      <b class="st-val">${fmtAvg(r.value, lang)}</b>
      <span class="st-bar" aria-hidden="true">${isNum(r.value) ? html`<i style="--v:${r.value}"></i>` : ''}</span>
    </div>`)}</div>`;
}

/**
 * Salz-Verlauf: ein Balken je Wert (1–5), Höhe = Wert/5 per CSS, Wert über dem Balken.
 * Leere Liste ⇒ '' (Abschnitt ausblenden); ein einzelner Wert ist ein gültiger Balken.
 * @param {number[]} values chronologisch, höchstens 8
 */
export function saltBars(values) {
  const vs = (values || []).filter(isNum);
  if (!vs.length) return '';
  return html`<div class="card st-salt">
    <div class="st-salt-bars" role="img" aria-label="${t('stats.saltTrendLabel', { list: vs.join(', ') })}">
      ${vs.map((v) => html`<span class="st-sb"><span class="st-sb-n">${v}</span><span class="st-sb-track"><i style="--v:${v}"></i></span></span>`)}
    </div>
    <span class="tiny muted">${t('stats.saltTrendHint', { n: vs.length })}</span>
  </div>`;
}

/** Feste Zeichenfläche der Punkte-Linie (viewBox; skaliert per CSS auf die Breite). */
export const LINE_BOX = { w: 320, h: 120, padL: 8, padR: 44, padT: 14, padB: 14 };

/**
 * Diagramm-Geometrie der Punkte-Linie: x gleichmäßig verteilt, y von 0 bis zum größten Wert.
 * Weniger als 2 Werte ⇒ null (keine Linie).
 * @param {number[]} series kumulierte Punkte, chronologisch
 * @returns {{ pts: [number, number][], max: number, last: number } | null}
 */
export function linePoints(series, box = LINE_BOX) {
  const vs = (series || []).filter(isNum);
  if (vs.length < 2) return null;
  let max = 0;
  for (const v of vs) if (v > max) max = v;
  const top = max > 0 ? max : 1; // nur Nullen ⇒ Linie auf der Grundlinie, keine Division durch 0
  const w = box.w - box.padL - box.padR;
  const h = box.h - box.padT - box.padB;
  /** @type {[number, number][]} */
  const pts = vs.map((v, i) => [box.padL + (i / (vs.length - 1)) * w, box.padT + (1 - v / top) * h]);
  return { pts, max, last: vs[vs.length - 1] };
}

const c1 = (x) => x.toFixed(1);

/**
 * Punkte-Verlauf als inline-SVG: eine Linie in --acc2, Fläche darunter blass, Endwert beschriftet.
 * @param {number[]} series
 */
export function pointsLine(series) {
  const g = linePoints(series);
  if (!g) return '';
  const b = LINE_BOX;
  const base = b.h - b.padB;
  const line = g.pts.map(([x, y]) => `${c1(x)},${c1(y)}`).join(' ');
  const [lx, ly] = g.pts[g.pts.length - 1];
  const [fx] = g.pts[0];
  const area = `${c1(fx)},${base} ${line} ${c1(lx)},${base}`;
  return html`<div class="card st-line">
    <svg viewBox="0 0 ${b.w} ${b.h}" role="img" aria-label="${t('stats.pointsLabel', { n: g.pts.length, v: g.last })}">
      <line class="st-base" x1="${b.padL}" y1="${base}" x2="${b.w - b.padR}" y2="${base}"></line>
      <polygon class="st-area" points="${area}"></polygon>
      <polyline class="st-poly" points="${line}"></polyline>
      <circle class="st-dot" cx="${c1(lx)}" cy="${c1(ly)}" r="4"></circle>
      <text class="st-end" x="${c1(lx + 9)}" y="${c1(ly + 5)}">${g.last}</text>
    </svg>
    <span class="tiny muted">${t('stats.pointsHint', { n: g.pts.length })}</span>
  </div>`;
}

const SCALE = { star: ['star', 'starFill'], salt: ['salt', 'salt'], fun: ['smiley', 'smiley'] };

/**
 * Fünf Symbole, anteilig gefüllt (Sterne, Salz, Spaß): untere Reihe blass, obere Reihe in --acc2 auf Wert/5 beschnitten.
 * @param {number|null} value 0–5
 * @param {'star'|'salt'|'fun'} kind
 * @param {string} lang
 */
export function iconScale(value, kind, lang) {
  const [off, onI] = SCALE[kind] || SCALE.star;
  const five = (name) => [0, 1, 2, 3, 4].map(() => icon(name, 20));
  return html`<span class="st-scale" style="--v:${isNum(value) ? value : 0}" role="img" aria-label="${t('stats.ofFive', { v: fmtAvg(value, lang) })}">
    <span class="st-scale-off" aria-hidden="true">${five(off)}</span>
    <span class="st-scale-on" aria-hidden="true">${five(onI)}</span>
  </span>`;
}

/**
 * Highlight-Kachel: Bildchen (Avatar/Deckbild/Icon) · kleine Überschrift · Aussage · optional Link.
 * @param {{ label: string, text: string, sub?: string, media: unknown, href?: string|null }} h
 */
export function highlight(h) {
  const inner = html`<span class="st-hl-media">${h.media}</span>
    <span class="st-hl-txt"><span class="tiny muted">${h.label}</span><b>${h.text}</b>${h.sub ? html`<span class="small muted">${h.sub}</span>` : ''}</span>`;
  return h.href
    ? html`<a class="st-hl" href="${h.href}">${inner}<span class="st-hl-go" aria-hidden="true">${icon('chevRight', 18)}</span></a>`
    : html`<div class="st-hl">${inner}</div>`;
}

/** Deckbild ungetönt (Hintergrund), ohne Bild die Initialen auf Fläche. */
export function deckThumb(imageUrl, name) {
  const url = typeof imageUrl === 'string' && /^https:\/\//.test(imageUrl) ? imageUrl.replace(/'/g, '%27') : '';
  return html`<span class="st-thumb" style="${url ? `background-image:url('${url}')` : ''}" role="img" aria-label="${name}">${url ? '' : html`<span aria-hidden="true">${String(name || '?').slice(0, 2)}</span>`}</span>`;
}

/** Runder Symbol-Halter für Kacheln ohne Bild. */
export function iconDisc(name) {
  return html`<span class="st-disc" aria-hidden="true">${icon(name, 22)}</span>`;
}

const DAY = {
  de: new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: 'numeric', month: 'short', year: 'numeric' }),
  en: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', day: 'numeric', month: 'short', year: 'numeric' }),
};
/**
 * Spieltag als Text („6. Nov. 2026“); format.js hat keinen Tages-Helfer (im Bericht gemeldet). Fehlt ⇒ '–'.
 * @param {string|null|undefined} iso
 * @param {string} lang
 */
export function fmtDay(iso, lang) {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return '–';
  return (lang === 'en' ? DAY.en : DAY.de).format(new Date(ms));
}
