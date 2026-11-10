// E2E Gruppe löschen (Spec P3, Kriterium 6) + #/beitreten ohne Anmeldung (Kriterium 8).
// P9b: feste Testkonten in TTG-E2E-Fixture. Grundzustand ⇒ A allein Admin; C tritt per API bei (Mitglied ohne
// Admin-Rechte). Die Fixture wird NICHT verändert: dort nur Knopf sehen, Sheet öffnen, abbrechen.
// Echtes Löschen (6b) entfällt: der feste Harness löscht nie eine Gruppe ⇒ sichtbar übersprungen,
// Ersatz tests/db/gruppe-loeschen.test.mjs. Die Probe (delete_playgroup an einer nicht vorhandenen ID) bleibt.
// K8: seit P9b zeigt #/beitreten/<code> ohne Anmeldung die Einladungsseite (join.js) statt des Platzhalters.
import { ok, skip, ctx, waitHash, login, prepare, TARGET, FIXTURE_NAME } from './harness.mjs';

const NIL = '00000000-0000-4000-8000-000000000000';

export default async function gruppeLoeschenE2e({ browser, base: BASE }) {
  await prepare({ members: ['c'] });

  // ---------------------------------------------------------------- 8: #/beitreten ohne Anmeldung
  console.log('\nGruppe löschen: #/beitreten ohne Anmeldung');
  const P = await ctx(browser, 'P');
  await P.goto(BASE + '#/beitreten/ABC');
  await P.waitForSelector('[data-act="have-account"]');
  ok('K8 #/beitreten/ABC ohne Anmeldung ⇒ Einladungsseite mit „Ich habe schon ein Konto“ (keine Umleitung zum Login)',
    (await P.evaluate(() => location.hash)) === '#/beitreten/ABC', await P.evaluate(() => location.hash));
  await P.shot('beitreten-ohne-anmeldung');

  // ---------------------------------------------------------------- 6a: Mitglied sieht keinen Knopf
  console.log('\nGruppe löschen: Mitglied C (kein Admin)');
  const B = await ctx(browser, 'GC');
  await B.goto(BASE);
  await waitHash(B, '#/login');
  await login(B, 'c');
  await waitHash(B, '#/start');
  await B.goto(BASE + '#/gruppen');
  await B.waitForSelector('.list .row');
  await B.waitForTimeout(300);
  const roleC = await B.locator('.list .row', { hasText: 'Tim Echt' }).textContent();
  ok('K6a C ist in der Fixture nur Mitglied', /Mitglied/.test(roleC) && !/Admin/.test(roleC), roleC);
  ok('K6a Mitglied C sieht keinen Knopf „Gruppe löschen“', (await B.locator('[data-act="delete-group"]').count()) === 0);
  await B.shot('gruppen-mitglied');

  // ---------------------------------------------------------------- 6a: Admin A sieht ihn, Sheet gesperrt bis Name stimmt
  console.log('\nGruppe löschen: Admin A (Fixture bleibt unverändert)');
  const A = await ctx(browser, 'GA');
  await A.goto(BASE);
  await waitHash(A, '#/login');
  await login(A, 'a');
  await waitHash(A, '#/start');
  await A.goto(BASE + '#/gruppen');
  await A.waitForSelector('[data-act="delete-group"]');
  ok('K6a Admin A sieht „Gruppe löschen“', (await A.locator('[data-act="delete-group"]').count()) === 1);
  await A.click('[data-act="delete-group"]');
  await A.waitForSelector('.sheet #dg-name');
  const warn = await A.textContent('.sheet [data-warn]');
  ok('K6a Sheet nennt Spiele, Mitgliedschaften, Spieler ohne Konto', /Spiel/.test(warn) && /Mitgliedschaft/.test(warn) && /ohne Konto/.test(warn), warn);
  ok('K6a Löschknopf anfangs gesperrt', await A.isDisabled('[data-act="delete-group-yes"]'));
  await A.fill('#dg-name', 'TTG-E2E');
  ok('K6a falscher Name ⇒ weiter gesperrt', await A.isDisabled('[data-act="delete-group-yes"]'));
  await A.fill('#dg-name', ` ${FIXTURE_NAME.toLowerCase()} `);
  ok('K6a richtiger Name (Rand/Groß-klein egal) ⇒ aktiv', !(await A.isDisabled('[data-act="delete-group-yes"]')));
  await A.shot('gruppe-loeschen-sheet');
  await A.click('.sheet [data-act="cancel"]');
  await A.waitForSelector('.sheet #dg-name', { state: 'detached' });
  ok('K6a Abbrechen schließt das Sheet, Gruppe bleibt', (await A.textContent('.pick[aria-pressed="true"]')).includes(FIXTURE_NAME));

  // ---------------------------------------------------------------- 6b: Probe; echtes Löschen übersprungen
  const db = (fn, arg) => A.evaluate(async ([src, a]) => {
    const { sb } = await import('/src/supabase.js');
    // eslint-disable-next-line no-new-func
    return new Function('sb', 'a', `return (async () => { ${src} })()`)(sb, a);
  }, [fn, arg]);
  const probe = await db(`const r = await sb.rpc('delete_playgroup', { p_group: a, p_name: 'x' }); return { code: r.error?.code ?? null, msg: r.error?.message ?? null };`, NIL);
  const missing = probe.code === 'PGRST202' || /Could not find the function/i.test(probe.msg || '');
  // Erwartete Antworten der Probe (Migration fehlt ⇒ 404, vorhanden ⇒ 400 „Gruppe nicht gefunden“)
  const probeUrl = `${TARGET.url}/rest/v1/rpc/delete_playgroup`;
  const expectedBad = new Set([`404 ${probeUrl}`, `400 ${probeUrl}`]);
  if (missing) skip('K6b Probe delete_playgroup', 'Migration delete_playgroup nicht in der Ziel-Datenbank');
  else ok('K6b Probe: delete_playgroup antwortet „Gruppe nicht gefunden“', /Gruppe nicht gefunden/.test(probe.msg || ''), JSON.stringify(probe));
  skip('K6b Wegwerf-Gruppe über die Oberfläche löschen (5 Prüfungen)',
    'fester Harness löscht nie eine Gruppe (P9b); Ersatz: tests/db/gruppe-loeschen.test.mjs (delete_playgroup samt Spielen, Platzhaltern, Decks)');

  for (const [n, p] of [['P', P], ['GC', B], ['GA', A]]) {
    ok(`Keine JS-Fehler bei ${n}`, p.errs.length === 0, p.errs.join(' | '));
    const unexpected = p.bad.filter((x) => !(n === 'GA' && expectedBad.has(x)));
    ok(`Keine unerwarteten HTTP-Fehler bei ${n}`, unexpected.length === 0, JSON.stringify(unexpected));
  }
  for (const p of [P, B, A]) await p.context().close();
}
