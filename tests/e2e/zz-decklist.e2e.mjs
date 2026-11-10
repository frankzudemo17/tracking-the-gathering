// E2E Decks-UI (Spec P5, Kriterien 1–5, 8): ManaBox-Import, Kennzahlen, Kartenbild, Bracket-Prüfung, Rechte.
// Dateiname mit „zz-“: run.mjs führt die Dateien alphabetisch aus und die Konten entstehen erst in
// etappe1-2.e2e.mjs (Harness: höchstens 3 je Lauf). Als letzte Datei stören die zwei neuen Decks von A
// keine andere Prüfung (setup.e2e zählt auf A genau ein Deck Tymna). Spec-Name war decklist.e2e.mjs.
// Konten: A = 'a' „Franco Test“ (Admin, Deck Tymna + Thrasios) · C = 'c' „Tim Echt“ (Mitglied, ohne Recht auf A-Decks).
// Erster Live-Beleg der Edge Function `spellbook` mit echtem Nutzer-Token: Status + Antwort werden protokolliert.
// P9b: feste Testkonten (login(page, 'a'|'b'|'c')) in TTG-E2E-Fixture; run.mjs stellt vorher den Grundzustand her,
// prepare() den Stand, den die alte Kette hier hinterließ (nach setup: zusätzlich Platzhalter „Jo Test“ und B mit Krenko).
import fs from 'node:fs';
import path from 'node:path';
import { ok, ctx, waitHash, login, ROOT, TARGET, prepare } from './harness.mjs';

const FIXTURE = fs.readFileSync(path.join(ROOT, 'tests', 'unit', 'fixtures', 'manabox-export-light-paws.txt'), 'utf8');
const TASIGUR = "// COMMANDER\n1 Tasigur, the Golden Fang\n\n1 Thassa's Oracle\n1 Demonic Consultation\n";
const SPELLBOOK = `${TARGET.url}/functions/v1/spellbook`;

export default async function decklistE2e({ browser, base: BASE }) {
  await prepare({ members: ['b', 'c'], placeholders: ['Jo Test'], decks: [['a', 'tymna'], ['b', 'krenko']] });
  console.log('\nDeckliste: A legt zwei Decks an (Light-Paws, Tasigur — beide Bracket 2)');
  const A = await ctx(browser, 'DA');
  const calls = [];
  A.on('response', async (r) => {
    if (!r.url().startsWith(SPELLBOOK) || r.request().method() !== 'POST') return;
    let body = '';
    try { body = await r.text(); } catch { body = '(kein Text)'; }
    calls.push({ status: r.status(), body });
    console.log(`    spellbook POST ⇒ ${r.status()} · ${body.slice(0, 300)}`);
  });
  await A.goto(BASE);
  await waitHash(A, '#/login');
  await login(A, 'a');
  await waitHash(A, '#/start');
  const db = (fn, arg) => A.evaluate(async ([src, a]) => {
    const { sb } = await import('/src/supabase.js');
    const { state } = await import('/src/state.js');
    // eslint-disable-next-line no-new-func
    return new Function('sb', 'state', 'a', `return (async () => { ${src} })()`)(sb, state, a);
  }, [fn, arg]);
  const ids = await db(`
    const must = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
    const mk = (commander_name, short_name, color_identity) => sb.from('decks').insert({ owner_profile_id: state.profile.id, commander_name, short_name, color_identity, bracket: 2 }).select('id').single();
    const lp = must(await mk("Light-Paws, Emperor's Voice", 'Light-Paws', ['W']));
    const ts = must(await mk('Tasigur, the Golden Fang', 'Tasigur', ['U', 'B']));
    return { lp: lp.id, ts: ts.id };`);
  ok('Decks Light-Paws und Tasigur angelegt', !!(ids.lp && ids.ts), JSON.stringify(ids));

  // ---------------------------------------------------------------- 8 + Leerzustand
  await A.goto(BASE + '#/deck/' + ids.lp);
  await A.waitForSelector('[data-dl-empty]');
  ok('K8 Deck ohne Liste ⇒ Leerzustand mit „Aus ManaBox importieren“',
    (await A.locator('[data-act="dl-import"]').count()) === 1 && (await A.textContent('[data-dl-empty]')).includes('Noch keine Liste importiert'));
  ok('Deck-Link-Zeile bleibt im Abschnitt', (await A.locator('[data-act="link"]').count()) === 1);
  await A.shot('dl-1-leer');

  // ---------------------------------------------------------------- 1 Import des echten Exports
  console.log('\nDeckliste: Import Light-Paws (echter ManaBox-Export)');
  await A.click('[data-act="dl-import"]');
  await A.waitForSelector('.sheet #dl-text');
  await A.fill('#dl-text', FIXTURE.replace(/\r?\n/g, '\r\n'));
  await A.shot('dl-2-import-sheet');
  await A.click('[data-act="dl-go"]');
  await Promise.race([
    A.waitForSelector('[data-dl-count]', { timeout: 60000 }),
    A.waitForSelector('.sheet [data-dl-notfound], .sheet [data-dl-err], .sheet [data-dl-warn]', { timeout: 60000 }).then(async () => {
      throw new Error('Import blieb im Sheet stehen: ' + (await A.textContent('.sheet [data-dl-msg]')));
    }),
  ]);
  ok('K1 Liste zeigt „100 Karten“', (await A.getAttribute('[data-dl-count]', 'data-dl-count')) === '100' && (await A.textContent('[data-dl-count]')).includes('100 Karten'),
    await A.textContent('[data-dl-count]'));
  const rows = await db(`const r = await sb.from('deck_cards').select('*').eq('deck_id', a); if (r.error) throw new Error(r.error.message); return r.data;`, ids.lp);
  ok('K1 deck_cards: 69 Zeilen (REST als Testkonto)', rows.length === 69, String(rows.length));

  // ---------------------------------------------------------------- 2 Kennzahlen = deckSummary der gespeicherten Zeilen
  const cmp = await A.evaluate(async (stored) => {
    const { deckSummary } = await import('/src/decks/cards.js');
    const s = deckSummary(stored);
    const pick = (sel, key) => Object.fromEntries([...document.querySelectorAll(sel)].map((e) => [e.dataset[key], Number(e.dataset.n)]));
    const types = pick('[data-type]', 'type');
    const want = {};
    for (const [k, n] of Object.entries(s.byType)) { const g = ['creature', 'planeswalker', 'instant', 'sorcery', 'artifact', 'enchantment', 'land'].includes(k) ? k : 'other'; want[g] = (want[g] || 0) + n; }
    const curve = pick('[data-mv]', 'mv');
    const curveWant = Object.fromEntries(['0', '1', '2', '3', '4', '5', '6', '7+'].map((k) => [k, s.curve[k] || 0]));
    const colors = pick('[data-color]', 'color');
    const eq = (a, b) => Object.keys({ ...a, ...b }).every((k) => a[k] === b[k]);
    return { types: eq(types, want), curve: eq(curve, curveWant), colors: eq(colors, s.colors), shown: { types, curve, colors }, s,
      plains: document.querySelector('[data-name="Plains"]')?.textContent.replace(/\s+/g, ' ').trim() };
  }, rows);
  ok('K2 Typen = deckSummary', cmp.types, JSON.stringify([cmp.shown.types, cmp.s.byType]));
  ok('K2 Manakurve = deckSummary', cmp.curve, JSON.stringify([cmp.shown.curve, cmp.s.curve]));
  ok('K2 Farben = deckSummary', cmp.colors, JSON.stringify([cmp.shown.colors, cmp.s.colors]));
  ok('K2 Plains-Zeile „32 · Plains“', /^32\s*·\s*Plains/.test(cmp.plains || ''), cmp.plains);
  await A.shot('dl-3-liste');

  // ---------------------------------------------------------------- 3 Kartenbild
  ok('Gruppen sind zu Beginn zugeklappt', (await A.locator('details.dl-group[open]').count()) === 0);
  await A.click('[data-group="artifact"] > summary');
  await A.click('[data-act="dl-card"][data-name="Sol Ring"]');
  await A.waitForSelector('.dl-zoom img');
  ok('K3 Sol Ring ⇒ Bild (scryfall)', /scryfall/.test(await A.getAttribute('.dl-zoom img', 'src') || ''));
  await A.shot('dl-4-kartenbild');
  await A.keyboard.press('Escape');
  await A.waitForSelector('.dl-zoom', { state: 'detached', timeout: 5000 });
  ok('K3 Escape schließt das Bild', (await A.evaluate(() => location.hash)) === '#/deck/' + ids.lp);

  // ---------------------------------------------------------------- 4 Bracket Light-Paws ⇒ 1–2
  console.log('\nDeckliste: Bracket prüfen (Edge Function mit echtem Nutzer-Token)');
  await A.click('[data-act="dl-check"]');
  await A.waitForSelector('[data-dl-result], [data-dl-error]', { timeout: 45000 });
  const errCode = (await A.locator('[data-dl-error]').count()) ? await A.getAttribute('[data-dl-error]', 'data-dl-error') : null;
  ok('Edge Function antwortet 200 mit Nutzer-Token', calls.length >= 1 && calls[0].status === 200 && !errCode,
    JSON.stringify({ errCode, calls: calls.map((c) => ({ status: c.status, body: c.body.slice(0, 500) })) }));
  if (!errCode) {
    ok('K4 Light-Paws ⇒ „Bracket 1–2“', (await A.textContent('[data-dl-result]')).includes('Bracket 1–2'), await A.textContent('[data-dl-result]'));
    const chk = await db(`const r = await sb.from('decks').select('bracket, bracket_check, cards_updated_at').eq('id', a).single(); return r.data;`, ids.lp);
    ok('K4 decks.bracket_check.floor = 1 gespeichert', chk?.bracket_check?.floor === 1 && chk.bracket_check.cards_updated_at === chk.cards_updated_at,
      JSON.stringify(chk).slice(0, 300));
    await A.shot('dl-5-bracket-1-2');

    // Tasigur + Thassa's Oracle + Demonic Consultation ⇒ 4, Abweichung, Bracket bleibt 2
    console.log('\nDeckliste: Tasigur (Kombo) ⇒ Bracket 4');
    await A.goto(BASE + '#/deck/' + ids.ts);
    await A.waitForSelector('[data-act="dl-import"]');
    await A.click('[data-act="dl-import"]');
    await A.waitForSelector('.sheet #dl-text');
    await A.fill('#dl-text', TASIGUR);
    await A.click('[data-act="dl-go"]');
    await A.waitForSelector('[data-dl-count]', { timeout: 30000 });
    ok('Tasigur-Liste: 3 Karten', (await A.getAttribute('[data-dl-count]', 'data-dl-count')) === '3');
    await A.click('[data-act="dl-check"]');
    await A.waitForSelector('[data-dl-result], [data-dl-error]', { timeout: 45000 });
    const res4 = await A.textContent('[data-dl-bracket]');
    ok('K4 Tasigur ⇒ „Bracket 4“', /Bracket 4/.test(await A.textContent('[data-dl-result]').catch(() => '')), res4.slice(0, 300));
    ok('K4 Grund nennt Thassa\'s Oracle und Demonic Consultation', /Thassa's Oracle/.test(res4) && /Demonic Consultation/.test(res4));
    ok('K4 Abweichung sichtbar (Besitzer 2)', (await A.locator('[data-dl-below]').count()) === 1 && (await A.locator('[data-act="dl-set"]').count()) === 1);
    const ts = await db(`const r = await sb.from('decks').select('bracket, bracket_check').eq('id', a).single(); return r.data;`, ids.ts);
    ok('K4 Bracket unverändert 2, bracket_check.floor = 4', ts?.bracket === 2 && ts?.bracket_check?.floor === 4, JSON.stringify(ts).slice(0, 200));
    await A.shot('dl-6-bracket-4');
  }

  // ---------------------------------------------------------------- 5 Rechte: C sieht Liste + Ergebnis, keine Knöpfe
  console.log('\nDeckliste: Mitglied C (ohne Recht auf die Decks von A)');
  const C = await ctx(browser, 'DC');
  await C.goto(BASE);
  await waitHash(C, '#/login');
  await login(C, 'c');
  await waitHash(C, '#/start');
  await C.goto(BASE + '#/deck/' + ids.lp);
  await C.waitForSelector('[data-dl-count]', { timeout: 15000 });
  ok('K5 C sieht die Liste (100 Karten)', (await C.getAttribute('[data-dl-count]', 'data-dl-count')) === '100');
  if (!errCode) ok('K5 C sieht das gespeicherte Ergebnis „Bracket 1–2“', (await C.textContent('[data-dl-result]')).includes('Bracket 1–2'));
  ok('K5 C hat keinen Import-Knopf', (await C.locator('[data-act="dl-import"]').count()) === 0);
  if (!errCode) {
    await C.goto(BASE + '#/deck/' + ids.ts);
    await C.waitForSelector('[data-dl-result]', { timeout: 15000 });
    ok('K5 C sieht Abweichung, aber keinen Setzen-Knopf', (await C.locator('[data-dl-below]').count()) === 1 && (await C.locator('[data-act="dl-set"], [data-act="dl-import"]').count()) === 0);
    await C.shot('dl-7-ohne-recht');
  }
  // 8: Deck ohne Liste, Konto ohne Recht
  const tymna = await C.evaluate(async () => {
    const { sb } = await import('/src/supabase.js');
    const r = await sb.from('decks').select('id').ilike('commander_name', 'Tymna%').eq('archived', false).limit(1);
    return r.data?.[0]?.id ?? null;
  });
  await C.goto(BASE + '#/deck/' + tymna);
  await C.waitForSelector('[data-dl-empty]', { timeout: 15000 });
  ok('K8 C: Deck ohne Liste ⇒ „Noch keine Liste hinterlegt“, kein Knopf',
    (await C.textContent('[data-dl-empty]')).includes('Noch keine Liste hinterlegt') && (await C.locator('[data-act="dl-import"]').count()) === 0);

  for (const [n, p] of [['DA', A], ['DC', C]]) {
    ok(`K8 Keine JS-/Konsolenfehler bei ${n}`, p.errs.length === 0, p.errs.join(' | '));
    ok(`K8 Keine HTTP-Fehler bei ${n}`, p.bad.length === 0, JSON.stringify(p.bad));
  }
  for (const p of [A, C]) await p.context().close();
}
