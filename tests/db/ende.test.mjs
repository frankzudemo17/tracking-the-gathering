// DB-Fälle Etappe 4 „Spielende“ (Migration 20261113000000_ende.sql) — Spec P14, Kriterien 1–8.
// EIN Szenario auf EINER Datenbank, Fälle laufen in Reihenfolge (node:test, eine Datei).
// Aufbau: Gruppe X (A Admin, B, C als Konten; P Platzhalter), Gruppe Y (D Admin, A zusätzlich Mitglied).
// Decks: dA (A), dB (B), dC (C), dP (P), dD (D).
// Spiele: s1 X finished (A, B, P) · s2 X live (A, B) · s3 X aborted (A, B) · sY Y finished (D, A).
// C ist Mitglied von X ohne Platz in s1; A hat ein Konto in zwei Gruppen (Mitglied-Wahl je Spielgruppe).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshDb, tools, U, MIGRATIONS } from './harness.mjs';

const FILE = '20261113000000_ende.sql';
const EXPECTED = 51;
let db, as, su, q, err;
let ran = 0;
const check = (name, fn) => test(name, async () => { ran++; await fn(); });
const ok = (cond, info = '') => assert.ok(cond, info === '' ? undefined : String(info));
const eq = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const fails = async (sql, params, re) => {
  const e = await err(sql, params);
  ok(e && (!re || re.test(e)), `erwartet Fehler${re ? ' ' + re : ''}, bekam: ${e}`);
  return e;
};
const n = async (sql, params) => (await q(sql, params))[0].n;
const NOBODY = '00000000-0000-4000-8000-0000000000ff';

before(async () => {
  db = await freshDb();
  ({ as, su, q, err } = tools(db));
});
after(async () => {
  await db?.close();
  assert.equal(ran, EXPECTED, `erwartet ${EXPECTED} Prüfungen, gelaufen ${ran}`);
});

// geteilter Zustand
let X, Y, mA, mB, mC, mP, mD, mAY;
const D = {};
let s1, s2, s3, sY;

const RATE = `select rate_game($1, $2, $3, $4, $5::jsonb, $6, $7)`;
const args = (game, { salt = null, fun = null, deck = null, deckSalt = null, potg = null, text = null } = {}) =>
  [game, salt, fun, deck, deckSalt == null ? null : (typeof deckSalt === 'string' ? deckSalt : JSON.stringify(deckSalt)), potg, text];
const rate = (game, o) => q(RATE, args(game, o));
const rateErr = (game, o) => err(RATE, args(game, o));

/** Stand aller drei Bewertungstabellen (als Superuser gelesen). Rolle danach: Superuser. */
const snap = async () => {
  await su();
  return (await q(`select json_build_object(
    'pr',   (select json_agg(x order by x) from (select game_id || '|' || member_id || '|' || coalesce(salt::text, '-') || '|' || coalesce(fun::text, '-') || '|' || coalesce(deck_rating::text, '-') x from player_ratings) t),
    'dsr',  (select json_agg(x order by x) from (select game_id || '|' || rater_id || '|' || deck_id || '|' || salt x from deck_salt_ratings) t),
    'potg', (select json_agg(x order by x) from (select game_id || '|' || voter_id || '|' || voted_for || '|' || coalesce(text, '-') x from potg_votes) t)
  )::text j`))[0].j;
};
const prRows = async (game, member) => { await su(); return q(`select salt, fun, deck_rating from player_ratings where game_id = $1 and member_id = $2`, [game, member]); };
const dsrRows = async (game, rater) => {
  await su();
  return (await q(`select deck_id, salt from deck_salt_ratings where game_id = $1 and rater_id = $2 order by salt, deck_id`, [game, rater]))
    .map((r) => `${r.deck_id}:${r.salt}`);
};
const potgRows = async (game, voter) => { await su(); return q(`select voted_for, text from potg_votes where game_id = $1 and voter_id = $2`, [game, voter]); };

// ---------------------------------------------------------------- Aufbau
check('Aufbau: Gruppen X/Y, Mitglieder, Platzhalter, Decks, Spiele s1/s2/s3/sY', async () => {
  await su();
  await db.query(`insert into auth.users (id, email) values ($1,'a@x.de'), ($2,'b@x.de'), ($3,'c@x.de'), ($4,'d@x.de'), ($5, null)`,
    [U.A, U.B, U.C, U.D, U.G]);
  await as(U.A);
  [X] = await q(`select * from create_playgroup('X')`);
  [{ id: mP }] = await q(`select * from create_placeholder($1, 'P')`, [X.id]);
  mA = (await q(`select my_member_id($1) id`, [X.id]))[0].id;
  await as(U.B);
  [{ id: mB }] = await q(`select * from join_playgroup($1)`, [X.invite_code]);
  await as(U.C);
  [{ id: mC }] = await q(`select * from join_playgroup($1)`, [X.invite_code]);
  await as(U.D);
  [Y] = await q(`select * from create_playgroup('Y')`);
  mD = (await q(`select my_member_id($1) id`, [Y.id]))[0].id;
  await as(U.A);
  [{ id: mAY }] = await q(`select * from join_playgroup($1)`, [Y.invite_code]);

  await su();
  const deck = async (col, owner, name) =>
    (await q(`insert into decks (${col}, commander_name, short_name) values ($1, $2, $2) returning id`, [owner, name]))[0].id;
  D.A = await deck('owner_profile_id', U.A, 'dA');
  D.B = await deck('owner_profile_id', U.B, 'dB');
  D.C = await deck('owner_profile_id', U.C, 'dC');
  D.P = await deck('owner_member_id', mP, 'dP');
  D.D = await deck('owner_profile_id', U.D, 'dD');

  const game = async (group, status, players) => {
    const [gm] = await q(`insert into games (playgroup_id, status, created_by) values ($1, $2::game_status, $3) returning *`, [group, status, U.A]);
    for (const [i, [m, d]] of players.entries()) {
      await q(`insert into game_players (game_id, member_id, deck_id, seat, place) values ($1, $2, $3, $4, $5)`,
        [gm.id, m, d, i, status === 'finished' ? i + 1 : null]);
    }
    return gm;
  };
  s1 = await game(X.id, 'finished', [[mA, D.A], [mB, D.B], [mP, D.P]]);
  s2 = await game(X.id, 'live', [[mA, D.A], [mB, D.B]]);
  s3 = await game(X.id, 'aborted', [[mA, D.A], [mB, D.B]]);
  sY = await game(Y.id, 'finished', [[mD, D.D], [mAY, D.A]]);
  ok(await n(`select count(*)::int n from game_players`) === 9);
});

// ---------------------------------------------------------------- K1 Migration
check('K1 Migration liegt als letzte Datei vor, Kopfkommentar mit Bestandsprüfungen', async () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  ok(files.at(-1) === FILE, files.join(', '));
  const sql = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
  for (const t of ['player_ratings', 'deck_salt_ratings', 'potg_votes']) ok(sql.includes(`select count(*) from ${t};`), t);
  ok(sql.includes('select count(*) from games where char_length(note) > 500;'));
  ok(/Nicht angefasst:/.test(sql));
});
check('K1 rate_game: security definer mit festem search_path, Signatur ohne p_member', async () => {
  await su();
  const [f] = await q(`select prosecdef, proconfig::text cfg, proargnames::text names from pg_proc
                       where proname = 'rate_game' and pronamespace = 'public'::regnamespace`);
  ok(f.prosecdef === true);
  ok(f.cfg === '{search_path=public}', f.cfg);
  ok(f.names === '{p_game,p_salt,p_fun,p_deck_rating,p_deck_salt,p_potg,p_potg_text}', f.names);
});

// ---------------------------------------------------------------- K2 Glückspfad
check('K2a A bewertet s1: genau eine Bewertungszeile, Deck-Salz, POTG mit getrimmtem Text', async () => {
  await as(U.A);
  await rate(s1.id, { salt: 4, fun: 5, deck: 3, deckSalt: { [D.B]: 5, [D.P]: 2 }, potg: mB, text: '  Toller Zug \n' });
  eq(await prRows(s1.id, mA), [{ salt: 4, fun: 5, deck_rating: 3 }]);
  await su();
  ok(await n(`select count(*)::int n from player_ratings`) === 1);
  eq(await dsrRows(s1.id, mA), [`${D.P}:2`, `${D.B}:5`]);
  eq(await potgRows(s1.id, mA), [{ voted_for: mB, text: 'Toller Zug' }]);
});
check('K2b B bewertet s1 (eigene Zeilen, unabhängig von A)', async () => {
  await as(U.B);
  await rate(s1.id, { salt: 1, fun: 4, deck: 5, deckSalt: { [D.A]: 3 }, potg: mA, text: 'Kombo' });
  eq(await prRows(s1.id, mB), [{ salt: 1, fun: 4, deck_rating: 5 }]);
  eq(await dsrRows(s1.id, mB), [`${D.A}:3`]);
  eq(await potgRows(s1.id, mB), [{ voted_for: mA, text: 'Kombo' }]);
});
check('K2c zweiter Aufruf überschreibt: null überschreibt, Deck-Salz ersetzt, Selbstwahl, leerer Text ⇒ null', async () => {
  await as(U.A);
  await rate(s1.id, { salt: 2, fun: null, deck: 1, deckSalt: { [D.P]: 4 }, potg: mA, text: '   ' });
  eq(await prRows(s1.id, mA), [{ salt: 2, fun: null, deck_rating: 1 }]);
  eq(await dsrRows(s1.id, mA), [`${D.P}:4`]);
  eq(await potgRows(s1.id, mA), [{ voted_for: mA, text: null }]);
  // B unberührt
  eq(await prRows(s1.id, mB), [{ salt: 1, fun: 4, deck_rating: 5 }]);
  eq(await dsrRows(s1.id, mB), [`${D.A}:3`]);
});
check('K2d p_deck_salt null ⇒ Deck-Salz unverändert', async () => {
  await as(U.A);
  await rate(s1.id, { salt: 2, deck: 1, potg: mA });
  eq(await dsrRows(s1.id, mA), [`${D.P}:4`]);
});
check('K2e Text genau 200 Zeichen (nach Trimmen) ok', async () => {
  await as(U.A);
  const t = 'x'.repeat(200);
  await rate(s1.id, { salt: 2, deck: 1, potg: mB, text: `  ${t}  ` });
  eq(await potgRows(s1.id, mA), [{ voted_for: mB, text: t }]);
});
check('K2f p_potg null löscht die eigene Stimme (Text ohne Stimme wird ignoriert), fremde bleibt', async () => {
  await as(U.A);
  await rate(s1.id, { salt: 2, deck: 1, potg: null, text: 'y'.repeat(300) });
  eq(await potgRows(s1.id, mA), []);
  eq(await potgRows(s1.id, mB), [{ voted_for: mA, text: 'Kombo' }]);
  eq(await prRows(s1.id, mA), [{ salt: 2, fun: null, deck_rating: 1 }]);
});
check('K2g p_deck_salt {} löscht alle eigenen Deck-Salz-Zeilen, fremde bleiben', async () => {
  await as(U.A);
  await rate(s1.id, { salt: 2, deck: 1, deckSalt: {} });
  eq(await dsrRows(s1.id, mA), []);
  eq(await dsrRows(s1.id, mB), [`${D.A}:3`]);
});
check('K2h alle drei Werte null ⇒ eigene Bewertung gelöscht, fremde bleibt', async () => {
  await as(U.A);
  await rate(s1.id, {});
  eq(await prRows(s1.id, mA), []);
  eq(await prRows(s1.id, mB), [{ salt: 1, fun: 4, deck_rating: 5 }]);
});
check('K2i Konto in zwei Gruppen: Zeile trägt das Mitglied der Spielgruppe (X bzw. Y)', async () => {
  await as(U.A);
  await rate(s1.id, { salt: 3, fun: 3, deck: 3, deckSalt: { [D.B]: 1 }, potg: mP });
  await as(U.A);
  await rate(sY.id, { salt: 5, deckSalt: { [D.D]: 5 }, potg: mD, text: 'Y-Text' });
  eq(await prRows(s1.id, mA), [{ salt: 3, fun: 3, deck_rating: 3 }]);
  eq(await prRows(sY.id, mAY), [{ salt: 5, fun: null, deck_rating: null }]);
  eq(await prRows(sY.id, mA), []);
  eq(await prRows(s1.id, mAY), []);
  eq(await dsrRows(sY.id, mAY), [`${D.D}:5`]);
  eq(await potgRows(sY.id, mAY), [{ voted_for: mD, text: 'Y-Text' }]);
  // D bewertet sY (für die Lese-Prüfung K4)
  await as(U.D);
  await rate(sY.id, { fun: 2, deckSalt: { [D.A]: 2 }, potg: mAY });
  eq(await prRows(sY.id, mD), [{ salt: null, fun: 2, deck_rating: null }]);
});

// ---------------------------------------------------------------- K3 Ablehnungen (Tabellenstand unverändert)
let BASE;
const rejects = (name, who, game, o, re) => check(`K3 ${name}`, async () => {
  BASE ??= await snap();
  ok(BASE.includes(mA) && BASE.includes(mB), 'Ausgangsstand nicht leer');
  await who();
  await fails(RATE, args(game(), o()), re);
  eq(await snap(), BASE);
});
const asA = () => as(U.A);
rejects('abgemeldet (anon): rate_game nicht ausführbar', () => as(null), () => s1.id, () => ({ salt: 1 }), /permission denied/);
rejects('anonymes Konto ⇒ Nicht angemeldet', () => as(U.G, { anonymous: true }), () => s1.id, () => ({ salt: 1 }), /^Nicht angemeldet$/);
rejects('Spiel live ⇒ nicht gewertet', asA, () => s2.id, () => ({ salt: 1, potg: mB }), /^Spiel ist nicht gewertet$/);
rejects('Spiel aborted ⇒ nicht gewertet', asA, () => s3.id, () => ({ salt: 1, potg: mB }), /^Spiel ist nicht gewertet$/);
rejects('Spiel existiert nicht ⇒ nicht gewertet', asA, () => NOBODY, () => ({ salt: 1 }), /^Spiel ist nicht gewertet$/);
rejects('Gruppenmitglied ohne Platz im Spiel ⇒ nur Mitspieler', () => as(U.C), () => s1.id, () => ({ salt: 1 }), /^Nur Mitspieler können bewerten$/);
rejects('fremde Gruppe ⇒ nur Mitspieler', () => as(U.D), () => s1.id, () => ({ salt: 1 }), /^Nur Mitspieler können bewerten$/);
rejects('fremde Gruppe, Spiel live ⇒ Status bleibt verborgen', () => as(U.D), () => s2.id, () => ({ salt: 1 }), /^Nur Mitspieler können bewerten$/);
for (const [k, v] of [['salt', 0], ['salt', 6], ['fun', 0], ['fun', 6], ['deck', 0], ['deck', 6]]) {
  rejects(`Wert ${k} = ${v}`, asA, () => s1.id, () => ({ salt: 2, fun: 2, deck: 2, [k]: v }), /^Bewertung muss zwischen 1 und 5 liegen$/);
}
rejects('Deck-Salz für eigenes Deck', asA, () => s1.id, () => ({ salt: 2, deckSalt: { [D.B]: 3, [D.A]: 4 } }), /^Eigenes Deck nicht salzen$/);
rejects('Deck-Salz für Gruppen-Deck, das nicht im Spiel ist', asA, () => s1.id, () => ({ salt: 2, deckSalt: { [D.C]: 3 } }), /^Deck nicht in diesem Spiel$/);
rejects('Deck-Salz für Deck aus einem anderen Spiel/einer anderen Gruppe', asA, () => s1.id, () => ({ salt: 2, deckSalt: { [D.D]: 3 } }), /^Deck nicht in diesem Spiel$/);
rejects('Deck-Salz-Schlüssel keine UUID', asA, () => s1.id, () => ({ salt: 2, deckSalt: { abc: 3 } }), /^Deck nicht in diesem Spiel$/);
for (const [label, v] of [['0', 0], ['6', 6], ['4.5', 4.5], ['"5" (Text)', '5'], ['null', null]]) {
  rejects(`Deck-Salz-Wert ${label}`, asA, () => s1.id, () => ({ salt: 2, deckSalt: `{"${D.B}": ${JSON.stringify(v)}}` }), /^Bewertung muss zwischen 1 und 5 liegen$/);
}
rejects('Deck-Salz kein Objekt', asA, () => s1.id, () => ({ salt: 2, deckSalt: '[1]' }), /^Deck-Salz ungültig$/);
rejects('POTG für Gruppenmitglied ohne Platz', asA, () => s1.id, () => ({ salt: 2, potg: mC }), /^Spieler nicht in diesem Spiel$/);
rejects('POTG für Mitglied einer fremden Gruppe', asA, () => s1.id, () => ({ salt: 2, potg: mD }), /^Spieler nicht in diesem Spiel$/);
rejects('POTG-Text 201 Zeichen', asA, () => s1.id, () => ({ salt: 2, potg: mB, text: 'z'.repeat(201) }), /^Text zu lang$/);

// ---------------------------------------------------------------- K4 Direkte Schreibwege zu, Lesen bleibt
const WRITES = [
  ['player_ratings insert', () => [`insert into player_ratings (game_id, member_id, salt) values ($1, $2, 3)`, [s1.id, mC]]],
  ['player_ratings update', () => [`update player_ratings set salt = 1 where game_id = $1`, [s1.id]]],
  ['player_ratings delete', () => [`delete from player_ratings where game_id = $1`, [s1.id]]],
  ['deck_salt_ratings insert', () => [`insert into deck_salt_ratings (game_id, rater_id, deck_id, salt) values ($1, $2, $3, 3)`, [s1.id, mA, D.P]]],
  ['deck_salt_ratings update', () => [`update deck_salt_ratings set salt = 1 where game_id = $1`, [s1.id]]],
  ['deck_salt_ratings delete', () => [`delete from deck_salt_ratings where game_id = $1`, [s1.id]]],
  ['potg_votes insert', () => [`insert into potg_votes (game_id, voter_id, voted_for) values ($1, $2, $3)`, [s1.id, mP, mA]]],
  ['potg_votes update', () => [`update potg_votes set text = 'x' where game_id = $1`, [s1.id]]],
  ['potg_votes delete', () => [`delete from potg_votes where game_id = $1`, [s1.id]]],
];
check('K4 Gruppenmitglied (authenticated): insert/update/delete auf allen drei Tabellen ⇒ permission denied', async () => {
  const before = await snap();
  for (const [name, mk] of WRITES) {
    await as(U.A);
    const [sql, p] = mk();
    const e = await err(sql, p);
    ok(e && /permission denied/.test(e), `${name}: ${e}`);
  }
  eq(await snap(), before);
});
check('K4 anon: insert/update/delete ⇒ permission denied', async () => {
  for (const [name, mk] of WRITES) {
    await as(null);
    const [sql, p] = mk();
    const e = await err(sql, p);
    ok(e && /permission denied/.test(e), `${name}: ${e}`);
  }
});
check('K4 select: Mitglied sieht alle Bewertungen der eigenen Gruppe, keine der fremden', async () => {
  await su();
  const all = await q(`select (select count(*) from player_ratings where game_id = $1)::int pr, (select count(*) from deck_salt_ratings where game_id = $1)::int dsr,
                              (select count(*) from potg_votes where game_id = $1)::int potg`, [s1.id]);
  const allY = await q(`select (select count(*) from player_ratings where game_id = $1)::int pr, (select count(*) from deck_salt_ratings where game_id = $1)::int dsr,
                              (select count(*) from potg_votes where game_id = $1)::int potg`, [sY.id]);
  ok(all[0].pr === 2 && all[0].dsr === 2 && all[0].potg === 2, JSON.stringify(all));
  ok(allY[0].pr === 2 && allY[0].dsr === 2 && allY[0].potg === 2, JSON.stringify(allY));
  const seen = async () => (await q(`select (select count(*) from player_ratings)::int pr, (select count(*) from deck_salt_ratings)::int dsr,
                                            (select count(*) from potg_votes)::int potg`))[0];
  await as(U.C); // X ohne Platz in s1: sieht trotzdem alle Bewertungen von X, keine von Y
  eq(await seen(), all[0]);
  await as(U.B);
  eq(await seen(), all[0]);
  await as(U.D); // nur Y
  eq(await seen(), allY[0]);
  await as(null);
  eq(await seen(), { pr: 0, dsr: 0, potg: 0 });
});

// ---------------------------------------------------------------- K5 v_game_turn_times
check('K5 Aufbau Zugende-Ereignisse (s1: A 120/200/90 + zwei zurückgenommene, B 60; s2 live, s3 aborted, sY)', async () => {
  await su();
  const EV = `insert into game_events (game_id, round, type, actor, payload, seq) values ($1, 1, $2::event_type, $3, $4::jsonb, $5) returning id`;
  const ev = async (game, type, actor, payload, seq) => (await q(EV, [game, type, actor, JSON.stringify(payload), seq]))[0].id;
  await ev(s1.id, 'turn_end', mA, { seconds: 120 }, 1);
  await ev(s1.id, 'turn_end', mB, { seconds: 60 }, 2);
  await ev(s1.id, 'turn_end', mA, { seconds: 200 }, 3);
  const undone = await ev(s1.id, 'turn_end', mA, { seconds: 300 }, 4);
  await ev(s1.id, 'undo', mA, { event_id: Number(undone) }, 5);
  await ev(s1.id, 'turn_end', mA, { seconds: 250 }, 6);
  await ev(s1.id, 'undo', mA, { seq: 6 }, 7);
  await ev(s1.id, 'turn_end', mA, { seconds: 90 }, 8);
  await ev(s1.id, 'turn_end', mB, {}, 9); // ohne seconds: zählt nicht
  await ev(s3.id, 'turn_end', mA, { seconds: 500 }, 1);
  await ev(s2.id, 'turn_end', mA, { seconds: 400 }, 1);
  await ev(sY.id, 'turn_end', mD, { seconds: 30 }, 1);
  ok(await n(`select count(*)::int n from game_events`) === 12);
});
check('K5 Spalten und Typen der View, security_invoker', async () => {
  await su();
  const cols = await q(`select column_name, data_type from information_schema.columns
                        where table_schema = 'public' and table_name = 'v_game_turn_times' order by ordinal_position`);
  eq(cols.map((c) => `${c.column_name}:${c.data_type}`),
    ['playgroup_id:uuid', 'game_id:uuid', 'member_id:uuid', 'turns:integer', 'total_sec:integer', 'longest_sec:integer']);
  const [{ opts }] = await q(`select reloptions::text opts from pg_class where relname = 'v_game_turn_times'`);
  ok(opts === '{security_invoker=true}', opts);
});
check('K5 Sollwerte s1 (von Hand): A 3/410/200, B 1/60/60; keine Zeile für s2/s3', async () => {
  await as(U.B);
  const rows = await q(`select playgroup_id, game_id, member_id, turns, total_sec, longest_sec from v_game_turn_times order by turns desc`);
  eq(rows, [
    { playgroup_id: X.id, game_id: s1.id, member_id: mA, turns: 3, total_sec: 410, longest_sec: 200 },
    { playgroup_id: X.id, game_id: s1.id, member_id: mB, turns: 1, total_sec: 60, longest_sec: 60 },
  ]);
});
check('K5 fremde Gruppe sieht 0 Zeilen von s1; D sieht nur sY', async () => {
  await as(U.D);
  ok(await n(`select count(*)::int n from v_game_turn_times where game_id = $1`, [s1.id]) === 0);
  eq(await q(`select game_id, member_id, turns, total_sec, longest_sec from v_game_turn_times`),
    [{ game_id: sY.id, member_id: mD, turns: 1, total_sec: 30, longest_sec: 30 }]);
  await as(null);
  ok(await n(`select count(*)::int n from v_game_turn_times`) === 0);
});

// ---------------------------------------------------------------- K6 photos_update
let objX, objY;
check('K6 photos_update: Mitglied ersetzt Foto im eigenen Gruppen-Ordner', async () => {
  await su();
  [{ id: objX }] = await q(`insert into storage.objects (bucket_id, name) values ('game-photos', $1) returning id`, [`${X.id}/${s1.id}.jpg`]);
  [{ id: objY }] = await q(`insert into storage.objects (bucket_id, name) values ('game-photos', $1) returning id`, [`${Y.id}/${sY.id}.jpg`]);
  await as(U.B);
  const rows = await q(`update storage.objects set name = name where id = $1 returning id`, [objX]);
  eq(rows.map((r) => r.id), [objX]);
  const [pol] = await q(`select cmd, qual, with_check from pg_policies where schemaname = 'storage' and policyname = 'photos_update'`);
  ok(pol.cmd === 'UPDATE' && /game-photos/.test(pol.qual) && /is_group_member/.test(pol.qual) && /is_group_member/.test(pol.with_check), JSON.stringify(pol));
});
check('K6 photos_update: fremde Gruppe ⇒ 0 Zeilen, Objekt unverändert; Verschieben in fremden Ordner ⇒ Fehler', async () => {
  await as(U.B);
  eq(await q(`update storage.objects set name = $2 where id = $1 returning id`, [objY, `${Y.id}/neu.jpg`]), []);
  await fails(`update storage.objects set name = $2 where id = $1`, [objX, `${Y.id}/geklaut.jpg`], /row-level security/);
  await as(null);
  eq(await q(`update storage.objects set name = name where id = $1 returning id`, [objX]), []);
  await su();
  eq((await q(`select name from storage.objects order by name`)).map((r) => r.name).sort(), [`${X.id}/${s1.id}.jpg`, `${Y.id}/${sY.id}.jpg`].sort());
});

// ---------------------------------------------------------------- K7 Notiz-Länge
check('K7 games_note_len: 501 Zeichen ⇒ Fehler, 500 ⇒ ok, null ⇒ ok', async () => {
  await as(U.A);
  await fails(`update games set note = $2 where id = $1`, [s1.id, 'n'.repeat(501)], /games_note_len/);
  eq(await q(`update games set note = $2 where id = $1 returning char_length(note) l`, [s1.id, 'n'.repeat(500)]), [{ l: 500 }]);
  eq(await q(`update games set note = null where id = $1 returning note`, [s1.id]), [{ note: null }]);
});

// ---------------------------------------------------------------- K8 Ausführungsrechte
check('K8 rate_game: anon nicht ausführbar, authenticated ja, kein PUBLIC-Eintrag', async () => {
  await su();
  const sig = 'public.rate_game(uuid, int, int, int, jsonb, uuid, text)';
  const [r] = await q(`select has_function_privilege('anon', $1, 'execute') anon, has_function_privilege('authenticated', $1, 'execute') auth,
                              (select proacl::text from pg_proc where proname = 'rate_game') acl`, [sig]);
  ok(r.anon === false, 'anon darf');
  ok(r.auth === true, 'authenticated darf nicht');
  ok(!/(^|[{,])=X/.test(r.acl), r.acl);
});

// ---------------------------------------------------------------- R Rückwärts
const CATALOG = `select json_build_object(
  'functions', (select json_agg(x order by x) from (select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
      || md5(p.prosrc) || '|' || p.prosecdef || '|' || coalesce(p.proconfig::text, '') || '|' || coalesce(p.proacl::text, '') x
      from pg_proc p where p.pronamespace = 'public'::regnamespace) f),
  'policies', (select json_agg(x order by x) from (select schemaname || '.' || tablename || '.' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') x
      from pg_policies where schemaname in ('public', 'storage')) f),
  'views', (select json_agg(x order by x) from (select c.relname || '|' || pg_get_viewdef(c.oid) || '|' || coalesce(c.reloptions::text, '') x
      from pg_class c where c.relkind = 'v' and c.relnamespace = 'public'::regnamespace) f),
  'acl', (select json_agg(x order by x) from (select c.relname || '|' || coalesce(c.relacl::text, '') x
      from pg_class c where c.relkind in ('r', 'v') and c.relnamespace = 'public'::regnamespace) f),
  'columns', (select json_agg(x order by x) from (select table_name || '.' || column_name || '|' || data_type || '|' || is_nullable x
      from information_schema.columns where table_schema = 'public') f),
  'constraints', (select json_agg(x order by x) from (select conrelid::regclass::text || '.' || conname || '|' || pg_get_constraintdef(oid) x
      from pg_constraint where connamespace = 'public'::regnamespace) f)
)::text j`;
check('R1 Rückwärts-Block: Schema gleich dem Stand ohne die Migration, Bewertungen bleiben', async () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
  const m = sql.match(/-- RÜCKWÄRTS-BEGINN\r?\n([\s\S]*?)-- RÜCKWÄRTS-ENDE/);
  ok(m, 'Rückwärts-Block nicht gefunden');
  const lines = m[1].split(/\r?\n/).filter((l) => l !== '');
  ok(lines.every((l) => l.startsWith('-- ')), 'jede Zeile beginnt mit „-- “');
  const back = lines.map((l) => l.slice(3)).join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttg-p14-'));
  let ref;
  try {
    for (const f of fs.readdirSync(MIGRATIONS)) if (f.endsWith('.sql') && f !== FILE) fs.copyFileSync(path.join(MIGRATIONS, f), path.join(dir, f));
    ref = await freshDb({ migrations: dir });
    const want = (await ref.query(CATALOG)).rows[0].j;
    await su();
    const pre = (await q(CATALOG))[0].j;
    ok(pre !== want, 'vor dem Rückwärts-Block unterscheiden sich die Schemata');
    const ratings = await snap();
    await db.exec(back);
    const got = (await q(CATALOG))[0].j;
    if (got !== want) {
      const a = JSON.parse(got), b = JSON.parse(want);
      const diff = Object.keys(b).map((k) => [k, (a[k] || []).filter((x) => !(b[k] || []).includes(x)), (b[k] || []).filter((x) => !(a[k] || []).includes(x))])
        .filter(([, x, y]) => x.length || y.length);
      assert.fail(`Schema nach Rückwärts ≠ Stand ohne Migration: ${JSON.stringify(diff).slice(0, 2000)}`);
    }
    eq(await snap(), ratings);
  } finally {
    await ref?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
