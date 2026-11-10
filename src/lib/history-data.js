// Daten-Schnittstelle Historie/Statistik (Etappe 4/5). Naht P13 (Vertrag) · Implementierung P15.
// Keine Importe: der Supabase-Client wird übergeben (Node-testbar wie src/lib/game-store.js).
// Die eine geteilte Instanz für alle Views steht in src/lib/data.js (`groupData`).
// Vertrag (bindend für P15–P20): WELLE ttg-ende-statistik, spec-p13-naehte.md Anhang A.
// Laden: jede Abfrage seitenweise (range à 1000, feste Sortierung über den Primärschlüssel, bis eine
// Seite < 1000 liefert), ID-Listen in Stücken ≤ 200 (URL-Länge), jedes Stück wieder seitenweise.

/** @typedef {{ id: string, name: string, profileId: string|null, avatarPath: string|null, isPlaceholder: boolean, removed: boolean, formerProfileId: string|null }} MemberRow */
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

const PAGE = 1000;
const CHUNK = 200;

// Spalten (explizit: games.live_state ist ein großes jsonb und wird hier nicht gebraucht)
const MEMBER_SELECT = '*, profiles!members_profile_id_fkey(display_name, avatar_path)'; // Muster src/views/groups.js:12
const GAME_COLS = 'id, playgroup_id, session_id, status, started_at, ended_at, round, wincon, note, photo_path, starting_life';
const PLAYER_COLS = 'game_id, member_id, deck_id, seat, place, eliminated_round, eliminated_by, final_life';
const RATING_COLS = 'game_id, member_id, salt, fun, deck_rating';
const DECK_SALT_COLS = 'game_id, rater_id, deck_id, salt';
const POTG_COLS = 'game_id, voter_id, voted_for, text';
const TURN_COLS = 'game_id, member_id, turns, total_sec, longest_sec';
const DAMAGE_COLS = 'source, target, damage, commander_damage, poison';
const DECK_COLS = 'id, short_name, commander_name, partner_name, image_url, color_identity, bracket, owner_profile_id, owner_member_id, archived';
const SESSION_COLS = 'id, played_on, location';
// Feste Sortierung je Abfrage (sonst kann range Zeilen auslassen oder doppelt liefern)
const ORDER = {
  members: ['created_at', 'id'],
  games: ['started_at', 'id'],
  game_players: ['game_id', 'member_id'],
  player_ratings: ['game_id', 'member_id'],
  deck_salt_ratings: ['game_id', 'rater_id', 'deck_id'],
  potg_votes: ['game_id', 'voter_id'],
  v_game_turn_times: ['game_id', 'member_id'],
  v_damage_matrix: ['source', 'target'],
  decks: ['id'],
  sessions: ['id'],
};
/** Fehlt die View v_game_turn_times (P14 noch nicht gepusht): Postgres 42P01 bzw. PostgREST PGRST205. */
const MISSING = new Set(['42P01', 'PGRST205']);

/**
 * Leere Gruppe (frisches Objekt je Aufruf).
 * @param {string} groupId
 * @returns {GroupData}
 */
export function emptyGroupData(groupId) {
  return { groupId, members: [], decks: [], sessions: [], games: [], players: [], ratings: [], deckSalt: [], potg: [], turns: [] };
}

// ---------------------------------------------------------------------------
// Abbildung snake_case ⇒ camelCase (Anhang A)

const one = (x) => (Array.isArray(x) ? x[0] : x) || null;

/** @returns {MemberRow} Name/Avatar wie src/lib/parts.js memberName/memberAvatarPath */
function toMember(r) {
  const pr = one(r.profiles);
  return {
    id: r.id,
    name: pr?.display_name || r.display_name || '',
    profileId: r.profile_id ?? null,
    avatarPath: (r.profile_id ? pr?.avatar_path : r.avatar_path) || null,
    isPlaceholder: r.profile_id == null,
    // P10: kommen über '*' (MEMBER_SELECT); vor dem db push fehlen die Spalten ⇒ false/null
    removed: r.removed_at != null,
    formerProfileId: r.former_profile_id ?? null,
  };
}
/** @returns {DeckRow} */
const toDeck = (r) => ({
  id: r.id, shortName: r.short_name, commanderName: r.commander_name, partnerName: r.partner_name ?? null,
  imageUrl: r.image_url ?? null, colors: r.color_identity || [], bracket: r.bracket ?? null,
  ownerProfileId: r.owner_profile_id ?? null, ownerMemberId: r.owner_member_id ?? null, archived: !!r.archived,
});
/** @returns {SessionRow} */
const toSession = (r) => ({ id: r.id, playedOn: r.played_on, location: r.location ?? null });
/** @returns {GameRow} */
const toGame = (r) => ({
  id: r.id, sessionId: r.session_id ?? null, status: r.status, startedAt: r.started_at, endedAt: r.ended_at ?? null,
  round: r.round, wincon: r.wincon ?? null, note: r.note ?? null, photoPath: r.photo_path ?? null, startingLife: r.starting_life,
});
/** @returns {PlayerRow} */
const toPlayer = (r) => ({
  gameId: r.game_id, memberId: r.member_id, deckId: r.deck_id ?? null, seat: r.seat, place: r.place ?? null,
  eliminatedRound: r.eliminated_round ?? null, eliminatedBy: r.eliminated_by ?? null, finalLife: r.final_life ?? null,
});
/** @returns {RatingRow} */
const toRating = (r) => ({ gameId: r.game_id, memberId: r.member_id, salt: r.salt ?? null, fun: r.fun ?? null, deckRating: r.deck_rating ?? null });
/** @returns {DeckSaltRow} */
const toDeckSalt = (r) => ({ gameId: r.game_id, raterId: r.rater_id, deckId: r.deck_id, salt: r.salt });
/** @returns {PotgRow} */
const toPotg = (r) => ({ gameId: r.game_id, voterId: r.voter_id, votedFor: r.voted_for, text: r.text ?? null });
/** @returns {TurnRow} */
const toTurn = (r) => ({ gameId: r.game_id, memberId: r.member_id, turns: r.turns, totalSec: r.total_sec, longestSec: r.longest_sec });
/** @returns {DamageRow} */
const toDamage = (r) => ({ source: r.source, target: r.target, damage: r.damage ?? 0, commanderDamage: r.commander_damage ?? 0, poison: r.poison ?? 0 });

// ---------------------------------------------------------------------------
// Laden

function fail(res, what) {
  const e = /** @type {Error & { code?: string, status?: number }} */ (new Error(res.error?.message || `${what} fehlgeschlagen`));
  e.code = res.error?.code;
  e.status = res.status;
  throw e;
}

const chunks = (ids) => {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
};
const uniq = (xs) => [...new Set(xs.filter((x) => x != null))];

/**
 * @param {any} sb Supabase-Client (oder Attrappe)
 * @param {{ cache?: { load: (key: string|null, loader: () => Promise<any>, opts?: { force?: boolean }) => Promise<any>, drop: (key: string) => number }, key?: (groupId: string) => string|null }} [store]
 *   P12: übergebener Speicher (src/lib/cache.js) + Schlüssel je Gruppe (Konto|Gruppe|group). Ohne ⇒ eigener Speicher wie bisher.
 * @returns {{ loadGroup: (groupId: string, opts?: { force?: boolean }) => Promise<GroupData>, loadGame: (gameId: string) => Promise<GameData|null>, invalidate: (groupId: string) => void }}
 */
export function createHistoryData(sb, { cache: shared, key } = {}) {
  /** @type {Map<string, Promise<GroupData>>} */
  const cache = new Map();

  /** Eine Abfrage seitenweise bis zur letzten Seite. `where(q)` setzt die Filter. */
  async function paged(table, cols, where) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      let q = where(sb.from(table).select(cols));
      for (const col of ORDER[table] || []) q = q.order(col, { ascending: true });
      const res = await q.range(from, from + PAGE - 1);
      if (res.error) fail(res, `${table} laden`);
      const rows = res.data || [];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  /** `in(col, …)` in Stücken ≤ 200, jedes Stück seitenweise; Ergebnis in Stück-Reihenfolge. */
  async function byIds(table, cols, col, ids) {
    const parts = await Promise.all(chunks(ids).map((part) => paged(table, cols, (q) => q.in(col, part))));
    return parts.flat();
  }

  /** v_game_turn_times; fehlt die View (P14 nicht gepusht) ⇒ [] + Warnung statt Wurf. */
  async function turnTimes(where) {
    try {
      return await paged('v_game_turn_times', TURN_COLS, where);
    } catch (e) {
      if (MISSING.has(/** @type {any} */ (e).code)) {
        console.warn('v_game_turn_times fehlt — Zugzeiten leer', /** @type {any} */ (e).message);
        return [];
      }
      throw e;
    }
  }

  const members = (groupId) => paged('members', MEMBER_SELECT, (q) => q.eq('playgroup_id', groupId));

  /** @param {string} groupId @returns {Promise<GroupData>} */
  async function fetchGroup(groupId) {
    const [memberRows, gameRows] = await Promise.all([
      members(groupId),
      paged('games', GAME_COLS, (q) => q.eq('playgroup_id', groupId).eq('status', 'finished')),
    ]);
    const games = gameRows.map(toGame);
    const ids = games.map((g) => g.id);
    const known = new Set(ids);
    const [players, ratings, deckSalt, potg, turns, sessions] = await Promise.all([
      byIds('game_players', PLAYER_COLS, 'game_id', ids),
      byIds('player_ratings', RATING_COLS, 'game_id', ids),
      byIds('deck_salt_ratings', DECK_SALT_COLS, 'game_id', ids),
      byIds('potg_votes', POTG_COLS, 'game_id', ids),
      ids.length ? turnTimes((q) => q.eq('playgroup_id', groupId)) : [],
      byIds('sessions', SESSION_COLS, 'id', uniq(games.map((g) => g.sessionId))),
    ]);
    const playerRows = players.map(toPlayer);
    const decks = await byIds('decks', DECK_COLS, 'id', uniq(playerRows.map((p) => p.deckId)));
    return {
      groupId,
      members: memberRows.map(toMember),
      decks: decks.map(toDeck),
      sessions: sessions.map(toSession),
      games,
      players: playerRows,
      ratings: ratings.map(toRating),
      deckSalt: deckSalt.map(toDeckSalt),
      potg: potg.map(toPotg),
      turns: turns.map(toTurn).filter((t) => known.has(t.gameId)),
    };
  }

  /** @param {string} gameId @returns {Promise<GameData|null>} */
  async function loadGame(gameId) {
    const res = await sb.from('games').select(GAME_COLS).eq('id', gameId).maybeSingle();
    if (res.error) fail(res, 'Spiel laden');
    if (!res.data) return null;
    const groupId = res.data.playgroup_id;
    const game = toGame(res.data);
    const byGame = (q) => q.eq('game_id', gameId);
    const [memberRows, players, ratings, deckSalt, potg, turns, damage, sessions] = await Promise.all([
      members(groupId),
      paged('game_players', PLAYER_COLS, byGame),
      paged('player_ratings', RATING_COLS, byGame),
      paged('deck_salt_ratings', DECK_SALT_COLS, byGame),
      paged('potg_votes', POTG_COLS, byGame),
      turnTimes(byGame),
      paged('v_damage_matrix', DAMAGE_COLS, byGame),
      byIds('sessions', SESSION_COLS, 'id', uniq([game.sessionId])),
    ]);
    const playerRows = players.map(toPlayer);
    const decks = await byIds('decks', DECK_COLS, 'id', uniq(playerRows.map((p) => p.deckId)));
    return {
      groupId,
      members: memberRows.map(toMember),
      decks: decks.map(toDeck),
      sessions: sessions.map(toSession),
      games: [game],
      players: playerRows,
      ratings: ratings.map(toRating),
      deckSalt: deckSalt.map(toDeckSalt),
      potg: potg.map(toPotg),
      turns: turns.map(toTurn),
      game,
      damage: damage.map(toDamage),
    };
  }

  if (shared && key) {
    return {
      /** P12: im geteilten Speicher je Konto + Gruppe; ohne Schlüssel (kein Konto/keine Gruppe) wird geladen, nichts gemerkt. */
      loadGroup(groupId, { force = false } = {}) {
        return shared.load(key(groupId), () => fetchGroup(groupId), { force });
      },
      loadGame,
      invalidate(groupId) {
        const k = key(groupId);
        if (k) shared.drop(k);
      },
    };
  }

  return {
    /** Zwischengespeichert je Gruppe (Promise ⇒ parallele Aufrufe teilen eine Ladung); Fehlschlag wird nicht gespeichert. */
    loadGroup(groupId, { force = false } = {}) {
      const hit = cache.get(groupId);
      if (hit && !force) return hit;
      const p = fetchGroup(groupId);
      cache.set(groupId, p);
      p.catch(() => { if (cache.get(groupId) === p) cache.delete(groupId); });
      return p;
    },
    loadGame,
    invalidate(groupId) {
      cache.delete(groupId);
    },
  };
}
