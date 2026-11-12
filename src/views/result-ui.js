// Reine Hilfen für den Ergebnis-Screen (P20). Keine DOM-, keine Netz-Importe ⇒ in Node testbar
// (tests/unit/result-ui.test.mjs). Zahlen rechnet src/lib/stats.js — hier nur Formularstand, RPC-Argumente,
// Bildmaße, Fehlerabbildung, Ordnen.

/** @typedef {import('../lib/history-data.js').GameData} GameData */
/** @typedef {import('../lib/history-data.js').DamageRow} DamageRow */
/** @typedef {import('../lib/stats.js').Placement} Placement */
/**
 * @typedef {{ salt: number|null, fun: number|null, deckRating: number|null, deckSalt: Record<string, number>,
 *   saltiest: string|null, potg: string|null, potgText: string, wincon: string|null, note: string,
 *   hadRating: boolean, hadDeckSalt: boolean }} RateForm
 */

/** Siegbedingungen (DB-Enum `win_condition`, init.sql:15), Reihenfolge = Chips. */
export const WINCONS = ['kampfschaden', 'commander', 'kombo', 'gift', 'alternativ', 'aufgabe'];
export const POTG_MAX = 200;
export const NOTE_MAX = 500;
export const PHOTO_EDGE = 1600;
export const PHOTO_QUALITY = 0.8;
export const DAMAGE_TOP = 6;

const isScore = (n) => Number.isInteger(n) && n >= 1 && n <= 5;

/**
 * Formularstand beim Öffnen: eigene Bewertung, eigenes Deck-Salz, eigene Stimme, Siegbedingung, Notiz.
 * @param {Pick<GameData, 'game'|'ratings'|'deckSalt'|'potg'>|null|undefined} data
 * @param {string|null|undefined} meId eigenes Mitglied (members.id)
 * @returns {RateForm}
 */
export function initialForm(data, meId) {
  const game = data?.game;
  const mine = (data?.ratings || []).find((r) => r.memberId === meId && r.gameId === game?.id) || null;
  /** @type {Record<string, number>} */
  const deckSalt = {};
  for (const r of data?.deckSalt || []) if (r.raterId === meId && r.gameId === game?.id && isScore(r.salt)) deckSalt[r.deckId] = r.salt;
  const vote = (data?.potg || []).find((v) => v.voterId === meId && v.gameId === game?.id) || null;
  return {
    salt: isScore(mine?.salt) ? mine.salt : null,
    fun: isScore(mine?.fun) ? mine.fun : null,
    deckRating: isScore(mine?.deckRating) ? mine.deckRating : null,
    deckSalt,
    saltiest: null,
    potg: vote?.votedFor ?? null,
    potgText: vote?.text ?? '',
    wincon: game?.wincon && WINCONS.includes(game.wincon) ? game.wincon : null,
    note: game?.note ?? '',
    hadRating: !!mine,
    hadDeckSalt: Object.keys(deckSalt).length > 0,
  };
}

/** Skala 1–5 setzen; derselbe Wert noch einmal ⇒ leer. @param {number|null} cur @param {number} n */
export const toggleScore = (cur, n) => (cur === n ? null : n);

/**
 * Deck-Salz eines Decks setzen; derselbe Wert noch einmal ⇒ unbewertet. Weicht der Wert von 5 ab,
 * verliert das Deck die Markierung „Salzigstes Deck“.
 * @param {RateForm} form @param {string} deckId @param {number} n @returns {RateForm}
 */
export function setDeckSalt(form, deckId, n) {
  const deckSalt = { ...form.deckSalt };
  if (deckSalt[deckId] === n) delete deckSalt[deckId];
  else deckSalt[deckId] = n;
  const saltiest = form.saltiest === deckId && deckSalt[deckId] !== 5 ? null : form.saltiest;
  return { ...form, deckSalt, saltiest };
}

/**
 * Schnellwahl „Salzigstes Deck“: setzt das Deck auf 5 und markiert es (genau eine Markierung).
 * Wechsel nimmt die Markierung beim vorigen weg, dessen Wert bleibt. Noch einmal tippen ⇒ Markierung weg, Wert bleibt.
 * @param {RateForm} form @param {string} deckId @returns {RateForm}
 */
export function pickSaltiest(form, deckId) {
  if (form.saltiest === deckId) return { ...form, saltiest: null };
  return { ...form, deckSalt: { ...form.deckSalt, [deckId]: 5 }, saltiest: deckId };
}

/** POTG-Wahl; dieselbe Person noch einmal ⇒ keine Stimme. @param {RateForm} form @param {string} memberId */
export const pickPotg = (form, memberId) => ({ ...form, potg: form.potg === memberId ? null : memberId });

/** Siegbedingung (einfach wählbar; noch einmal ⇒ keine). @param {RateForm} form @param {string} w */
export const pickWincon = (form, w) => ({ ...form, wincon: form.wincon === w || !WINCONS.includes(w) ? null : w });

/**
 * Prüfung vor dem Speichern (Länge nach dem Trimmen, wie rate_game bzw. games_note_len).
 * @param {RateForm} form
 * @returns {{ potgTooLong: boolean, noteTooLong: boolean, ok: boolean }}
 */
export function formCheck(form) {
  const potgTooLong = String(form.potgText || '').trim().length > POTG_MAX;
  const noteTooLong = String(form.note || '').trim().length > NOTE_MAX;
  return { potgTooLong, noteTooLong, ok: !potgTooLong && !noteTooLong };
}

/**
 * Decks, die ich salzen darf: Decks der ANDEREN Spieler, je Deck einmal, ohne mein eigenes (rate_game:
 * „Eigenes Deck nicht salzen“), ohne Spieler ohne Deck. Reihenfolge = Platzierung.
 * @param {Pick<Placement, 'memberId'|'deckId'>[]} placements
 * @param {string|null|undefined} meId
 * @returns {{ deckId: string, memberIds: string[] }[]}
 */
export function saltDecks(placements, meId) {
  const own = placements.find((p) => p.memberId === meId)?.deckId ?? null;
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const p of placements) {
    if (p.memberId === meId || p.deckId == null || p.deckId === own) continue;
    const list = out.get(p.deckId) || [];
    list.push(p.memberId);
    out.set(p.deckId, list);
  }
  return [...out].map(([deckId, memberIds]) => ({ deckId, memberIds }));
}

/**
 * Formularstand ⇒ Argumente für `rate_game` (voller Stand bei jedem Speichern, spec-p14-schema Entscheid 1).
 * Deck-Salz: nur bewertete Decks aus `allowed`; nichts bewertet ⇒ `null` (unverändert), außer es gab vorher
 * eigenes Deck-Salz ⇒ `{}` (alles eigene löschen). POTG-Text getrimmt, leer oder ohne Stimme ⇒ null.
 * @param {string} gameId
 * @param {RateForm} form
 * @param {string[]} allowed Deck-IDs aus saltDecks()
 */
export function rateArgs(gameId, form, allowed) {
  const ok = new Set(allowed);
  /** @type {Record<string, number>} */
  const salt = {};
  for (const [deckId, n] of Object.entries(form.deckSalt || {})) if (ok.has(deckId) && isScore(n)) salt[deckId] = n;
  const any = Object.keys(salt).length > 0;
  const text = String(form.potgText || '').trim();
  return {
    p_game: gameId,
    p_salt: isScore(form.salt) ? form.salt : null,
    p_fun: isScore(form.fun) ? form.fun : null,
    p_deck_rating: isScore(form.deckRating) ? form.deckRating : null,
    p_deck_salt: any ? salt : form.hadDeckSalt ? {} : null,
    p_potg: form.potg || null,
    p_potg_text: form.potg && text ? text : null,
  };
}

/**
 * Felder für `games.update` (Siegbedingung, Notiz getrimmt, leer ⇒ null).
 * @param {RateForm} form
 */
export const gamePatch = (form) => ({ wincon: form.wincon || null, note: String(form.note || '').trim() || null });

/**
 * Bildmaße für den Upload: längste Kante höchstens `max`, nie vergrößern, ganze Pixel.
 * @param {number} w @param {number} h @param {number} [max]
 * @returns {{ width: number, height: number }}
 */
export function fitSize(w, h, max = PHOTO_EDGE) {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Speicherpfad des Spielfotos (init.sql:489: `<playgroup_id>/<game_id>.jpg`). */
export const photoPath = (groupId, gameId) => `${groupId}/${gameId}.jpg`;

/** Bekannte Meldungen aus rate_game (Migration 20261113000000_ende.sql) ⇒ i18n-Schlüssel `result.err.*`. */
const RATE_ERRORS = [
  [/^Spiel ist nicht gewertet/, 'notFinished'],
  [/^Nur Mitspieler/, 'notPlayer'],
  [/^Nicht angemeldet/, 'auth'],
  [/^Bewertung muss/, 'range'],
  [/^(Deck nicht in diesem Spiel|Eigenes Deck nicht salzen|Deck-Salz ungültig)/, 'deck'],
  [/^Spieler nicht in diesem Spiel/, 'potg'],
  [/^Text zu lang/, 'tooLong'],
  [/games_note_len/, 'noteTooLong'],
];

/**
 * Fehler beim Speichern ⇒ Schlüssel unter `result.err` oder null (dann errText() aus src/lib/ui.js).
 * @param {unknown} e @param {boolean} [online]
 * @returns {string|null}
 */
export function saveErrorKey(e, online = true) {
  const m = String(/** @type {any} */ (e)?.message ?? e ?? '');
  if (!online || /Failed to fetch|NetworkError|Load failed/i.test(m)) return 'offline';
  for (const [re, key] of RATE_ERRORS) if (re.test(m)) return key;
  return null;
}

/**
 * Die größten Schadenszeilen (Prototyp `dmgLog` top 6): nach Schaden, dann Commander-Schaden, dann Gift absteigend.
 * Zeilen ohne jeden Wert fallen weg.
 * @param {DamageRow[]|null|undefined} rows @param {number} [n]
 * @returns {DamageRow[]}
 */
export function damageTop(rows, n = DAMAGE_TOP) {
  return (rows || [])
    .filter((r) => r && (r.damage || r.commanderDamage || r.poison))
    .slice()
    .sort((a, b) => (b.damage || 0) - (a.damage || 0) || (b.commanderDamage || 0) - (a.commanderDamage || 0)
      || (b.poison || 0) - (a.poison || 0) || String(a.source).localeCompare(String(b.source)) || String(a.target).localeCompare(String(b.target)))
    .slice(0, n);
}

/**
 * Letzte gewertete Spiele (neueste zuerst) für die Startseite.
 * @param {{ id: string, status: string, startedAt: string }[]|null|undefined} games @param {number} [n]
 */
export function recentGames(games, n = 3) {
  return (games || []).filter((g) => g.status === 'finished')
    .slice().sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0) || String(b.id).localeCompare(String(a.id)))
    .slice(0, n);
}

/** Kurzes Datum, z. B. „6. Nov. 2026“ (Ortszeit des Geräts). */
export function fmtShortDate(iso, lang = 'de') {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * P2 Revanche (spec-p2-revanche.md Entscheid 9): hat sich das Formular gegenüber dem Stand beim Öffnen geändert?
 * Skalen, Stimmen, Siegbedingung direkt; Deck-Salz als Menge der Einträge mit Zahlwert; POTG-Text und Notiz nach trim().
 * hadRating/hadDeckSalt zählen nicht. Fehlende Felder werfen nicht.
 * @param {Partial<RateForm>|null|undefined} initial @param {Partial<RateForm>|null|undefined} form
 */
export function formDirty(initial, form) {
  const a = initial || {};
  const b = form || {};
  for (const k of ['salt', 'fun', 'deckRating', 'potg', 'saltiest', 'wincon']) if ((a[k] ?? null) !== (b[k] ?? null)) return true;
  const txt = (v) => String(v ?? '').trim();
  if (txt(a.potgText) !== txt(b.potgText) || txt(a.note) !== txt(b.note)) return true;
  const salts = (x) => Object.entries(x.deckSalt || {}).filter(([, n]) => typeof n === 'number' && Number.isFinite(n)).map(([d, n]) => `${d}:${n}`).sort().join('|');
  return salts(a) !== salts(b);
}
