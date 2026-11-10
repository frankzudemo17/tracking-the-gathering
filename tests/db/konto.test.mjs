// DB-Fälle P12 „Konto löschen“ (Migration 20261112000000_konto.sql) — spec-p12-konto.md, Abnahme 2 (a)–(h)
// plus Negativraum (mehrere Gruppen, übernommene Platzhalter-Decks, Ersteller fremder Sessions/Spiele,
// offenes Live-Spiel, Konto ohne Gruppe, Doppelklick) und Atomarität (Risiko 1).
// EIN Szenario auf EINER Datenbank, Fälle laufen in Reihenfolge. Dazu (Nacharbeit Review 651275):
// Probelauf check_delete_my_account() (B2) und ein zweites Szenario auf eigener Datenbank
// „Deck in mehreren Gruppen“ (B1) samt Erbe nach Beitritt (coalesce(claimed_at, created_at)).
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
const EXPECTED = 28;
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
  await m2?.db.close();
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
const CHECK = `select check_delete_my_account()`;

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
  await su(); await q(`insert into player_ratings (game_id, member_id, salt, fun) values ($1, $2, 2, 5), ($1, $3, 4, 3)`, [g1.id, mA, mB]);
  await q(`insert into deck_salt_ratings (game_id, rater_id, deck_id, salt) values ($1, $2, $3, 5)`, [g1.id, mB, D.A1]); await as(U.A);
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
  await su(); await q(`insert into player_ratings (game_id, member_id, salt) values ($1, $2, 5)`, [s1.id, mAS]); await as(U.A);
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
  ok(/permission denied/.test(await err(`select check_delete_my_account()`)), 'Probelauf anon');
});
check('(g) anonymes Konto (Live-Modus) ⇒ „Nicht angemeldet“, Konto bleibt', async () => {
  await su();
  await q(`insert into profiles (id, display_name) values ($1, 'Gast') on conflict do nothing`, [U.G]);
  await as(U.G, { anonymous: true });
  ok(/Nicht angemeldet/.test(await err(DEL)), 'anonym');
  ok(/Nicht angemeldet/.test(await err(CHECK)), 'Probelauf anonym');
  ok((await q(`select * from my_account_files()`)).length === 0, 'anonym sieht keine Dateien');
  await su();
  ok(await n(`select count(*)::int n from auth.users where id = $1`, [U.G]) === 1);
});
check('(h) Funktion ohne Parameter; fremde uid nicht übergebbar; Hilfe purge_playgroup nicht aufrufbar', async () => {
  await su();
  const fns = await q(`select proname, pronargs from pg_proc where proname in ('delete_my_account', 'check_delete_my_account', 'purge_playgroup') order by 1`);
  ok(J(fns) === J([{ proname: 'check_delete_my_account', pronargs: 0 }, { proname: 'delete_my_account', pronargs: 0 },
    { proname: 'purge_playgroup', pronargs: 1 }]), J(fns));
  ok(/does not exist/.test(await err(`select check_delete_my_account($1::uuid)`, [U.A])), 'Probelauf mit Argument');
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

// Zustand, den ein Probelauf nicht ändern darf (als Superuser)
async function world() {
  await su();
  return J({
    G: await snap(g.id), H: await snap(h.id), S: await snap(s.id), X: await snap(x.id),
    users: await q(`select id from auth.users order by id`),
    profiles: await q(`select id, avatar_path from profiles order by id`),
    members: await q(`select id, playgroup_id, profile_id, display_name, role, claim_code, avatar_path, claimed_at from members order by id`),
    groups: await q(`select id, created_by from playgroups order by id`),
    decks: await q(`select id, owner_profile_id, owner_member_id, archived, version_of from decks order by id`),
    attempts: await q(`select count(*)::int n from code_attempts`),
  });
}
check('B2 Probelauf: check_delete_my_account() gelingt für A und ändert nichts; erzwungener Fehler ⇒ Probelauf wirft', async () => {
  const w0 = await world();
  await as(U.A);
  const e = await err(CHECK);
  ok(e === null, e);
  ok(await world() === w0, 'Probelauf hat etwas geändert');
  // derselbe Fehler, an dem das echte Löschen scheitern würde, kommt beim Client an
  await su();
  await db.exec(`create function public.t_block() returns trigger language plpgsql as $$ begin raise exception 'blockiert'; end $$;
                 create trigger t_block before delete on auth.users for each row execute function public.t_block();`);
  await as(U.A);
  ok(/blockiert/.test(await err(CHECK) || ''), 'Probelauf meldet den Fehler');
  await su();
  await db.exec(`drop trigger t_block on auth.users; drop function public.t_block();`);
  ok(await world() === w0, 'nach Fehler unverändert');
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
  ok(/Konto nicht gefunden/.test(await err(CHECK)), 'Probelauf nach dem Löschen');
  ok((await q(`select * from my_account_files()`)).length === 0, 'keine Dateien mehr');
  ok(await snap(g.id) === gBefore);
});

// ---------------------------------------------------------------- B1: Deck in mehreren Gruppen (eigene Datenbank)
// Aufbau M (Zeiten per Superuser gesetzt, früheste zuerst):
//   S  (−5 d): A allein, Deck AS gespielt (S fällt in Schritt a weg).
//   G4 (−4 d): D Admin, A Mitglied, A spielt AE und AF; danach ist A dort ausgetreten
//              (Mitgliedschaft ohne Konto) ⇒ Platzhalter muss neu entstehen, EINER für beide Decks.
//   G1 (−3 d, −1 d): A Admin, B; A spielt AD (−3 d) und AE (−1 d).
//   G2 (−2 d, −1 d): C Admin, A Mitglied; A spielt AD (−2 d, C bewertet AD salzig) und AS (−1 d).
//   G5: A Admin; Platzhalter Pia (angelegt −10 d), B tritt bei (−5 d), E übernimmt Pia (−1 d).
// Erwartet nach A löscht: AD Original bei A@G1, Kopie bei A@G2 · AE Original beim neuen Platzhalter
// in G4, Kopie bei A@G1 · AF beim selben Platzhalter in G4 · AS Original bei A@G2, keine Kopie ·
// G5-Admin = B (Beitritt −5 d vor Übernahme −1 d).
const E = 'ffffffff-0000-4000-8000-000000000007';
const M = {};
let m2;
const mq = (sql, params) => m2.q(sql, params);
const mn = async (sql, params) => (await mq(sql, params))[0].n;
const mstart = (group, players) => mq(START, [group, J(players)]).then((r) => r[0]);
const mfinish = (game, results) => mq(`select * from finish_game($1, 'finished', 3, $2::jsonb)`, [game, J(results)]);
const mdeck = async (owner, name) =>
  (await mq(`insert into decks (owner_profile_id, commander_name, short_name, image_url, field_mode, field_color, counter_pins, bracket)
             values ($1, $2, $2, $3, 'color', '#336699', array['poison'], 4) returning id`, [owner, name, `https://x.test/${name}.jpg`]))[0].id;
// Spielbezogenes einer Gruppe; withDeck = false lässt deck_id weg (Vergleich über die Kopie hinweg)
async function msnap(gid, withDeck = true) {
  await m2.su();
  const rows = (sql) => mq(sql, [gid]);
  return J({
    games: await rows(`select id, status, started_at from games where playgroup_id = $1 order by id`),
    gp: await rows(`select gp.game_id, gp.member_id, ${withDeck ? 'gp.deck_id,' : ''} gp.seat, gp.place, gp.eliminated_by
                    from game_players gp join games g on g.id = gp.game_id where g.playgroup_id = $1 order by 1, 2`),
    salt: await rows(`select r.game_id, r.rater_id, ${withDeck ? 'r.deck_id,' : ''} r.salt
                      from deck_salt_ratings r join games g on g.id = r.game_id where g.playgroup_id = $1 order by 1, 2`),
    stats: await rows(`select member_id, games, wins, points from v_member_stats where playgroup_id = $1 order by member_id`),
  });
}
// Sichtprüfung wie game-store.js: Decks der Spiele einer Gruppe per RLS lesen (Rolle authenticated)
async function visibleDecks(uid, gid) {
  await m2.as(uid);
  const ids = (await mq(`select distinct gp.deck_id from game_players gp join games g on g.id = gp.game_id
                         where g.playgroup_id = $1 and gp.deck_id is not null`, [gid])).map((r) => r.deck_id);
  const seen = (await mq(`select id from decks where id = any($1)`, [ids])).map((r) => r.id);
  return { ids: ids.length, seen: seen.length };
}
// Invariante „kein Deck hängt an zwei Gruppen“: jedes Platzhalter-Deck in Spielen/Bewertungen gehört
// einem Mitglied genau der Gruppe des Spiels
const CROSS = `select count(*)::int n from (
  select g.playgroup_id gg, x.playgroup_id dg from game_players gp join games g on g.id = gp.game_id
    join decks d on d.id = gp.deck_id join members x on x.id = d.owner_member_id
  union all
  select g.playgroup_id, x.playgroup_id from deck_salt_ratings r join games g on g.id = r.game_id
    join decks d on d.id = r.deck_id join members x on x.id = d.owner_member_id) t where gg <> dg`;
let mBefore;

check('B1 Aufbau M: Decks von A in S, G4, G1, G2 gespielt; G5 mit übernommenem Platzhalter', async () => {
  const mdb = await freshDb();
  m2 = { db: mdb, ...tools(mdb) };
  const { as: mas, su: msu } = m2;
  await msu();
  await mq(`insert into auth.users (id, email) values ($1,'a@x.de'), ($2,'b@x.de'), ($3,'c@x.de'), ($4,'d@x.de'), ($5,'e@x.de')`,
    [U.A, U.B, U.C, U.D, E]);
  const mid = async (gid) => (await mq(`select my_member_id($1) id`, [gid]))[0].id;
  // Gruppen und Mitgliedschaften
  await mas(U.A);
  [M.S] = await mq(`select * from create_playgroup('S')`); M.aS = await mid(M.S.id);
  const [sTom] = await mq(`select * from create_placeholder($1, 'Tom')`, [M.S.id]);
  M.sTomDeck = (await mq(`insert into decks (owner_member_id, commander_name, short_name) values ($1,'TT','TT') returning id`, [sTom.id]))[0].id;
  [M.G1] = await mq(`select * from create_playgroup('G1')`); M.a1 = await mid(M.G1.id);
  [M.G5] = await mq(`select * from create_playgroup('G5')`); M.a5 = await mid(M.G5.id);
  [M.pia] = await mq(`select * from create_placeholder($1, 'Pia')`, [M.G5.id]);
  M.AD = await mdeck(U.A, 'AD'); M.AE = await mdeck(U.A, 'AE'); M.AF = await mdeck(U.A, 'AF'); M.AS = await mdeck(U.A, 'AS');
  await mas(U.B);
  [{ id: M.b1 }] = await mq(`select * from join_playgroup($1)`, [M.G1.invite_code]);
  [{ id: M.b5 }] = await mq(`select * from join_playgroup($1)`, [M.G5.invite_code]);
  M.BD = await mdeck(U.B, 'BD');
  await mas(E);
  const [claimed] = await mq(`select * from claim_member($1)`, [M.pia.claim_code]);
  ok(claimed.id === M.pia.id, 'E übernimmt Pia');
  await mas(U.C);
  [M.G2] = await mq(`select * from create_playgroup('G2')`); M.c2 = await mid(M.G2.id);
  M.CD = await mdeck(U.C, 'CD');
  await mas(U.D);
  [M.G4] = await mq(`select * from create_playgroup('G4')`); M.d4 = await mid(M.G4.id);
  M.DD = await mdeck(U.D, 'DD');
  await mas(U.A);
  [{ id: M.a2 }] = await mq(`select * from join_playgroup($1)`, [M.G2.invite_code]);
  [{ id: M.a4 }] = await mq(`select * from join_playgroup($1)`, [M.G4.invite_code]);
  // Spiele (A startet)
  const play = async (key, gid, aMem, aDeck, oMem, oDeck, aWins) => {
    M[key] = await mstart(gid, [P(aMem, aDeck, 0), P(oMem, oDeck, 1)]);
    await mfinish(M[key].id, aWins ? [R(aMem, 1), R(oMem, 2, aMem)] : [R(oMem, 1), R(aMem, 2, oMem)]);
  };
  await play('s9', M.S.id, M.aS, M.AS, sTom.id, M.sTomDeck, true);
  await play('w1', M.G4.id, M.a4, M.AE, M.d4, M.DD, true);
  await play('w2', M.G4.id, M.a4, M.AF, M.d4, M.DD, false);
  await play('y1', M.G1.id, M.a1, M.AD, M.b1, M.BD, true);
  await play('y2', M.G1.id, M.a1, M.AE, M.b1, M.BD, false);
  await play('z1', M.G2.id, M.a2, M.AD, M.c2, M.CD, false);
  await play('z2', M.G2.id, M.a2, M.AS, M.c2, M.CD, true);
  await mas(U.C);
  await msu(); await mq(`insert into deck_salt_ratings (game_id, rater_id, deck_id, salt) values ($1, $2, $3, 4)`, [M.z1.id, M.c2, M.AD]);
  // Zeiten, Austritt aus G4, Beitritt/Übernahme in G5
  await msu();
  const ago = (game, d) => mq(`update games set started_at = now() - make_interval(days => $2) where id = $1`, [game, d]);
  await ago(M.s9.id, 5); await ago(M.w1.id, 4); await ago(M.w2.id, 4); await ago(M.y1.id, 3);
  await ago(M.z1.id, 2); await ago(M.y2.id, 1); await ago(M.z2.id, 1);
  await mq(`update members set profile_id = null, display_name = 'Ausgetreten' where id = $1`, [M.a4]);
  await mq(`update members set created_at = now() - interval '20 days' where id = $1`, [M.a5]);
  await mq(`update members set created_at = now() - interval '10 days', claimed_at = now() - interval '1 day' where id = $1`, [M.pia.id]);
  await mq(`update members set created_at = now() - interval '5 days' where id = $1`, [M.b5]);
  mBefore = { G1: await msnap(M.G1.id, false), G2: await msnap(M.G2.id, false), G4: await msnap(M.G4.id, false),
    seeC: await visibleDecks(U.C, M.G2.id), seeB: await visibleDecks(U.B, M.G1.id), seeD: await visibleDecks(U.D, M.G4.id) };
  // D sieht AE/AF vorher NICHT: A ist aus G4 ausgetreten, teilt dort keine Gruppe mehr mit D
  ok(J([mBefore.seeC, mBefore.seeB, mBefore.seeD]) === J([{ ids: 3, seen: 3 }, { ids: 3, seen: 3 }, { ids: 3, seen: 1 }]),
    J([mBefore.seeC, mBefore.seeB, mBefore.seeD]));
});
check('B1 (i) A löscht: AD-Original bleibt in G1, inhaltsgleiche Kopie in G2, G2-Verweise auf der Kopie, kein Deck an zwei Gruppen', async () => {
  await m2.as(U.A);
  const e = await m2.err(DEL);
  ok(e === null, e);
  await m2.su();
  const cols = 'commander_name, short_name, image_url, field_mode, field_color, counter_pins, bracket, archived, owner_profile_id';
  const ad = await mq(`select id, owner_member_id, ${cols} from decks where commander_name = 'AD' order by owner_member_id = $1 desc`, [M.a1]);
  ok(ad.length === 2, J(ad));
  ok(ad[0].id === M.AD && ad[0].owner_member_id === M.a1, 'Original bei A@G1');
  ok(ad[1].id !== M.AD && ad[1].owner_member_id === M.a2, 'Kopie bei A@G2');
  const strip = ({ id: _i, owner_member_id: _o, ...rest }) => J(rest);
  ok(strip(ad[0]) === strip(ad[1]) && ad[1].archived === true && ad[1].owner_profile_id === null, 'Kopie inhaltsgleich, archiviert');
  M.ADcopy = ad[1].id;
  ok((await mq(`select deck_id from game_players where game_id = $1 and member_id = $2`, [M.z1.id, M.a2]))[0].deck_id === M.ADcopy, 'z1 → Kopie');
  ok((await mq(`select deck_id from deck_salt_ratings where game_id = $1`, [M.z1.id]))[0].deck_id === M.ADcopy, 'Salz-Bewertung → Kopie');
  ok((await mq(`select deck_id from game_players where game_id = $1 and member_id = $2`, [M.y1.id, M.a1]))[0].deck_id === M.AD, 'y1 bleibt beim Original');
  ok(await mn(CROSS) === 0, 'Deck an zwei Gruppen');
  ok(await msnap(M.G1.id, false) === mBefore.G1 && await msnap(M.G2.id, false) === mBefore.G2 && await msnap(M.G4.id, false) === mBefore.G4,
    'Spiele/Plätze/Bewertungen/Statistik sonst unverändert');
});
check('B1 (i) Sichtprüfung als authenticated: C (G2), B (G1), D (G4) sehen alle Decks ihrer Spiele (D jetzt auch AE/AF)', async () => {
  const seen = [await visibleDecks(U.C, M.G2.id), await visibleDecks(U.B, M.G1.id), await visibleDecks(U.D, M.G4.id)];
  ok(J(seen) === J([{ ids: 3, seen: 3 }, { ids: 3, seen: 3 }, { ids: 3, seen: 3 }]), J(seen));
  await m2.as(U.C);
  ok((await mq(`select id from decks where id = $1`, [M.ADcopy])).length === 1, 'C sieht die G2-Kopie von AD');
});
check('B1 Kanten: A aus G4 ausgetreten ⇒ EIN neuer Platzhalter für AE+AF; früheste Gruppe S mitgelöscht ⇒ AS ohne Kopie in G2', async () => {
  await m2.su();
  const ph = await mq(`select id from members where playgroup_id = $1 and display_name = 'Ehemaliges Mitglied'`, [M.G4.id]);
  ok(ph.length === 1, J(ph));
  const ae = await mq(`select id, owner_member_id from decks where commander_name = 'AE' order by id = $1 desc`, [M.AE]);
  ok(ae.length === 2 && ae[0].owner_member_id === ph[0].id && ae[1].owner_member_id === M.a1, J(ae));
  ok((await mq(`select deck_id from game_players where game_id = $1 and member_id = $2`, [M.y2.id, M.a1]))[0].deck_id === ae[1].id, 'y2 → AE-Kopie');
  ok((await mq(`select deck_id from game_players where game_id = $1 and member_id = $2`, [M.w1.id, M.a4]))[0].deck_id === M.AE, 'w1 → Original');
  const af = await mq(`select id, owner_member_id from decks where commander_name = 'AF'`);
  ok(J(af) === J([{ id: M.AF, owner_member_id: ph[0].id }]), J(af));
  const as_ = await mq(`select id, owner_member_id from decks where commander_name = 'AS'`);
  ok(J(as_) === J([{ id: M.AS, owner_member_id: M.a2 }]), J(as_));
  ok(await mn(`select count(*)::int n from playgroups where id = $1`, [M.S.id]) === 0, 'S gelöscht');
});
check('Wunsch 3: Erbe nach Beitritt (coalesce(claimed_at, created_at)) ⇒ B vor dem spät übernommenen Platzhalter', async () => {
  await m2.su();
  const roles = await mq(`select id, role from members where playgroup_id = $1 and profile_id is not null order by id`, [M.G5.id]);
  ok(J(roles) === J([{ id: M.b5, role: 'admin' }, { id: M.pia.id, role: 'member' }].sort((a, b) => a.id.localeCompare(b.id))), J(roles));
  ok((await mq(`select created_by from playgroups where id = $1`, [M.G5.id]))[0].created_by === U.B, 'G5 created_by');
});
check('B1 (ii) B löscht danach (letztes Konto in G1) ⇒ G1 weg ohne FK-Fehler, G2 unverändert, C sieht weiter', async () => {
  const g2 = await msnap(M.G2.id);
  await m2.as(U.B);
  const e = await m2.err(DEL);
  ok(e === null, e);
  await m2.su();
  ok(await mn(`select count(*)::int n from playgroups where id = $1`, [M.G1.id]) === 0, 'G1');
  ok(await mn(`select count(*)::int n from auth.users where id = $1`, [U.B]) === 0, 'B');
  ok(await msnap(M.G2.id) === g2, 'G2 unverändert');
  ok(J(await visibleDecks(U.C, M.G2.id)) === J(mBefore.seeC), 'C sieht G2-Decks');
  await m2.su();
  ok((await mq(`select role from members where id = $1`, [M.pia.id]))[0].role === 'admin', 'E erbt G5');
});
check('B1 (ii) C und D löschen danach (letzte Konten in G2/G4) ⇒ ohne FK-Fehler, nur E und G5 bleiben', async () => {
  for (const uid of [U.C, U.D]) {
    await m2.as(uid);
    const e = await m2.err(DEL);
    ok(e === null, `${uid}: ${e}`);
  }
  await m2.su();
  ok(J(await mq(`select id from playgroups order by id`)) === J([{ id: M.G5.id }]), 'nur G5');
  ok(J(await mq(`select id from auth.users`)) === J([{ id: E }]), 'nur E');
  ok(await mn(`select count(*)::int n from decks where commander_name in ('AD', 'AE', 'AF', 'AS')`) === 0, 'A-Decks mit ihren Gruppen weg');
  await m2.db.close();
  m2 = null;
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
check('Rückwärts-Block der Migration läuft und entfernt alle vier Funktionen', async () => {
  const text = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
  const block = text.split('RÜCKWÄRTS-BEGINN')[1].split('-- RÜCKWÄRTS-ENDE')[0]
    .split('\n').filter((l) => l.startsWith('-- ')).map((l) => l.slice(3)).join('\n');
  await su();
  await db.exec(block);
  ok(await n(`select count(*)::int n from pg_proc where proname in ('delete_my_account', 'check_delete_my_account', 'purge_playgroup', 'my_account_files')`) === 0);
});
