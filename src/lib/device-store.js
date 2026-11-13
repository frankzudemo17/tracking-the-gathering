// Gerätespeicher (P6 Kaltstart, spec-p6-kaltstart.md, Vertrag): letzter Stand und Profilbilder dauerhaft auf
// diesem Gerät, damit der Kaltstart sofort zeichnet. IndexedDB `ttg-geraet` (Version 1), Objektspeicher
// `daten` (Datensätze { key, account, group, name, fmt, at, value }) und `bilder`
// (Datensätze { key, account, path, type, bytes: ArrayBuffer, at, seen, checked, fmt }).
//
// Mandantentrennung (Entscheid 4): jeder Schlüssel beginnt mit dem Konto (`konto|gruppe|name`, `konto|*|me`,
// `konto|avatars/<pfad>`) und jeder Datensatz trägt `account` (+ `group`). Gelesen wird nur, was Präfix UND Feld
// zum Konto (und zur Gruppe) passt; alles andere wird beim Lesen gelöscht („Kehren“). Geleert wird alles bei
// Abmelden/Kontowechsel (`clearAll`, aus state.js clearCaches) ⇒ auf dem Gerät liegt höchstens ein Konto.
// Nie gespeichert: HTML, signierte Adressen, Zugangs-Token.
//
// Schreiben (Entscheid 16): eine serielle Warteschlange, frühestens nach dem Zeichnen (setTimeout 0). Riegel
// werden beim AUSFÜHREN geprüft: Generation (jedes clearAll zählt hoch), Konto, Schreibmarke (eigene
// Schreibvorgänge dieses Geräts, Entscheid 9).
//
// FORMAT-REGEL: `STORE_FORMAT` hochzählen, sobald sich die Form gespeicherter Werte so ändert, dass alter Code
// sie nicht mehr versteht oder neuer Code ein Feld zwingend braucht. Die Gruppen-Daten (`group`) pinnt der
// Formwächter D20 in tests/unit/device-store.test.mjs (neue Spalte in history-data.js ⇒ rot, bis Version +
// Abdruck nachgezogen sind). Einträge aus select('*') (`page:start`, `page:profil`, `me`) sind nicht gepinnt:
// Code, der eine neu hinzugekommene Spalte liest, muss `undefined` vertragen oder `STORE_FORMAT` hochzählen.
//
// Keine Importe, damit die Datei in Node testbar bleibt (IndexedDB nur über das übergebene Hintergrund-Objekt).

export const STORE_FORMAT = 1;
/** Lesen des Gerätespeichers vor dem ersten Bild höchstens so lange (Entscheid 6). */
export const HYDRATE_MAX_MS = 500;
/** Vorab-Dekodieren der lokalen Profilbilder beim Säen höchstens so lange (Entscheid 12). */
export const DECODE_MAX_MS = 150;
export const RECORD_MAX_BYTES = 2000000;
export const IMG_MAX_COUNT = 150;
export const IMG_MAX_BYTES = 8000000;
export const IMG_MAX_ONE = 1000000;
/** Altpfad `avatar.jpg`: lokale Kopie höchstens einmal je 24 h im Hintergrund neu laden (Entscheid 13). */
export const LEGACY_RECHECK_MS = 86400000;
/** Nachfüllen nach so viel Ruhe seit dem letzten eigenen Schreibvorgang (Entscheid 10). */
export const REFILL_QUIET_MS = 3000;
/** Bilder, die so lange nicht gezeigt wurden, fallen beim Säen (Entscheid 15). */
export const IMG_STALE_MS = 30 * 86400000;
/** Lesende RPCs: kein eigener Schreibvorgang (Entscheid 9). */
export const READ_RPC = new Set(['check_invite', 'access_overview', 'member_removal_check', 'playgroup_files', 'check_delete_my_account', 'my_account_files']);

const BUCKET = 'avatars';
const ME = 'me';

/**
 * Eigener Schreibvorgang dieses Geräts? (Entscheid 9; rein)
 * @param {string} method
 * @param {string} url absolute oder relative Adresse
 */
export function isOwnWrite(method, url) {
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  let p;
  try { p = new URL(String(url), 'http://x.invalid').pathname; } catch { return false; }
  if (p.startsWith('/rest/v1/rpc/')) return !READ_RPC.has(decodeURIComponent(p.slice('/rest/v1/rpc/'.length).split('/')[0]));
  if (p.startsWith('/rest/v1/')) return true;
  if (p.startsWith('/storage/v1/object/')) return !p.startsWith('/storage/v1/object/sign/');
  if (p.startsWith('/functions/v1/')) return true;
  return false;
}

/** Dateiname eines neu hochgeladenen Profilbilds (Entscheid 13). @param {number} stamp @param {string} rand 4 Hex-Zeichen */
export const avatarFileName = (stamp, rand) => `avatar-${stamp.toString(36)}${rand}.jpg`;
/** Altpfad: Dateiname genau `avatar.jpg` (ältere App-Versionen überschreiben ihn). @param {string|null|undefined} path */
export const isLegacyAvatarPath = (path) => typeof path === 'string' && path.slice(path.lastIndexOf('/') + 1) === 'avatar.jpg';
/** Gleicher Ordner (alles vor dem letzten `/`). @param {string} a @param {string} b */
export function sameFolder(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const i = a.lastIndexOf('/'); const j = b.lastIndexOf('/');
  return i > 0 && j > 0 && a.slice(0, i) === b.slice(0, j);
}

/**
 * @typedef {{ get: (store: string, key: string) => Promise<any>, put: (store: string, record: any) => Promise<any>,
 *   del: (store: string, keys: string[]) => Promise<any>, all: (store: string) => Promise<any[]>, clear: (store: string) => Promise<any> }} Backend
 */

/** Hintergrund im Arbeitsspeicher (Tests). @returns {Backend & { maps: Record<string, Map<string, any>> }} */
export function memoryBackend() {
  /** @type {Record<string, Map<string, any>>} */
  const maps = { daten: new Map(), bilder: new Map() };
  const m = (/** @type {string} */ s) => maps[s] || (maps[s] = new Map());
  return {
    maps,
    async get(s, k) { return m(s).get(k); },
    async put(s, r) { m(s).set(r.key, r); },
    async del(s, ks) { for (const k of ks) m(s).delete(k); },
    async all(s) { return [...m(s).values()]; },
    async clear(s) { m(s).clear(); },
  };
}

/**
 * IndexedDB-Hintergrund. Jeder Fehler (kein IndexedDB, privater Modus, Kontingent, iOS räumt auf) ⇒ verhält sich
 * wie ein leerer Speicher, der nichts behält — nie ein Wurf.
 * @param {string} [name]
 * @returns {Backend}
 */
export function idbBackend(name = 'ttg-geraet') {
  /** @type {Promise<any>|null} */
  let opening = null;
  const open = () => {
    if (opening) return opening;
    opening = new Promise((resolve) => {
      try {
        const idb = /** @type {any} */ (globalThis).indexedDB;
        if (!idb) { resolve(null); return; }
        const req = idb.open(name, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of ['daten', 'bilder']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'key' });
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => { try { db.close(); } catch { /* egal */ } opening = null; };
          db.onclose = () => { opening = null; };
          resolve(db);
        };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
    return opening;
  };
  /** @param {string} s @param {'readonly'|'readwrite'} mode @param {(os: any) => any} fn @param {any} fallback */
  const run = async (s, mode, fn, fallback) => {
    const db = await open();
    if (!db) return fallback;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(s, mode);
        const os = tx.objectStore(s);
        const req = fn(os);
        let out = fallback;
        if (req) req.onsuccess = () => { out = req.result; };
        tx.oncomplete = () => resolve(out === undefined ? fallback : out);
        tx.onerror = () => resolve(fallback);
        tx.onabort = () => resolve(fallback);
      } catch { resolve(fallback); }
    });
  };
  return {
    get: (s, k) => run(s, 'readonly', (os) => os.get(k), undefined),
    put: (s, r) => run(s, 'readwrite', (os) => { os.put(r); return null; }, false),
    del: (s, ks) => run(s, 'readwrite', (os) => { for (const k of ks) os.delete(k); return null; }, false),
    all: (s) => run(s, 'readonly', (os) => os.getAll(), []),
    clear: (s) => run(s, 'readwrite', (os) => { os.clear(); return null; }, false),
  };
}

/** @param {string} key */
function keyParts(key) {
  const i = key.indexOf('|');
  const j = key.indexOf('|', i + 1);
  if (i < 0 || j < 0) return null;
  return { account: key.slice(0, i), group: key.slice(i + 1, j), name: key.slice(j + 1) };
}
/** Kalendertag (lokale Zeit) als Zahl. @param {number} t */
const day = (t) => { const d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
/** @param {any} b */
const byteLen = (b) => (b && typeof b.byteLength === 'number' ? b.byteLength : -1);

/**
 * `me` nach Lesestelle L2: Gruppe muss in den Mitgliedschaften vorkommen, sonst die erste Mitgliedschaft.
 * @param {any} v
 */
function normMe(v) {
  if (!v || typeof v !== 'object' || !v.profile) return null;
  const memberships = Array.isArray(v.memberships) ? v.memberships : [];
  const groupId = memberships.some((m) => m && m.playgroup_id === v.groupId) ? v.groupId : memberships[0]?.playgroup_id || null;
  return { profile: v.profile, memberships, groupId };
}

/**
 * @param {{ backend: Backend, now?: () => number }} opts
 */
export function createDeviceStore({ backend, now = Date.now }) {
  /** @type {string|null} */
  let acct = null;
  let gen = 0;
  let wmark = 0;
  /** @type {Array<() => Promise<any>>} */
  const queue = [];
  let running = false;
  /** @type {Array<() => void>} */
  let idle = [];

  // Jeder Aufruf am Hintergrund ist eingefangen: der Gerätespeicher wirft nie (Entscheid 15).
  /** @param {() => Promise<any>} fn @param {any} [fallback] */
  const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };

  const pump = async () => {
    while (queue.length) {
      const op = /** @type {() => Promise<any>} */ (queue.shift());
      await safe(op);
    }
    running = false;
    const done = idle; idle = [];
    for (const r of done) r();
  };
  /** @param {() => Promise<any>} op */
  const enqueue = (op) => {
    queue.push(op);
    if (!running) { running = true; setTimeout(pump, 0); }
  };

  /** Alle Gruppen-/Seiten-Datensätze des Kontos löschen (Schreibmarke, Entscheid 9). @param {string} a */
  const dropGroupData = async (a) => {
    const all = await safe(() => backend.all('daten'), []);
    const keys = all.filter((r) => r && typeof r.key === 'string' && r.key.startsWith(`${a}|`) && r.name !== ME).map((r) => r.key);
    if (keys.length) await safe(() => backend.del('daten', keys));
  };

  /** Bilder-Obergrenzen (Entscheid 15): Anzahl und Summe; es fallen die am längsten nicht gezeigten. */
  const enforceImageLimits = async () => {
    const all = (await safe(() => backend.all('bilder'), [])).filter(Boolean);
    all.sort((x, y) => (x.seen || 0) - (y.seen || 0));
    let total = all.reduce((s, r) => s + Math.max(0, byteLen(r.bytes)), 0);
    const drop = [];
    let n = all.length;
    for (const r of all) {
      if (n <= IMG_MAX_COUNT && total <= IMG_MAX_BYTES) break;
      drop.push(r.key); n--; total -= Math.max(0, byteLen(r.bytes));
    }
    if (drop.length) await safe(() => backend.del('bilder', drop));
  };

  const imgKey = (/** @type {string} */ a, /** @type {string} */ path) => `${a}|${BUCKET}/${path}`;

  return {
    /** @param {string|null} id */
    setAccount(id) { acct = id || null; },
    account() { return acct; },
    generation() { return gen; },
    mark() { return wmark; },

    /** Eigener Schreibvorgang: Marke +1; Gruppen-/Seiten-Datensätze des Kontos weg (me und Bilder bleiben). */
    noteWrite() {
      wmark++;
      const a = acct; const g = gen;
      if (!a) return;
      enqueue(async () => { if (g === gen && a === acct) await dropGroupData(a); });
    },

    /**
     * Lesen für den Start (Lesestellen L1–L3). Nur Datensätze des Kontos (Präfix + Feld) und der Format-Version;
     * Gruppen-Einträge nur der Gruppe `group` (sonst `me.groupId`). Alles andere wird gekehrt.
     * @param {string} account
     * @param {{ group?: string|null }} [opts]
     * @returns {Promise<{ me: { profile: any, memberships: any[], groupId: string|null }|null, entries: Array<{ key: string, value: any, at: number }>, images: Array<{ path: string, type: string, bytes: ArrayBuffer, at: number, seen: number, checked: number }> }>}
     */
    async hydrate(account, { group } = {}) {
      const empty = { me: null, entries: [], images: [] };
      if (!account) return empty;
      const g0 = gen;
      const [daten, bilder] = await Promise.all([safe(() => backend.all('daten'), []), safe(() => backend.all('bilder'), [])]);
      if (g0 !== gen) return empty;
      const sweepD = []; const sweepB = [];
      const meKey = `${account}|*|${ME}`;
      // L2 me
      let me = null;
      for (const r of daten) {
        if (!r || r.name !== ME) continue;
        if (r.key === meKey && r.account === account && r.fmt === STORE_FORMAT) me = normMe(r.value);
        if (!me || r.key !== meKey) sweepD.push(r?.key);
      }
      const gid = group !== undefined ? group : me?.groupId ?? null;
      // L1 Gruppen-Einträge
      const entries = [];
      for (const r of daten) {
        if (!r || r.name === ME) continue;
        const p = typeof r.key === 'string' ? keyParts(r.key) : null;
        const ok = !!p && !!gid && r.fmt === STORE_FORMAT && p.account === account && r.account === account
          && p.group === gid && r.group === gid && p.name === r.name && typeof r.at === 'number';
        if (ok) entries.push({ key: r.key, value: r.value, at: r.at }); else sweepD.push(r.key);
      }
      // L3 Bilder
      const images = [];
      const t = now();
      for (const r of bilder) {
        const ok = !!r && r.account === account && r.fmt === STORE_FORMAT && typeof r.path === 'string'
          && r.key === imgKey(account, r.path) && byteLen(r.bytes) >= 0 && typeof r.type === 'string';
        if (ok && t - (r.seen || 0) <= IMG_STALE_MS) images.push({ path: r.path, type: r.type, bytes: r.bytes, at: r.at, seen: r.seen, checked: r.checked });
        else sweepB.push(r?.key);
      }
      const dk = sweepD.filter((k) => k != null); const bk = sweepB.filter((k) => k != null);
      if (dk.length || bk.length) {
        enqueue(async () => {
          if (dk.length) await backend.del('daten', dk);
          if (bk.length) await backend.del('bilder', bk);
        });
      }
      return { me, entries, images };
    },

    /**
     * @param {string} key `konto|gruppe|name`
     * @param {any} value
     * @param {number} at
     * @param {{ mark: any, gen: any }} riegel Marke und Generation vom Beginn der Ladung
     */
    putData(key, value, at, { mark, gen: g } = /** @type {any} */ ({})) {
      enqueue(async () => {
        const p = typeof key === 'string' ? keyParts(key) : null;
        const ok = () => g === gen && mark === wmark && !!acct && !!p && p.account === acct && p.name !== ME;
        if (!ok() || !p) return;
        let size;
        try { size = JSON.stringify(value)?.length ?? 0; } catch { return; }
        if (size > RECORD_MAX_BYTES) { console.warn(`Gerätespeicher: ${p.name} zu groß (${size}), nicht gespeichert`); return; }
        const old = await backend.get('daten', key);
        if (old && old.account === acct && typeof old.at === 'number' && old.at > at) return;
        if (!ok()) return;
        await backend.put('daten', { key, account: p.account, group: p.group, name: p.name, fmt: STORE_FORMAT, at, value });
      });
    },

    /** Alle Gruppen-/Seiten-Datensätze einer Gruppe (jedes Konto) löschen — Gruppenwechsel-Setter (Entscheid 11). @param {string} group */
    dropGroup(group) {
      if (!group) return;
      enqueue(async () => {
        const all = await backend.all('daten');
        const keys = all.filter((r) => r && r.name !== ME && (r.group === group || keyParts(String(r.key))?.group === group)).map((r) => r.key);
        if (keys.length) await backend.del('daten', keys);
      });
    },

    /** Alle Gruppen-/Seiten-Datensätze (jedes Konto) löschen; `me` und Bilder bleiben — Spiegel von pageCache.clear(). */
    dropEntries() {
      enqueue(async () => {
        const all = await backend.all('daten');
        const keys = all.filter((r) => r && r.name !== ME).map((r) => r.key);
        if (keys.length) await backend.del('daten', keys);
      });
    },

    /** @param {string[]} keys */
    dropData(keys) {
      const ks = (keys || []).filter((k) => typeof k === 'string');
      if (ks.length) enqueue(() => backend.del('daten', ks));
    },

    /**
     * @param {{ profile: any, memberships: any[], groupId: string|null }} me
     * @param {{ gen: any }} riegel
     */
    putMe({ profile, memberships, groupId }, { gen: g } = /** @type {any} */ ({})) {
      enqueue(async () => {
        const a = acct;
        if (g !== gen || !a || profile?.id !== a) return;
        await backend.put('daten', { key: `${a}|*|${ME}`, account: a, group: null, name: ME, fmt: STORE_FORMAT, at: now(), value: { profile, memberships, groupId } });
      });
    },

    /** @param {string} account */
    async getMe(account) {
      if (!account) return null;
      const r = await safe(() => backend.get('daten', `${account}|*|${ME}`));
      return r && r.account === account && r.fmt === STORE_FORMAT && r.name === ME ? normMe(r.value) : null;
    },

    /**
     * @param {string} path Pfad im Bucket `avatars`
     * @param {{ type: string, bytes: ArrayBuffer }} img
     * @param {{ gen: any }} riegel
     */
    putImage(path, { type, bytes }, { gen: g } = /** @type {any} */ ({})) {
      enqueue(async () => {
        const a = acct;
        const n = byteLen(bytes);
        if (g !== gen || !a || typeof path !== 'string' || n < 0 || n > IMG_MAX_ONE) return;
        const t = now();
        await backend.put('bilder', { key: imgKey(a, path), account: a, path, type: String(type || 'image/jpeg'), bytes, at: t, seen: t, checked: t, fmt: STORE_FORMAT });
        await enforceImageLimits();
      });
    },

    /** @param {string} path */
    dropImage(path) {
      const a = acct;
      if (a && typeof path === 'string') enqueue(() => backend.del('bilder', [imgKey(a, path)]));
    },

    /** Gezeigt: `seen` höchstens einmal je Kalendertag schreiben. @param {string} path */
    touchImage(path) {
      const a = acct; const g = gen;
      if (!a || typeof path !== 'string') return;
      enqueue(async () => {
        if (g !== gen || a !== acct) return;
        const r = await backend.get('bilder', imgKey(a, path));
        const t = now();
        if (!r || r.account !== a || day(r.seen || 0) === day(t)) return;
        if (g !== gen) return;
        await backend.put('bilder', { ...r, seen: t });
      });
    },

    /** Prüfzeitpunkt eines Bildes setzen (Altpfad-Regel), ohne die Bytes zu ändern. @param {string} path */
    touchChecked(path) {
      const a = acct; const g = gen;
      if (!a || typeof path !== 'string') return;
      enqueue(async () => {
        if (g !== gen || a !== acct) return;
        const r = await backend.get('bilder', imgKey(a, path));
        if (!r || r.account !== a || g !== gen) return;
        await backend.put('bilder', { ...r, checked: now() });
      });
    },

    /** Aufräumen (Entscheid 15): Bilder des Kontos, deren Pfad nicht in `paths` steht, fallen. @param {Iterable<string>} paths */
    keepImages(paths) {
      const a = acct; const g = gen;
      const keep = new Set(paths || []);
      if (!a) return;
      enqueue(async () => {
        if (g !== gen || a !== acct) return;
        const all = await backend.all('bilder');
        const drop = all.filter((r) => r && r.account === a && !keep.has(r.path)).map((r) => r.key);
        if (drop.length) await backend.del('bilder', drop);
      });
    },

    /** Alle gespeicherten Datensätze des Kontos (für das Aufräumen: welche Pfade kommen noch vor). */
    async ownData() {
      const a = acct;
      if (!a) return [];
      const all = await safe(() => backend.all('daten'), []);
      return all.filter((r) => r && r.account === a && typeof r.key === 'string' && r.key.startsWith(`${a}|`) && r.fmt === STORE_FORMAT);
    },

    /** Beide Objektspeicher ganz leeren; Generation +1 ⇒ eingereihte Schreibvorgänge schreiben nicht mehr. */
    clearAll() {
      gen++;
      enqueue(async () => {
        await safe(() => backend.clear('daten'));
        await safe(() => backend.clear('bilder'));
      });
    },

    /** @returns {Promise<void>} erfüllt, sobald die Warteschlange leer ist */
    flush() {
      if (!running && !queue.length) return Promise.resolve();
      return new Promise((r) => { idle.push(r); });
    },
  };
}

/** Die eine Instanz der App (in Node ohne indexedDB ⇒ leerer Hintergrund, der nichts behält). */
export const deviceStore = createDeviceStore({ backend: idbBackend() });
