// Zwischenspeicher der laufenden Seite (P12, spec-p12-seitenwechsel.md, Vertrag).
// Nur Arbeitsspeicher: nichts landet dauerhaft im Browser (kein Web-Storage, keine Datenbank, keine Cookies).
// Jeder Eintrag gehört genau einem Konto und einer Gruppe: Schlüssel `${konto}|${gruppe}|${name}`.
// Ohne Konto oder Gruppe gibt es keinen Schlüssel (null) — dann wird geladen, aber nichts gemerkt.
// Gemerkt werden Daten, nie HTML und nie signierte Bild-Adressen.
// Keine Importe, damit die Datei in Node testbar bleibt.

/** Gruppen-Daten älter als das werden sofort gezeigt und im Hintergrund neu geladen (Entscheid 11). */
export const GROUP_MAX_AGE_MS = 60000;

/**
 * @param {string|null|undefined} account
 * @param {string|null|undefined} group
 * @param {string} name
 * @returns {string|null}
 */
export function cacheKey(account, group, name) {
  if (!account || !group) return null;
  return `${account}|${group}|${name}`;
}

/** @param {string} key */
function parts(key) {
  const i = key.indexOf('|');
  const j = key.indexOf('|', i + 1);
  return { account: key.slice(0, i), group: key.slice(i + 1, j), name: key.slice(j + 1), key };
}

/**
 * @typedef {{ value: any, at: number, failed: boolean }} CacheEntry
 * @typedef {{ has: boolean, value: any, at: number, failed: boolean, run: { token: number, promise: Promise<any> } | null }} Slot
 */

/** @param {{ now?: () => number }} [opts] */
export function createCache({ now = Date.now } = {}) {
  /** @type {Map<string, Slot>} */
  const slots = new Map();
  let tokens = 0;

  /** @param {() => any} loader */
  const start = (loader) => {
    try { return Promise.resolve(loader()); } catch (e) { return Promise.reject(e); }
  };

  return {
    /** @param {string|null} key @returns {CacheEntry|undefined} */
    peek(key) {
      const s = key == null ? undefined : slots.get(key);
      return s && s.has ? { value: s.value, at: s.at, failed: s.failed } : undefined;
    },

    /** Läuft für den Schlüssel gerade eine Ladung? (Zusatz zum Vertrag: Views hängen sich an statt neu zu laden.) */
    pending(/** @type {string|null} */ key) {
      return key != null && !!slots.get(key)?.run;
    },

    /**
     * @template T
     * @param {string|null} key
     * @param {() => T|Promise<T>} loader
     * @param {{ force?: boolean }} [opts]
     * @returns {Promise<T>}
     */
    load(key, loader, { force = false } = {}) {
      if (key == null) return start(loader);
      let slot = slots.get(key);
      if (!force && slot?.run) return slot.run.promise;
      if (!force && slot?.has) return Promise.resolve(slot.value);
      if (!slot) { slot = { has: false, value: undefined, at: 0, failed: false, run: null }; slots.set(key, slot); }
      const mine = slot;
      const token = ++tokens;
      // Riegel 14a: geschrieben wird nur, wenn dieser Eintrag noch derselbe ist (nicht verworfen, nicht geleert)
      // und keine jüngere Ladung ihn übernommen hat.
      const current = () => slots.get(key) === mine && mine.run?.token === token;
      const promise = start(loader).then((value) => {
        if (current()) { mine.value = value; mine.at = now(); mine.has = true; mine.failed = false; mine.run = null; }
        return value;
      }, (err) => {
        if (current()) {
          mine.run = null;
          if (mine.has) mine.failed = true; else slots.delete(key);
        }
        throw err;
      });
      mine.run = { token, promise };
      return promise;
    },

    /**
     * Verwirft Einträge (auch laufende Ladungen; deren Antwort schreibt nicht mehr).
     * @param {string|((p: { account: string, group: string, name: string, key: string }) => boolean)} match
     * @returns {number}
     */
    drop(match) {
      let n = 0;
      for (const key of [...slots.keys()]) {
        if (typeof match === 'function' ? match(parts(key)) : key === match) { slots.delete(key); n++; }
      }
      return n;
    },

    /** Alles weg; laufende Ladungen schreiben nicht mehr. */
    clear() { slots.clear(); },

    /** @returns {string[]} Schlüssel mit Wert oder laufender Ladung */
    keys() { return [...slots.keys()]; },
  };
}

/** Die eine Instanz der App. */
export const pageCache = createCache();
