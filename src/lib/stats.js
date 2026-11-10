// Kennzahlen Etappe 4/5 — die eine Rechenquelle (WELLE ttg-ende-statistik D3). Reine Logik, keine Importe.
// Naht P13: Namen, Typen und leere Formen (Vertrag spec-p13-naehte.md Anhang A) · Implementierung: P15
// (Semantik verbindlich in spec-p15-stats.md). Alle Ausgaben ungerundet; Durchschnitt über null Werte ⇒ null.

/** @typedef {import('./history-data.js').GroupData} GroupData */
/** @typedef {'all'|'30d'|'year'} Range */
/** @typedef {{ memberId: string, games: number, wins: number, points: number, winRate: number|null, avgPlace: number|null, rank: number }} PlayerTableRow */
/** @typedef {{ deckId: string, games: number, wins: number, points: number, winRate: number|null, avgPlace: number|null, rank: number }} DeckTableRow */
/** @typedef {{ deckId: string, avgSalt: number|null, ratings: number, mostSaltedMemberId: string|null, rank: number }} DeckSaltTableRow */
/** @typedef {{ memberId: string, deckId: string|null, place: number|null, eliminatedRound: number|null, eliminatedBy: string|null, finalLife: number|null, avgTurnSec: number|null, points: number }} Placement */
/** @typedef {{ winners: string[], votes: Record<string, number>, texts: any[] }} PotgResult */
/** @typedef {{ gameId: string, sessionId: string|null, startedAt: string, minutes: number|null, rounds: number, wincon: string|null, note: string|null, photoPath: string|null, avgSalt: number|null, avgFun: number|null, winnerId: string|null, placements: Placement[], potg: PotgResult }} GameSummary */
/** @typedef {{ sessionId: string, playedOn: string, location: string|null, gameIds: string[], dayWinnerId: string|null }} Evening */
/** @typedef {{ sessionId: string, playedOn: string, location: string|null, games: any, minutes: any, dayWinner: any, saltiest: any, longestTurn: any, potg: any }} Recap */
/** @typedef {{ avgTurnSec: number|null, rank: number|null, of: number, rows: any[] }} Tempo */
/** @typedef {{ games: number, wins: number, points: number, winRate: number|null, avgPlace: number|null, avgSalt: number|null, avgFun: number|null, avgDeckRating: number|null, saltTrend: any[], pointsSeries: any[], placeSeries: any[], tempo: Tempo, nemesis: any, favoriteDeck: any, bestDeck: any, longestStreak: number, fastestWin: any }} MemberProfile */
/** @typedef {{ games: number, wins: number, winRate: number|null, avgPlace: number|null, points: number, avgOwnRating: number|null, avgFun: number|null, salt: any, recentGameIds: string[] }} DeckProfile */

/**
 * Punkte für einen Platz (D2: Platz 1 = Spielerzahl, sonst max(0, n − Platz)).
 * @param {number} n Spielerzahl
 * @param {number|null} place
 * @returns {number}
 */
export function placePoints(n, place) {
  void n; void place;
  return 0; // Stub P13
}

/**
 * Daten auf einen Zeitraum beschränken.
 * @param {GroupData} data
 * @param {Range} range
 * @param {Date|number|string} now
 * @returns {GroupData}
 */
export function inRange(data, range, now) {
  void range; void now;
  return data; // Stub P13: Eingabe unverändert
}

/** @param {GroupData} data @returns {PlayerTableRow[]} */
export function playerTable(data) {
  void data;
  return [];
}

/** @param {GroupData} data @returns {DeckTableRow[]} */
export function deckTable(data) {
  void data;
  return [];
}

/**
 * @param {GroupData} data
 * @param {{ min?: number }} [opts]
 * @returns {DeckSaltTableRow[]}
 */
export function deckSaltTable(data, { min = 2 } = {}) {
  void data; void min;
  return [];
}

/**
 * @param {GroupData} data
 * @param {string} gameId
 * @returns {GameSummary|null} null für unbekanntes Spiel
 */
export function gameSummary(data, gameId) {
  void data; void gameId;
  return null;
}

/**
 * @param {GroupData} data
 * @param {{ filter?: string, meMemberId?: string|null }} [opts]
 * @returns {Evening[]}
 */
export function evenings(data, { filter = 'alle', meMemberId = null } = {}) {
  void data; void filter; void meMemberId;
  return [];
}

/**
 * @param {GroupData} data
 * @param {string} sessionId
 * @returns {Recap|null} null für unbekannten Abend
 */
export function recap(data, sessionId) {
  void data; void sessionId;
  return null;
}

/**
 * @param {GroupData} data
 * @param {string} memberId
 * @returns {MemberProfile}
 */
export function memberProfile(data, memberId) {
  void data; void memberId;
  return {
    games: 0, wins: 0, points: 0, winRate: null, avgPlace: null, avgSalt: null, avgFun: null, avgDeckRating: null,
    saltTrend: [], pointsSeries: [], placeSeries: [], tempo: { avgTurnSec: null, rank: null, of: 0, rows: [] },
    nemesis: null, favoriteDeck: null, bestDeck: null, longestStreak: 0, fastestWin: null,
  };
}

/**
 * @param {GroupData} data
 * @param {string} deckId
 * @returns {DeckProfile}
 */
export function deckProfile(data, deckId) {
  void data; void deckId;
  return { games: 0, wins: 0, winRate: null, avgPlace: null, points: 0, avgOwnRating: null, avgFun: null, salt: null, recentGameIds: [] };
}
