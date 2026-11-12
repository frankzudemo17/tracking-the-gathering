// Bausteine der Profil-/Deck-Statistik (src/views/stats-ui.js, Spec P18): Diagramm-Geometrie,
// Ausblenden ohne Werte, keine NaN/Division durch 0, Endwert-Beschriftung, Datumsanzeige.
// Imports dynamisch im Test (Baseline-Regel: am Basis-Stand fehlt die Datei ⇒ Test rot, nicht Lauf-Abbruch).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ui = () => import('../../src/views/stats-ui.js');
const fx = () => import('../fixtures/gruppe.mjs');
const st = () => import('../../src/lib/stats.js');

test('linePoints: < 2 Werte ⇒ null; Linie von links unten nach rechts oben', async () => {
  const { linePoints, LINE_BOX: b } = await ui();
  assert.equal(linePoints([]), null);
  assert.equal(linePoints([4]), null);
  const g = linePoints([4, 6, 7, 9, 13, 15]);
  assert.equal(g.pts.length, 6);
  assert.equal(g.last, 15);
  assert.equal(g.max, 15);
  assert.deepEqual(g.pts[0], [b.padL, b.padT + (1 - 4 / 15) * (b.h - b.padT - b.padB)]);
  assert.deepEqual(g.pts[5], [b.w - b.padR, b.padT]); // größter Wert = oberer Rand
});

test('linePoints: nur Nullen ⇒ Grundlinie, keine NaN', async () => {
  const { linePoints, LINE_BOX: b } = await ui();
  const g = linePoints([0, 0, 0]);
  for (const [x, y] of g.pts) { assert.ok(Number.isFinite(x)); assert.equal(y, b.h - b.padB); }
});

test('pointsLine: Fixture Franco endet bei 15, ein SVG mit viewBox; < 2 Spiele ⇒ leer', async () => {
  const { pointsLine } = await ui();
  const { memberProfile } = await st();
  const { fixtureGroupData } = await fx();
  const s = String(pointsLine(memberProfile(fixtureGroupData(), 'm-F').pointsSeries));
  assert.match(s, /<svg viewBox="0 0 320 120"/);
  assert.match(s, /<text class="st-end"[^>]*>15<\/text>/);
  assert.equal((s.match(/<polyline/g) || []).length, 1);
  assert.doesNotMatch(s, /NaN|playerColor|--p-/);
  assert.equal(String(pointsLine([3])), '');
});

test('saltBars: ein Balken je Wert (Franco [1,3,5,2,1,4]); leer ⇒ ausgeblendet; ein Wert geht', async () => {
  const { saltBars } = await ui();
  const { memberProfile } = await st();
  const { fixtureGroupData } = await fx();
  const trend = memberProfile(fixtureGroupData(), 'm-F').saltTrend;
  assert.deepEqual(trend, [1, 3, 5, 2, 1, 4]);
  const s = String(saltBars(trend));
  assert.deepEqual([...s.matchAll(/style="--v:(\d)"/g)].map((m) => Number(m[1])), [1, 3, 5, 2, 1, 4]);
  assert.equal(String(saltBars([])), '');
  assert.equal([...String(saltBars([2])).matchAll(/--v:2/g)].length, 1);
});

test('kpis: fünf Kacheln in .stats.st-5, Werte escaped', async () => {
  const { kpis } = await ui();
  const s = String(kpis([{ v: 6, l: 'Spiele' }, { v: 2, l: 'Siege' }, { v: 15, l: 'Punkte' }, { v: '2,0', l: 'Ø Platz' }, { v: '<b>', l: 'x' }]));
  assert.equal((s.match(/class="stat"/g) || []).length, 5);
  assert.match(s, /class="stats st-5"/);
  assert.match(s, /&lt;b&gt;/);
});

test('iconScale: --v = Wert, fehlend ⇒ 0; Sterne unten leer, oben gefüllt', async () => {
  const { iconScale } = await ui();
  const s = String(iconScale(3.25, 'star', 'de'));
  assert.match(s, /--v:3\.25/);
  assert.match(s, /aria-label="3,3 von 5"/);
  assert.equal((s.match(/<svg/g) || []).length, 10);
  const n = String(iconScale(null, 'salt', 'de'));
  assert.match(n, /--v:0/);
  assert.match(n, /aria-label="– von 5"/);
});

test('fmtDay: Spieltag in Berlin-Zeit, Unsinn ⇒ –', async () => {
  const { fmtDay } = await ui();
  assert.equal(fmtDay('2026-11-06T19:30:00+01:00', 'de'), '6. Nov. 2026');
  assert.equal(fmtDay('2026-10-31T23:30:00Z', 'de'), '1. Nov. 2026');
  assert.equal(fmtDay(null, 'de'), '–');
  assert.equal(fmtDay('x', 'en'), '–');
});

// ---------------------------------------------------------------------------
// Spec P1 (Welle ttg-features): moreStats — Bereich „Erweitert“ im Profil (Tabelle „Spec-Tests · moreStats“).
// Eingabe memberTimes aus der Fixture „F-Zeit“ (wie tests/unit/stats.test.mjs), geprüft am HTML-Text.

function fZeitUi() {
  const members = [['a', 'Anna'], ['b', 'Ben'], ['c', 'Cem'], ['d', 'Dana'], ['x', 'Xaver']]
    .map(([id, name]) => ({ id, name, profileId: null, avatarPath: null, isPlaceholder: false }));
  const g = (id, day, end, who) => ({
    game: { id, sessionId: null, status: 'finished', startedAt: `2026-11-0${day}T18:00:00Z`, endedAt: end, round: 5, wincon: null, note: null, photoPath: null, startingLife: 40 },
    players: who.map((memberId, i) => ({ gameId: id, memberId, deckId: null, seat: i, place: i + 1, eliminatedRound: null, eliminatedBy: null, finalLife: null })),
  });
  const spec = [
    g('g1', 1, '2026-11-01T19:30:00Z', ['a', 'b', 'c', 'd']),
    g('g2', 2, '2026-11-02T18:45:00Z', ['a', 'b', 'c']),
    g('g3', 3, '2026-11-03T19:00:00Z', ['a', 'b']),
    g('g4', 4, '2026-11-04T20:00:00Z', ['a', 'b', 'c', 'd']),
    g('g5', 5, null, ['a', 'b', 'c']),
    g('g6', 6, '2026-11-06T18:00:00Z', ['a', 'b']),
  ];
  const tu = (gameId, memberId, turns, totalSec, longestSec) => ({ gameId, memberId, turns, totalSec, longestSec });
  return {
    groupId: 'G', members, decks: [], sessions: [],
    games: spec.map((s) => s.game), players: spec.flatMap((s) => s.players),
    ratings: [], deckSalt: [], potg: [],
    turns: [
      tu('g1', 'a', 10, 1200, 300), tu('g1', 'b', 10, 900, 200), tu('g1', 'c', 9, 1800, 600), tu('g1', 'd', 9, 540, 90),
      tu('g2', 'a', 8, 800, 250), tu('g2', 'b', 8, 1600, 600), tu('g2', 'c', 7, 700, 150),
      tu('g4', 'a', 12, 1440, 400), tu('g4', 'b', 12, 1200, 300), tu('g4', 'c', 12, 2400, 500), tu('g4', 'd', 11, 660, 120),
    ],
  };
}

/** moreStats für ein Mitglied der F-Zeit (oder abgewandelte Daten) als HTML-Text. */
async function moreHtml(id, { data = fZeitUi(), open = true, isMe = id === 'a' } = {}) {
  const { moreStats } = await ui();
  const { memberTimes } = await st();
  const names = new Map(data.members.map((m) => [m.id, m.name]));
  const who = (x) => names.get(x) || '–';
  return String(moreStats({ times: memberTimes(data, id), memberId: id, name: who(id), isMe, who, open, lang: 'de' }));
}
const plain = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const count = (s, re) => (s.match(re) || []).length;
const items = (s) => [...s.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)].map((m) => ({ attrs: m[1], text: plain(m[2]) }));
const linkText = (s, gid) => { const m = s.match(new RegExp(`<a\\b[^>]*href="#/partie/${gid}"[^>]*>([\\s\\S]*?)</a>`)); return m ? plain(m[1]) : null; };
/** Tabellenzeilen: Kopf (th scope=row) ⇒ Zellen-Texte */
const tableRows = (s) => [...s.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
  .map((m) => m[1]).filter((r) => /scope="row"/.test(r))
  .map((r) => ({ head: plain(r.match(/<th\b[^>]*scope="row"[^>]*>([\s\S]*?)<\/th>/)[1]), cells: [...r.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => plain(c[1])) }));

test('P1 M1 moreStats Kopf: zu ⇒ aria-expanded false + hidden, auf ⇒ true ohne hidden', async () => {
  const zu = await moreHtml('a', { open: false });
  assert.match(zu, /<div class="section st-more">/);
  assert.match(zu, /<button type="button" class="collapse-head" data-act="toggle-more" aria-expanded="false" aria-controls="prof-more">/);
  assert.match(zu, /<div id="prof-more"[^>]*\bhidden\b/);
  assert.match(plain(zu), /Erweitert/);
  const auf = await moreHtml('a', { open: true });
  assert.match(auf, /data-act="toggle-more" aria-expanded="true"/);
  assert.match(auf, /<div id="prof-more"/);
  assert.doesNotMatch(auf, /<div id="prof-more"[^>]*\bhidden\b/);
});

test('P1 M2 Balkenvergleich: Reihenfolge, Werte, genau eine Hervorhebung', async () => {
  const s = await moreHtml('a');
  assert.equal(count(s, /<ol\b/g), 1);
  const li = items(s);
  assert.equal(li.length, 4);
  ['Cem', 'Ben', 'Anna', 'Dana'].forEach((n, i) => assert.match(li[i].text, new RegExp(n), `Platz ${i + 1}`));
  ['2:55', '2:03', '1:55', '1:00'].forEach((v, i) => assert.match(li[i].text, new RegExp(v), `Wert ${i + 1}`));
  assert.equal(count(s, /aria-current="true"/g), 1);
  assert.match(li[2].attrs, /aria-current="true"/);
  assert.doesNotMatch(s, /NaN|--p-/);
});

test('P1 M3 Rekorde: Gruppe und eigener verlinkt; eigener = Gruppe ⇒ nur eine Kachel', async () => {
  const a = await moreHtml('a');
  const g1 = linkText(a, 'g1');
  assert.ok(g1, 'Link g1');
  assert.match(g1, /Cem/); assert.match(g1, /10:00/);
  const g4 = linkText(a, 'g4');
  assert.ok(g4, 'Link g4');
  assert.match(g4, /6:40/); assert.match(g4, /Dein längster Zug/);
  const c = await moreHtml('c', { isMe: false });
  assert.equal(count(c, /#\/partie\//g), 1);
});

test('P1 M4 Tabelle Ø Spieldauer: Zeilen, Gruppen- und Mitgliedsspalte', async () => {
  const want = [['Alle Partien', '1:19 h'], ['2 Spieler', '1:00 h'], ['3 Spieler', '0:45 h'], ['4 Spieler', '1:45 h']];
  const a = await moreHtml('a');
  assert.equal(count(a, /<table\b/g), 1);
  assert.match(a, /<th scope="col"/);
  const ra = tableRows(a);
  assert.deepEqual(ra.map((r) => r.head), want.map((w) => w[0]));
  ra.forEach((r, i) => { assert.match(r.cells[1], new RegExp(want[i][1]), `Gruppe ${r.head}`); assert.match(r.cells[0], new RegExp(want[i][1]), `Anna ${r.head}`); });
  const rx = tableRows(await moreHtml('x', { isMe: false }));
  rx.forEach((r, i) => { assert.equal(r.cells[0], '–', `Xaver ${r.head}`); assert.match(r.cells[1], new RegExp(want[i][1])); });
  const rd = tableRows(await moreHtml('d', { isMe: false }));
  assert.equal(rd[1].cells[0], '–'); assert.equal(rd[2].cells[0], '–');
  assert.match(rd[3].cells[0], /1:45 h/);
});

test('P1 M5 nur ein Spieler mit Zugzeiten ⇒ compareFew, keine Liste, Gruppenrekord bleibt', async () => {
  const data = fZeitUi(); data.turns = data.turns.filter((x) => x.memberId === 'a');
  const s = await moreHtml('a', { data });
  assert.match(plain(s), /Für einen Vergleich braucht es Zugzeiten von mindestens zwei Spielern\./);
  assert.equal(count(s, /<ol\b/g), 0);
  assert.match(linkText(s, 'g4') || '', /Längster Zug der Gruppe/);
});

test('P1 M6 Mitglied ohne eigene Zugzeiten ⇒ Balken ohne Hervorhebung, compareNone, keine eigene Kachel', async () => {
  const s = await moreHtml('x', { isMe: false });
  assert.equal(items(s).length, 4);
  assert.equal(count(s, /aria-current/g), 0);
  assert.match(plain(s), /Von Xaver gibt es noch keine Zugzeiten\./);
  assert.equal(count(s, /#\/partie\//g), 1);
  assert.doesNotMatch(plain(s), /Längster Zug von Xaver|Dein längster Zug/);
});

test('P1 M7 keine Zugzeiten ⇒ ein Text noTurns, keine Liste, kein Link, Tabelle bleibt', async () => {
  const data = fZeitUi(); data.turns = [];
  const s = await moreHtml('a', { data });
  assert.equal(count(plain(s), /Noch keine Zugzeiten erfasst\./g), 1);
  assert.equal(count(s, /<ol\b/g), 0);
  assert.equal(count(s, /#\/partie\//g), 0);
  assert.equal(count(s, /<table\b/g), 1);
});

test('P1 M8 keine Spieldauer ⇒ durationNone, keine Tabelle', async () => {
  const data = fZeitUi(); for (const g of data.games) g.endedAt = null;
  const s = await moreHtml('a', { data });
  assert.match(plain(s), /Noch keine Spieldauer erfasst\./);
  assert.equal(count(s, /<table\b/g), 0);
});
