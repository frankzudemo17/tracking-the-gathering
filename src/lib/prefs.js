// Geräte-Einstellungen am Tisch und Spiel-Standards (P7, Welle ttg-live-feinschliff-decks; HANDOFF 5.10).
// Je Gerät in localStorage `ttg.prefs.v1` (JSON, versioniert) — das Handy in der Tischmitte, keine Migration.
// Robust: fehlende/ungültige Werte ⇒ Standard je Feld, nie ein Wurf; ohne localStorage ⇒ Speicher im Lauf.
// Kein Zugriff auf window/navigator/document beim Laden (Modul ist in Node importierbar, tests/unit/prefs.test.mjs).
import { KO_VARIANTS } from '../game/ko.js';
import { LAYOUTS } from '../game/layouts.js';

const KEY = 'ttg.prefs.v1';
const VERSION = 1;

/** Startleben-Stufen der Einstellung (spec-p7-tisch.md, Tabelle „Felder und Standards“). */
export const START_LIVES = [20, 30, 40, 50, 60];
/** Zähler, die ein Deck anpinnen kann — gleiche Liste wie set_deck_counter_pins (spielen.sql:256). */
export const PIN_KEYS = ['poison', 'tax', 'tax2', 'energy', 'exp', 'rad', 'speed', 'ring', 'dungeon'];
export const KO_MODES = ['all', 'some', 'off'];
export const MOTION_MODES = ['system', 'on', 'off'];

export const DEFAULTS = Object.freeze({
  wakeLock: true,
  vibration: true,
  koScreens: 'all',
  koVariants: Object.freeze([...KO_VARIANTS]),
  reduceMotion: 'system',
  startLife: 40,
  layout: 'seiten',
  defaultPins: Object.freeze(['poison', 'tax']), // init.sql:123
  turnTime: true,
  startIntro: true, // P3 Spielstart-Intro (Welle ttg-features, Entscheid 11)
});

const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const oneOf = (list) => (v) => (list.includes(v) ? v : undefined);
/** Teilmenge einer Liste: Unbekanntes und Dubletten fallen weg, Reihenfolge der Eingabe. */
const subset = (list) => (v) => (Array.isArray(v) ? v.filter((x, i) => list.includes(x) && v.indexOf(x) === i) : undefined);

/** Prüfer je Schlüssel: liefert den bereinigten Wert oder undefined (⇒ Standard). */
const CHECK = {
  wakeLock: bool,
  vibration: bool,
  koScreens: oneOf(KO_MODES),
  // umbenannte/entfernte Varianten ignorieren; bleibt keine übrig ⇒ alle
  koVariants: (v) => { const s = subset(KO_VARIANTS)(v); return s && s.length ? s : undefined; },
  reduceMotion: oneOf(MOTION_MODES),
  startLife: oneOf(START_LIVES),
  layout: oneOf(LAYOUTS),
  defaultPins: subset(PIN_KEYS),
  turnTime: bool,
  startIntro: bool,
};

let mem = null; // Speicher im Lauf, wenn localStorage fehlt oder wirft

function readRaw() {
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const s = ls.getItem(KEY);
      if (s == null) return {};
      const o = JSON.parse(s);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    }
  } catch { /* gesperrt oder kaputtes JSON ⇒ unten */ }
  return mem ? { ...mem } : {};
}

function clean(raw) {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    const v = CHECK[k](raw[k]);
    const d = DEFAULTS[k];
    out[k] = v === undefined ? (Array.isArray(d) ? [...d] : d) : v;
  }
  return out;
}

/** Aktueller Stand (frische Kopie, immer vollständig und gültig). */
export function getPrefs() {
  return clean(readRaw());
}

const listeners = new Set();
function emit() {
  const p = getPrefs();
  for (const fn of [...listeners]) { try { fn(p); } catch (e) { console.error(e); } }
}

/**
 * Setzt einen Wert. Ungültig oder unbekannter Schlüssel ⇒ false, nichts geschrieben.
 * Schreibfehler (Speicher voll, Privatmodus) ⇒ Wert gilt im Lauf weiter, Rückgabe trotzdem true.
 */
export function setPref(key, value) {
  if (!Object.hasOwn(CHECK, key)) return false;
  const v = CHECK[key](value);
  if (v === undefined) return false;
  const next = { ...clean(readRaw()), [key]: v };
  mem = next;
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify({ v: VERSION, ...next })); } catch { /* bleibt im Lauf */ }
  emit();
  return true;
}

let storageHook = null;
function onStorage(e) { if (!e || e.key === KEY || e.key === null) emit(); }

/** Hörer für Änderungen (auch aus einem anderen Tab über das storage-Ereignis). Rückgabe: off(). */
export function onPrefs(fn) {
  listeners.add(fn);
  if (!storageHook && typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('storage', onStorage);
    storageHook = onStorage;
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && storageHook) {
      globalThis.removeEventListener?.('storage', storageHook);
      storageHook = null;
    }
  };
}

// ---------------------------------------------------------------- Gerät: Vibration, Bewegung, K.O.

/** navigator.vibrate vorhanden (iOS: nein). */
export const canVibrate = () => { try { return typeof globalThis.navigator?.vibrate === 'function'; } catch { return false; } };
/** Screen Wake Lock vorhanden (iOS < 16.4: nein). */
export const canWakeLock = () => { try { return typeof globalThis.navigator?.wakeLock?.request === 'function'; } catch { return false; } };

/** Haptik über den Schalter „Vibration“ — einziger Weg zu navigator.vibrate außerhalb von life.js. */
export function buzz(pattern) {
  if (!getPrefs().vibration || !canVibrate()) return false;
  try { return !!globalThis.navigator.vibrate(pattern); } catch { return false; }
}

/** Weniger Bewegung: „an“/„aus“ gehen vor, „System“ fragt prefers-reduced-motion. */
export function reducedMotion() {
  const m = getPrefs().reduceMotion;
  if (m === 'on') return true;
  if (m === 'off') return false;
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * Variante für den nächsten K.O.-Screen: bei „einzelne“ nur erlaubte. Ist die gezogene Variante nicht
 * erlaubt, wählt der gezogene Spruch-Index deterministisch eine erlaubte (kein zusätzlicher Zufall).
 */
export function koVariantFor(pick) {
  const p = getPrefs();
  const v = KO_VARIANTS.includes(pick?.variant) ? pick.variant : KO_VARIANTS[0];
  if (p.koScreens !== 'some' || p.koVariants.includes(v)) return v;
  const q = Number.isInteger(pick?.quote) ? Math.abs(pick.quote) : 0;
  return p.koVariants[q % p.koVariants.length];
}

// ---------------------------------------------------------------- Seite: Attribute und Wake Lock (main.js boot())

/** html[data-motion] (reduce | full | –) und html[data-turntime] (off | –) nach dem aktuellen Stand. */
export function applyDevicePrefs(p = getPrefs()) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (p.reduceMotion === 'on') root.dataset.motion = 'reduce';
  else if (p.reduceMotion === 'off') root.dataset.motion = 'full';
  else delete root.dataset.motion; // System: @media (prefers-reduced-motion) greift
  if (p.turnTime) delete root.dataset.turntime;
  else root.dataset.turntime = 'off';
}

/**
 * Hält den Bildschirm an, solange want() wahr ist, der Schalter an ist und die Seite sichtbar ist.
 * check() nach jedem Routenwechsel, visibilitychange und jeder Änderung der Einstellungen aufrufen.
 * Versteckt ⇒ freigeben (der Browser gibt ohnehin frei); wieder sichtbar ⇒ neu anfordern.
 * Fehlende API oder abgelehnte Anfrage ⇒ still nichts.
 */
export function keepAwake(want) {
  let lock = null;
  let pending = false;
  const wanted = () => {
    try { return !!want() && getPrefs().wakeLock && globalThis.document?.visibilityState !== 'hidden'; } catch { return false; }
  };
  const release = () => {
    const l = lock;
    lock = null;
    if (l) l.release?.().catch?.(() => {});
  };
  async function check() {
    if (!wanted()) { release(); return; }
    if (lock || pending || !canWakeLock()) return;
    pending = true;
    let l = null;
    try { l = await globalThis.navigator.wakeLock.request('screen'); } catch { l = null; }
    pending = false;
    if (!l) return;
    lock = l;
    l.addEventListener?.('release', () => { if (lock === l) lock = null; });
    // Route verlassen oder Schalter aus, während die Anfrage lief ⇒ gleich wieder freigeben
    if (!wanted()) release();
  }
  return { check, release };
}
