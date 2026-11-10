// Daten-Schnittstelle Historie/Statistik (Etappe 4/5). Naht P13: Vertrag + Stub · Implementierung: P15.
// Keine Importe: der Supabase-Client wird übergeben (Node-testbar wie src/lib/game-store.js).
// Die eine geteilte Instanz für alle Views steht in src/lib/data.js (`groupData`).
// Vertrag (bindend für P15–P20): WELLE ttg-ende-statistik, spec-p13-naehte.md Anhang A.

/** @typedef {{ id: string, name: string, profileId: string|null, avatarPath: string|null, isPlaceholder: boolean }} MemberRow */
/** @typedef {{ id: string, shortName: string, commanderName: string, partnerName: string|null, imageUrl: string|null, colors: string[], bracket: number|null, ownerProfileId: string|null, ownerMemberId: string|null, archived: boolean }} DeckRow */
/** @typedef {{ id: string, playedOn: string, location: string|null }} SessionRow */
/** @typedef {{ id: string, sessionId: string|null, status: 'finished'|'live'|'aborted', startedAt: string, endedAt: string|null, round: number, wincon: string|null, note: string|null, photoPath: string|null, startingLife: number }} GameRow */
/** @typedef {{ gameId: string, memberId: string, deckId: string|null, seat: number, place: number|null, eliminatedRound: number|null, eliminatedBy: string|null, finalLife: number|null }} PlayerRow */
/** @typedef {{ gameId: string, memberId: string, salt: number|null, fun: number|null, deckRating: number|null }} RatingRow */
/** @typedef {{ gameId: string, raterId: string, deckId: string, salt: number }} DeckSaltRow */
/** @typedef {{ gameId: string, voterId: string, votedFor: string, text: string|null }} PotgRow */
/** @typedef {{ gameId: string, memberId: string, turns: number, totalSec: number, longestSec: number }} TurnRow */
/** @typedef {{ source: string, target: string, damage: number, commanderDamage: number, poison: number }} DamageRow */
/** @typedef {{ groupId: string, members: MemberRow[], decks: DeckRow[], sessions: SessionRow[], games: GameRow[], players: PlayerRow[], ratings: RatingRow[], deckSalt: DeckSaltRow[], potg: PotgRow[], turns: TurnRow[] }} GroupData */
/** @typedef {GroupData & { game: GameRow, damage: DamageRow[] }} GameData */ // loadGame: genau ein Spiel (jeder Status), Listen nur dieses Spiels

/**
 * Leere Gruppe (frisches Objekt je Aufruf).
 * @param {string} groupId
 * @returns {GroupData}
 */
export function emptyGroupData(groupId) {
  return { groupId, members: [], decks: [], sessions: [], games: [], players: [], ratings: [], deckSalt: [], potg: [], turns: [] };
}

/**
 * loadGroup: nur Spiele mit status = 'finished' (und nur deren players/ratings/deckSalt/potg/turns);
 * members = alle Mitglieder der Gruppe; decks = alle in players vorkommenden Decks (auch archivierte);
 * sessions = die der geladenen Spiele. loadGame: ein Spiel jeden Status samt Schaden, unbekannt ⇒ null.
 * @param {any} sb Supabase-Client (oder Attrappe)
 * @returns {{ loadGroup: (groupId: string, opts?: { force?: boolean }) => Promise<GroupData>, loadGame: (gameId: string) => Promise<GameData|null>, invalidate: (groupId: string) => void }}
 */
export function createHistoryData(sb) {
  void sb; // Stub (P13) — P15 liest hierüber
  return {
    async loadGroup(groupId, { force = false } = {}) {
      void force;
      return emptyGroupData(groupId);
    },
    async loadGame(gameId) {
      void gameId;
      return null;
    },
    invalidate(groupId) {
      void groupId;
    },
  };
}
