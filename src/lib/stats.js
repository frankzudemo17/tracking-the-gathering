// Kennzahlen Etappe 4/5: die eine Rechenquelle (WELLE ttg-ende-statistik D3). Reine Logik, keine Importe.
// Vertrag: spec-p13-naehte.md Anhang A (Namen, Typen, leere Formen) · Semantik: spec-p15-stats.md.
// Alle Ausgaben ungerundet; Durchschnitt über null Werte ⇒ null. Gerundet wird nur in src/lib/format.js.
// Eingaben werden nie verändert (Listen vor dem Sortieren kopiert). Fehlende Mitglieder/Decks/Abende werfen nicht.

/** @typedef {import('./history-data.js').GroupData} GroupData */
/** @typedef {import('./history-data.js').GameRow} GameRow */
/** @typedef {import('./history-data.js').PlayerRow} PlayerRow */
/** @typedef {'all'|'30d'|'year'} Range */
/** @typedef {{ memberId: string, games: number, wins: number, points: number, winRate: number|null, avgPlace: number|null, rank: number }} PlayerTableRow */
/** @typedef {{ deckId: string, games: number, wins: number, points: number, winRate: number|null, avgPlace: number|null, rank: number }} DeckTableRow */
/** @typedef {{ deckId: string, avgSalt: number|null, ratings: number, mostSaltedMemberId: string|null, rank: number }} DeckSaltTableRow */
/** @typedef {'win'|'out'|'conceded'|'alive'} Outcome */
/** @typedef {{ memberId: string, deckId: string|null, place: number|null, eliminatedRound: number|null, eliminatedBy: string|null, finalLife: number|null, avgTurnSec: number|null, points: number, outcome: Outcome }} Placement */
/** @typedef {{ voterId: string, votedFor: string, text: string }} PotgText */
/** @typedef {{ winners: string[], votes: Record<string, number>, texts: PotgText[] }} PotgResult */
/** @typedef {{ gameId: string, sessionId: string|null, startedAt: string, minutes: number|null, rounds: number, wincon: string|null, note: string|null, photoPath: string|null, avgSalt: number|null, avgFun: number|null, winnerId: string|null, placements: Placement[], potg: PotgResult }} GameSummary */
/** @typedef {{ sessionId: string, playedOn: string, location: string|null, gameIds: string[], dayWinnerId: string|null }} Evening */
/** @typedef {{ memberId: string, wins: number, points: number, deckId: string|null }} DayWinner */
/** @typedef {{ sessionId: string, playedOn: string, location: string|null, games: number, minutes: number, dayWinner: DayWinner|null, saltiest: { memberId: string, avgSalt: number, ratings: number }|null, longestTurn: { memberId: string, seconds: number, gameId: string }|null, potg: { memberId: string, votes: number, text: string|null }|null }} Recap */
/** @typedef {{ avgTurnSec: number|null, rank: number|null, of: number, rows: { memberId: string, avgTurnSec: number }[] }} Tempo */
/** @typedef {{ games: number, wins: number, points: number, winRate: number|null, avgPlace: number|null, avgSalt: number|null, avgFun: number|null, avgDeckRating: number|null, saltTrend: number[], pointsSeries: number[], placeSeries: number[], tempo: Tempo, nemesis: { memberId: string, count: number }|null, favoriteDeck: { deckId: string, games: number }|null, bestDeck: { deckId: string, winRate: number, games: number }|null, longestStreak: number, fastestWin: { gameId: string, rounds: number }|null }} MemberProfile */
/** @typedef {{ games: number, wins: number, winRate: number|null, avgPlace: number|null, points: number, avgOwnRating: number|null, avgFun: number|null, salt: { avgSalt: number, ratings: number }|null, recentGameIds: string[] }} DeckProfile */

const DAY_MS = 86_400_000;
const EPS = 1e-9;
const COLLATOR = new Intl.Collator('de');
const YEAR_FMT = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric' });

// ---------------------------------------------------------------------------
// Helfer

/** @param {unknown} iso @returns {number} Zeitpunkt in ms (ungültig ⇒ 0) */
const ts = (iso) => { const t = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : 0; };
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Chronologie: startedAt aufsteigend (als Zeitpunkt, nicht als Text), bei Gleichstand id. */
const chrono = (a, b) => ts(a.startedAt) - ts(b.startedAt) || cmpStr(a.id, b.id);
/** a < b mit Toleranz (Brüche wie 16/6) ⇒ −1/0/1 */
const cmpNum = (a, b) => (Math.abs(a - b) < EPS ? 0 : a < b ? -1 : 1);

/** @param {Array<number|null|undefined>} xs @returns {number|null} */
function mean(xs) {
  let s = 0; let n = 0;
  for (const x of xs) if (isNum(x)) { s += x; n++; }
  return n ? s / n : null;
}

function hasText(t) { return typeof t === 'string' && t.trim() !== ''; }

/** Gemeinsame Sicht auf die Daten (Maps, sortierte Spiele). Nichts davon verändert die Eingabe. */
function ctx(data) {
  const games = [...(data.games || [])].sort(chrono);
  const gameById = new Map(games.map((g) => [g.id, g]));
  const order = new Map(games.map((g, i) => [g.id, i]));
  const live = (r) => gameById.has(r.gameId);
  const players = (data.players || []).filter(live);
  const byGame = new Map();
  for (const p of players) {
    if (!byGame.has(p.gameId)) byGame.set(p.gameId, []);
    byGame.get(p.gameId).push(p);
  }
  const memberName = new Map((data.members || []).map((m) => [m.id, m.name || '']));
  const deckName = new Map((data.decks || []).map((d) => [d.id, d.shortName || '']));
  return {
    games, gameById, order, players, byGame,
    ratings: (data.ratings || []).filter(live),
    deckSalt: (data.deckSalt || []).filter(live),
    potg: (data.potg || []).filter(live),
    turns: (data.turns || []).filter(live),
    sessions: data.sessions || [],
    /** Spieleranzahl des Spiels */
    n: (gameId) => (byGame.get(gameId) || []).length,
    name: (id) => memberName.get(id) ?? String(id ?? ''),
    deck: (id) => deckName.get(id) ?? String(id ?? ''),
    /** Position in der Chronologie (unbekannt ⇒ −1) */
    pos: (gameId) => order.get(gameId) ?? -1,
  };
}

/** Wettkampf-Rang (1, 1, 3): gleicher Rang ⇔ `same(prev, cur)`. Schreibt `rank` in die (eigenen) Zeilen. */
function rankRows(rows, same) {
  rows.forEach((r, i) => { r.rank = i > 0 && same(rows[i - 1], r) ? rows[i - 1].rank : i + 1; });
  return rows;
}

/** Bei Gleichstand das zuletzt Gespielte: Map key → { count, last } ⇒ bester Schlüssel oder null. */
function mostFrequent(map) {
  let best = null;
  for (const [key, v] of map) {
    if (!best || v.count > best.v.count || (v.count === best.v.count && v.last > best.v.last)) best = { key, v };
  }
  return best;
}

function bump(map, key, last) {
  const v = map.get(key) || { count: 0, last: -1 };
  v.count++; v.last = Math.max(v.last, last);
  map.set(key, v);
}

// ---------------------------------------------------------------------------
// Punkte, Zeitraum

/**
 * Punkte für einen Platz (D2: Platz 1 = Spielerzahl, sonst max(0, n − Platz); ohne Platz 0).
 * @param {number} n Spielerzahl
 * @param {number|null} place
 * @returns {number}
 */
export function placePoints(n, place) {
  if (!isNum(place) || !isNum(n)) return 0;
  if (place === 1) return n;
  return Math.max(0, n - place);
}

/**
 * Daten auf einen Zeitraum beschränken. '30d' in UTC-Millisekunden, 'year' im Kalenderjahr Europe/Berlin.
 * Filtert games und alle spielbezogenen Listen; sessions nur mit verbleibenden Spielen; members/decks unverändert.
 * @param {GroupData} data
 * @param {Range} range
 * @param {Date|number|string} now
 * @returns {GroupData}
 */
export function inRange(data, range, now) {
  if (range !== '30d' && range !== 'year') return data;
  const t = new Date(now).getTime();
  if (!Number.isFinite(t)) return data;
  let keep;
  if (range === '30d') {
    const from = t - 30 * DAY_MS;
    keep = (g) => ts(g.startedAt) >= from;
  } else {
    const year = YEAR_FMT.format(t);
    keep = (g) => { const s = Date.parse(g.startedAt); return Number.isFinite(s) && YEAR_FMT.format(s) === year; };
  }
  const games = (data.games || []).filter(keep);
  const ids = new Set(games.map((g) => g.id));
  const sids = new Set(games.map((g) => g.sessionId).filter((x) => x != null));
  const live = (r) => ids.has(r.gameId);
  return {
    ...data,
    games,
    sessions: (data.sessions || []).filter((s) => sids.has(s.id)),
    players: (data.players || []).filter(live),
    ratings: (data.ratings || []).filter(live),
    deckSalt: (data.deckSalt || []).filter(live),
    potg: (data.potg || []).filter(live),
    turns: (data.turns || []).filter(live),
  };
}

// ---------------------------------------------------------------------------
// Ranglisten

/** Spiele/Siege/Punkte/Ø-Platz je Schlüssel (nur Spieler mit Platz). */
function tally(c, keyOf) {
  const acc = new Map();
  for (const p of c.players) {
    if (!isNum(p.place)) continue;
    const key = keyOf(p);
    if (key == null) continue;
    const a = acc.get(key) || { games: 0, wins: 0, points: 0, placeSum: 0 };
    a.games++;
    if (p.place === 1) a.wins++;
    a.points += placePoints(c.n(p.gameId), p.place);
    a.placeSum += p.place;
    acc.set(key, a);
  }
  return acc;
}

const standing = (a, b) => b.points - a.points || b.wins - a.wins || cmpNum(a.avgPlace, b.avgPlace);

function table(c, keyField, keyOf, nameOf) {
  const rows = [...tally(c, keyOf)].map(([key, a]) => ({
    [keyField]: key, games: a.games, wins: a.wins, points: a.points,
    winRate: a.wins / a.games, avgPlace: a.placeSum / a.games, rank: 0,
  }));
  rows.sort((a, b) => standing(a, b) || COLLATOR.compare(nameOf(a[keyField]), nameOf(b[keyField])) || cmpStr(a[keyField], b[keyField]));
  return rankRows(rows, (a, b) => standing(a, b) === 0);
}

/** @param {GroupData} data @returns {PlayerTableRow[]} */
export function playerTable(data) {
  const c = ctx(data);
  // P10: Zeilen entfernter Mitglieder entfallen; ihre Spiele zählen für die anderen weiter (Plätze neu, lückenlos)
  const gone = new Set((data.members || []).filter((m) => m.removed).map((m) => m.id));
  return /** @type {PlayerTableRow[]} */ (table(c, 'memberId', (p) => (gone.has(p.memberId) ? null : p.memberId), c.name));
}

/** @param {GroupData} data @returns {DeckTableRow[]} */
export function deckTable(data) {
  const c = ctx(data);
  return /** @type {DeckTableRow[]} */ (table(c, 'deckId', (p) => p.deckId, c.deck));
}

/**
 * Alle Salz-Stimmen: direkte deckSalt-Zeilen + Ersatz (v_deck_salt, init.sql): wer in einem Spiel keine
 * direkte Deck-Salz-Zeile abgab, eine salt-Bewertung hat und rausgenommen wurde, gibt seinen salt-Wert
 * dem Deck des Verursachers in diesem Spiel (nur wenn der ein Deck hatte).
 */
function saltVotes(c) {
  const votes = c.deckSalt.filter((r) => isNum(r.salt)).map((r) => ({ deckId: r.deckId, raterId: r.raterId, salt: r.salt, gameId: r.gameId }));
  const direct = new Set(c.deckSalt.map((r) => `${r.gameId}|${r.raterId}`));
  const rating = new Map(c.ratings.map((r) => [`${r.gameId}|${r.memberId}`, r]));
  for (const v of c.players) {
    if (v.eliminatedBy == null || direct.has(`${v.gameId}|${v.memberId}`)) continue;
    const r = rating.get(`${v.gameId}|${v.memberId}`);
    if (!r || !isNum(r.salt)) continue;
    const killer = (c.byGame.get(v.gameId) || []).find((k) => k.memberId === v.eliminatedBy);
    if (!killer || killer.deckId == null) continue;
    votes.push({ deckId: killer.deckId, raterId: v.memberId, salt: r.salt, gameId: v.gameId });
  }
  return votes;
}

function saltRows(c, min) {
  const acc = new Map();
  for (const v of saltVotes(c)) {
    const a = acc.get(v.deckId) || { sum: 0, n: 0, by: new Map() };
    a.sum += v.salt; a.n++;
    const b = a.by.get(v.raterId) || { sum: 0, n: 0 };
    b.sum += v.salt; b.n++;
    a.by.set(v.raterId, b);
    acc.set(v.deckId, a);
  }
  const rows = [];
  for (const [deckId, a] of acc) {
    if (a.n < min) continue;
    const most = [...a.by].sort(([ia, x], [ib, y]) => y.sum - x.sum || y.n - x.n || COLLATOR.compare(c.name(ia), c.name(ib)) || cmpStr(ia, ib))[0];
    rows.push({ deckId, avgSalt: a.sum / a.n, ratings: a.n, mostSaltedMemberId: most ? most[0] : null, rank: 0 });
  }
  const key = (a, b) => cmpNum(b.avgSalt, a.avgSalt) || b.ratings - a.ratings;
  rows.sort((a, b) => key(a, b) || COLLATOR.compare(c.deck(a.deckId), c.deck(b.deckId)) || cmpStr(a.deckId, b.deckId));
  return rankRows(rows, (a, b) => key(a, b) === 0);
}

/**
 * @param {GroupData} data
 * @param {{ min?: number }} [opts]
 * @returns {DeckSaltTableRow[]}
 */
export function deckSaltTable(data, { min = 2 } = {}) {
  return saltRows(ctx(data), min);
}

// ---------------------------------------------------------------------------
// Spiel

function gameMinutes(g) {
  if (!g || !g.startedAt || !g.endedAt) return null;
  const a = Date.parse(g.startedAt); const b = Date.parse(g.endedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 60_000);
}

/** @returns {Outcome} D3a: Aufgabe = ausgeschieden ohne Verursacher. */
function outcomeOf(p) {
  if (p.place === 1) return 'win';
  if (p.eliminatedRound != null) return p.eliminatedBy != null ? 'out' : 'conceded';
  return 'alive';
}

/**
 * @param {GroupData} data
 * @param {string} gameId
 * @returns {GameSummary|null} null für unbekanntes Spiel
 */
export function gameSummary(data, gameId) {
  const c = ctx(data);
  const g = c.gameById.get(gameId);
  if (!g) return null;
  const ps = [...(c.byGame.get(gameId) || [])].sort((a, b) =>
    (isNum(a.place) ? a.place : Infinity) - (isNum(b.place) ? b.place : Infinity) || (a.seat ?? 0) - (b.seat ?? 0));
  const n = ps.length;
  const turn = new Map(c.turns.filter((t) => t.gameId === gameId).map((t) => [t.memberId, t]));
  const ratings = c.ratings.filter((r) => r.gameId === gameId);
  const placements = ps.map((p) => {
    const t = turn.get(p.memberId);
    return {
      memberId: p.memberId, deckId: p.deckId ?? null, place: p.place ?? null,
      eliminatedRound: p.eliminatedRound ?? null, eliminatedBy: p.eliminatedBy ?? null, finalLife: p.finalLife ?? null,
      avgTurnSec: t && isNum(t.turns) && t.turns > 0 && isNum(t.totalSec) ? t.totalSec / t.turns : null,
      points: placePoints(n, p.place),
      outcome: outcomeOf(p),
    };
  });
  return {
    gameId: g.id, sessionId: g.sessionId ?? null, startedAt: g.startedAt, minutes: gameMinutes(g),
    rounds: g.round, wincon: g.wincon ?? null, note: g.note ?? null, photoPath: g.photoPath ?? null,
    avgSalt: mean(ratings.map((r) => r.salt)), avgFun: mean(ratings.map((r) => r.fun)),
    winnerId: ps.find((p) => p.place === 1)?.memberId ?? null,
    placements,
    potg: potgOf(c, gameId),
  };
}

function potgOf(c, gameId) {
  const rows = c.potg.filter((v) => v.gameId === gameId);
  /** @type {Record<string, number>} */
  const votes = {};
  for (const v of rows) votes[v.votedFor] = (votes[v.votedFor] || 0) + 1;
  const max = Math.max(0, ...Object.values(votes));
  const byName = (a, b) => COLLATOR.compare(c.name(a), c.name(b)) || cmpStr(a, b);
  const winners = max >= 1 ? Object.keys(votes).filter((id) => votes[id] === max).sort(byName) : [];
  const texts = rows.filter((v) => hasText(v.text))
    .sort((a, b) => byName(a.voterId, b.voterId))
    .map((v) => ({ voterId: v.voterId, votedFor: v.votedFor, text: /** @type {string} */ (v.text) }));
  return { winners, votes, texts };
}

// ---------------------------------------------------------------------------
// Abende

function sessionGames(c, sessionId) {
  return c.games.filter((g) => g.sessionId === sessionId); // bereits chronologisch
}

/** Tageskönig (Recap-Regel): meiste Siege ⇒ mehr Punkte ⇒ besserer Ø-Platz ⇒ Name. */
function dayWinnerOf(c, games) {
  const acc = new Map();
  for (const g of games) {
    const n = c.n(g.id);
    const at = c.pos(g.id);
    for (const p of c.byGame.get(g.id) || []) {
      if (!isNum(p.place)) continue;
      const a = acc.get(p.memberId) || { wins: 0, points: 0, placeSum: 0, games: 0, decks: new Map() };
      if (p.place === 1) a.wins++;
      a.points += placePoints(n, p.place);
      a.placeSum += p.place; a.games++;
      if (p.deckId != null) bump(a.decks, p.deckId, at);
      acc.set(p.memberId, a);
    }
  }
  const best = [...acc].sort(([ia, a], [ib, b]) =>
    b.wins - a.wins || b.points - a.points || cmpNum(a.placeSum / a.games, b.placeSum / b.games)
    || COLLATOR.compare(c.name(ia), c.name(ib)) || cmpStr(ia, ib))[0];
  if (!best) return null;
  const [memberId, a] = best;
  return { memberId, wins: a.wins, points: a.points, deckId: mostFrequent(a.decks)?.key ?? null };
}

function sessionInfo(c, sessionId, games) {
  const s = c.sessions.find((x) => x.id === sessionId);
  const first = games[0];
  return {
    playedOn: s?.playedOn ?? (typeof first?.startedAt === 'string' ? first.startedAt.slice(0, 10) : ''),
    location: s?.location ?? null,
  };
}

/**
 * @param {GroupData} data
 * @param {{ filter?: string, meMemberId?: string|null }} [opts]
 * @returns {Evening[]}
 */
export function evenings(data, { filter = 'alle', meMemberId = null } = {}) {
  const c = ctx(data);
  const avgSalt = (gid) => mean(c.ratings.filter((r) => r.gameId === gid).map((r) => r.salt));
  const winner = (gid) => (c.byGame.get(gid) || []).find((p) => p.place === 1)?.memberId ?? null;
  /** @type {(g: GameRow) => boolean} */
  const match = filter === 'siege' ? (g) => meMemberId != null && winner(g.id) === meMemberId
    : filter === 'salt' ? (g) => { const s = avgSalt(g.id); return s != null && s >= 3 - EPS; }
      : filter === 'foto' ? (g) => !!g.photoPath
        : () => true;
  const sids = [...new Set(c.games.map((g) => g.sessionId).filter((x) => x != null))];
  const out = [];
  for (const sid of sids) {
    const all = sessionGames(c, sid);
    const hit = all.filter(match);
    if (!hit.length) continue;
    const info = sessionInfo(c, sid, all);
    out.push({
      sessionId: sid, playedOn: info.playedOn, location: info.location,
      gameIds: hit.map((g) => g.id).reverse(),
      dayWinnerId: dayWinnerOf(c, all)?.memberId ?? null,
      _last: ts(all[all.length - 1].startedAt),
    });
  }
  out.sort((a, b) => cmpStr(b.playedOn, a.playedOn) || b._last - a._last || cmpStr(b.sessionId, a.sessionId));
  return out.map(({ _last, ...e }) => { void _last; return e; });
}

/**
 * Abend-Rückblick (Prototyp recapFor, Punkte nach placePoints).
 * @param {GroupData} data
 * @param {string} sessionId
 * @returns {Recap|null} null für unbekannten Abend
 */
export function recap(data, sessionId) {
  const c = ctx(data);
  const games = sessionGames(c, sessionId);
  if (!games.length && !c.sessions.some((s) => s.id === sessionId)) return null;
  const ids = new Set(games.map((g) => g.id));
  const byName = (a, b) => COLLATOR.compare(c.name(a), c.name(b)) || cmpStr(a, b);

  // Salzigster: höchster Ø eigener salt, Gleichstand ⇒ mehr Bewertungen ⇒ Name
  const sAcc = new Map();
  for (const r of c.ratings) {
    if (!ids.has(r.gameId) || !isNum(r.salt)) continue;
    const a = sAcc.get(r.memberId) || { sum: 0, n: 0 };
    a.sum += r.salt; a.n++;
    sAcc.set(r.memberId, a);
  }
  const salty = [...sAcc].sort(([ia, a], [ib, b]) => cmpNum(b.sum / b.n, a.sum / a.n) || b.n - a.n || byName(ia, ib))[0];

  // Längster Zug: größtes longestSec, Gleichstand ⇒ früheres Spiel (dann Name)
  const turn = c.turns.filter((t) => ids.has(t.gameId) && isNum(t.longestSec))
    .sort((a, b) => b.longestSec - a.longestSec || c.pos(a.gameId) - c.pos(b.gameId) || byName(a.memberId, b.memberId))[0];

  // POTG des Abends: meiste Stimmen, Gleichstand ⇒ Name; Text = erster nicht-leerer für diese Person
  const votes = new Map();
  for (const v of c.potg) if (ids.has(v.gameId)) votes.set(v.votedFor, (votes.get(v.votedFor) || 0) + 1);
  const top = [...votes].sort(([ia, a], [ib, b]) => b - a || byName(ia, ib))[0];
  let potg = null;
  if (top) {
    let text = null;
    for (const g of games) {
      const hit = c.potg.filter((v) => v.gameId === g.id && v.votedFor === top[0] && hasText(v.text))
        .sort((a, b) => byName(a.voterId, b.voterId))[0];
      if (hit) { text = hit.text; break; }
    }
    potg = { memberId: top[0], votes: top[1], text };
  }

  const info = sessionInfo(c, sessionId, games);
  return {
    sessionId, playedOn: info.playedOn, location: info.location,
    games: games.length,
    minutes: games.reduce((s, g) => s + (gameMinutes(g) ?? 0), 0),
    dayWinner: dayWinnerOf(c, games),
    saltiest: salty ? { memberId: salty[0], avgSalt: salty[1].sum / salty[1].n, ratings: salty[1].n } : null,
    longestTurn: turn ? { memberId: turn.memberId, seconds: turn.longestSec, gameId: turn.gameId } : null,
    potg,
  };
}

// ---------------------------------------------------------------------------
// Profil, Deck

/** Zugtempo aller Mitglieder mit Zeiten: Σ totalSec / Σ turns, langsamster zuerst. */
function tempoRows(c) {
  const acc = new Map();
  for (const t of c.turns) {
    if (!isNum(t.turns) || !isNum(t.totalSec)) continue;
    const a = acc.get(t.memberId) || { sec: 0, turns: 0 };
    a.sec += t.totalSec; a.turns += t.turns;
    acc.set(t.memberId, a);
  }
  return [...acc].filter(([, a]) => a.turns > 0)
    .map(([memberId, a]) => ({ memberId, avgTurnSec: a.sec / a.turns }))
    .sort((a, b) => cmpNum(b.avgTurnSec, a.avgTurnSec) || COLLATOR.compare(c.name(a.memberId), c.name(b.memberId)) || cmpStr(a.memberId, b.memberId));
}

/**
 * @param {GroupData} data
 * @param {string} memberId
 * @returns {MemberProfile}
 */
export function memberProfile(data, memberId) {
  const c = ctx(data);
  const own = c.players.filter((p) => p.memberId === memberId && isNum(p.place))
    .sort((a, b) => c.pos(a.gameId) - c.pos(b.gameId));
  const games = own.length;
  const wins = own.filter((p) => p.place === 1).length;
  const pts = own.map((p) => placePoints(c.n(p.gameId), p.place));
  const points = pts.reduce((s, x) => s + x, 0);

  const ratings = c.ratings.filter((r) => r.memberId === memberId).sort((a, b) => c.pos(a.gameId) - c.pos(b.gameId));
  const saltTrend = ratings.filter((r) => isNum(r.salt)).map((r) => /** @type {number} */ (r.salt)).slice(-8);

  let run = 0;
  const pointsSeries = pts.map((x) => (run += x));

  const rows = tempoRows(c);
  const idx = rows.findIndex((r) => r.memberId === memberId);

  // Nemesis: wer mich am häufigsten rausgenommen hat (≥ 2), Gleichstand ⇒ das zuletzt erfolgte Rausnehmen
  const kills = new Map();
  for (const p of own) if (p.eliminatedBy != null) bump(kills, p.eliminatedBy, c.pos(p.gameId));
  const nem = mostFrequent(kills);

  // Lieblingsdeck (meistgespielt, Gleichstand ⇒ zuletzt gespielt) und bestes Deck (≥ 3 eigene Spiele)
  const decks = new Map();
  const deckWins = new Map();
  for (const p of own) {
    if (p.deckId == null) continue;
    bump(decks, p.deckId, c.pos(p.gameId));
    if (p.place === 1) deckWins.set(p.deckId, (deckWins.get(p.deckId) || 0) + 1);
  }
  const fav = mostFrequent(decks);
  const best = [...decks].filter(([, v]) => v.count >= 3)
    .map(([deckId, v]) => ({ deckId, winRate: (deckWins.get(deckId) || 0) / v.count, games: v.count }))
    .sort((a, b) => cmpNum(b.winRate, a.winRate) || b.games - a.games || COLLATOR.compare(c.deck(a.deckId), c.deck(b.deckId)) || cmpStr(a.deckId, b.deckId))[0];

  let longestStreak = 0; let cur = 0;
  for (const p of own) { cur = p.place === 1 ? cur + 1 : 0; longestStreak = Math.max(longestStreak, cur); }

  const fastest = own.filter((p) => p.place === 1 && isNum(c.gameById.get(p.gameId)?.round))
    .map((p) => ({ gameId: p.gameId, rounds: /** @type {number} */ (c.gameById.get(p.gameId)?.round), at: c.pos(p.gameId) }))
    .sort((a, b) => a.rounds - b.rounds || a.at - b.at)[0];

  return {
    games, wins, points,
    winRate: games ? wins / games : null,
    avgPlace: games ? own.reduce((s, p) => s + /** @type {number} */ (p.place), 0) / games : null,
    avgSalt: mean(ratings.map((r) => r.salt)),
    avgFun: mean(ratings.map((r) => r.fun)),
    avgDeckRating: mean(ratings.map((r) => r.deckRating)),
    saltTrend,
    pointsSeries,
    placeSeries: own.map((p) => /** @type {number} */ (p.place)),
    tempo: { avgTurnSec: idx >= 0 ? rows[idx].avgTurnSec : null, rank: idx >= 0 ? idx + 1 : null, of: rows.length, rows },
    nemesis: nem && nem.v.count >= 2 ? { memberId: nem.key, count: nem.v.count } : null,
    favoriteDeck: fav ? { deckId: fav.key, games: fav.v.count } : null,
    bestDeck: best ? { deckId: best.deckId, winRate: best.winRate, games: best.games } : null,
    longestStreak,
    fastestWin: fastest ? { gameId: fastest.gameId, rounds: fastest.rounds } : null,
  };
}

/**
 * @param {GroupData} data
 * @param {string} deckId
 * @returns {DeckProfile}
 */
export function deckProfile(data, deckId) {
  const c = ctx(data);
  const rows = c.players.filter((p) => p.deckId === deckId && isNum(p.place))
    .sort((a, b) => c.pos(a.gameId) - c.pos(b.gameId));
  const games = rows.length;
  const wins = rows.filter((p) => p.place === 1).length;
  const rating = new Map(c.ratings.map((r) => [`${r.gameId}|${r.memberId}`, r]));
  const mine = rows.map((p) => rating.get(`${p.gameId}|${p.memberId}`)).filter(Boolean);
  const salt = saltRows(c, 1).find((r) => r.deckId === deckId);
  return {
    games, wins,
    winRate: games ? wins / games : null,
    avgPlace: games ? rows.reduce((s, p) => s + /** @type {number} */ (p.place), 0) / games : null,
    points: rows.reduce((s, p) => s + placePoints(c.n(p.gameId), p.place), 0),
    avgOwnRating: mean(mine.map((r) => r.deckRating)),
    avgFun: mean(mine.map((r) => r.fun)),
    salt: salt ? { avgSalt: /** @type {number} */ (salt.avgSalt), ratings: salt.ratings } : null,
    recentGameIds: rows.map((p) => p.gameId).reverse().slice(0, 5),
  };
}
