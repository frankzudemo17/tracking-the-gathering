// DB-Fälle P3 „Gruppe löschen“ (Migration 20261115010000_gruppe_loeschen.sql) — spec-p3-gruppe.md,
// Abnahmekriterien 1–5 plus Negativraum (Name NULL/leer, Rechte der Hilfsfunktionen, Versionsverweis
// auf ein Platzhalter-Deck, created_by bleibt, Rückwärts-Block). EIN Szenario auf EINER Datenbank,
// Fälle laufen in Reihenfolge: erst alles, was NICHTS löschen darf, dann das Löschen, dann der
// Doppelklick.
//
// Aufbau:
//   X „X-Name“: A Admin + Ersteller, B Mitglied, Tim ohne Konto (Deck T1, Bild im Speicher).
//     Decks A1 (A), A2 (A, Version von T1), B1 (B). Zwei beendete Spiele + ein laufendes, Ereignisse,
//     Spieler- und Deck-Bewertungen, Spielfoto.
//   Y „Y“: C Admin, B Mitglied, Ole ohne Konto (Deck O1, Bild). Ein beendetes Spiel mit B1 (B spielt
//     sein Konto-Deck in beiden Gruppen), Ereignis, Bewertung, Spielfoto.
//
// Gegenprobe (Spec „am Stand ohne Migration rot“): GEGENPROBE=1 node --test tests/db/gruppe-loeschen.test.mjs
// lädt alle Migrationen AUSSER dieser ⇒ jeder Fall mit delete_playgroup/playgroup_files wird rot.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshDb, tools, U, MIGRATIONS } from './harness.mjs';

const FILE = '20261115010000_gruppe_loeschen.sql';
const EXPECTED = 18;
let db, as, su, q, err;
let ran = 0;
let gegenDir = null;
const check = (name, fn) => test(name, async () => { ran++; await fn(); });
const ok = (cond, info = '') => assert.ok(cond, info === '' ? undefined : String(info));
const n = async (sql, params) => (await q(sql, params))[0].n;
const J = (x) => JSON.stringify(x);

before(async () => {
  let migrations = MIGRATIONS;
  if (process.env.GEGENPROBE) {
    gegenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttg-p3-gegen-'));
    for (const f of fs.readdirSync(MIGRATIONS)) if (f.endsWith('.sql') && f !== FILE) fs.copyFileSync(path.join(MIGRATIONS, f), path.join(gegenDir, f));
    migrations = gegenDir;
  }
  db = await freshDb({ migrations });
  ({ as, su, q, err } = tools(db));
});
after(async () => {
  await db?.close();
  if (gegenDir) fs.rmSync(gegenDir, { recursive: true, force: true });
  assert.equal(ran, EXPECTED, `erwartet ${EXPECTED} Prüfungen, gelaufen ${ran}`);
});

let x, y, tim, ole, mA, mB, mBY, mC;
const D = {};
const G = {};
const PATHS = {};

const START = `select * from start_game($1, 'seiten', 40, 0, $2::jsonb, '2026-11-15')`;
const start = (group, players) => q(START, [group, J(players)]).then((r) => r[0]);
const P = (member_id, deck_id, seat) => ({ member_id, deck_id, seat });
const finish = (game, results) => q(`select * from finish_game($1, 'finished', 3, $2::jsonb)`, [game, J(results)]);
const R = (member_id, place, eliminated_by = null) => ({ member_id, place, eliminated_round: place === 1 ? null : 2, eliminated_by, final_life: place === 1 ? 12 : 0 });
const ev = (game, type, actor, source, target, amount, seq) =>
  q(`insert into game_events (game_id, round, type, actor, source, target, amount, seq) values ($1, 1, $2::event_type, $3, $4, $5, $6, $7)`,
    [game, type, actor, source, target, amount, seq]);
const deck = async (col, owner, name, extra = {}) =>
  (await q(`insert into decks (${col}, commander_name, short_name, version_of) values ($1, $2, $2, $3) returning id`, [owner, name, extra.version_of ?? null]))[0].id;
const DEL = (gid, name) => [`select delete_playgroup($1, $2)`, [gid, name]];
const FILES = (gid) => [`select * from playgroup_files($1)`, [gid]];

/** Zeilenzahlen aller Tabellen, die an einer Gruppe hängen (als Superuser, ohne RLS). */
async function counts(gid) {
  await su();
  const c = async (sql) => n(sql, [gid]);
  return {
    playgroups: await c(`select count(*)::int n from playgroups where id = $1`),
    members: await c(`select count(*)::int n from members where playgroup_id = $1`),
    sessions: await c(`select count(*)::int n from sessions where playgroup_id = $1`),
    games: await c(`select count(*)::int n from games where playgroup_id = $1`),
    game_players: await c(`select count(*)::int n from game_players gp join games g on g.id = gp.game_id where g.playgroup_id = $1`),
    game_events: await c(`select count(*)::int n from game_events e join games g on g.id = e.game_id where g.playgroup_id = $1`),
    player_ratings: await c(`select count(*)::int n from player_ratings r join games g on g.id = r.game_id where g.playgroup_id = $1`),
    deck_salt_ratings: await c(`select count(*)::int n from deck_salt_ratings r join games g on g.id = r.game_id where g.playgroup_id = $1`),
    placeholder_decks: await c(`select count(*)::int n from decks d join members m on m.id = d.owner_member_id where m.playgroup_id = $1`),
  };
}
/** Vollständige Momentaufnahme einer Gruppe (für „unverändert“). */
async function snap(gid) {
  await su();
  const rows = (sql) => q(sql, [gid]);
  return J({
    counts: await counts(gid),
    pg: await rows(`select * from playgroups where id = $1`),
    members: await rows(`select id, profile_id, display_name, role, claim_code, avatar_path from members where playgroup_id = $1 order by id`),
    games: await rows(`select id, status, session_id, created_by from games where playgroup_id = $1 order by id`),
    gp: await rows(`select gp.game_id, gp.member_id, gp.deck_id, gp.seat, gp.place from game_players gp join games g on g.id = gp.game_id where g.playgroup_id = $1 order by 1, 4`),
    ev: await rows(`select e.id, e.type, e.amount from game_events e join games g on g.id = e.game_id where g.playgroup_id = $1 order by e.id`),
    decks: await rows(`select d.id, d.version_of, d.archived from decks d join members m on m.id = d.owner_member_id where m.playgroup_id = $1 order by d.id`),
  });
}
let before_X, before_Y, countsY;

// ---------------------------------------------------------------- Aufbau
check('Aufbau: Gruppen X (A Admin, B, Tim) und Y (C Admin, B, Ole), Spiele, Ereignisse, Bewertungen, Speicher', async () => {
  await su();
  await db.query(`insert into auth.users (id, email) values ($1,'a@x.de'), ($2,'b@x.de'), ($3,'c@x.de'), ($4, null)`, [U.A, U.B, U.C, U.G]);
  // X
  await as(U.A);
  [x] = await q(`select * from create_playgroup('X-Name')`);
  mA = (await q(`select my_member_id($1) id`, [x.id]))[0].id;
  [tim] = await q(`select * from create_placeholder($1, 'Tim')`, [x.id]);
  D.A1 = await deck('owner_profile_id', U.A, 'A1');
  D.T1 = await deck('owner_member_id', tim.id, 'T1');
  D.A2 = await deck('owner_profile_id', U.A, 'A2', { version_of: D.T1 });
  await as(U.B);
  [{ id: mB }] = await q(`select * from join_playgroup($1)`, [x.invite_code]);
  D.B1 = await deck('owner_profile_id', U.B, 'B1');
  await as(U.A);
  G.x1 = await start(x.id, [P(mA, D.A1, 0), P(mB, D.B1, 1), P(tim.id, D.T1, 2)]);
  await ev(G.x1.id, 'damage', mA, mA, mB, 7, 1);
  await ev(G.x1.id, 'cmd_damage', mB, mB, tim.id, 21, 2);
  await finish(G.x1.id, [R(mA, 1), R(mB, 2, mA), R(tim.id, 3, mB)]);
  await q(`insert into player_ratings (game_id, member_id, salt, fun) values ($1, $2, 2, 5), ($1, $3, 4, 3)`, [G.x1.id, mA, mB]);
  await q(`insert into deck_salt_ratings (game_id, rater_id, deck_id, salt) values ($1, $2, $3, 5), ($1, $2, $4, 2)`, [G.x1.id, mB, D.A1, D.T1]);
  G.x2 = await start(x.id, [P(mA, D.A1, 0), P(tim.id, D.T1, 1)]);
  await ev(G.x2.id, 'poison', tim.id, tim.id, mA, 10, 1);
  await finish(G.x2.id, [R(tim.id, 1), R(mA, 2, tim.id)]);
  G.x3 = await start(x.id, [P(mA, D.A1, 0), P(mB, D.B1, 1), P(tim.id, D.T1, 2)]); // läuft noch
  await ev(G.x3.id, 'damage', mB, mB, tim.id, 3, 1);
  // Y
  await as(U.C);
  [y] = await q(`select * from create_playgroup('Y')`);
  mC = (await q(`select my_member_id($1) id`, [y.id]))[0].id;
  [ole] = await q(`select * from create_placeholder($1, 'Ole')`, [y.id]);
  D.C1 = await deck('owner_profile_id', U.C, 'C1');
  D.O1 = await deck('owner_member_id', ole.id, 'O1');
  await as(U.B);
  [{ id: mBY }] = await q(`select * from join_playgroup($1)`, [y.invite_code]);
  await as(U.C);
  G.y1 = await start(y.id, [P(mC, D.C1, 0), P(mBY, D.B1, 1), P(ole.id, D.O1, 2)]);
  await ev(G.y1.id, 'damage', mBY, mBY, mC, 40, 1);
  await finish(G.y1.id, [R(mBY, 1), R(mC, 2, mBY), R(ole.id, 3, mBY)]);
  await q(`insert into player_ratings (game_id, member_id, salt) values ($1, $2, 5)`, [G.y1.id, mC]);
  // Speicher: Profilbilder (bleiben immer), Bilder der Spieler ohne Konto, Spielfotos
  await su();
  PATHS.timAvatar = `members/${tim.id}/avatar.jpg`;
  PATHS.oleAvatar = `members/${ole.id}/avatar.jpg`;
  PATHS.xPhoto1 = `${x.id}/${G.x1.id}.jpg`;
  PATHS.xPhoto2 = `${x.id}/${G.x2.id}.jpg`;
  PATHS.yPhoto = `${y.id}/${G.y1.id}.jpg`;
  await q(`insert into storage.objects (bucket_id, name) values
    ('avatars', $1), ('avatars', $2), ('avatars', $3), ('avatars', $4), ('game-photos', $5), ('game-photos', $6), ('game-photos', $7)`,
  [`profiles/${U.A}/avatar.jpg`, `profiles/${U.B}/avatar.jpg`, PATHS.timAvatar, PATHS.oleAvatar, PATHS.xPhoto1, PATHS.xPhoto2, PATHS.yPhoto]);
  await q(`update members set avatar_path = $2 where id = $1`, [tim.id, PATHS.timAvatar]);
  before_X = await snap(x.id);
  before_Y = await snap(y.id);
  countsY = await counts(y.id);
  const cX = await counts(x.id);
  ok(J(cX) === J({ playgroups: 1, members: 3, sessions: 1, games: 3, game_players: 8, game_events: 4, player_ratings: 2, deck_salt_ratings: 2, placeholder_decks: 1 }), J(cX));
  ok(cX.games === 3 && (await n(`select count(*)::int n from games where playgroup_id = $1 and status = 'live'`, [x.id])) === 1, 'ein laufendes Spiel');
});

// ---------------------------------------------------------------- Kriterium 2: Mandanten und Rechte (nichts darf passieren)
check('K2 anon ohne Login ⇒ keine Ausführungsrechte (delete_playgroup, playgroup_files)', async () => {
  await as(null);
  ok(/permission denied/.test(await err(...DEL(x.id, 'X-Name'))), 'delete anon');
  ok(/permission denied/.test(await err(...FILES(x.id))), 'files anon');
});
check('K2 anonymes Konto (is_anonymous) ⇒ „Nicht angemeldet“', async () => {
  await as(U.G, { anonymous: true });
  ok(/Nicht angemeldet/.test(await err(...DEL(x.id, 'X-Name'))), 'delete anonym');
  ok(/Nicht angemeldet/.test(await err(...FILES(x.id))), 'files anonym');
});
check('K2 B (Mitglied, kein Admin) ⇒ Fehler bei delete_playgroup und playgroup_files', async () => {
  await as(U.B);
  ok(/Nur Admins/.test(await err(...DEL(x.id, 'X-Name'))), 'delete B');
  ok(/Nur Admins/.test(await err(...FILES(x.id))), 'files B');
});
check('K2 C (fremd, Admin nur von Y) ⇒ Fehler', async () => {
  await as(U.C);
  ok(/Nur Admins/.test(await err(...DEL(x.id, 'X-Name'))), 'delete C');
  ok(/Nur Admins/.test(await err(...FILES(x.id))), 'files C');
});
check('K2 falscher Name, NULL, leer, nur Leerzeichen ⇒ „Name stimmt nicht“, nichts gelöscht', async () => {
  await as(U.A);
  for (const bad of ['X-Nam', 'X Name', 'Y', null, '', '   ']) {
    const e = await err(...DEL(x.id, bad));
    ok(/Name stimmt nicht/.test(e || ''), `${J(bad)} ⇒ ${e}`);
  }
  ok(await snap(x.id) === before_X, 'X unverändert');
  ok(await snap(y.id) === before_Y, 'Y unverändert');
});
check('K2 Hilfsfunktionen ohne eigene Prüfung sind für Client-Rollen gesperrt (_playgroup_delete_guard, purge_playgroup)', async () => {
  for (const who of [null, U.A]) {
    await as(who);
    ok(/permission denied/.test(await err(`select _playgroup_delete_guard($1)`, [x.id])), `guard ${who}`);
    ok(/permission denied/.test(await err(`select purge_playgroup($1)`, [x.id])), `purge ${who}`);
  }
  ok(await snap(x.id) === before_X, 'X unverändert');
});
check('K2 Ausführungsrechte im Katalog: delete_playgroup/playgroup_files nur authenticated', async () => {
  await su();
  const priv = async (fn, role) => (await q(`select has_function_privilege($1, $2, 'execute') p`, [role, fn]))[0].p;
  for (const fn of ['public.delete_playgroup(uuid, text)', 'public.playgroup_files(uuid)']) {
    ok(await priv(fn, 'authenticated') === true, `${fn} authenticated`);
    ok(await priv(fn, 'anon') === false, `${fn} anon`);
  }
  ok(await priv('public._playgroup_delete_guard(uuid)', 'authenticated') === false, 'guard authenticated');
});

// ---------------------------------------------------------------- Kriterium 3: Leihdeck
check('K3 Tims Deck in einem Spiel von Y (game_players) ⇒ playgroup_files UND delete_playgroup werfen deck_used_elsewhere, X erhalten', async () => {
  // Über start_game nicht herstellbar (deck_in_group) ⇒ als Superuser angelegt (Altdaten-Fall)
  await su();
  await q(`update game_players set deck_id = $1 where game_id = $2 and member_id = $3`, [D.T1, G.y1.id, ole.id]);
  const y_with = await snap(y.id);
  await as(U.A);
  ok(/deck_used_elsewhere/.test(await err(...FILES(x.id)) || ''), 'files');
  ok(/deck_used_elsewhere/.test(await err(...DEL(x.id, 'X-Name')) || ''), 'delete');
  ok(await snap(x.id) === before_X, 'X vollständig erhalten');
  ok(await snap(y.id) === y_with, 'Y unverändert');
  await su();
  await q(`update game_players set deck_id = $1 where game_id = $2 and member_id = $3`, [D.O1, G.y1.id, ole.id]);
  ok(await snap(y.id) === before_Y, 'Y zurückgesetzt');
});
check('K3 Tims Deck in einer Deck-Bewertung eines Spiels von Y ⇒ ebenfalls deck_used_elsewhere', async () => {
  await su();
  await q(`insert into deck_salt_ratings (game_id, rater_id, deck_id, salt) values ($1, $2, $3, 4)`, [G.y1.id, mC, D.T1]);
  await as(U.A);
  ok(/deck_used_elsewhere/.test(await err(...FILES(x.id)) || ''), 'files');
  ok(/deck_used_elsewhere/.test(await err(...DEL(x.id, 'X-Name')) || ''), 'delete');
  ok(await snap(x.id) === before_X, 'X vollständig erhalten');
  await su();
  await q(`delete from deck_salt_ratings where game_id = $1 and deck_id = $2`, [G.y1.id, D.T1]);
  ok(await snap(y.id) === before_Y && J(await counts(y.id)) === J(countsY), 'Y zurückgesetzt');
});
check('K3 Konto-Deck von B in X UND Y ⇒ kein Leihdeck-Fall (gehört keinem Spieler ohne Konto)', async () => {
  await as(U.A);
  ok((await err(...FILES(x.id))) === null, 'playgroup_files läuft');
});

// ---------------------------------------------------------------- Kriterium 5: Dateiliste
check('K5 playgroup_files(X) als Admin: Tims Bild + Spielfotos von X, nichts aus Y, keine Profilbilder', async () => {
  await as(U.A);
  const rows = await q(...FILES(x.id));
  ok(J(rows) === J([
    { bucket: 'avatars', path: PATHS.timAvatar },
    { bucket: 'game-photos', path: PATHS.xPhoto1 }, { bucket: 'game-photos', path: PATHS.xPhoto2 },
  ].sort((a, b) => (a.bucket + a.path).localeCompare(b.bucket + b.path))), J(rows));
  ok(!rows.some((r) => r.path === PATHS.oleAvatar || r.path === PATHS.yPhoto || r.path.startsWith('profiles/')), 'nichts Fremdes');
  ok(await snap(x.id) === before_X, 'Dateiliste ändert nichts');
});
check('K5 playgroup_files(Y) als C: nur Y (Gegenprobe Mandant)', async () => {
  await as(U.C);
  const rows = await q(...FILES(y.id));
  ok(J(rows.map((r) => r.path).sort()) === J([PATHS.oleAvatar, PATHS.yPhoto].sort()), J(rows));
});

// ---------------------------------------------------------------- Kriterium 1: Admin löscht vollständig
check('K1 A löscht X mit „ x-name “ (Leerzeichen, Kleinschreibung) ⇒ alles von X weg', async () => {
  await as(U.A);
  ok((await err(...DEL(x.id, ' x-name '))) === null, 'delete_playgroup läuft');
  const c = await counts(x.id);
  ok(J(c) === J({ playgroups: 0, members: 0, sessions: 0, games: 0, game_players: 0, game_events: 0, player_ratings: 0, deck_salt_ratings: 0, placeholder_decks: 0 }), J(c));
  const gids = [G.x1.id, G.x2.id, G.x3.id];
  ok(await n(`select count(*)::int n from game_players where game_id = any($1)`, [gids]) === 0, 'game_players über Spiel-IDs');
  ok(await n(`select count(*)::int n from game_events where game_id = any($1)`, [gids]) === 0, 'game_events über Spiel-IDs');
  ok(await n(`select count(*)::int n from members where id = any($1)`, [[mA, mB, tim.id]]) === 0, 'Mitgliedschaften');
});
check('K1 Decks: Tims Deck weg; Konto-Decks von A und B bleiben; Versionsverweis A2 → T1 gelöst', async () => {
  await su();
  ok(await n(`select count(*)::int n from decks where id = $1`, [D.T1]) === 0, 'T1 weg');
  const kept = await q(`select id, owner_profile_id, version_of, archived from decks where id = any($1) order by short_name`, [[D.A1, D.A2, D.B1]]);
  ok(kept.length === 3, J(kept));
  ok(kept.every((d) => d.archived === false), 'nicht archiviert');
  ok(kept.find((d) => d.id === D.A2).version_of === null, 'A2.version_of geleert');
  ok(kept.find((d) => d.id === D.A1).owner_profile_id === U.A && kept.find((d) => d.id === D.B1).owner_profile_id === U.B, 'Besitzer unverändert');
});
check('K2 Y unverändert (Zeilenzahlen und Inhalt), Konten und Profile bleiben, created_by von Y unberührt', async () => {
  ok(J(await counts(y.id)) === J(countsY), J(await counts(y.id)));
  ok(await snap(y.id) === before_Y, 'Y-Inhalt gleich');
  await su();
  ok(await n(`select count(*)::int n from profiles where id = any($1)`, [[U.A, U.B, U.C]]) === 3, 'Profile A, B, C');
  ok(await n(`select count(*)::int n from members where profile_id = $1 and playgroup_id = $2`, [U.B, y.id]) === 1, 'B weiter in Y');
  ok((await q(`select created_by from playgroups where id = $1`, [y.id]))[0].created_by === U.C, 'Y.created_by');
  ok(await n(`select count(*)::int n from storage.objects`) === 7, 'Speicherzeilen löscht SQL nie (das macht der Client vorher)');
});

// ---------------------------------------------------------------- Kriterium 4: Doppelklick
check('K4 zweiter Aufruf nach dem ersten ⇒ „Gruppe nicht gefunden“ (auch playgroup_files), kein Teilzustand', async () => {
  const yBefore = await snap(y.id);
  await as(U.A);
  ok(/Gruppe nicht gefunden/.test(await err(...DEL(x.id, 'X-Name')) || ''), 'delete zweimal');
  ok(/Gruppe nicht gefunden/.test(await err(...FILES(x.id)) || ''), 'files danach');
  ok(J(await counts(x.id)).includes('"playgroups":0') && Object.values(await counts(x.id)).every((v) => v === 0), 'X bleibt leer');
  ok(await snap(y.id) === yBefore, 'Y unverändert');
  await as(U.C);
  ok(/Gruppe nicht gefunden/.test(await err(...DEL('00000000-0000-4000-8000-0000000000ff', 'egal')) || ''), 'unbekannte Gruppe');
});

// ---------------------------------------------------------------- Rückwärts
check('Rückwärts-Block der Migration läuft und entfernt alle drei Funktionen', async () => {
  const text = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
  const block = text.split('RÜCKWÄRTS-BEGINN')[1].split('-- RÜCKWÄRTS-ENDE')[0]
    .split('\n').filter((l) => l.startsWith('-- ')).map((l) => l.slice(3)).join('\n');
  await su();
  await db.exec(block);
  ok(await n(`select count(*)::int n from pg_proc where proname in ('delete_playgroup', 'playgroup_files', '_playgroup_delete_guard')`) === 0);
  ok(await n(`select count(*)::int n from pg_proc where proname = 'purge_playgroup'`) === 1, 'purge_playgroup (E3-P12) bleibt');
});
