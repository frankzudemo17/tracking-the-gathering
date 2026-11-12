// E2E Revanche (P2, Welle ttg-features, spec-p2-revanche.md Kriterien 7, 8, 11–13, 16, 21; Fälle V1–V6).
// Feste Konten: A = 'a' „Franco Test“ (Deck Tymna) · B = 'b' „Luka Test“ (Deck Krenko) · Jo = Platzhalter „Jo Test“.
// Legt KEIN Konto, KEIN Mitglied, KEIN Deck an; kein Foto. Die Spiele <g> (finished) und <g2> (live) räumt der
// Grundzustand des Runners (run.mjs) vor jeder Datei und am Ende — wie in allen E2E-Dateien.
// Ausgaben nur Wahrheitswerte (keine Adresse, keine Konto-/Mitglieds-/Spiel-ID).
import { ok, ctx, waitHash, login, prepare } from './harness.mjs';

export default async function revancheE2e({ browser, base: BASE }) {
  await prepare({ members: ['b', 'c'], placeholders: ['Jo Test'], decks: [['a', 'tymna'], ['b', 'krenko']] });
  console.log('\nRevanche: Anmelden als A (Franco Test)');
  const P = await ctx(browser, 'R');
  await P.setViewportSize({ width: 375, height: 812 });
  await P.goto(BASE);
  await waitHash(P, '#/login');
  await login(P, 'a');
  await waitHash(P, '#/start');
  ok('A angemeldet', true);

  const db = (fn, arg) => P.evaluate(async ([src, a]) => {
    const { sb } = await import('/src/supabase.js');
    const { state } = await import('/src/state.js');
    const { createStore } = await import('/src/lib/game-store.js');
    // eslint-disable-next-line no-new-func
    return new Function('sb', 'state', 'createStore', 'a', `return (async () => { ${src} })()`)(sb, state, createStore, a);
  }, [fn, arg]);
  const poll = async (fn, arg, pred, ms = 10000) => {
    const end = Date.now() + ms; let v;
    do { v = await db(fn, arg); if (pred(v)) return v; await P.waitForTimeout(300); } while (Date.now() < end);
    return v;
  };
  const toastIs = (re, ms = 8000) => P.waitForFunction((src) => new RegExp(src).test(document.querySelector('#toast')?.textContent || ''), re.source, { timeout: ms }).then(() => true, () => false);
  const label = () => P.evaluate(() => document.querySelector('[data-act="rematch"]')?.textContent?.trim() ?? null);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---------------------------------------------------------------- Aufbau
  const gid = await db('return state.groupId;');
  const KEY = `ttg.setup.${gid}`;
  const mem = await db("const r = await sb.from('members').select('id, profile_id, display_name, profiles!members_profile_id_fkey(display_name)').eq('playgroup_id', a); return r.data;", gid);
  const byName = (n) => mem.find((m) => (m.profiles?.display_name || m.display_name) === n);
  const A = byName('Franco Test')?.id, B = byName('Luka Test')?.id, J = byName('Jo Test');
  ok('Gruppe hat A, B und Platzhalter Jo', !!(A && B && J?.id && J.profile_id == null));
  const deck = (q) => db("const r = await sb.from('decks').select('id').ilike('commander_name', a).eq('archived', false).limit(1); return r.data?.[0];", q);
  const tymna = await deck('Tymna%'), krenko = await deck('Krenko%');
  ok('Decks Tymna (A) und Krenko (B) vorhanden', !!(tymna?.id && krenko?.id));

  // ---------------------------------------------------------------- V1 Spiel B0 · Jo1 · A2, rundum, 30, firstSeat 1 ⇒ beenden ⇒ Ergebnis mit „Revanche“
  const g = await db(`return createStore(sb).startGame({ groupId: a.gid, layout: 'rundum', startingLife: 30, firstSeat: 1,
      players: [{ memberId: a.B, deckId: a.k, seat: 0 }, { memberId: a.J, deckId: a.k, seat: 1 }, { memberId: a.A, deckId: a.t, seat: 2 }] });`,
  { gid, A, B, J: J.id, t: tymna.id, k: krenko.id });
  ok('V1 Spiel B · Jo · A gestartet (rundum, 30, Startsitz 1)', typeof g === 'string' && g.length > 10);
  await P.goto(BASE + '#/spiel/' + g);
  await P.waitForSelector('.lc-field');
  const tap = async (id, n) => { for (let i = 0; i < n; i++) await P.click(`.lc-field[data-pid="${id}"] .lc-tap.minus`); };
  await tap(B, 3);
  await tap(J.id, 5);
  await P.waitForTimeout(800);
  await P.click('.lc-hub');
  await P.click('[data-sheet="menu"] [data-m="end"]');
  await P.waitForSelector('[data-sheet="end"]');
  await P.click('[data-sheet="end"] [data-e="finished"]');
  await waitHash(P, `#/spiel/${g}/ende`);
  const fin = await poll("const s = await sb.from('games').select('status').eq('id', a).single(); return s.data?.status;", g, (v) => v === 'finished');
  await P.waitForSelector('.rs-hero');
  ok('V1 „Werten und beenden“ ⇒ #/spiel/<g>/ende, Spiel finished', P.url().endsWith(`#/spiel/${g}/ende`) && fin === 'finished');
  ok('V1 [data-act="rematch"] mit Text „Revanche“', (await label()) === 'Revanche');

  // ---------------------------------------------------------------- V2 Tipp ohne Eingabe ⇒ Setup vorbelegt, nichts gespeichert
  const lineup = () => P.waitForSelector('.su-row').then(() => P.waitForTimeout(400)).then(() => P.evaluate((key) => ({
    hash: location.hash,
    pressed: [...document.querySelectorAll('[data-act="member"][aria-pressed="true"]')].map((b) => b.dataset.id).sort(),
    rows: [...document.querySelectorAll('.su-row[data-mid]')].map((r) => r.dataset.mid),
    layout: [...document.querySelectorAll('[data-act="layout"][aria-pressed="true"]')].map((b) => b.dataset.l),
    life: document.querySelector('.su-lifebig')?.textContent?.trim(),
    starter: document.querySelector('.su-startrow b')?.textContent?.trim(),
    rollOn: document.querySelector('[data-act="roll"]')?.disabled === false,
    draft: (() => { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } })(),
  }), KEY));
  const checkLineup = (tag, s) => {
    ok(`${tag} Hash #/spiel-neu`, s.hash === '#/spiel-neu');
    ok(`${tag} genau A, B, Jo gedrückt`, same(s.pressed, [A, B, J.id].sort()));
    ok(`${tag} Reihenfolge der Zeilen = Sitzordnung B · Jo · A`, same(s.rows, [B, J.id, A]));
    ok(`${tag} Layout „rundum“ gedrückt`, same(s.layout, ['rundum']));
    ok(`${tag} Startleben 30`, s.life === '30');
    ok(`${tag} Deck je Zeile = Deck des Spiels (B Krenko · Jo Krenko · A Tymna)`, same([s.draft?.deck?.[B], s.draft?.deck?.[J.id], s.draft?.deck?.[A]], [krenko.id, krenko.id, tymna.id]));
    ok(`${tag} Starter „Noch nicht ausgewürfelt“, Würfeln aktiv`, s.starter === 'Noch nicht ausgewürfelt' && s.rollOn);
    ok(`${tag} gespeicherter Entwurf ohne rematch, start null`, !!s.draft && !('rematch' in s.draft) && s.draft.start === null);
  };
  await P.click('[data-act="rematch"]');
  await waitHash(P, '#/spiel-neu');
  const s2 = await lineup();
  checkLineup('V2', s2);
  const jo = await P.evaluate((id) => document.querySelector(`[data-act="member"][data-id="${id}"] small`)?.textContent?.trim() ?? null, J.id);
  ok('V2 Platzhalter Jo mit „ohne Konto“', jo === 'ohne Konto');
  const pr0 = await db("const r = await sb.from('player_ratings').select('member_id').eq('game_id', a); return r.data?.length ?? -1;", g);
  ok('V2 player_ratings für <g> = 0 Zeilen', pr0 === 0);
  await P.shot('p2-v2-setup-revanche');

  // ---------------------------------------------------------------- V3 Deck von Jo wechseln, Start ⇒ neues Spiel live, first_seat 0
  await P.click(`.su-deckbtn[data-act="cycle"][data-mid="${J.id}"]`);
  await P.waitForTimeout(400);
  const d3 = await P.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || 'null'), KEY);
  const joDeck = d3?.deck?.[J.id];
  ok('V3 Deck von Jo gewechselt (nicht mehr Krenko)', typeof joDeck === 'string' && joDeck !== krenko.id);
  await P.click('[data-act="start"]');
  const started = await P.waitForFunction((old) => /^#\/spiel\/[^/]+$/.test(location.hash) && location.hash !== `#/spiel/${old}`, g, { timeout: 15000 }).then(() => true, () => false);
  const g2 = decodeURIComponent((await P.evaluate(() => location.hash)).replace('#/spiel/', ''));
  ok('V3 Start ⇒ #/spiel/<g2> (neues Spiel)', started && g2 !== g);
  const NEW = `const s = await sb.from('games').select('status, layout, starting_life, first_seat').eq('id', a).single();
    const p = await sb.from('game_players').select('member_id, deck_id, seat').eq('game_id', a).order('seat');
    return { g: s.data, p: p.data };`;
  const r3 = await poll(NEW, g2, (v) => v?.g?.status === 'live' && v?.p?.length === 3);
  ok('V3 REST: status live, layout rundum, starting_life 30', r3?.g?.status === 'live' && r3.g.layout === 'rundum' && r3.g.starting_life === 30);
  ok('V3 REST: first_seat 0 (Ursprung hatte 1)', r3?.g?.first_seat === 0);
  ok('V3 REST: Sitze B0 · Jo1 · A2', same((r3?.p || []).map((x) => [x.member_id, x.seat]), [[B, 0], [J.id, 1], [A, 2]]));
  ok('V3 REST: Decks B Krenko · Jo neues Deck · A Tymna', same((r3?.p || []).map((x) => x.deck_id), [krenko.id, joDeck, tymna.id]));
  const gone = await P.evaluate((key) => { try { return sessionStorage.getItem(key) === null; } catch { return false; } }, KEY);
  ok('V3 Entwurf danach gelöscht', gone);

  // ---------------------------------------------------------------- V4 Ergebnis geändert ⇒ „Speichern und Revanche“ ⇒ gespeichert, Setup
  await P.goto(BASE + `#/spiel/${g}/ende`);
  await P.waitForSelector('.rs-hero');
  ok('V4 unverändert „Revanche“', (await label()) === 'Revanche');
  await P.click('[data-pick="salt"][data-v="3"]');
  ok('V4 nach Salz 3: „Speichern und Revanche“', (await label()) === 'Speichern und Revanche');
  await P.shot('p2-v4-ergebnis-geaendert');
  await P.click('[data-act="rematch"]');
  const saved = await toastIs(/^Gespeichert$/);
  await waitHash(P, '#/spiel-neu');
  ok('V4 Toast „Gespeichert“, #/spiel-neu', saved && P.url().endsWith('#/spiel-neu'));
  const pr = await poll("const r = await sb.from('player_ratings').select('member_id, salt').eq('game_id', a); return r.data;", g, (v) => v?.length === 1);
  ok('V4 REST player_ratings: A mit salt 3', pr?.length === 1 && pr[0].member_id === A && pr[0].salt === 3);

  // ---------------------------------------------------------------- V5 Partie-Detail ⇒ Revanche ⇒ dieselbe Aufstellung
  await P.goto(BASE + `#/partie/${g}`);
  await P.waitForSelector('.gd-hero');
  ok('V5 Partie-Detail: [data-act="rematch"] „Revanche“', (await label()) === 'Revanche');
  await P.click('[data-act="rematch"]');
  await waitHash(P, '#/spiel-neu');
  checkLineup('V5', await lineup());

  // ---------------------------------------------------------------- V6
  ok('V6 Keine JS-Fehler', P.errs.length === 0, P.errs.join(' | '));
  ok('V6 Keine HTTP-Fehler', P.bad.length === 0, JSON.stringify(P.bad));
  await P.context().close();
}
