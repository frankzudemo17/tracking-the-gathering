// E2E Abzeichen (Spec P4, Abschnitt „E2E“, Fälle E1–E5; Kriterium 32). Feste Fixture-Konten in TTG-E2E-Fixture:
//   A = 'a' „Franco Test“ (Deck Tymna) · B = 'b' „Luka Test“ (Deck Krenko) · C = 'c' „Tim Echt“ (Deck Tymna).
// prepare() holt B und C wie in spiel-ko.e2e.mjs in die Fixture-Gruppe (feste Testkonten, kein neues Konto, kein
// Platzhalter, kein neues Deck); run.mjs stellt vor und nach der Datei den Grundzustand her (Spiele weg).
// Das Spiel startet über den Store der App (RPC start_game), Schaden läuft über das Angriffsfenster (Ziehen, Quelle
// bekannt), das Ende über „Werten und beenden“. Ausgabe nur Wahrheitswerte und Zahlen (keine IDs, keine Adressen).
// E5 (Nachtrag 2/3): Fakten liegen im device-store (IndexedDB `ttg-geraet`, Objektspeicher `fakten`), nicht mehr
// unter localStorage `ttg.bf.*` ⇒ geprüft werden beide: 0 Datensätze in `fakten` und 0 Schlüssel `ttg.bf.*`.
import { ok, ctx, waitHash, login, prepare } from './harness.mjs';

const OBS3 = ['messers-schneide', 'commander-henker', 'comeback', 'doppelschlag'];

export default async function abzeichenE2e({ browser, base: BASE }) {
  await prepare({ members: ['b', 'c'], decks: [['a', 'tymna'], ['b', 'krenko']] });
  console.log('\nAbzeichen: Anmelden als A (Franco Test)');
  const P = await ctx(browser, 'BDG');
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

  // ---------------------------------------------------------------- Aufbau
  const gid = await db('return state.groupId;');
  const mem = await db("const r = await sb.from('members').select('id, display_name, profiles!members_profile_id_fkey(display_name)').eq('playgroup_id', a); return r.data;", gid);
  const byName = (n) => mem.find((m) => (m.profiles?.display_name || m.display_name) === n)?.id;
  const A = byName('Franco Test'), B = byName('Luka Test'), C = byName('Tim Echt') || null;
  const nameA = 'Franco Test'; // Anzeigename wie history-data (profiles.display_name vor members.display_name)
  ok('Gruppe hat A und B', !!(A && B), `Mitglieder ${mem?.length ?? 0}`);
  const OBS = C ? OBS3 : OBS3.slice(0, 3);
  console.log(`    drei Spieler: ${!!C} · beobachtete Abzeichen: ${OBS.length}`);
  const decks = await db("const q = await sb.from('decks').select('id, commander_name').eq('archived', false); return q.data;");
  const tymna = decks?.find((d) => /^Tymna/.test(d.commander_name));
  const krenko = decks?.find((d) => /^Krenko/.test(d.commander_name)) || tymna;
  ok('Decks Tymna und Krenko vorhanden', !!(tymna?.id && krenko?.id), `Decks ${decks?.length ?? 0}`);
  const finishedCount = () => db("const r = await sb.from('games').select('id', { count: 'exact', head: true }).eq('playgroup_id', a).eq('status', 'finished'); return r.count ?? -1;", gid);
  const fin0 = await finishedCount();
  console.log(`    beendete Partien der Fixture-Gruppe vorher: ${fin0}`);

  const names = await P.evaluate(async () => {
    const L = (await import('/src/i18n/de-badges.js')).default.list;
    return Object.fromEntries(Object.entries(L).map(([id, v]) => [id, v.name]));
  });

  /** Profil: 21 Zellen, Statuszeile leer, Zustand zweimal hintereinander gleich (1,2 s Abstand). */
  const cells = () => P.$$eval('#prof-bdg-wrap [data-badge]', (bs) => bs.map((b) => [b.dataset.badge, b.classList.contains('is-earned')]));
  const settleProfile = async () => {
    await P.waitForFunction(() => document.querySelectorAll('#prof-bdg-wrap [data-badge]').length === 21
      && !(document.querySelector('#prof-bdg-wrap .bdg-status')?.textContent || '').trim(), null, { timeout: 30000 });
    let prev = JSON.stringify(await cells());
    for (let i = 0; i < 20; i++) {
      await P.waitForTimeout(1200);
      const status = ((await P.textContent('#prof-bdg-wrap .bdg-status').catch(() => '')) || '').trim();
      const now = JSON.stringify(await cells());
      if (!status && now === prev) return new Map(JSON.parse(now));
      prev = now;
    }
    return new Map(JSON.parse(prev));
  };

  // ---------------------------------------------------------------- E1 vorher
  await P.goto(BASE + '#/profil');
  await waitHash(P, '#/profil');
  const before = await settleProfile();
  ok('E1 Profil: Abschnitt mit 21 Zellen, Statuszeile weg', before.size === 21, `Zellen ${before.size}`);
  const open1 = Object.fromEntries(OBS.map((id) => [id, before.get(id) === false]));
  for (const id of OBS) console.log(`    E1 ${id} offen: ${open1[id]}`);

  // ---------------------------------------------------------------- E2 Spiel
  const players = [A, B, ...(C ? [C] : [])];
  const deckOf = { [A]: tymna.id, [B]: krenko.id, ...(C ? { [C]: tymna.id } : {}) };
  const g = await db(`return createStore(sb).startGame({ groupId: a.gid, layout: 'seiten', startingLife: 40, firstSeat: 0,
      players: a.ids.map((id, i) => ({ memberId: id, deckId: a.decks[id], seat: i })) });`, { gid, ids: players, decks: deckOf });
  ok('E2 Spiel gestartet', typeof g === 'string' && g.length > 10);
  await P.goto(BASE + '#/spiel/' + g);
  await P.waitForSelector('.lc-field');

  const field = (id) => `.lc-field[data-pid="${id}"]`;
  const lifeOf = async (id) => Number((await P.textContent(`${field(id)} [data-life]`)).trim());
  const center = async (sel) => { const bb = await P.locator(sel).first().boundingBox(); return [bb.x + bb.width / 2, bb.y + bb.height / 2]; };
  const sheetGone = () => P.waitForFunction(() => !document.querySelector('.sheet-wrap'));
  const attack = async (fromId, toId, kind, amount) => {
    await P.waitForTimeout(450); // Tipps < 400 ms nach einem Ziehen zählen nicht
    const from = await center(field(fromId)), to = await center(field(toId));
    await P.mouse.move(from[0], from[1]); await P.mouse.down();
    await P.mouse.move(to[0], to[1], { steps: 14 });
    await P.mouse.up();
    await P.waitForSelector('[data-sheet="attack"]');
    if (kind !== 'damage') await P.click(`[data-sheet="attack"] [data-a="kind"][data-k="${kind}"]`);
    await P.click('[data-sheet="attack"] [data-a="quick"][data-v="20"]');
    for (let i = 20; i < amount; i++) await P.click('[data-sheet="attack"] [data-a="amt"][data-v="1"]');
    const label = (await P.textContent('[data-sheet="attack"] [data-a="apply"]')).trim();
    await P.click('[data-sheet="attack"] [data-a="apply"]');
    return label.startsWith(`${amount} `);
  };
  /** K.O. bestätigen: K.O.-Screen (Stufe 9) oder ruhiges Sheet, beides mit „Ausscheiden“ (Verursacher bekannt). */
  const confirmKo = async () => {
    const sel = '.ko[data-stage="9"] [data-ko="out"], [data-sheet="ko"] [data-ko="out"]';
    await P.waitForSelector(sel, { timeout: 15000 });
    await P.click(sel);
    await P.waitForFunction(() => !document.querySelector('.ko') && !document.querySelector('[data-sheet="ko"]'), null, { timeout: 15000 });
  };

  const l1 = await attack(B, A, 'damage', 39);
  await sheetGone();
  ok('E2 B → A Schaden 39 ⇒ A auf 1', l1 && (await lifeOf(A)) === 1, `A ${await lifeOf(A)}`);
  const l2 = await attack(A, B, 'cmd', 21);
  await confirmKo();
  ok('E2 A → B Commander-Schaden 21, B ausgeschieden', l2 && (await P.locator(`${field(B)} .lc-plaque`).count()) === 1);
  if (C) {
    const l3 = await attack(A, C, 'damage', 40);
    await confirmKo();
    ok('E2 A → C Schaden 40, C ausgeschieden (ohne Zugende dazwischen)', l3 && (await P.locator(`${field(C)} .lc-plaque`).count()) === 1);
  }
  // Ein Spieler übrig ⇒ das Ende-Fenster öffnet von selbst; sonst über das Menü
  const autoEnd = await P.waitForSelector('[data-sheet="end"]', { timeout: 6000 }).then(() => true, () => false);
  if (!autoEnd) {
    await P.click('.lc-hub');
    await P.click('[data-sheet="menu"] [data-m="end"]');
    await P.waitForSelector('[data-sheet="end"]');
  }
  await P.click('[data-sheet="end"] [data-e="finished"]');
  await waitHash(P, `#/spiel/${g}/ende`);
  await P.waitForSelector('.rs-hero');
  ok('E2 „Werten und beenden“ ⇒ Ergebnisseite', P.url().endsWith(`#/spiel/${g}/ende`));
  const evCount = await db("const r = await sb.from('game_events').select('type').eq('game_id', a).eq('type', 'eliminate'); return r.data?.length ?? -1;", g);
  console.log(`    eliminate-Ereignisse in game_events: ${evCount}`);

  // Neu-Abschnitt: Einträge von A (Name aus der Zeile, Titel = Abzeichen-Name, ggf. „ · Stufe …“)
  await P.waitForSelector('[data-bdg-new] .bdg-item', { state: 'attached', timeout: 20000 }).catch(() => {});
  await P.waitForLoadState('networkidle').catch(() => {});
  await P.waitForTimeout(1000);
  const rows = await P.$$eval('[data-bdg-new] .bdg-item', (lis) => lis.map((li) => [li.querySelector('.bdg-txt b')?.textContent.trim() ?? '', li.querySelector('.bdg-txt small')?.textContent.trim() ?? '']));
  const newA = new Set(OBS.filter((id) => rows.some(([label, who]) => who === nameA && (label === names[id] || label.startsWith(`${names[id]} · `)))));
  console.log(`    Neu-Einträge gesamt: ${rows.length} · davon beobachtet für A: ${newA.size}`);
  for (const id of OBS) ok(`E2 Neu „${id}“ für A genau dann, wenn in E1 offen`, newA.has(id) === open1[id], `neu ${newA.has(id)} · offen ${open1[id]}`);
  await P.shot('p4-e2-ergebnis');

  // ---------------------------------------------------------------- E3 Profil danach
  await P.goto(BASE + '#/profil');
  await waitHash(P, '#/profil');
  await settleProfile();
  // Statistik aus Prod kann nach der leeren Statuszeile nachkommen ⇒ bis 30 s auf die beobachteten Zellen warten
  await P.waitForFunction((ids) => ids.every((id) => document.querySelector(`#prof-bdg-wrap [data-badge="${id}"]`)?.classList.contains('is-earned')), OBS, { timeout: 30000 }).catch(() => {});
  const after = new Map(await cells());
  for (const id of OBS) ok(`E3 Profil: „${id}“ verdient`, after.get(id) === true);
  await P.shot('p4-e3-profil');
  const fin1 = await finishedCount();
  console.log(`    beendete Partien der Fixture-Gruppe nachher: ${fin1}`);

  // ---------------------------------------------------------------- E4 Neuladen ⇒ 0 Anfragen an game_events
  let evReq = 0;
  P.on('request', (r) => { if (/\/rest\/v1\/game_events(\?|$)/.test(r.url())) evReq++; });
  const maxVisits = fin1 > 200 ? 3 : 1;
  let visits = 0, last = -1;
  while (visits < maxVisits) {
    visits++;
    evReq = 0;
    await P.reload();
    await waitHash(P, '#/profil');
    await settleProfile();
    await P.waitForLoadState('networkidle').catch(() => {});
    last = evReq;
    if (last === 0) break;
  }
  console.log(`    E4 Besuche: ${visits} · Anfragen an game_events beim letzten Besuch: ${last}`);
  ok('E4 Neuladen + #/profil ⇒ 0 Anfragen an game_events', last === 0, `Anfragen ${last} · Besuche ${visits}`);

  // ---------------------------------------------------------------- E5 Abmelden ⇒ Fakten weg
  // Weg wie storeCheck in kaltstart.e2e.mjs: Warteschlange schreiben, keine leere DB anlegen
  const factsCount = () => P.evaluate(async () => {
    const ds = (await import(new URL('src/lib/device-store.js', location.href).href)).deviceStore;
    try { await ds.flush(); } catch { /* egal */ }
    const ls = Object.keys(localStorage).filter((k) => k.startsWith('ttg.bf.')).length;
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    if (!dbs.some((d) => d.name === 'ttg-geraet')) return { idb: 0, ls };
    const d = await new Promise((res, rej) => { const q = indexedDB.open('ttg-geraet'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    if (!d.objectStoreNames.contains('fakten')) { d.close(); return { idb: -1, ls }; }
    const n = await new Promise((res) => { const q = d.transaction('fakten').objectStore('fakten').count(); q.onsuccess = () => res(q.result); q.onerror = () => res(-1); });
    d.close();
    return { idb: n, ls };
  });
  ok('Keine JS-Fehler (bis vor dem Abmelden)', P.errs.length === 0, `Fehler ${P.errs.length}`);
  ok('Keine HTTP-Fehler (bis vor dem Abmelden)', P.bad.length === 0, `HTTP-Fehler ${P.bad.length}`);
  if (P.errs.length || P.bad.length) console.log('    Fehler (gekürzt):', JSON.stringify([...P.errs, ...P.bad].map((s) => s.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>').slice(0, 160))));
  const pre = await factsCount();
  ok('E5 vor dem Abmelden: Fakten im Gerätespeicher (≥ 1 Datensatz)', pre.idb >= 1, `fakten ${pre.idb}`);
  await P.goto(BASE + '#/einstellungen');
  await P.waitForSelector('[data-act="logout"]');
  await P.click('[data-act="logout"]');
  await waitHash(P, '#/login');
  let post = await factsCount();
  for (let i = 0; i < 10 && post.idb !== 0; i++) { await P.waitForTimeout(300); post = await factsCount(); }
  ok('E5 nach dem Abmelden: 0 Datensätze in fakten, 0 Schlüssel ttg.bf.*', post.idb === 0 && post.ls === 0, `fakten ${post.idb} · ttg.bf ${post.ls}`);

  ok('Keine JS-Fehler nach dem Abmelden', P.errs.length === 0, `Fehler ${P.errs.length}`);
  await P.context().close();
}
