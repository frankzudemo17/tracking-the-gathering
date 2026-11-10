// E2E Gruppe löschen (Spec P3, Kriterium 6) + Platzhalter #/beitreten (Kriterium 8).
// Läuft nach etappe1-2.e2e.mjs und vor setup.e2e.mjs im selben Lauf und nutzt nur deren Konten
// (Harness: höchstens 3 je Lauf): A = mail('a') Admin von „Küchentisch <b>Test</b>“, B = mail('b') Mitglied.
// „Küchentisch“ wird NICHT verändert (setup.e2e.mjs braucht sie): dort nur Knopf sehen, Sheet öffnen, abbrechen.
// Echtes Löschen (6b) nur an einer eigenen Wegwerf-Gruppe von A — und nur, wenn die Migration
// delete_playgroup in der Ziel-Datenbank schon steht; sonst sichtbar „übersprungen“ (kein ok()).
import { ok, ctx, waitHash, login, mail, TARGET } from './harness.mjs';

const TEMP_NAME = 'Wegwerf <i>Löschtest</i>';
const NIL = '00000000-0000-4000-8000-000000000000';

export default async function gruppeLoeschenE2e({ browser, base: BASE }) {
  // ---------------------------------------------------------------- 8: #/beitreten ohne Anmeldung
  console.log('\nGruppe löschen: #/beitreten ohne Anmeldung');
  const P = await ctx(browser, 'P');
  await P.goto(BASE + '#/beitreten/ABC');
  await P.waitForSelector('.empty b');
  ok('K8 #/beitreten/ABC ohne Anmeldung ⇒ Platzhalter (keine Umleitung zum Login)',
    (await P.evaluate(() => location.hash)) === '#/beitreten/ABC' && (await P.textContent('.empty b')).includes('Live-Beitritt'),
    await P.evaluate(() => location.hash));
  await P.shot('beitreten-platzhalter');

  // ---------------------------------------------------------------- 6a: Mitglied sieht keinen Knopf
  console.log('\nGruppe löschen: Mitglied B');
  const B = await ctx(browser, 'GB');
  await B.goto(BASE);
  await waitHash(B, '#/login');
  await login(B, mail('b'));
  await waitHash(B, '#/start');
  await B.goto(BASE + '#/gruppen');
  await B.waitForSelector('.list .row');
  await B.waitForTimeout(300);
  ok('K6a Mitglied B sieht keinen Knopf „Gruppe löschen“', (await B.locator('[data-act="delete-group"]').count()) === 0);
  await B.shot('gruppen-mitglied');

  // ---------------------------------------------------------------- 6a: Admin A sieht ihn, Sheet gesperrt bis Name stimmt
  console.log('\nGruppe löschen: Admin A (Küchentisch bleibt unverändert)');
  const A = await ctx(browser, 'GA');
  await A.goto(BASE);
  await waitHash(A, '#/login');
  await login(A, mail('a'));
  await waitHash(A, '#/start');
  await A.goto(BASE + '#/gruppen');
  await A.waitForSelector('[data-act="delete-group"]');
  ok('K6a Admin A sieht „Gruppe löschen“', (await A.locator('[data-act="delete-group"]').count()) === 1);
  await A.click('[data-act="delete-group"]');
  await A.waitForSelector('.sheet #dg-name');
  const warn = await A.textContent('.sheet [data-warn]');
  ok('K6a Sheet nennt Spiele, Mitgliedschaften, Spieler ohne Konto', /Spiel/.test(warn) && /Mitgliedschaft/.test(warn) && /ohne Konto/.test(warn), warn);
  ok('K6a Löschknopf anfangs gesperrt', await A.isDisabled('[data-act="delete-group-yes"]'));
  await A.fill('#dg-name', 'Küchentisch');
  ok('K6a falscher Name ⇒ weiter gesperrt', await A.isDisabled('[data-act="delete-group-yes"]'));
  await A.fill('#dg-name', ' küchentisch <b>test</b> ');
  ok('K6a richtiger Name (Rand/Groß-klein egal) ⇒ aktiv', !(await A.isDisabled('[data-act="delete-group-yes"]')));
  await A.shot('gruppe-loeschen-sheet');
  await A.click('.sheet [data-act="cancel"]');
  await A.waitForSelector('.sheet #dg-name', { state: 'detached' });
  ok('K6a Abbrechen schließt das Sheet, Gruppe bleibt', (await A.textContent('.pick[aria-pressed="true"]')).includes('Küchentisch'));

  // ---------------------------------------------------------------- 6b: echtes Löschen einer Wegwerf-Gruppe
  const db = (fn, arg) => A.evaluate(async ([src, a]) => {
    const { sb } = await import('/src/supabase.js');
    const { state } = await import('/src/state.js');
    // eslint-disable-next-line no-new-func
    return new Function('sb', 'state', 'a', `return (async () => { ${src} })()`)(sb, state, a);
  }, [fn, arg]);
  const probe = await db(`const r = await sb.rpc('delete_playgroup', { p_group: a, p_name: 'x' }); return { code: r.error?.code ?? null, msg: r.error?.message ?? null };`, NIL);
  const missing = probe.code === 'PGRST202' || /Could not find the function/i.test(probe.msg || '');
  // Erwartete Antworten der Probe (Migration fehlt ⇒ 404, vorhanden ⇒ 400 „Gruppe nicht gefunden“)
  const probeUrl = `${TARGET.url}/rest/v1/rpc/delete_playgroup`;
  const expectedBad = new Set([`404 ${probeUrl}`, `400 ${probeUrl}`]);
  let tempGid = null;
  if (missing) {
    console.log('  – K6b übersprungen: Migration delete_playgroup nicht in der Ziel-Datenbank (Prod) — kein db push in P3');
  } else {
    ok('K6b Probe: delete_playgroup antwortet „Gruppe nicht gefunden“', /Gruppe nicht gefunden/.test(probe.msg || ''), JSON.stringify(probe));
    console.log('\nGruppe löschen: Wegwerf-Gruppe mit Spieler ohne Konto und laufendem Spiel');
    const made = await db(`
      const must = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
      const g = must(await sb.rpc('create_playgroup', { p_name: a }));
      const me = must(await sb.rpc('my_member_id', { gid: g.id }));
      const ph = must(await sb.rpc('create_placeholder', { p_group: g.id, p_name: 'Wegwerf Tim' }));
      const own = must(await sb.from('decks').select('id').eq('owner_profile_id', state.profile.id).eq('archived', false).limit(1));
      const phDeck = must(await sb.from('decks').insert({ owner_member_id: ph.id, commander_name: 'Wegwerf Deck', short_name: 'Wegwerf' }).select('id').single());
      const game = must(await sb.rpc('start_game', { p_group: g.id, p_layout: 'seiten', p_starting_life: 40, p_first_seat: 0,
        p_players: [{ member_id: me, deck_id: own[0].id, seat: 0 }, { member_id: ph.id, deck_id: phDeck.id, seat: 1 }], p_played_on: null }));
      return { gid: g.id, game: game.id, phDeck: phDeck.id };`, TEMP_NAME);
    tempGid = made.gid;
    ok('K6b Wegwerf-Gruppe mit Spiel angelegt', !!(made.gid && made.game), JSON.stringify(made));
    await A.evaluate((g) => localStorage.setItem('ttg.group', g), made.gid);
    await A.goto(BASE + '#/gruppen');
    await A.reload();
    await A.waitForSelector('[data-act="delete-group"]');
    ok('K6b Wegwerf-Gruppe ist aktiv', (await A.textContent('.pick[aria-pressed="true"]')).includes('Wegwerf'));
    await A.click('[data-act="delete-group"]');
    await A.waitForSelector('.sheet #dg-name');
    ok('K6b Sheet zählt 1 Spiel, 1 Spieler ohne Konto', /1 Spiel\b/.test(await A.textContent('.sheet [data-warn]')) && /1 Spieler ohne Konto/.test(await A.textContent('.sheet [data-warn]')),
      await A.textContent('.sheet [data-warn]'));
    await A.fill('#dg-name', TEMP_NAME);
    await A.click('[data-act="delete-group-yes"]');
    await waitHash(A, '#/start');
    await A.waitForSelector('.group-switch');
    ok('K6b nach dem Löschen ⇒ Start der verbleibenden Gruppe (Küchentisch)', (await A.textContent('.group-switch')).includes('Küchentisch'));
    const left = await db(`
      const g = await sb.from('playgroups').select('id').eq('id', a.gid);
      const d = await sb.from('decks').select('id').eq('id', a.phDeck);
      const gm = await sb.from('games').select('id').eq('id', a.game);
      return { groups: g.data?.length ?? -1, decks: d.data?.length ?? -1, games: gm.data?.length ?? -1, store: localStorage.getItem('ttg.group') };`, made);
    ok('K6b Gruppe, Spiel und Deck des Spielers ohne Konto sind weg; Merker zeigt nicht mehr auf sie',
      left.groups === 0 && left.decks === 0 && left.games === 0 && left.store !== made.gid, JSON.stringify(left));
    await A.shot('nach-gruppe-loeschen');
  }

  for (const [n, p] of [['P', P], ['GB', B], ['GA', A]]) {
    ok(`Keine JS-Fehler bei ${n}`, p.errs.length === 0, p.errs.join(' | '));
    const unexpected = p.bad.filter((x) => !(n === 'GA' && expectedBad.has(x)));
    ok(`Keine unerwarteten HTTP-Fehler bei ${n}`, unexpected.length === 0, JSON.stringify(unexpected));
  }
  for (const p of [P, B, A]) await p.context().close();
  if (tempGid) console.log(`    Wegwerf-Gruppe ${tempGid} über die UI gelöscht`);
}
