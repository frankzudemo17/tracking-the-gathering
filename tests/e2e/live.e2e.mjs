// E2E Live-UI (Spec P6, Kriterien 1–6 und 9; Welle ttg-live-feinschliff-decks, E-L = B: nur Konten der Gruppe).
// Läuft nach life.e2e.mjs und VOR setup.e2e.mjs (alphabetisch) mit den Konten aus etappe1-2:
//   A = mail('a') „Franco Test“ (Admin, Deck Tymna + Thrasios) · B = mail('b') „Luka Test“ · beide in „Küchentisch“.
// Anmelden nur über die Harness-Helfer (login). Dieser Lauf legt KEINE Konten, Mitglieder, Decks, Pins
// oder Feldfarben an und beendet jedes gestartete Spiel (verworfen), damit setup.e2e unverändert gilt.
// Zwei Browser-Kontexte (A, B) = zwei Handys. Messungen aus dem Negativraum stehen als „MESSUNG“ im
// Protokoll (kein ok(), sie entscheiden nicht über Grün).
import { ok, ctx, waitHash, login, mail } from './harness.mjs';

const LOOKS = ['nacht', 'arktis', 'lachs'];
const NIL_GAME = '00000000-0000-4000-8000-0000000000aa';

export default async function liveE2e({ browser, base: BASE }) {
  // ---------------------------------------------------------------- zwei Handys, angemeldet
  console.log('\nLive: zwei Handys (A = Franco Test, B = Luka Test)');
  const PA = await ctx(browser, 'VA');
  const PB = await ctx(browser, 'VB');
  for (const P of [PA, PB]) await P.setViewportSize({ width: 375, height: 812 });
  await PA.goto(BASE); await waitHash(PA, '#/login'); await login(PA, mail('a')); await waitHash(PA, '#/start');
  await PB.goto(BASE); await waitHash(PB, '#/login'); await login(PB, mail('b')); await waitHash(PB, '#/start');
  ok('A und B angemeldet (Konten aus etappe1-2)', true);

  const db = (P, fn, arg) => P.evaluate(async ([src, a]) => {
    const { sb } = await import('/src/supabase.js');
    const { state } = await import('/src/state.js');
    const { createStore } = await import('/src/lib/game-store.js');
    // eslint-disable-next-line no-new-func
    return new Function('sb', 'state', 'createStore', 'a', `return (async () => { ${src} })()`)(sb, state, createStore, a);
  }, [fn, arg]);
  const until = async (fn, ms = 10000, step = 100) => {
    const end = Date.now() + ms; let v;
    do { try { v = await fn(); if (v) return v; } catch { /* Seite lädt noch */ } await PA.waitForTimeout(step); } while (Date.now() < end);
    return v;
  };
  const step = async (name, fn) => {
    try { await fn(); } catch (e) { ok(`${name} (Abbruch)`, false, String(e.message).split('\n')[0]); }
  };
  const field = (id) => `.lc-field[data-pid="${id}"]`;
  const lifeOf = async (P, id) => Number((await P.textContent(`${field(id)} [data-life]`)).trim());
  const lifes = async (P, ids) => { const o = []; for (const id of ids) o.push(await lifeOf(P, id)); return o; };
  const tap = async (P, id, sign, n = 1) => { for (let i = 0; i < n; i++) await P.click(`${field(id)} .lc-tap.${sign < 0 ? 'minus' : 'plus'}`); };
  const sheetOpen = (P) => P.evaluate(() => !!document.querySelector('.sheet-wrap'));
  const closeSheets = async (P) => {
    for (let i = 0; i < 3 && await sheetOpen(P); i++) { await P.keyboard.press('Escape'); await P.waitForTimeout(150); }
  };
  const menu = async (P, tab) => {
    if (!(await P.locator('[data-sheet="menu"]').count())) { await P.click('.lc-hub'); await P.waitForSelector('[data-sheet="menu"]'); }
    if (tab) await P.click(`[data-sheet="menu"] [data-m="tab"][data-t="${tab}"]`);
  };
  const text = async (P, sel) => ((await P.locator(sel).first().textContent().catch(() => '')) || '').trim();
  const channels = (P) => P.evaluate(async () => (await import('/src/supabase.js')).sb.getChannels().length);
  /** Bildschirmfoto je Look (375 × 812), Look nur am <html> umgestellt, danach zurück. */
  const looks = async (P, name) => {
    const orig = await P.evaluate(() => document.documentElement.dataset.theme);
    for (const lk of LOOKS) {
      await P.evaluate((l) => { document.documentElement.dataset.theme = l; }, lk);
      await P.waitForTimeout(250);
      await P.shot(`p6-${name}-${lk}`);
    }
    await P.evaluate((o) => { document.documentElement.dataset.theme = o; }, orig);
  };

  // ---------------------------------------------------------------- Aufbau: Gruppe, Mitglieder, Deck
  const gid = await db(PA, 'return state.groupId;');
  const gidB = await db(PB, 'return state.groupId;');
  ok('A und B haben dieselbe aktuelle Gruppe', !!gid && gid === gidB, `${gid} / ${gidB}`);
  const mem = await db(PA, "const r = await sb.from('members').select('id, display_name, profiles!members_profile_id_fkey(display_name)').eq('playgroup_id', a); return r.data;", gid);
  const byName = (n) => mem.find((m) => (m.profiles?.display_name || m.display_name) === n)?.id;
  const MA = byName('Franco Test'), MB = byName('Luka Test'), MC = byName('Tim Echt');
  ok('Gruppe hat A, B, C', !!(MA && MB && MC), JSON.stringify(mem));
  const deck = await db(PA, "const q = await sb.from('decks').select('id').ilike('commander_name', 'Tymna%').eq('archived', false).limit(1); return q.data?.[0];");
  const ALL = [MA, MB, MC];
  const started = [];
  const startGame = async () => {
    const id = await db(PA, `return createStore(sb).startGame({ groupId: a.gid, layout: 'seiten', startingLife: 40, firstSeat: 0,
      players: a.ids.map((id, i) => ({ memberId: id, deckId: a.deck, seat: i })) });`, { gid, ids: ALL, deck: deck?.id ?? null });
    started.push(id);
    return id;
  };
  const abort = (id) => db(PA, "const g = await sb.from('games').select('status').eq('id', a).maybeSingle(); if (g.data?.status !== 'live') return 'schon zu'; await createStore(sb).finishGame(a, { round: 1 }, 'aborted'); return 'verworfen';", id);
  const liveCount = () => db(PA, "const r = await sb.from('games').select('id').eq('playgroup_id', a).eq('status', 'live'); return r.data?.length ?? -1;", gid);
  const events = (id) => db(PA, "const r = await sb.from('game_events').select('seq, type, target, amount, payload').eq('game_id', a).order('seq'); return r.data;", id);

  try {
    const left = await liveCount();
    if (left > 0) console.log(`  (Vorlauf: ${left} laufende Spiele in der Gruppe — werden verworfen)`);
    if (left > 0) {
      const ids = await db(PA, "const r = await sb.from('games').select('id').eq('playgroup_id', a).eq('status', 'live'); return r.data.map((x) => x.id);", gid);
      for (const id of ids) await abort(id);
    }

    // -------------------------------------------------------------- K9a: kein laufendes Spiel
    await step('K9 kein Spiel', async () => {
      await PB.goto(BASE + '#/gruppen'); await PB.goto(BASE + '#/start');
      await PB.waitForSelector('[data-act="live"]');
      await PB.click('[data-act="live"]');
      const msg = await until(async () => { const v = await text(PB, '.toast'); return /läuft kein Spiel/.test(v) ? v : ''; }, 5000);
      await PB.waitForTimeout(400);
      ok('K9 kein laufendes Spiel ⇒ „Gerade läuft kein Spiel in dieser Gruppe.“, keine Navigation',
        /Gerade läuft kein Spiel in dieser Gruppe\./.test(msg || '') && (await PB.evaluate(() => location.hash)) === '#/start', `${msg} · ${await PB.evaluate(() => location.hash)}`);
    });

    // -------------------------------------------------------------- Spiel 1, B kommt über die Startseite
    const g1 = await startGame();
    ok('Spiel 1 gestartet (A)', typeof g1 === 'string' && g1.length > 10, String(g1));
    await PA.goto(BASE + '#/spiel/' + g1);
    await PA.waitForSelector('.lc-field');

    await step('K9 ein Spiel', async () => {
      await PB.goto(BASE + '#/gruppen'); await PB.goto(BASE + '#/start');
      await PB.waitForSelector(`[data-live-game="${g1}"]`);
      await PB.waitForTimeout(500);
      await looks(PB, 'start-laufend');
      await PB.click('[data-act="live"]');
      await until(() => PB.evaluate((g) => location.hash === '#/spiel/' + g, g1), 8000);
      ok('K9 ein laufendes Spiel ⇒ „Spiel beitreten“ öffnet dessen Lifecounter', (await PB.evaluate(() => location.hash)) === '#/spiel/' + g1, await PB.evaluate(() => location.hash));
      await PB.waitForSelector('.lc-field');
    });

    // -------------------------------------------------------------- K1: zwei Geräte, ein Spiel
    await step('K1', async () => {
      // B ist verbunden, bevor getippt wird (sonst misst K1 das Nachholen, nicht Realtime)
      await menu(PB, 'tools');
      await until(async () => /Live verbunden/.test(await text(PB, '[data-conn-text]')), 15000);
      await closeSheets(PB);
      await tap(PA, MA, -1, 3);
      await tap(PB, MB, +1, 2);
      const t0 = Date.now();
      const both = await until(async () => {
        const a = await lifes(PA, [MA, MB]); const b = await lifes(PB, [MA, MB]);
        return a[0] === 37 && a[1] === 42 && b[0] === 37 && b[1] === 42 ? Date.now() - t0 : 0;
      }, 6000);
      ok('K1 A −3 bei Spieler 1, B +2 bei Spieler 2 ⇒ beide zeigen 37 und 42 nach ≤ 3 s', both > 0 && both <= 3000,
        `nach ${both || '>6000'} ms · A ${await lifes(PA, [MA, MB])} · B ${await lifes(PB, [MA, MB])}`);
      const ev = await until(async () => { const e = await events(g1); return e.length >= 5 ? e : null; }, 8000);
      const sumOf = (id) => (ev || []).filter((e) => e.type === 'life' && e.target === id).reduce((s, e) => s + e.amount, 0);
      ok('K1 DB hat beide Ereignisse (Spieler 1: −3, Spieler 2: +2)', sumOf(MA) === -3 && sumOf(MB) === 2, JSON.stringify(ev));
    });

    // -------------------------------------------------------------- K2: gleichzeitig
    await step('K2', async () => {
      const before = (await events(g1)).length;
      await Promise.all([tap(PA, MC, -1, 5), tap(PB, MB, +1, 5)]);
      const ev = await until(async () => { const e = await events(g1); return e.length >= before + 10 ? e : null; }, 15000);
      const same = await until(async () => {
        const a = await lifes(PA, ALL); const b = await lifes(PB, ALL);
        return JSON.stringify(a) === JSON.stringify(b) && a[1] === 47 && a[2] === 35 ? a : null;
      }, 10000);
      ok('K2 je 5× gleichzeitig ⇒ beide Geräte dieselben Endwerte [37, 47, 35]', !!same, `A ${await lifes(PA, ALL)} · B ${await lifes(PB, ALL)}`);
      const seqs = (ev || []).map((e) => e.seq);
      ok('K2 game_events +10 Zeilen, seq eindeutig', (ev || []).length === before + 10 && new Set(seqs).size === seqs.length,
        `${before} → ${(ev || []).length} · seq ${seqs.join(',')}`);
    });

    // -------------------------------------------------------------- Rückgängig nennt die Aktion (WELLE Dirigat: Undo gilt für den Tisch)
    await step('Undo-Anzeige', async () => {
      await menu(PA, 'log');
      const w = await text(PA, '[data-undo-what]');
      ok('Rückgängig zeigt, welche Aktion es zurücknimmt (letzte am Tisch)', /^Nimmt zurück: /.test(w), w);
      await closeSheets(PA);
    });

    // -------------------------------------------------------------- K3: offline
    await step('K3', async () => {
      await PB.context().setOffline(true);
      await tap(PB, MA, -1, 2);
      await tap(PA, MC, -1, 1);
      await menu(PB, 'tools');
      const off = await until(async () => { const v = await text(PB, '[data-live-text]'); return /Offline – wird nachgeholt \(2\)/.test(v) ? v : ''; }, 5000);
      ok('K3 B offline + 2 Taps ⇒ Live-Status „Offline – wird nachgeholt (2)“', !!off, await text(PB, '[data-live-text]'));
      ok('K3 B offline ⇒ Verbindung „Keine Live-Verbindung“', /Keine Live-Verbindung/.test(await text(PB, '[data-conn-text]')), await text(PB, '[data-conn-text]'));
      await PB.locator('.lv-join').scrollIntoViewIfNeeded().catch(() => {});
      await looks(PB, 'status-offline');
      await PB.context().setOffline(false);
      const live = await until(async () => /Live verbunden/.test(await text(PB, '[data-conn-text]')), 30000, 250);
      ok('K3 B wieder online ⇒ „Live verbunden“', !!live, await text(PB, '[data-conn-text]'));
      await closeSheets(PB);
      const same = await until(async () => {
        const a = await lifes(PA, ALL); const b = await lifes(PB, ALL);
        return JSON.stringify(a) === JSON.stringify(b) && a[0] === 35 && a[2] === 34 ? a : null;
      }, 15000);
      ok('K3 danach beide Geräte gleiche Werte [35, 47, 34]', !!same, `A ${await lifes(PA, ALL)} · B ${await lifes(PB, ALL)}`);
    });

    // -------------------------------------------------------------- K6: Live-Status verbunden mit „Handy dazuholen“
    await step('K6 Bild verbunden', async () => {
      await menu(PA, 'tools');
      await until(async () => /Live verbunden/.test(await text(PA, '[data-conn-text]')), 10000);
      ok('Live-Status A „Live verbunden“ + „Handy dazuholen“ mit „Link teilen“',
        /Live verbunden/.test(await text(PA, '[data-conn-text]')) && /Handy dazuholen/.test(await text(PA, '.lv-join')) && /Link teilen/.test(await text(PA, '.lv-join [data-m="share"]')));
      await PA.locator('.lv-join').scrollIntoViewIfNeeded();
      await looks(PA, 'status-verbunden');
      await closeSheets(PA);
    });

    // -------------------------------------------------------------- Negativraum: zwei Geräte drücken gleichzeitig „Zug beenden“
    try {
      const evBefore = await events(g1);
      const seatBefore = await PA.evaluate(() => document.querySelector('.lc-field.turn')?.dataset.pid);
      await Promise.all([PA.click('.lc-field.turn [data-act="endturn"]'), PB.click('.lc-field.turn [data-act="endturn"]')]);
      await PA.waitForTimeout(4000);
      const evAfter = await events(g1);
      const ends = evAfter.slice(evBefore.length).filter((e) => e.type === 'turn_end').length;
      const turnA = await PA.evaluate(() => document.querySelector('.lc-field.turn')?.dataset.pid);
      const turnB = await PB.evaluate(() => document.querySelector('.lc-field.turn')?.dataset.pid);
      const nm = (id) => ({ [MA]: 'A', [MB]: 'B', [MC]: 'C' }[id] ?? id);
      console.log(`  MESSUNG doppeltes „Zug beenden“: ${ends}× turn_end in der DB · am Zug vorher ${nm(seatBefore)} · danach A-Gerät ${nm(turnA)}, B-Gerät ${nm(turnB)}`);
    } catch (e) { console.log('  MESSUNG doppeltes „Zug beenden“ nicht möglich:', e.message.split('\n')[0]); }

    // -------------------------------------------------------------- K5: B verlässt den Lifecounter
    await step('K5', async () => {
      ok('K5 vorher: B hat einen Realtime-Kanal', (await channels(PB)) === 1, String(await channels(PB)));
      await menu(PB);
      await PB.click('[data-sheet="menu"] [data-m="home"]');
      await waitHash(PB, '#/start');
      const n = await until(async () => ((await channels(PB)) === 0 ? 'leer' : ''), 6000);
      ok('K5 B verlässt den Lifecounter ⇒ kein offener Realtime-Kanal (sb.getChannels().length === 0)', n === 'leer', String(await channels(PB)));
    });

    // -------------------------------------------------------------- K9: mehrere laufende Spiele ⇒ Auswahl
    let g2 = null;
    await step('K9 Auswahl', async () => {
      g2 = await startGame();
      await PB.goto(BASE + '#/gruppen'); await PB.goto(BASE + '#/start');
      await PB.waitForSelector(`[data-live-game="${g2}"]`);
      await PB.click('[data-act="live"]');
      await PB.waitForSelector('.lv-pick');
      await PB.waitForTimeout(500);
      const ids = await PB.$$eval('.lv-pick', (els) => els.map((e) => e.dataset.pick));
      ok('K9 zwei laufende Spiele ⇒ Auswahl-Sheet mit zwei Einträgen', ids.length === 2 && ids.includes(g1) && ids.includes(g2), ids.join(','));
      await looks(PB, 'start-auswahl');
      await PB.click(`.lv-pick[data-pick="${g1}"]`);
      await until(() => PB.evaluate((g) => location.hash === '#/spiel/' + g, g1), 8000);
      ok('K9 Tipp auf einen Eintrag öffnet genau dieses Spiel', (await PB.evaluate(() => location.hash)) === '#/spiel/' + g1, await PB.evaluate(() => location.hash));
      await PB.waitForSelector('.lc-field');
      console.log('  g2', await abort(g2));
    });

    // -------------------------------------------------------------- K4: Spielende von außen
    await step('K4', async () => {
      await until(async () => { await menu(PB, 'tools'); const v = /Live verbunden/.test(await text(PB, '[data-conn-text]')); await closeSheets(PB); return v; }, 15000, 500);
      await closeSheets(PA);
      await menu(PA);
      await PA.click('[data-sheet="menu"] [data-m="end"]');
      await PA.waitForSelector('[data-sheet="end"] [data-e="aborted"]');
      await PA.click('[data-sheet="end"] [data-e="aborted"]');
      await waitHash(PA, '#/start');
      const ended = await until(async () => /Spiel wurde beendet/.test(await text(PB, '#view')), 8000);
      ok('K4 A „Verwerfen“ ⇒ B zeigt „Spiel wurde beendet“ (+ Weg zur Startseite)',
        !!ended && (await PB.locator('[data-live-ended][href="#/start"]').count()) === 1, (await text(PB, '#view')).slice(0, 160));
      ok('K4 A selbst sieht keinen Hinweis, sondern die Startseite', (await PA.evaluate(() => location.hash)) === '#/start');
      await looks(PB, 'beendet');
      const n = await until(async () => ((await channels(PB)) === 0 ? 'leer' : ''), 6000);
      ok('K4/K5 nach Spielende kein offener Realtime-Kanal auf B', n === 'leer', String(await channels(PB)));
    });

    // -------------------------------------------------------------- Negativraum: Spiel-Link ohne Zugriff
    // RLS liefert für ein Spiel einer fremden Gruppe genau dasselbe wie für ein unbekanntes (0 Zeilen):
    // gemessen wird der Pfad mit einer unbekannten Spiel-ID (kein Konto außerhalb der Gruppe in diesem Lauf).
    try {
      const before = PB.bad.length;
      await PB.goto(BASE + '#/spiel/' + NIL_GAME);
      await PB.waitForSelector('.empty, .lc-field', { timeout: 10000 });
      const fieldN = await PB.locator('.lc-field').count();
      const view = (await text(PB, '#view')).replace(/\s+/g, ' ').slice(0, 160);
      console.log(`  MESSUNG Spiel-Link ohne Zugriff: Lifecounter-Felder ${fieldN} · Anzeige „${view}“ · HTTP ≥ 400 neu: ${PB.bad.slice(before).join(', ') || 'keine'}`);
    } catch (e) { console.log('  MESSUNG Spiel-Link ohne Zugriff nicht möglich:', e.message.split('\n')[0]); }
  } finally {
    // Kein laufendes Spiel zurücklassen (setup.e2e und Startseiten-Prüfungen danach)
    for (const id of started) { try { const r = await abort(id); if (r !== 'schon zu') console.log(`  Aufräumen: Spiel ${id} ${r}`); } catch (e) { console.log(`  Aufräumen: Spiel ${id} nicht verworfen: ${e.message}`); } }
    try { ok('Nach dem Lauf: kein laufendes Spiel in der Gruppe', (await liveCount()) === 0); } catch { /* Seite weg */ }
    // Konsolenfehler aus Offline-Phase und Fremd-Link sind erwartet (nur Protokoll); Skriptfehler nicht
    const all = [...PA.errs, ...PB.errs];
    const pageErrs = all.filter((e) => e.startsWith('pageerror'));
    if (all.length > pageErrs.length) console.log(`  Konsole (erwartet, nur Protokoll): ${all.filter((e) => !e.startsWith('pageerror')).slice(0, 4).join(' | ')}`);
    ok('Keine Skriptfehler (pageerror) auf A und B', pageErrs.length === 0, pageErrs.slice(0, 5).join(' | '));
  }
}
