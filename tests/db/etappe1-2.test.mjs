// Bestandsprüfungen Etappe 1–2 (Schema, RLS, RPCs, Storage) — die 64 Prüfungen aus
// test-entwurf/dbtest.mjs, Inhalt und Sollwerte unverändert, je Prüfung ein node:test-Fall.
// Einzige Anpassung: „Look burgund erlaubt“ → „Look lachs erlaubt“ (WELLE.md: Burgund liest
// als Lachs, Migration 20261110010000_lachs.sql).
// Die Fälle bilden EIN zusammenhängendes Szenario auf EINER Datenbank und laufen in Reihenfolge
// (node:test führt Fälle einer Datei nacheinander aus). Schritte stehen im Fall der Prüfung,
// die als nächste auf sie folgt. Wirft ein Schritt, wird der Fall rot.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, tools, U } from './harness.mjs';

const EXPECTED = 64;
let db, as, su, q, err;
let ran = 0;
const check = (name, fn) => test(name, async () => { ran++; await fn(); });
const ok = (cond, info = '') => assert.ok(cond, info === '' ? undefined : String(info));

before(async () => {
  db = await freshDb();
  ({ as, su, q, err } = tools(db));
});
after(async () => {
  await db?.close();
  // Schutz: bricht das Szenario still ab, darf die Zahl nicht schrumpfen und trotzdem grün sein.
  assert.equal(ran, EXPECTED, `erwartet ${EXPECTED} Prüfungen, gelaufen ${ran}`);
});

// geteilter Zustand des Szenarios
let profs, g, mc, tim, oe, x, deckA, game, game2, meA, meB, claimed, res, merged, dm, pts, ph2, e, upd, lim, wrong, promo, again, still;

// ---------------------------------------------------------------- Profile
check('5 Profile per Trigger', async () => {
  await su();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values
    ($1,'franco@x.de','{"display_name":"Franco"}'), ($2,'luka@x.de','{}'), ($3,'marie@x.de','{"display_name":"   "}'),
    ($4,'tim@x.de','{"display_name":"Tim der sehr sehr lange Name der viel zu lang ist für alles"}'), ($5,null,'{}')`,
  [U.A, U.B, U.C, U.D, U.G]);
  profs = await q(`select id, display_name from profiles order by id`);
  ok(profs.length === 5);
});
check('Leerer Anzeigename → E-Mail-Teil', () => ok(profs.find((p) => p.id === U.C).display_name === 'marie'));
check('Langer Name auf 40 gekürzt', () => ok(profs.find((p) => p.id === U.D).display_name.length === 40));
check('Ohne E-Mail → Gast', () => ok(profs.find((p) => p.id === U.G).display_name === 'Gast'));

// ---------------------------------------------------------------- Gruppen
check('Gruppe angelegt, Name getrimmt', async () => {
  await as(U.A);
  [g] = await q(`select * from create_playgroup('  Küchentisch ')`);
  ok(g.name === 'Küchentisch');
});
check('Einladungscode TTG-XXXXXX', () => ok(/^TTG-[A-HJ-NP-Z2-9]{6}$/.test(g.invite_code), g.invite_code));
check('A ist Admin', async () => ok((await q(`select role from members where profile_id = $1`, [U.A]))[0]?.role === 'admin'));
check('B sieht fremde Gruppe nicht', async () => {
  await as(U.B);
  ok((await q(`select count(*)::int n from playgroups`))[0].n === 0);
});
check('B sieht fremde Mitglieder nicht', async () => ok((await q(`select count(*)::int n from members`))[0].n === 0));
check('B sieht Profil von A nicht', async () => ok((await q(`select count(*)::int n from profiles where id = $1`, [U.A]))[0].n === 0));
check('Falscher Code → null statt Fehler', async () => {
  wrong = await q(`select * from join_playgroup('TTG-ZZZZZZ')`);
  ok(wrong[0]?.id == null);
});
check('Versuchsbremse greift nach 10 Fehlversuchen', async () => {
  for (let i = 0; i < 9; i++) await q(`select * from join_playgroup('TTG-ZZZZZZ')`);
  lim = await err(`select * from join_playgroup($1)`, [g.invite_code]);
  ok(lim && /Zu viele/.test(lim), lim);
});
check('C tritt per Code bei (klein + Leerzeichen)', async () => {
  await as(U.C);
  [mc] = await q(`select * from join_playgroup($1)`, [g.invite_code.toLowerCase() + ' ']);
  ok(mc?.id && mc.role === 'member');
});
check('C sieht Profil von A', async () => ok((await q(`select count(*)::int n from profiles where id = $1`, [U.A]))[0].n === 1));

// ---------------------------------------------------------------- Rechte-Eskalation
check('C kann sich nicht selbst zum Admin machen', async () => {
  e = await err(`update members set role = 'admin' where profile_id = $1`, [U.C]);
  ok(!!e, e);
});
check('Rolle unverändert', async () => ok((await q(`select role from members where profile_id = $1`, [U.C]))[0].role === 'member'));
check('C kann keinen Admin-Platzhalter direkt anlegen', async () => {
  e = await err(`insert into members (playgroup_id, display_name, role, claim_code) values ($1,'X','admin','X-AAAAAA')`, [g.id]);
  ok(!!e, e);
});
check('C darf eigenen Anzeigenamen ändern', async () => {
  e = await err(`update members set display_name = 'Marie' where profile_id = $1`, [U.C]);
  ok(!e, e);
});
check('C (Mitglied) kann Rollen nicht per RPC ändern', async () => {
  e = await err(`select * from set_member_role($1, 'admin')`, [mc.id]);
  ok(!!e, e);
});
check('Einladungscode nicht direkt änderbar', async () => {
  e = await err(`update playgroups set invite_code = 'TTG-AAAAAA'`);
  ok(!!e, e);
});
check('Profil-ID nicht änderbar', async () => {
  e = await err(`update profiles set id = $1 where id = $2`, [U.B, U.C]);
  ok(!!e, e);
});
check('Letzter Admin kann sich nicht herabstufen', async () => {
  await as(U.A);
  e = await err(`select * from set_member_role((select id from members where profile_id = $1), 'member')`, [U.A]);
  ok(e && /mindestens einen Admin/.test(e), e);
});
check('Admin kann befördern', async () => {
  [promo] = await q(`select * from set_member_role($1, 'admin')`, [mc.id]);
  ok(promo.role === 'admin');
});

// ---------------------------------------------------------------- Platzhalter
check('Platzhalter-Code TIM-XXXXXX', async () => {
  await q(`select * from set_member_role($1, 'member')`, [mc.id]); // Rückstufung aus dem Szenario davor
  [tim] = await q(`select * from create_placeholder($1, ' Tim ')`, [g.id]);
  ok(/^TIM-[A-HJ-NP-Z2-9]{6}$/.test(tim.claim_code), tim.claim_code);
});
check('Umlaute im Code ersetzt', async () => {
  [oe] = await q(`select * from create_placeholder($1, 'Jörg')`, [g.id]);
  ok(/^JOER-/.test(oe.claim_code), oe.claim_code);
});
check('Name ohne Buchstaben → GAST-', async () => {
  [x] = await q(`select * from create_placeholder($1, '42')`, [g.id]);
  ok(/^GAST-/.test(x.claim_code), x.claim_code);
});
check('C kann Platzhalter nicht ohne Code übernehmen', async () => {
  await as(U.C);
  e = await err(`update members set profile_id = $1 where id = $2`, [U.C, tim.id]);
  ok(!!e, e);
});
check('Mitglied darf Deck für Platzhalter anlegen', async () => {
  await q(`insert into decks (owner_member_id, commander_name, short_name) values ($1, 'Kinnan, Bonder Prodigy', 'Kinnan')`, [tim.id]);
  ok((await q(`select count(*)::int n from decks where owner_member_id = $1`, [tim.id]))[0].n === 1);
});

// ---------------------------------------------------------------- Decks
check('Eigenes Deck mit Partnerbild anlegbar', async () => {
  await as(U.A);
  [deckA] = await q(`insert into decks (owner_profile_id, commander_name, short_name, color_identity, bracket, partner_image_url) values ($1, 'Atraxa, Praetors'' Voice', 'Atraxa', '{W,U,B,G}', 3, 'https://x/y.jpg') returning *`, [U.A]);
  ok(!!deckA?.id);
});
check('Gruppenmitglied C sieht Decks von A', async () => {
  await as(U.C);
  ok((await q(`select count(*)::int n from decks where id = $1`, [deckA.id]))[0].n === 1);
});
check('C kann Deck von A nicht ändern', async () => {
  upd = await q(`update decks set bracket = 5 where id = $1 returning id`, [deckA.id]);
  ok(upd.length === 0);
});
check('C kann kein Deck im Namen von A anlegen', async () => {
  e = await err(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'X', 'X')`, [U.A]);
  ok(!!e, e);
});
check('Deck-Link nur http(s)', async () => {
  e = await err(`insert into decks (owner_profile_id, commander_name, short_name, list_url) values ($1, 'X', 'X', 'javascript:alert(1)')`, [U.C]);
  ok(!!e, e);
});
check('Nur gültige Farben', async () => {
  e = await err(`insert into decks (owner_profile_id, commander_name, short_name, color_identity) values ($1, 'X', 'X', '{W,P}')`, [U.C]);
  ok(!!e, e);
});
check('Fremder B sieht Decks der Gruppe nicht', async () => {
  await as(U.B);
  ok((await q(`select count(*)::int n from decks where id = $1 or owner_member_id = $2`, [deckA.id, tim.id]))[0].n === 0);
});
check('Fremdes Mitglied nicht in eigenes Spiel setzbar', async () => {
  await as(U.C);
  // Spiel mit Tim und A, Tim wird von A rausgenommen
  await as(U.A);
  [game] = await q(`insert into games (playgroup_id, created_by) values ($1, $2) returning *`, [g.id, U.A]);
  meA = (await q(`select id from members where profile_id = $1`, [U.A]))[0].id;
  await q(`insert into game_players (game_id, member_id, seat, place) values ($1,$2,0,1), ($1,$3,1,2)`, [game.id, meA, tim.id]);
  await q(`update game_players set eliminated_by = $2, eliminated_round = 5 where game_id = $1 and member_id = $3`, [game.id, meA, tim.id]);
  await q(`insert into game_events (game_id, round, type, source, target, amount) values ($1, 3, 'damage', $2, $3, 7), ($1, 4, 'damage', $3, $2, 2)`, [game.id, meA, tim.id]);
  await su(); await q(`insert into player_ratings (game_id, member_id, salt, fun) values ($1, $2, 4, 3)`, [game.id, tim.id]); await as(U.A);
  await q(`update games set status = 'finished' where id = $1`, [game.id]);
  // fremde Gruppe: B legt eigene Gruppe an; A darf B's Mitglied nicht in eigenes Spiel setzen
  await as(U.B);
  await q(`select * from create_playgroup('Laden')`); // Versuchsbremse betrifft nur Codes, Anlegen geht
  meB = (await q(`select id from members where profile_id = $1`, [U.B]))[0].id;
  await as(U.A);
  [game2] = await q(`insert into games (playgroup_id, created_by) values ($1, $2) returning *`, [g.id, U.A]);
  e = await err(`insert into game_players (game_id, member_id, seat) values ($1, $2, 0)`, [game2.id, meB]);
  ok(!!e, e);
});
check('Mitglied C kann fremdes Spiel nicht löschen', async () => {
  await as(U.C);
  e = await err(`delete from games where id = $1`, [game2.id]);
  still = (await q(`select count(*)::int n from games where id = $1`, [game2.id]))[0].n;
  ok(still === 1, e);
});

// ---------------------------------------------------------------- Übernahme per Code
check('Anonymes Konto kann nicht übernehmen', async () => {
  await as(U.G, { anonymous: true });
  e = await err(`select * from claim_member($1)`, [tim.claim_code]);
  ok(!!e, e);
});
check('Anonymes Konto kann keine Gruppe anlegen', async () => {
  e = await err(`select * from create_playgroup('Anon')`);
  ok(!!e, e);
});
check('Ohne Login: RPC nicht ausführbar', async () => {
  await as(null);
  e = await err(`select * from create_playgroup('Niemand')`);
  ok(!!e, e);
});
// D ist noch kein Mitglied, übernimmt Tim
check('D übernimmt Tim', async () => {
  await as(U.D);
  [claimed] = await q(`select * from claim_member($1)`, [tim.claim_code.toLowerCase()]);
  ok(claimed?.id === tim.id && claimed.profile_id === U.D && claimed.claim_code === null);
});
check('D sieht jetzt die Gruppe', async () => ok((await q(`select count(*)::int n from playgroups`))[0].n === 1));
check('Deck von Tim gehört jetzt D', async () => ok((await q(`select count(*)::int n from decks where owner_profile_id = $1`, [U.D]))[0].n === 1));
check('Historie bleibt (Ergebnis Platz 2)', async () => {
  res = await q(`select * from v_game_results where member_id = $1`, [tim.id]);
  ok(res.length === 1 && res[0].place === 2 && res[0].points === 0);
});
check('Code ist danach verbraucht', async () => {
  again = await q(`select * from claim_member($1)`, [tim.claim_code]);
  ok(again[0]?.id == null);
});
// C ist schon Mitglied und übernimmt Jörg → Zusammenführung
check('Zusammenführung: Rückgabe ist Cs Mitgliedschaft', async () => {
  await as(U.A);
  await q(`insert into game_players (game_id, member_id, seat, place) values ($1, $2, 0, 1)`, [game2.id, oe.id]);
  await as(U.C);
  [merged] = await q(`select * from claim_member($1)`, [oe.claim_code]);
  ok(merged.id === mc.id);
});
check('Platzhalter gelöscht', async () => ok((await q(`select count(*)::int n from members where id = $1`, [oe.id]))[0].n === 0));
check('Spiel hängt jetzt an C', async () => ok((await q(`select count(*)::int n from game_players where member_id = $1 and game_id = $2`, [mc.id, game2.id]))[0].n === 1));

// ---------------------------------------------------------------- Views
const VIEWS = ['v_game_results', 'v_member_stats', 'v_deck_stats', 'v_turn_times', 'v_deck_salt', 'v_damage_matrix'];
for (const v of VIEWS) {
  check(`${v} lesbar`, async () => {
    if (v === VIEWS[0]) await as(U.A);
    const e2 = await err(`select * from ${v}`);
    ok(!e2, e2);
  });
}
check('Schadensmatrix 7 / 2', async () => {
  dm = await q(`select * from v_damage_matrix where game_id = $1 order by damage desc`, [game.id]);
  ok(dm.length === 2 && dm[0].damage === 7 && dm[1].damage === 2);
});
check('Neuer Look-Standard nacht', async () => {
  pts = await q(`select place_points(4,1) a, place_points(4,2) b, place_points(4,3) c, place_points(4,4) d, place_points(6,2) e`);
  ok((await q(`select theme from profiles limit 1`))[0].theme === 'nacht');
});
check('Alter Look abgelehnt', async () => ok(!!(await err(`update profiles set theme = 'schiefer' where id = auth.uid()`))));
check('Look lachs erlaubt', async () => ok(!(await err(`update profiles set theme = 'lachs' where id = auth.uid()`))));
check('Punkte 4/2/1/0 und 6er Platz 2 = 4', () => ok(JSON.stringify(pts[0]) === '{"a":4,"b":2,"c":1,"d":0,"e":4}', JSON.stringify(pts[0])));

// ---------------------------------------------------------------- Storage
check('C kann kein Bild für A hochladen', async () => {
  await as(U.C);
  e = await err(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`profiles/${U.A}/avatar.jpg`]);
  ok(!!e, e);
});
check('C kann eigenes Bild hochladen', async () => {
  e = await err(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`profiles/${U.C}/avatar.jpg`]);
  ok(!e, e);
});
check('C kann Bild für Platzhalter der Gruppe setzen', async () => {
  await as(U.A);
  [ph2] = await q(`select * from create_placeholder($1, 'Deniz')`, [g.id]);
  await as(U.C);
  e = await err(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`members/${ph2.id}/avatar.jpg`]);
  ok(!e, e);
});
check('B (fremd) kann Platzhalter-Bild nicht setzen', async () => {
  await as(U.B);
  e = await err(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`members/${ph2.id}/avatar.jpg`]);
  ok(!!e, e);
});
check('B kann kein Spielfoto in fremde Gruppe laden', async () => {
  e = await err(`insert into storage.objects (bucket_id, name) values ('game-photos', $1)`, [`${g.id}/${game.id}.jpg`]);
  ok(!!e, e);
});
