// Zwischenspeicher der laufenden Seite (P12, spec-p12-seitenwechsel.md, Vertrag).
// Arbeitsspeicher. P6 (spec-p6-kaltstart.md): optionaler Spiegel `store` (src/lib/device-store.js über state.js) —
// jede erfolgreiche Ladung wird nach Riegel 14a mit Marke/Generation vom BEGINN der Ladung gespiegelt, jedes
// drop/clear ebenso (außer drop(…, { keepStored: true }), Tab-Regel). Ohne `store` wie P12: nichts dauerhaft.
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

/**
 * @typedef {{ mark: () => any, gen: () => any, put: (key: string, value: any, at: number, riegel: { mark: any, gen: any }) => void, del: (keys: string[]) => void, clear: () => void }} MirrorStore
 */

/** @param {{ now?: () => number, store?: MirrorStore|null }} [opts] */
export function createCache({ now = Date.now, store = null } = {}) {
  /** @type {Map<string, Slot>} */
  const slots = new Map();
  let tokens = 0;
  /** @type {MirrorStore|null} */
  let mirror = store;
  /** Spiegel-Aufrufe fangen jeden Fehler: der Arbeitsspeicher bleibt P12. @param {(m: MirrorStore) => void} fn */
  const toMirror = (fn) => { if (mirror) { try { fn(mirror); } catch { /* Gerätespeicher ist optional */ } } };

  /** @param {() => any} loader */
  const start = (loader) => {
    try { return Promise.resolve(loader()); } catch (e) { return Promise.reject(e); }
  };

  return {
    /** P6: Spiegel setzen (state.js). @param {MirrorStore|null} s */
    setStore(s) { mirror = s; },

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
      // P6: Marke und Generation des Spiegels beim BEGINN der Ladung
      /** @type {{ mark: any, gen: any }|null} */
      let riegel = null;
      toMirror((m) => { riegel = { mark: m.mark(), gen: m.gen() }; });
      // Riegel 14a: geschrieben wird nur, wenn dieser Eintrag noch derselbe ist (nicht verworfen, nicht geleert)
      // und keine jüngere Ladung ihn übernommen hat.
      const current = () => slots.get(key) === mine && mine.run?.token === token;
      const promise = start(loader).then((value) => {
        if (current()) {
          mine.value = value; mine.at = now(); mine.has = true; mine.failed = false; mine.run = null;
          const r = riegel;
          if (r) toMirror((m) => m.put(key, value, mine.at, r));
        }
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
     * P6: Eintrag aus dem Gerätespeicher säen — nur, wenn für `key` weder Wert noch Ladung existiert. Kein Spiegel.
     * @param {string|null} key @param {any} value @param {number} at
     * @returns {boolean} gesät?
     */
    seed(key, value, at) {
      if (key == null || slots.has(key)) return false;
      slots.set(key, { has: true, value, at, failed: false, run: null });
      return true;
    },

    /**
     * Verwirft Einträge (auch laufende Ladungen; deren Antwort schreibt nicht mehr).
     * P6: ohne `keepStored` auch im Spiegel (die Tab-Regel verwirft mit `keepStored: true`).
     * @param {string|((p: { account: string, group: string, name: string, key: string }) => boolean)} match
     * @param {{ keepStored?: boolean }} [opts]
     * @returns {number}
     */
    drop(match, { keepStored = false } = {}) {
      /** @type {string[]} */
      const gone = [];
      for (const key of [...slots.keys()]) {
        if (typeof match === 'function' ? match(parts(key)) : key === match) { slots.delete(key); gone.push(key); }
      }
      // Fester Schlüssel: auch dann im Spiegel löschen, wenn der Arbeitsspeicher ihn nicht (mehr) hält.
      const del = !keepStored && typeof match === 'string' && !gone.length ? [match] : gone;
      if (!keepStored && del.length) toMirror((m) => m.del(del));
      return gone.length;
    },

    /** Alles weg; laufende Ladungen schreiben nicht mehr. P6: Spiegel ebenso. */
    clear() { slots.clear(); toMirror((m) => m.clear()); },

    /** @returns {string[]} Schlüssel mit Wert oder laufender Ladung */
    keys() { return [...slots.keys()]; },
  };
}

/** Die eine Instanz der App. */
export const pageCache = createCache();
