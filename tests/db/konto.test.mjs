// DB-Fälle P12 „Konto löschen“ (Migration 20261112000000_konto.sql) — spec-p12-konto.md, Abnahme 2 (a)–(h)
// plus Negativraum (mehrere Gruppen, übernommene Platzhalter-Decks, Ersteller fremder Sessions/Spiele,
// offenes Live-Spiel, Konto ohne Gruppe, Doppelklick) und Atomarität (Risiko 1).
// EIN Szenario auf EINER Datenbank, Fälle laufen in Reihenfolge.
//
// Aufbau:
//   G (Spec-Testgruppe): A Admin + Ersteller, B Mitglied, Platzhalter Tim (von A angelegt).
//     A-Decks A1 (gespielt), A2 (ungespielt, Version von A1); B1, T1. Zwei beendete Spiele A/B/Tim,
//     von A gestartet (Session + Spiele created_by A), mit Ereignissen und Bewertungen.
//   H: C Admin, A Mitglied. Platzhalter Kai (von A angelegt) spielt mit Deck K1 ein beendetes Spiel,
//     danach übernimmt A Kai per Code (K1 gehört dann A). Offenes Live-Spiel A (Deck A3) gegen C.
//   S: A allein mit Platzhalter Tom, ein beendetes Spiel, Spielfoto und Tom-Bild im Speicher.
//   X: D einziges Konto-Mitglied, nicht Admin, ein beendetes Spiel mit Platzhalter (Gegenprobe Spec).
//   F: Konto ohne Gruppe mit einem Deck.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshDb, tools, U, MIGRATIONS } from './harness.mjs';

const FILE = '20261112000000_konto.sql';
const EXPECTED = 20;
const F = 'ffffffff-0000-4000-8000-000000000006';
let db, as, su, q, err;
let ran = 0;
const check = (name, fn) => test(name, async () => { ran++; await fn(); });
const ok = (cond, info = '') => assert.ok(cond, info === '' ? undefined : String(info));
const n = async (sql, params) => (await q(sql, params))[0].n;
const J = (x) => JSON.stringify(x);

before(async () => {
  db = await freshDb();
  ({ as, su, q, err } = tools(db));
});
after(async () => {
  await db?.close();
  assert.equal(ran, EXPECTED, `erwartet ${EXPECTED} Prüfungen, gelaufen ${ran}`);
});

let g, h, s, x;
let mA, mB, tim, mAH, mC, kai, tom, mD, xph;
const D = {};
let g1, g2, hK, hLive, s1, x1;

const START = `select * from start_game($1, 'seiten', 40, 0, $2::jsonb, '2026-11-12')`;
const start = (group, players) => q(START, [group, J(players)]).then((r) => r[0]);
const P = (member_id, deck_id, seat) => ({ member_id, deck_id, seat });
const finish = (game, results) => q(`select * from finish_game($1, 'finished', 3, $2::jsonb)`, [game, J(results)]);
const R = (member_id, place, eliminated_by = null) => ({ member_id, place, eliminated_round: place === 1 ? null : 2, eliminated_by, final_life: place === 1 ? 12 : 0 });
const ev = (game, type, actor, source, target, amount, seq) =>
  q(`insert into game_events (game_id, round, type, actor, source, target, amount, seq) values ($1, 1, $2::event_type, $3, $4, $5, $6, $7)`,
    [game, type, actor, source, target, amount, seq]);
const deck = async (col, owner, name, extra = {}) =>
  (await q(`insert into decks (${col}, commander_name, short_name, version_of) values ($1, $2, $2, $3) returning id`, [owner, name, extra.version_of ?? null]))[0].id;
const DEL = `select delete_my_account()`;

// Momentaufnahme alles Spielbezogenen einer Gruppe (als Superuser, ohne RLS)
async function snap(gid) {
  await su();
  const rows = async (sql) => q(sql, [gid]);
  return J({
    games: await rows(`select id, status, session_id, wincon from games where playgroup_id = $1 order by id`),
    gp: await rows(`select gp.game_id, gp.member_id, gp.deck_id, gp.seat, gp.place, gp.eliminated_by, gp.final_life
                    from game_players gp join games g on g.id = gp.game_id where g.playgroup_id = $1 order by 1, 4`),
    ev: await rows(`select e.id, e.type, e.actor, e.source, e.target, e.amount, e.seq
                    from game_events e join games g on g.id = e.game_id where g.playgroup_id = $1 order by e.id`),
    pr: await rows(`select pr.* from player_ratings pr join games g on g.id = pr.game_id where g.playgroup_id = $1 order by 1, 2`),
    stats: await rows(`select member_id, games, wins, points from v_member_stats where playgroup_id = $1 order by member_id`),
  });
}
let before_G, before_H;

// ---------------------------------------------------------------- Aufbau
check('Aufbau: Gruppen G/H/S/X, Konto F, Spiele, Ereignisse, Bewertungen, Speicher-Objekte', async () => {
  await su();
  await db.query(`insert into auth.users (id, email) values ($1,'a@x.de'), ($2,'b@x.de'), ($3,'c@x.de'), ($4,'d@x.de'), ($5, null), ($6, 'f@x.de')`,
    [U.A, U.B, U.C, U.D, U.G, F]);
  // G
  await as(U.A);
  [g] = await q(`select * from create_playgroup('G')`);
  [tim] = await q(`select * from create_placeholder($1, 'Tim')`, [g.id]);
  mA = (await q(`select my_member_id($1) id`, [g.id]))[0].id;
  D.A1 = await deck('owner_profile_id', U.A, 'A1');
  D.A2 = await deck('owner_profile_id', U.A, 'A2', { version_of: D.A1 });
  D.T1 = await deck('owner_member_id', tim.id, 'T1');
  await as(U.B);
  [{ id: mB }] = await q(`select * from join_playgroup($1)`, [g.invite_code]);
  D.B1 = await deck('owner_profile_id', U.B, 'B1');
  await as(U.A);
  g1 = await start(g.id, [P(mA, D.A1, 0), P(mB, D.B1, 1), P(tim.id, D.T1, 2)]);
  await ev(g1.id, 'damage', mA, mA, mB, 7, 1);
  await ev(g1.id, 'cmd_damage', mB, mB, tim.id, 21, 2);
  await ev(g1.id, 'life', mA, null, mA, -3, 3);
  await finish(g1.id, [R(mA, 1), R(mB, 2, mA), R(tim.id, 3, mB)]);
  await q(`insert into player_ratings (game_id, member_id, salt, fun) values ($1, $2, 2, 5), ($1, $3, 4, 3)`, [g1.id, mA, mB]);
  await q(`insert into deck_salt_ratings (game_id, rater_id, deck_id, salt) values ($1, $2, $3, 5)`, [g1.id, mB, D.A1]);
  g2 = await start(g.id, [P(mA, D.A1, 0), P(mB, D.B1, 1), P(tim.id, D.T1, 2)]);
  await ev(g2.id, 'poison', tim.id, tim.id, mA, 10, 1);
  await finish(g2.id, [R(tim.id, 1), R(mA, 2, tim.id), R(mB, 3, tim.id)]);
  // H
  await as(U.C);
  [h] = await q(`select * from create_playgroup('H')`);
  mC = (await q(`select my_member_id($1) id`, [h.id]))[0].id;
  D.C1 = await deck('owner_profile_id', U.C, 'C1');
  await as(U.A);
  [{ id: mAH }] = await q(`select * from join_playgroup($1)`, [h.invite_code]);
  [kai] = await q(`select * from create_placeholder($1, 'Kai')`, [h.id]);
  D.K1 = await deck('owner_member_id', kai.id, 'K1');
  D.A3 = await deck('owner_profile_id', U.A, 'A3');
  await as(U.C);
  hK = await start(h.id, [P(mC, D.C1, 0), P(kai.id, D.K1, 1)]);
  await ev(hK.id, 'damage', kai.id, kai.id, mC, 40, 1);
  await finish(hK.id, [R(kai.id, 1), R(mC, 2, kai.id)]);
  await as(U.A);
  const [claimed] = await q(`select * from claim_member($1)`, [kai.claim_code]);
  ok(claimed.id === mAH, 'Kai in A-Mitgliedschaft H übernommen');
  ok((await q(`select owner_profile_id from decks where id = $1`, [D.K1]))[0].owner_profile_id === U.A, 'K1 gehört jetzt A');
  await su();
  await q(`update games set started_at = now() - interval '2 hours' where id = $1`, [hK.id]);
  await as(U.C);
  hLive = await start(h.id, [P(mC, D.C1, 0), P(mAH, D.A3, 1)]);
  await ev(hLive.id, 'damage', mAH, mAH, mC, 5, 1);
  // S
  await as(U.A);
  [s] = await q(`select * from create_playgroup('S')`);
  [tom] = await q(`select * from create_placeholder($1, 'Tom')`, [s.id]);
  D.O1 = await deck('owner_member_id', tom.id, 'O1');
  D.A4 = await deck('owner_profile_id', U.A, 'A4');
  const mAS = (await q(`select my_member_id($1) id`, [s.id]))[0].id;
  s1 = await start(s.id, [P(mAS, D.A4, 0), P(tom.id, D.O1, 1)]);
  await ev(s1.id, 'damage', tom.id, tom.id, mAS, 40, 1);
  await finish(s1.id, [R(tom.id, 1), R(mAS, 2, tom.id)]);
  await q(`insert into player_ratings (game_id, member_id, salt) values ($1, $2, 5)`, [s1.id, mAS]);
  // X: D allein, nicht Admin (z. B. nachdem der Admin entfernt wurde)
  await as(U.D);
  [x] = await q(`select * from create_playgroup('X')`);
  mD = (await q(`select my_member_id($1) id`, [x.id]))[0].id;
  [xph] = await q(`select * from create_placeholder($1, 'Xaver')`, [x.id]);
  D.D1 = await deck('owner_profile_id', U.D, 'D1');
  D.X1 = await deck('owner_member_id', xph.id, 'X1');
  x1 = await start(x.id, [P(mD, D.D1, 0), P(xph.id, D.X1, 1)]);
  await finish(x1.id, [R(mD, 1), R(xph.id, 2, mD)]);
  await su();
  await q(`update members set role = 'member' where id = $1`, [mD]);
  // F: ohne Gruppe
  await as(F);
  D.F1 = await deck('owner_profile_id', F, 'F1');
  // Speicher (Profilbilder, Platzhalter-Bilder, Spielfotos) und Versuchsbremse
  await su();
  await q(`insert into storage.objects (bucket_id, name) values
    ('avatars', $1), ('avatars', $2), ('avatars', $3), ('avatars', $4), ('game-photos', $5), ('game-photos', $6)`,
  [`profiles/${U.A}/avatar.jpg`, `profiles/${U.B}/avatar.jpg`, `members/${tim.id}/avatar.jpg`, `members/${tom.id}/avatar.jpg`,
    `${s.id}/${s1.id}.jpg`, `${g.id}/${g1.id}.jpg`]);
  await q(`update profiles set avatar_path = $2 where id = $1`, [U.A, `profiles/${U.A}/avatar.jpg`]);
  await q(`insert into code_attempts (user_id, kind) values ($1, 'join'), ($2, 'join')`, [U.A, U.B]);
  before_G = await snap(g.id);
  before_H = await snap(h.id);
  ok(Object.keys(D).length === 12);
});

// ---------------------------------------------------------------- (g)/(h) Rechte zuerst (nichts darf passieren)
check('(g) anon ohne Login ⇒ keine Ausführungsrechte (delete_my_account, my_account_files)', async () => {
  await as(null);
  ok(/permission denied/.test(await err(DEL)), 'delete anon');
  ok(/permission denied/.test(await err(`select * from my_account_files()`)), 'files anon');
});
check('(g) anonymes Konto (Live-Modus) ⇒ „Nicht angemeldet“, Konto bleibt', async () => {
  await su();
  await q(`insert into profiles (id, display_name) values ($1, 'Gast') on conflict do nothing`, [U.G]);
  await as(U.G, { anonymous: true });
  ok(/Nicht angemeldet/.test(await err(DEL)), 'anonym');
  ok((await q(`select * from my_account_files()`)).length === 0, 'anonym sieht keine Dateien');
  await su();
  ok(await n(`select count(*)::int n from auth.users where id = $1`, [U.G]) === 1);
});
check('(h) Funktion ohne Parameter; fremde uid nicht übergebbar; Hilfe purge_playgroup nicht aufrufbar', async () => {
  await su();
  const fns = await q(`select proname, pronargs from pg_proc where proname in ('delete_my_account', 'purge_playgroup') order by 1`);
  ok(J(fns) === J([{ proname: 'delete_my_account', pronargs: 0 }, { proname: 'purge_playgroup', pronargs: 1 }]), J(fns));
  await as(U.B);
  ok(/does not exist/.test(await err(`select delete_my_account($1::uuid)`, [U.A])), 'mit Argument');
  ok(/permission denied/.test(await err(`select purge_playgroup($1)`, [g.id])), 'purge für authenticated');
  await su();
  ok(await n(`select count(*)::int n from auth.users`) === 6, 'niemand gelöscht');
});
check('Atomarität (Risiko 1): Fehler im letzten Schritt ⇒ nichts geändert', async () => {
  await su();
  await db.exec(`create function public.t_block() returns trigger language plpgsql as $$ begin raise exception 'blockiert'; end $$;
                 create trigger t_block before delete on auth.users for each row execute function public.t_block();`);
  await as(U.A);
  ok(/blockiert/.test(await err(DEL)), 'Fehler kommt durch');
  await su();
  await db.exec(`drop trigger t_block on auth.users; drop function public.t_block();`);
  ok(await snap(g.id) === before_G && await snap(h.id) === before_H, 'G/H unverändert');
  ok(await n(`select count(*)::int n from members where profile_id = $1`, [U.A]) === 3, 'A noch in G, H, S');
  ok(await n(`select count(*)::int n from playgroups where id = $1`, [s.id]) === 1, 'S noch da');
  ok(await n(`select count(*)::int n from decks where owner_profile_id = $1`, [U.A]) === 5, 'A1–A4 + K1 noch bei A');
});

// ---------------------------------------------------------------- Dateien vor dem Löschen
check('my_account_files: eigenes Profilbild + Bild/Foto der mitgelöschten Gruppe S, nichts Fremdes', async () => {
  await as(U.A);
  const files = await q(`select bucket, path from my_account_files()`);
  ok(J(files) === J([
    { bucket: 'avatars', path: `members/${tom.id}/avatar.jpg` },
    { bucket: 'avatars', path: `profiles/${U.A}/avatar.jpg` },
    { bucket: 'game-photos', path: `${s.id}/${s1.id}.jpg` },
  ].sort((a, b) => (a.bucket + a.path).localeCompare(b.bucket + b.path))), J(files));
  // Client löscht per Storage-API = DELETE unter den Storage-Policies als A
  for (const f of files) await q(`delete from storage.objects where bucket_id = $1 and name = $2`, [f.bucket, f.path]);
  await su();
  const left = await q(`select bucket_id, name from storage.objects order by 1, 2`);
  ok(left.length === 3 && !left.some((o) => files.some((f) => f.path === o.name)), J(left));
});

// ---------------------------------------------------------------- A löscht sein Konto
check('(a) A löscht: keine FK-Fehler, auth.users-Zeile und Profil weg', async () => {
  await as(U.A);
  const e = await err(DEL);
  ok(e === null, e);
  await su();
  ok(await n(`select count(*)::int n from auth.users where id = $1`, [U.A]) === 0, 'auth.users');
  ok(await n(`select count(*)::int n from profiles where id = $1`, [U.A]) === 0, 'profiles');
  ok(await n(`select count(*)::int n from members where profile_id = $1`, [U.A]) === 0, 'members');
  ok(await n(`select count(*)::int n from code_attempts where user_id = $1`, [U.A]) === 0, 'code_attempts A');
  ok(await n(`select count(*)::int n from code_attempts where user_id = $1`, [U.B]) === 1, 'code_attempts B bleibt');
});
check('(b) Spiele/Ereignisse/Ergebnisse/Statistik der anderen unverändert (G und H, Zählung + Inhalt)', async () => {
  ok(await snap(g.id) === before_G, 'G');
  ok(await snap(h.id) === before_H, 'H');
  await su();
  const c = await q(`select (select count(*) from games where playgroup_id = $1)::int ga,
    (select count(*) from game_players gp join games x on x.id = gp.game_id where x.playgroup_id = $1)::int gp`, [g.id]);
  ok(J(c) === J([{ ga: 2, gp: 6 }]), J(c));
});
check('(c) A-Mitgliedschaften sind „Ehemaliges Mitglied“: ohne Konto, Bild, Code, Rolle member', async () => {
  await su();
  const rows = await q(`select id, profile_id, display_name, claim_code, avatar_path, role, claimed_at from members where id = any($1) order by id`, [[mA, mAH]]);
  ok(rows.length === 2, J(rows));
  for (const r of rows) {
    ok(r.profile_id === null && r.display_name === 'Ehemaliges Mitglied' && r.claim_code === null && r.avatar_path === null
      && r.role === 'member' && r.claimed_at === null, J(r));
  }
});
check('(d) letzter Admin ⇒ B Admin von G und Ersteller; in H bleibt C Admin', async () => {
  await su();
  const roles = await q(`select id, role from members where playgroup_id = $1 and profile_id is not null order by id`, [g.id]);
  ok(J(roles) === J([{ id: mB, role: 'admin' }]), J(roles));
  ok((await q(`select created_by from playgroups where id = $1`, [g.id]))[0].created_by === U.B, 'G created_by');
  const hr = await q(`select role from members where id = $1`, [mC]);
  ok(hr[0].role === 'admin' && (await q(`select created_by from playgroups where id = $1`, [h.id]))[0].created_by === U.C);
});
check('(e) S (A einziges Konto-Mitglied, mit beendetem Spiel) samt Inhalt gelöscht', async () => {
  await su();
  ok(await n(`select count(*)::int n from playgroups where id = $1`, [s.id]) === 0, 'Gruppe');
  ok(await n(`select count(*)::int n from members where playgroup_id = $1`, [s.id]) === 0, 'Mitglieder');
  ok(await n(`select count(*)::int n from games where id = $1`, [s1.id]) === 0, 'Spiel');
  ok(await n(`select count(*)::int n from game_events where game_id = $1`, [s1.id]) === 0, 'Ereignisse');
  ok(await n(`select count(*)::int n from player_ratings where game_id = $1`, [s1.id]) === 0, 'Bewertungen');
  ok(await n(`select count(*)::int n from decks where id = any($1)`, [[D.O1, D.A4]]) === 0, 'Decks Tom + A4');
  ok(await n(`select count(*)::int n from sessions where playgroup_id = $1`, [s.id]) === 0, 'Sessions');
});
check('(f) Decks: gespielte archiviert + an Ehemaliges Mitglied gehängt, ungespielte gelöscht', async () => {
  await su();
  const rows = await q(`select id, owner_profile_id, owner_member_id, archived from decks where id = any($1) order by short_name`, [[D.A1, D.A2, D.A3, D.K1]]);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  ok(J(by[D.A1]) === J({ id: D.A1, owner_profile_id: null, owner_member_id: mA, archived: true }), J(by[D.A1]));
  ok(!by[D.A2], 'A2 (ungespielt) weg');
  ok(J(by[D.A3]) === J({ id: D.A3, owner_profile_id: null, owner_member_id: mAH, archived: true }), 'A3 (Live-Spiel H)');
  ok(J(by[D.K1]) === J({ id: D.K1, owner_profile_id: null, owner_member_id: mAH, archived: true }), 'K1 (übernommen, gespielt in H)');
  ok(await n(`select count(*)::int n from decks where owner_profile_id is null and owner_member_id is null`) === 0);
});
check('Negativraum: Ersteller-Verweise auf A geleert (Sessions, Spiele, Platzhalter)', async () => {
  await su();
  ok(await n(`select count(*)::int n from sessions where created_by = $1`, [U.A]) === 0);
  ok(await n(`select count(*)::int n from games where created_by = $1`, [U.A]) === 0);
  ok(await n(`select count(*)::int n from members where created_by = $1`, [U.A]) === 0);
  ok((await q(`select created_by from members where id = $1`, [tim.id]))[0].created_by === null, 'Tim');
  ok((await q(`select created_by from games where id = $1`, [hLive.id]))[0].created_by === U.C, 'Spiel von C bleibt bei C');
});
check('Negativraum: offenes Live-Spiel in H läuft weiter (C schreibt Ereignis mit A-Platzhalter als Ziel)', async () => {
  await as(U.C);
  ok((await q(`select status from games where id = $1`, [hLive.id]))[0].status === 'live');
  const e = await err(`insert into game_events (game_id, round, type, actor, source, target, amount, seq) values ($1, 2, 'damage', $2, $2, $3, 3, 2)`, [hLive.id, mC, mAH]);
  ok(e === null, e);
  const [r] = await q(`select * from finish_game($1, 'finished', 2, $2::jsonb)`, [hLive.id, J([R(mC, 1), R(mAH, 2, mC)])]);
  ok(r.status === 'finished');
});
check('Doppelklick: zweiter Aufruf mit demselben Token ⇒ „Konto nicht gefunden“, nichts weiter', async () => {
  const gBefore = await snap(g.id);
  await as(U.A);
  ok(/Konto nicht gefunden/.test(await err(DEL)), 'zweiter Aufruf');
  ok((await q(`select * from my_account_files()`)).length === 0, 'keine Dateien mehr');
  ok(await snap(g.id) === gBefore);
});

// ---------------------------------------------------------------- Gegenproben
check('Gegenprobe Spec: D (nicht Admin) einziges Konto-Mitglied von X ⇒ X samt Spiel gelöscht', async () => {
  await as(U.D);
  const e = await err(DEL);
  ok(e === null, e);
  await su();
  ok(await n(`select count(*)::int n from playgroups where id = $1`, [x.id]) === 0, 'X');
  ok(await n(`select count(*)::int n from games where id = $1`, [x1.id]) === 0, 'Spiel');
  ok(await n(`select count(*)::int n from decks where id = any($1)`, [[D.D1, D.X1]]) === 0, 'Decks');
  ok(await n(`select count(*)::int n from auth.users where id = $1`, [U.D]) === 0, 'Konto');
});
check('Negativraum: Konto ohne Gruppe (F) löschen ⇒ Deck weg, Konto weg', async () => {
  await as(F);
  const e = await err(DEL);
  ok(e === null, e);
  await su();
  ok(await n(`select count(*)::int n from decks where id = $1`, [D.F1]) === 0);
  ok(await n(`select count(*)::int n from auth.users where id = $1`, [F]) === 0);
});
check('B löscht danach: G hat kein Konto-Mitglied mehr ⇒ G samt Spielen gelöscht, keine FK-Fehler', async () => {
  await as(U.B);
  const e = await err(DEL);
  ok(e === null, e);
  await su();
  ok(await n(`select count(*)::int n from playgroups where id = $1`, [g.id]) === 0, 'G');
  ok(await n(`select count(*)::int n from games where playgroup_id = $1`, [g.id]) === 0, 'Spiele G');
  ok(await n(`select count(*)::int n from decks where id = any($1)`, [[D.A1, D.B1, D.T1]]) === 0, 'Decks G');
  ok(await n(`select count(*)::int n from playgroups where id = $1`, [h.id]) === 1, 'H bleibt');
  ok(await n(`select count(*)::int n from auth.users`) === 2, 'C + Gast übrig');
});
check('Gegenprobe Migration: ohne 20261112000000_konto.sql gibt es delete_my_account nicht', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttg-p12-ohne-'));
  let old;
  try {
    for (const f of fs.readdirSync(MIGRATIONS)) if (f.endsWith('.sql') && f !== FILE) fs.copyFileSync(path.join(MIGRATIONS, f), path.join(dir, f));
    old = await freshDb({ migrations: dir });
    const e = await old.query(DEL).then(() => null, (x) => x.message);
    ok(/does not exist/.test(e || ''), e);
  } finally {
    await old?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
check('Rückwärts-Block der Migration läuft und entfernt alle drei Funktionen', async () => {
  const text = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
  const block = text.split('RÜCKWÄRTS-BEGINN')[1].split('-- RÜCKWÄRTS-ENDE')[0]
    .split('\n').filter((l) => l.startsWith('-- ')).map((l) => l.slice(3)).join('\n');
  await su();
  await db.exec(block);
  ok(await n(`select count(*)::int n from pg_proc where proname in ('delete_my_account', 'purge_playgroup', 'my_account_files')`) === 0);
});
