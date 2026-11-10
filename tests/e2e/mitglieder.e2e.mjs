// E2E Mitglieder (Spec P10, Krit. 17 + 18) unter dem P9b-Harness: feste Konten, nur TTG-E2E-Fixture,
// Grundzustand davor und danach (run.mjs; nach dem db push über remove_member, harness.mjs).
// Abgefangen (laufen immer): die RPCs werden auf KONTEXT-Ebene beantwortet ⇒ kein schreibender Aufruf erreicht
// Prod. Kein Fall mit dem Superadmin-Konto: „Superadmin“ entsteht nur in der abgefangenen Profil-Antwort von A.
// Echt nur bei mitgliederLive() (gibt es member_removal_check in Prod?), sonst sichtbar übersprungen.
import {
  ok, skip, ctx, waitHash, login, prepare, ensureDeck, fixtureIds, rpc, get, mitgliederLive,
} from './harness.mjs';

const RPC = (fn) => `**/rest/v1/rpc/${fn}`;
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function loggedIn(browser, BASE, name) {
  const p = await ctx(browser, name);
  await p.goto(BASE);
  await waitHash(p, '#/login');
  await login(p, 'a');
  await waitHash(p, '#/start');
  return p;
}

export default async function mitgliederE2e({ browser, base: BASE }) {
  const fx = fixtureIds();
  const { placeholders } = await prepare({ placeholders: ['Mo Test'] });
  const mo = placeholders['Mo Test'];

  // ---------------------------------------------------------------- 17 abgefangen: Knopf → Probelauf → Sheet → remove_member
  console.log('\nMitglieder: Entfernen mit abgefangenen RPCs');
  const M = await ctx(browser, 'MA');
  const calls = [];
  const checks = [{ mode: 'delete', games: 0, live_games: 0, decks: 0, files: [] }];
  const removes = [];
  await M.context().route(RPC('member_removal_check'), async (r) => {
    calls.push(['member_removal_check', r.request().postDataJSON()]);
    json(r, checks.length > 1 ? checks.shift() : checks[0]);
  });
  await M.context().route(RPC('remove_member'), async (r) => {
    calls.push(['remove_member', r.request().postDataJSON()]);
    const next = removes.shift();
    if (next) json(r, next.body, next.status); else json(r, { result: r.request().postDataJSON().p_expect === 'delete' ? 'deleted' : 'marked' });
  });
  await M.goto(BASE);
  await waitHash(M, '#/login');
  await login(M, 'a');
  await waitHash(M, '#/start');
  await M.goto(BASE + '#/profil/' + mo.id);
  await M.waitForSelector('[data-act="remove-member"]');
  ok('K17 Admin A sieht „Aus Gruppe entfernen“ beim Platzhalter', (await M.locator('[data-act="remove-member"]').count()) === 1);
  await M.click('[data-act="remove-member"]');
  await M.waitForSelector('.sheet [data-remove-mode="delete"]');
  const t1 = await M.textContent('.sheet');
  ok('K17 Sheet „delete“ mit Soll-Text', /Mo Test hat noch kein Spiel und wird vollständig gelöscht\./.test(t1), t1);
  await M.shot('p10-sheet-delete');
  await M.click('.sheet [data-act="remove-yes"]');
  await waitHash(M, '#/gruppen');
  ok('K17 Aufrufe: Probelauf, dann remove_member mit p_expect aus dem Probelauf',
    JSON.stringify(calls) === JSON.stringify([['member_removal_check', { p_member: mo.id }], ['remove_member', { p_member: mo.id, p_expect: 'delete' }]]), JSON.stringify(calls));

  // member_state_changed ⇒ zweiter Probelauf, zweites Sheet
  calls.length = 0;
  checks.splice(0, checks.length, { mode: 'delete', games: 0, live_games: 0, decks: 0, files: [] }, { mode: 'mark', games: 1, live_games: 1, decks: 0, files: [] });
  removes.push({ status: 400, body: { code: 'P0001', message: 'member_state_changed', details: null, hint: null } });
  await M.goto(BASE + '#/profil/' + mo.id);
  await M.waitForSelector('[data-act="remove-member"]');
  await M.click('[data-act="remove-member"]');
  await M.waitForSelector('.sheet [data-remove-mode="delete"]');
  await M.click('.sheet [data-act="remove-yes"]');
  await M.waitForSelector('.sheet [data-again] ~ [data-remove-mode="mark"]');
  const t2 = await M.textContent('.sheet');
  ok('K17 member_state_changed ⇒ zweites Sheet im neuen Modus mit Hinweis', /in einem Spiel eingetragen/.test(t2) && /Ein laufendes Spiel mit Mo Test läuft weiter\./.test(t2), t2);
  await M.shot('p10-sheet-zweites');
  await M.click('.sheet [data-act="remove-yes"]');
  await M.waitForFunction(() => !document.querySelector('.sheet-wrap'));
  await M.waitForTimeout(400);
  ok('K17 Aufrufe: check, remove(delete) ⇒ changed, check, remove(mark)',
    JSON.stringify(calls.map(([f, a]) => f + ':' + (a.p_expect || ''))) === JSON.stringify(['member_removal_check:', 'remove_member:delete', 'member_removal_check:', 'remove_member:mark']),
    JSON.stringify(calls));
  const stillThere = await get('a', `members?select=id&id=eq.${mo.id}`);
  ok('K17 abgefangen ⇒ Platzhalter in Prod unverändert da', stillThere.length === 1);

  // ---------------------------------------------------------------- 18 abgefangen: Superadmin ohne Gruppe ⇒ Verwaltung
  console.log('\nMitglieder: Superadmin ohne Gruppe (abgefangen, Konto A mit vorgespielter Profil-Antwort)');
  const S = await ctx(browser, 'MS');
  const asSuper = async (r) => {
    const res = await r.fetch();
    let body = await res.json();
    body = Array.isArray(body) ? body.map((x) => ({ ...x, is_superadmin: true })) : { ...body, is_superadmin: true };
    json(r, body);
  };
  await S.context().route('**/rest/v1/profiles?*', asSuper);
  await S.context().route('**/rest/v1/members?*', async (r) => {
    const u = r.request().url();
    if (r.request().method() === 'GET' && /profile_id=eq\./.test(u) && /playgroups/.test(decodeURIComponent(u))) return json(r, []);
    return r.continue();
  });
  await S.context().route(RPC('access_overview'), (r) => json(r, { accounts: 3, max_accounts: 10, unconfirmed: 0 }));
  await S.context().route(RPC('list_all_playgroups'), (r) => json(r, [
    { id: '00000000-0000-4000-8000-0000000000a1', name: 'Gruppe Eins', members: 3, admins: 1, is_member: false },
    { id: '00000000-0000-4000-8000-0000000000a2', name: 'Gruppe Zwei', members: 2, admins: 0, is_member: false },
  ]));
  await S.goto(BASE);
  await waitHash(S, '#/login');
  await login(S, 'a');
  await waitHash(S, '#/willkommen');
  await S.goto(BASE + '#/einstellungen/verwaltung');
  await S.waitForSelector('[data-all-groups] .row');
  ok('K18 ohne Gruppe: #/einstellungen/verwaltung erreichbar, „Alle Gruppen“ mit 2 Zeilen',
    (await S.evaluate(() => location.hash)) === '#/einstellungen/verwaltung' && (await S.locator('[data-all-groups] .row').count()) === 2);
  ok('K18 „kein Admin“ und „Betreten“ sichtbar', (await S.locator('[data-all-groups] [data-no-admin]').count()) === 1 && (await S.locator('[data-act="enter"]').count()) === 2);
  await S.shot('p10-verwaltung-ohne-gruppe');

  // Gruppe verlassen: Warnsatz nur für den Superadmin als einzigen Admin (abgefangen; Abbrechen, kein Aufruf)
  const L = await ctx(browser, 'ML');
  await L.context().route('**/rest/v1/profiles?*', asSuper);
  let leaveCalls = 0;
  await L.context().route(RPC('leave_playgroup'), (r) => { leaveCalls++; json(r, { result: 'left', mode: 'delete', admins_left: 0 }); });
  await L.goto(BASE);
  await waitHash(L, '#/login');
  await login(L, 'a');
  await waitHash(L, '#/start');
  await L.goto(BASE + '#/gruppen');
  await L.waitForSelector('[data-act="leave"]');
  await L.click('[data-act="leave"]');
  await L.waitForSelector('.sheet [data-act="leave-yes"]');
  ok('K16 „Gruppe verlassen“: Warnsatz „keinen Admin“ für den einzigen Admin', (await L.locator('.sheet [data-no-admin]').count()) === 1);
  await L.shot('p10-verlassen-warnung');
  await L.click('.sheet [data-act="cancel"]');
  ok('K16 Abbrechen ⇒ kein leave_playgroup', leaveCalls === 0);

  // ---------------------------------------------------------------- 17 echt (nur mit der Migration in Prod)
  const REAL = [
    'K17 echt: A legt Platzhalter an und entfernt ihn ⇒ Zeile weg (API)',
    'K17 echt: Platzhalter mit einem Spiel ⇒ markiert, nicht im Spielaufbau, Name im Spieldetail',
    'K17 echt: wiederhergestellt ⇒ wieder im Spielaufbau',
  ];
  if (!(await mitgliederLive())) {
    for (const n of REAL) skip(n, 'übersprungen (Migration nicht in Prod) — mitgliederLive=false, Dirigent nach db push');
  } else {
    console.log('\nMitglieder: echt (Migration in Prod)');
    const R = await loggedIn(browser, BASE, 'MR');
    // (1) löschen
    const weg = (await prepare({ placeholders: ['Weg Test'] })).placeholders['Weg Test'];
    await R.goto(BASE + '#/profil/' + weg.id);
    await R.waitForSelector('[data-act="remove-member"]');
    await R.click('[data-act="remove-member"]');
    await R.waitForSelector('.sheet [data-remove-mode="delete"]');
    await R.click('.sheet [data-act="remove-yes"]');
    await waitHash(R, '#/gruppen');
    ok(REAL[0], (await get('a', `members?select=id&id=eq.${weg.id}`)).length === 0);

    // (2) markieren: ein beendetes Spiel A gegen Mo Test
    const aRow = (await get('a', `members?select=id&playgroup_id=eq.${fx.group}&profile_id=eq.${fx.a}`))[0];
    const dA = await ensureDeck('a', 'tymna');
    const dM = await ensureDeck({ member: mo.id }, 'krenko');
    const g = await rpc('a', 'start_game', { p_group: fx.group, p_layout: 'seiten', p_starting_life: 40, p_first_seat: 0, p_played_on: null,
      p_players: [{ member_id: aRow.id, deck_id: dA, seat: 0 }, { member_id: mo.id, deck_id: dM, seat: 1 }] });
    await rpc('a', 'finish_game', { p_game: g.id, p_status: 'finished', p_round: 3, p_results: [{ member_id: aRow.id, place: 1 }, { member_id: mo.id, place: 2, eliminated_round: 3, eliminated_by: aRow.id }] });
    await R.goto(BASE + '#/profil/' + mo.id);
    await R.waitForSelector('[data-act="remove-member"]');
    await R.click('[data-act="remove-member"]');
    await R.waitForSelector('.sheet [data-remove-mode="mark"]');
    await R.click('.sheet [data-act="remove-yes"]');
    await R.waitForSelector('.prof-head .chip.removed');
    const row = (await get('a', `members?select=removed_at&id=eq.${mo.id}`))[0];
    await R.goto(BASE + '#/spiel-neu');
    await R.waitForSelector('.su-chips');
    const chips = await R.textContent('.su-chips');
    await R.goto(BASE + '#/partie/' + g.id);
    await R.waitForTimeout(1500);
    const detail = await R.textContent('main, #app, body');
    ok(REAL[1], !!row?.removed_at && !/Mo Test/.test(chips) && /Mo Test/.test(detail), JSON.stringify({ removed: !!row?.removed_at, chips }));
    await R.shot('p10-echt-spieldetail');

    // (3) wiederherstellen
    await R.goto(BASE + '#/gruppen');
    await R.waitForSelector('[data-act="toggle-removed"]');
    await R.click('[data-act="toggle-removed"]');
    await R.click(`[data-act="restore"][data-id="${mo.id}"]`);
    await R.waitForTimeout(1200);
    await R.goto(BASE + '#/spiel-neu');
    await R.waitForSelector('.su-chips');
    ok(REAL[2], /Mo Test/.test(await R.textContent('.su-chips')));
  }

  for (const [n, p] of [['MA', M], ['MS', S], ['ML', L]]) {
    ok(`Keine JS-Fehler bei ${n}`, p.errs.length === 0, p.errs.join(' | '));
    // erwartet: die abgefangene 400 (member_state_changed) bei MA
    const unexpected = p.bad.filter((x) => !(n === 'MA' && /^400 .*\/rpc\/remove_member$/.test(x)));
    ok(`Keine unerwarteten HTTP-Fehler bei ${n}`, unexpected.length === 0, unexpected.join(' | '));
  }
}
