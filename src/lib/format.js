// Anzeige-Helfer für Kennzahlen (Etappe 4/5, Naht P13). Reine Logik, keine Importe.
// Quelle: Prototyp fmt/mmssS (mockup/design-canvas-quellen/Main.dc.html:2761) und Recap-Fuß (:2785).
// Views zeigen Zahlen nur hierüber an (WELLE ttg-ende-statistik, UI-Regel 6).

const DASH = '–'; // „–“ für fehlende Werte
const NNBSP = ' '; // schmales geschütztes Leerzeichen (de: „33 %“)

/** Kaufmännisch runden: Hälfte von null weg (Math.round rundet −2,5 auf −2). */
function roundHalfAway(x) {
  return Math.sign(x) * Math.round(Math.abs(x));
}
/** @param {unknown} x */
const missing = (x) => x == null || typeof x !== 'number' || Number.isNaN(x);

/**
 * Durchschnitt mit einer Nachkommastelle: 3.25 ⇒ '3,3' (de) bzw. '3.3' (en); fehlt ⇒ '–'.
 * @param {number|null|undefined} x
 * @param {string} [lang]
 */
export function fmtAvg(x, lang = 'de') {
  if (missing(x)) return DASH;
  // Zehntel vorher auf 9 Stellen glätten, damit 3.25 (binär 3.2499…) nicht abrundet
  const tenths = roundHalfAway(Number((/** @type {number} */ (x) * 10).toFixed(9)));
  const s = (tenths / 10).toFixed(1);
  return lang === 'en' ? s : s.replace('.', ',');
}

/**
 * Anteil r ∈ [0,1] als ganze Prozent: 1/3 ⇒ '33 %' (de, U+202F) bzw. '33%' (en); fehlt ⇒ '–'.
 * @param {number|null|undefined} r
 * @param {string} [lang]
 */
export function fmtPct(r, lang = 'de') {
  if (missing(r)) return DASH;
  const p = roundHalfAway(Number((/** @type {number} */ (r) * 100).toFixed(9)));
  return lang === 'en' ? `${p}%` : `${p}${NNBSP}%`;
}

/**
 * Sekunden als m:ss (Sekunden vorher kaufmännisch gerundet): 156.67 ⇒ '2:37'; fehlt ⇒ '–'.
 * @param {number|null|undefined} sec
 */
export function fmtMmss(sec) {
  if (missing(sec)) return DASH;
  const s = roundHalfAway(/** @type {number} */ (sec));
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s);
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

/**
 * Minuten als h:mm h: 170 ⇒ '2:50 h'; fehlt ⇒ '–'.
 * @param {number|null|undefined} min
 */
export function fmtHm(min) {
  if (missing(min)) return DASH;
  const m = roundHalfAway(/** @type {number} */ (min));
  const sign = m < 0 ? '-' : '';
  const a = Math.abs(m);
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')} h`;
}

/**
 * Ganze Minuten zwischen zwei Zeitpunkten (kaufmännisch); null, wenn ein Wert fehlt oder ungültig ist.
 * @param {string|null|undefined} startIso
 * @param {string|null|undefined} endIso
 * @returns {number|null}
 */
export function minutesBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const ms = Date.parse(endIso) - Date.parse(startIso);
  if (Number.isNaN(ms)) return null;
  return roundHalfAway(ms / 60000);
}
