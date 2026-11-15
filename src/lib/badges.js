// Abzeichen (P4, spec-p4-abzeichen.md): 21 Abzeichen, rückwirkend aus allen beendeten Partien einer Gruppe.
// Rein: kein DOM, keine Uhr (`now` kommt als Parameter), kein Speicher, kein Zufall; Node-testbar.
// Zwei Quellen (Entscheid 3): gespeicherte Ergebnisse (GroupData) und „Fakten“ je Spiel aus dem Replay der
// game_events mit der bestehenden Engine (`gameFacts`). Fehlen die Fakten eines Spiels, entfallen nur die
// Replay-Abzeichen dieses Spiels. Ranglistenerste, Erzfeind und Salz kommen aus stats.js (Entscheid 4).
// Eine Zeitleiste (`badgeAwards`, ein chronologischer Durchlauf) speist alle drei Orte: Profil, Ergebnis, Abend.
import { createGame, apply } from '../game/engine.js';
import { playerTable, memberProfile, deckSaltTable } from './stats.js';

/** Logik-Version der Fakten (Teil des Speicher-Schlüssels; hochzählen, wenn sich `gameFacts` ändert). */
export const FACTS_VERSION = 1;

/** @typedef {import('./history-data.js').GroupData} GroupData */
/** @typedef {import('./history-data.js').GameRow} GameRow */
/** @typedef {import('./history-data.js').PlayerRow} PlayerRow */
/** @typedef {{ id: string, group: 'start'|'play'|'endure'|'rare', icon: string, tiers: number[]|null, unit: 'games'|'wins'|'streak'|'decks'|'evenings'|null, replay: boolean, rare: boolean, secret: boolean }} BadgeDef */
/** @typedef {{ target: string, source: string|null, turn: number, cmd21: boolean, poison10: boolean }} KoFact */
/** @typedef {{ v: number, ok: true, min: Record<string, number>, gained: Record<string, number>, kos: KoFact[], startWinner: string|null } | { v: number, ok: false, reason: 'none'|'error' }} GameFacts */
/** @typedef {Map<string, GameFacts> | Record<string, GameFacts> | null | undefined} FactsIn */
/** @typedef {{ memberId: string, badgeId: string, tier: 1|2|3|null, gameId: string }} Award */
/** @typedef {{ games: number, wins: number, streak: number, decks: number, evenings: number }} Progress */
/** @typedef {{ id: string, earned: boolean, tier: 0|1|2|3, gameId: string|null, at: string|null, tierGames: (string|null)[], value: number|null, next: number|null, hidden: boolean }} BadgeState */

/** @param {string} id @param {BadgeDef['group']} group @param {string} icon @param {Partial<BadgeDef>} [x] @returns {BadgeDef} */
const def = (id, group, icon, x = {}) => ({ id, group, icon, tiers: null, unit: null, replay: false, rare: false, secret: false, ...x });

/** Katalog (Entscheid 1, Franco 12.11.): Reihenfolge = Anzeige-Reihenfolge. @type {BadgeDef[]} */
export const BADGES = [
  def('erste-runde', 'start', 'flag'),
  def('erster-sieg', 'start', 'trophy'),
  def('erstes-blut', 'start', 'drop'),
  def('comeback', 'play', 'arrowCounterClockwise', { replay: true }),
  def('messers-schneide', 'play', 'heart'),
  def('unberuehrbar', 'play', 'shieldStar', { replay: true }),
  def('commander-henker', 'play', 'skull', { replay: true }),
  def('giftmischer', 'play', 'radioactive', { replay: true }),
  def('doppelschlag', 'play', 'lightning', { replay: true }),
  def('blitzsieg', 'play', 'hourglass'),
  def('koenigsmoerder', 'play', 'crown'),
  def('rache', 'play', 'crosshair'),
  def('lebensquell', 'play', 'gauge', { replay: true }),
  def('stammgast', 'endure', 'users', { tiers: [10, 50, 100], unit: 'games' }),
  def('siegertyp', 'endure', 'medal', { tiers: [5, 25, 50], unit: 'wins' }),
  def('serie', 'endure', 'fire', { tiers: [3, 5, 10], unit: 'streak' }),
  def('deckbauer', 'endure', 'coins', { tiers: [3, 5, 10], unit: 'decks' }),
  def('abendkoenig', 'endure', 'moon', { tiers: [1, 3, 5], unit: 'evenings' }),
  def('salzbergwerk', 'rare', 'salt', { rare: true }),
  def('nachteule', 'rare', 'sun', { rare: true, secret: true }),
  def('gluckspilz', 'rare', 'smiley', { rare: true, secret: true, replay: true }),
];
const BY_ID = new Map(BADGES.map((b) => [b.id, b]));
const CATALOG = new Map(BADGES.map((b, i) => [b.id, i]));

const COMEBACK_BELOW = 5;        // Sieg mit Lebensminimum < 5 (absolut, Entscheid 12)
const UNTOUCHED_SHARE = 0.75;    // Unberührbar: Minimum ≥ ceil(0,75 × Startleben)
const WELLSPRING = 30;           // Lebensquell: brutto dazugewonnen ≥ 30
const LUCK_RUN = 3;              // Glückspilz: dreimal in Folge
const BLITZ_ROUND = 6;           // Blitzsieg: bis Runde 6
const EVENING_CLOSED_MS = 6 * 3600000; // Abend abgeschlossen: 6 h nach dem letzten Start (spielen.sql:124–131)
const NIGHT = [2, 6];            // Nachteule: Ende in Berlin in [02:00, 06:00)
const CMD_LETHAL = 21;
const POISON_LETHAL = 10;
const HOUR_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' });

// ---------------------------------------------------------------------------
// Helfer

const isNum = (/** @type {unknown} */ x) => typeof x === 'number' && Number.isFinite(x);
/** @param {unknown} iso @returns {number} Zeitpunkt in ms (ungültig ⇒ 0), wie stats.js */
const ts = (iso) => { const t = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : 0; };
const cmpStr = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0);
/** Chronologie wie stats.js `chrono`: startedAt als Zeitpunkt, dann id. */
const chrono = (/** @type {GameRow} */ a, /** @type {GameRow} */ b) => ts(a.startedAt) - ts(b.startedAt) || cmpStr(a.id, b.id);
/** @param {unknown} now @returns {number} */
const nowMs = (now) => (isNum(now) ? /** @type {number} */ (now) : typeof now === 'string' ? ts(now) : 0);
/** Stunde (0–23) in Europe/Berlin. @param {number} ms */
function berlinHour(ms) {
  const part = HOUR_FMT.formatToParts(ms).find((p) => p.type === 'hour');
  return part ? Number(part.value) % 24 : -1;
}
/** @param {FactsIn} facts @returns {(gameId: string) => GameFacts|undefined} */
function factsGetter(facts) {
  if (facts instanceof Map) return (id) => facts.get(id);
  if (facts && typeof facts === 'object') return (id) => (Object.prototype.hasOwnProperty.call(facts, id) ? /** @type {any} */ (facts)[id] : undefined);
  return () => undefined;
}
const isOk = (/** @type {any} */ f) => !!f && f.ok === true && f.min && f.gained && Array.isArray(f.kos);
const isNone = (/** @type {any} */ f) => !!f && f.ok === false && f.reason === 'none';

// ---------------------------------------------------------------------------
// Fakten je Spiel (Replay)

/**
 * Fakten aus den Ereignissen eines beendeten Spiels (Entscheide 7–10): Lebensminimum, brutto dazugewonnenes
 * Leben, K.O. mit Zug und Zustand unmittelbar davor, Startwurf-Sieger. Nie ein Wurf nach außen.
 * @param {{ players: { memberId: string, seat: number }[], startingLife?: number|null, events: { seq: any, type: string, source?: string|null, target?: string|null, amount?: number|null, payload?: any }[] }} input
 * @returns {GameFacts}
 */
export function gameFacts({ players, startingLife, events }) {
  const v = FACTS_VERSION;
  try {
    const evs = (events || []).filter((e) => e && Number.isInteger(e.seq)).slice().sort((a, b) => a.seq - b.seq);
    if (!evs.length) return { v, ok: false, reason: 'none' };
    // Rückgängig = Menge payload.seq aller undo über die ganze Liste (wie engine.js derive)
    const undone = new Set();
    for (const e of evs) if (e.type === 'undo' && e.payload?.seq != null) undone.add(e.payload.seq);
    const live = evs.filter((e) => e.type !== 'undo' && !undone.has(e.seq));
    const life0 = isNum(startingLife) ? /** @type {number} */ (startingLife) : 40;
    const roster = (players || []).map((p) => ({ id: p.memberId, seat: p.seat }));
    const seats = roster.map((p) => p.seat).filter(isNum);
    let s = createGame({ players: roster, startingLife: life0, firstSeat: seats.length ? Math.min(...seats) : 0, startedAt: 0 });
    /** @type {Record<string, number>} */ const min = {};
    /** @type {Record<string, number>} */ const gained = {};
    for (const p of roster) { min[p.id] = life0; gained[p.id] = 0; }
    /** @type {KoFact[]} */ const kos = [];
    let turns = 0;
    /** @type {any} */ let start = null;
    for (const e of live) {
      if (e.type === 'eliminate') {
        const t = s.players.find((/** @type {any} */ p) => p.id === e.target);
        if (!t) throw new Error('unbekanntes Ziel');
        const src = e.source ?? null;
        kos.push({
          target: t.id, source: src, turn: turns,
          cmd21: src != null && ((t.cmd[src] || 0) >= CMD_LETHAL || (t.cmd[`${src}#2`] || 0) >= CMD_LETHAL),
          poison10: src != null && t.poison >= POISON_LETHAL,
        });
      }
      if (e.type === 'roll' && e.payload?.kind === 'start' && (!start || e.seq < start.seq)) start = e;
      s = apply(s, { ...e, payload: e.payload || {} });
      for (const p of s.players) if (p.life < min[p.id]) min[p.id] = p.life;
      if ((e.type === 'life' || e.type === 'lifelink') && isNum(e.amount) && /** @type {number} */ (e.amount) > 0 && e.target != null) {
        gained[e.target] = (gained[e.target] || 0) + /** @type {number} */ (e.amount);
      }
      if (e.type === 'turn_end') turns++;
    }
    const seat = start?.payload?.winner_seat;
    const winner = start ? roster.find((p) => p.seat === seat) : null;
    return { v, ok: true, min, gained, kos, startWinner: winner ? winner.id : null };
  } catch {
    return { v, ok: false, reason: 'error' };
  }
}

// ---------------------------------------------------------------------------
// Zeitleiste

/** @typedef {Award & { complete: boolean, ord: number[] }} TimelineAward */

/**
 * Ein chronologischer Durchlauf über alle beendeten Partien (Entscheid 20).
 * @param {GroupData} data @param {FactsIn} facts @param {{ now: any }} opts
 */
function timeline(data, facts, { now }) {
  const t = nowMs(now);
  const getF = factsGetter(facts);
  const games = (data?.games || []).filter((g) => g && g.status === 'finished').slice().sort(chrono);
  const pos = new Map(games.map((g, i) => [g.id, i]));
  /** @type {Map<string, PlayerRow[]>} */
  const rowsOf = new Map();
  for (const r of data?.players || []) {
    if (!r || !pos.has(r.gameId)) continue;
    const list = rowsOf.get(r.gameId) || [];
    list.push(r);
    rowsOf.set(r.gameId, list);
  }
  const members = data?.members || [];
  // Entscheid 11: Ranglistenerste ohne „entfernt“ — ein spätes Entfernen schreibt nichts um
  const unremoved = members.map((m) => ({ ...m, removed: false }));
  const ratings = data?.ratings || []; const deckSalt = data?.deckSalt || [];
  // Abende: letzte Partie und Zeitpunkt des letzten Starts je Abend
  /** @type {Map<string, GameRow[]>} */
  const evening = new Map();
  for (const g of games) if (g.sessionId) { const l = evening.get(g.sessionId) || []; l.push(g); evening.set(g.sessionId, l); }

  /** @type {Map<string, { games: number, wins: number, cur: number, streak: number, decks: Set<string>, evenings: number, luck: number, complete: boolean, once: Set<string>, tier: Map<string, number> }>} */
  const st = new Map();
  const S = (/** @type {string} */ m) => {
    let x = st.get(m);
    if (!x) { x = { games: 0, wins: 0, cur: 0, streak: 0, decks: new Set(), evenings: 0, luck: 0, complete: true, once: new Set(), tier: new Map() }; st.set(m, x); }
    return x;
  };
  /** @type {TimelineAward[]} */
  const awards = [];
  /** @type {GameRow[]} */ const prefGames = [];
  /** @type {PlayerRow[]} */ const prefPlayers = [];

  for (const g of games) {
    const gi = /** @type {number} */ (pos.get(g.id));
    const rows = rowsOf.get(g.id) || [];
    const part = rows.filter((r) => isNum(r.place));
    const f = getF(g.id);
    const ok = isOk(f);
    const pref = { groupId: data?.groupId, games: prefGames, players: prefPlayers, members, decks: [], sessions: [], ratings: [], deckSalt: [], potg: [], turns: [] };
    /** @type {Set<string>|null} */ let first = null;
    const firsts = () => {
      if (!first) first = new Set(prefGames.length ? playerTable({ ...pref, members: unremoved }).filter((r) => r.rank === 1).map((r) => r.memberId) : []);
      return first;
    };
    /** @type {any[]|null} */ let salt = null;
    const saltRows = () => {
      if (!salt) {
        salt = deckSaltTable({
          ...pref, games: [g], players: rows, decks: data?.decks || [],
          ratings: ratings.filter((r) => r.gameId === g.id), deckSalt: deckSalt.filter((r) => r.gameId === g.id),
        }, { min: 1 });
      }
      return salt;
    };
    const endH = g.endedAt ? berlinHour(ts(g.endedAt)) : -1;
    const night = !!g.endedAt && ts(g.endedAt) > 0 && endH >= NIGHT[0] && endH < NIGHT[1];
    const life0 = isNum(g.startingLife) ? g.startingLife : 40;
    const untouched = Math.ceil(UNTOUCHED_SHARE * life0);
    const sess = g.sessionId ? evening.get(g.sessionId) : null;
    const eveningEnds = !!sess && sess.length >= 2 && sess[sess.length - 1].id === g.id
      && t - ts(g.startedAt) >= EVENING_CLOSED_MS;

    for (const r of part) {
      const m = r.memberId;
      const x = S(m);
      const place = /** @type {number} */ (r.place);
      const ord = [gi, place, r.seat ?? 0];
      if (f === undefined) x.complete = false;
      const give = (/** @type {string} */ id, /** @type {1|2|3|null} */ tier = null) =>
        awards.push({ memberId: m, badgeId: id, tier, gameId: g.id, complete: x.complete, ord });
      const once = (/** @type {string} */ id) => { if (!x.once.has(id)) { x.once.add(id); give(id); } };
      const tierUp = (/** @type {string} */ id, /** @type {number} */ value) => {
        const tiers = /** @type {number[]} */ (BY_ID.get(id)?.tiers);
        let n = x.tier.get(id) || 0;
        while (n < tiers.length && value >= tiers[n]) { n++; give(id, /** @type {1|2|3} */ (n)); }
        x.tier.set(id, n);
      };
      const win = place === 1;
      // Zählwerte (wie memberProfile: Partien chronologisch, Serie = längste Folge von Siegen)
      x.games++;
      if (win) { x.wins++; x.cur++; } else x.cur = 0;
      if (x.cur > x.streak) x.streak = x.cur;
      if (r.deckId != null) x.decks.add(r.deckId);

      once('erste-runde');
      if (win) once('erster-sieg');
      const victims = rows.filter((y) => y.eliminatedBy === m && y.memberId !== m);
      if (victims.length) once('erstes-blut');
      if (win && r.finalLife === 1) once('messers-schneide');
      if (win && isNum(g.round) && g.round >= 1 && g.round <= BLITZ_ROUND) once('blitzsieg');
      if (victims.length && !x.once.has('koenigsmoerder') && victims.some((y) => firsts().has(y.memberId))) once('koenigsmoerder');
      if (victims.length && !x.once.has('rache') && prefGames.length) {
        const nem = memberProfile(pref, m).nemesis;
        if (nem && victims.some((y) => y.memberId === nem.memberId)) once('rache');
      }
      if (win && r.deckId != null && !x.once.has('salzbergwerk')) {
        const tops = saltRows();
        const top = tops.filter((s) => s.rank === 1);
        if (tops.length >= 2 && top.length === 1 && top[0].deckId === r.deckId) once('salzbergwerk');
      }
      if (night) once('nachteule');
      // Replay-Abzeichen (nur mit Fakten)
      if (ok) {
        const ff = /** @type {Extract<GameFacts, { ok: true }>} */ (f);
        const lo = ff.min[m];
        if (win && isNum(lo) && lo < COMEBACK_BELOW) once('comeback');
        if (win && isNum(lo) && lo >= untouched) once('unberuehrbar');
        const mine = ff.kos.filter((k) => k.source === m);
        if (mine.some((k) => k.cmd21)) once('commander-henker');
        if (mine.some((k) => k.poison10)) once('giftmischer');
        /** @type {Map<number, number>} */ const perTurn = new Map();
        for (const k of mine) perTurn.set(k.turn, (perTurn.get(k.turn) || 0) + 1);
        if ([...perTurn.values()].some((n) => n >= 2)) once('doppelschlag');
        if ((ff.gained[m] || 0) >= WELLSPRING) once('lebensquell');
      }
      // Glückspilz (Entscheid 16): unbekannt/Fehler ⇒ 0; ohne Startwurf ⇒ überspringen
      if (ok) {
        const w = /** @type {any} */ (f).startWinner;
        if (w != null) x.luck = w === m ? x.luck + 1 : 0;
      } else if (!isNone(f)) x.luck = 0;
      if (x.luck >= LUCK_RUN) once('gluckspilz');

      tierUp('stammgast', x.games);
      tierUp('siegertyp', x.wins);
      tierUp('serie', x.streak);
      tierUp('deckbauer', x.decks.size);
      // Abendkönig (Entscheid 13): in der letzten Partie eines abgeschlossenen Abends mit ≥ 2 Partien, alle gewonnen
      if (eveningEnds && win && /** @type {GameRow[]} */ (sess).every((sg) => (rowsOf.get(sg.id) || []).some((y) => y.memberId === m && y.place === 1))) {
        x.evenings++;
      }
      tierUp('abendkoenig', x.evenings);
    }
    prefGames.push(g);
    for (const r of rows) prefPlayers.push(r);
  }
  /** @type {Record<string, Progress>} */
  const progress = {};
  for (const [m, x] of st) progress[m] = { games: x.games, wins: x.wins, streak: x.streak, decks: x.decks.size, evenings: x.evenings };
  return { awards, progress, games, pos };
}

/** Anzeige-Reihenfolge: Partie chronologisch, Platz aufsteigend (ohne Platz zuletzt, dann Sitz), Katalog, Stufe. */
const display = (/** @type {TimelineAward} */ a, /** @type {TimelineAward} */ b) =>
  a.ord[0] - b.ord[0] || a.ord[1] - b.ord[1] || a.ord[2] - b.ord[2]
  || /** @type {number} */ (CATALOG.get(a.badgeId)) - /** @type {number} */ (CATALOG.get(b.badgeId)) || (a.tier || 0) - (b.tier || 0);
/** Entscheid 22: Replay-Abzeichen nur, wenn alle Partien des Mitglieds bis hierher Fakten haben. */
const shown = (/** @type {TimelineAward} */ a) => a.complete || !BY_ID.get(a.badgeId)?.replay;

/**
 * Zeitleiste aller Abzeichen (chronologisch) + Zählwerte je Mitglied.
 * @param {GroupData} data @param {FactsIn} facts @param {{ now: any }} opts
 * @returns {{ awards: Award[], progress: Record<string, Progress> }}
 */
export function badgeAwards(data, facts, { now }) {
  const { awards, progress } = timeline(data, facts, { now });
  return { awards: awards.map(({ memberId, badgeId, tier, gameId }) => ({ memberId, badgeId, tier, gameId })), progress };
}

/**
 * Zustand aller 21 Abzeichen eines Mitglieds (Katalog-Reihenfolge). Unbekanntes Mitglied ⇒ alles offen.
 * @param {GroupData} data @param {FactsIn} facts @param {string} memberId @param {{ now: any }} opts
 * @returns {BadgeState[]}
 */
export function memberBadges(data, facts, memberId, { now }) {
  const { awards, progress, games } = timeline(data, facts, { now });
  const startOf = new Map(games.map((g) => [g.id, g.startedAt]));
  const mine = awards.filter((a) => a.memberId === memberId);
  const prog = progress[memberId] || { games: 0, wins: 0, streak: 0, decks: 0, evenings: 0 };
  return BADGES.map((b) => {
    const own = mine.filter((a) => a.badgeId === b.id);
    const earned = own.length > 0;
    const firstGame = earned ? own[0].gameId : null;
    if (b.tiers) {
      const tierGames = b.tiers.map((_, i) => own.find((a) => a.tier === i + 1)?.gameId ?? null);
      const tier = /** @type {0|1|2|3} */ (tierGames.filter(Boolean).length);
      return {
        id: b.id, earned, tier, gameId: firstGame, at: firstGame ? startOf.get(firstGame) ?? null : null, tierGames,
        value: prog[/** @type {keyof Progress} */ (b.unit)], next: tier < b.tiers.length ? b.tiers[tier] : null, hidden: false,
      };
    }
    return {
      id: b.id, earned, tier: 0, gameId: firstGame, at: firstGame ? startOf.get(firstGame) ?? null : null, tierGames: [],
      value: null, next: null, hidden: b.secret && !earned,
    };
  });
}

/**
 * „Neues Abzeichen!“ (Entscheid 21): verdient genau in dieser Partie; Replay-Abzeichen nur bei vollständigen Fakten.
 * @param {GroupData} data @param {FactsIn} facts @param {string} gameId @param {{ now: any }} opts
 * @returns {{ memberId: string, badgeId: string, tier: 1|2|3|null }[]}
 */
export function gameBadges(data, facts, gameId, { now }) {
  const { awards } = timeline(data, facts, { now });
  return awards.filter((a) => a.gameId === gameId && shown(a)).sort(display)
    .map(({ memberId, badgeId, tier }) => ({ memberId, badgeId, tier }));
}

/**
 * „Abzeichen des Abends“: verdient in einer Partie dieses Abends (Regel wie gameBadges).
 * @param {GroupData} data @param {FactsIn} facts @param {string} sessionId @param {{ now: any }} opts
 * @returns {{ memberId: string, badgeId: string, tier: 1|2|3|null, gameId: string }[]}
 */
export function sessionBadges(data, facts, sessionId, { now }) {
  const { awards, games } = timeline(data, facts, { now });
  const ids = new Set(games.filter((g) => g.sessionId === sessionId).map((g) => g.id));
  return awards.filter((a) => ids.has(a.gameId) && shown(a)).sort(display)
    .map(({ memberId, badgeId, tier, gameId }) => ({ memberId, badgeId, tier, gameId }));
}
