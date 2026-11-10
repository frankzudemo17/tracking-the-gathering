// E2E Würfeltisch (Spec P9, Kriterien 2–5 + Negativraum).
// Braucht die Konten aus etappe1-2.e2e.mjs und „Jo Test“ aus setup.e2e.mjs (Harness: höchstens 3 Konten
// je Lauf) ⇒ muss NACH beiden laufen. Angemeldet ist B („Luka Test“, Deck Krenko); A („Franco Test“) hat
// Tymna, C („Tim Echt“) und Jo leihen. Würfe werden über den Testhaken window.__ttgRand erzwungen
// (src/lib/rand.js, nur localhost): randInt(6) = floor(v·2^32) % 6 ⇒ v = (w − 1) / 2^32 ergibt w.
import { ok, ctx, hash, waitHash, login, mail } from './harness.mjs';

export default async function diceE2e({ browser, base: BASE }) {
  console.log('\nWürfeltisch: Anmelden als B (Luka Test)');
  const S = await ctx(browser, 'D');
  await S.goto(BASE);
  await waitHash(S, '#/login');
  await login(S, mail('b'));
  await waitHash(S, '#/start');

  const db = (fn, arg) => S.evaluate(async ([src, a]) => {
    const { sb } = await import('/src/supabase.js');
    // eslint-disable-next-line no-new-func
    return new Function('sb', 'a', `return (async () => { ${src} })()`)(sb, a);
  }, [fn, arg]);
  const poll = async (fn, arg, pred, ms = 10000) => {
    const end = Date.now() + ms; let v;
    do { v = await db(fn, arg); if (pred(v)) return v; await S.waitForTimeout(300); } while (Date.now() < end);
    return v;
  };
  /** Nächste Würfe erzwingen (danach liefert der Haken 0,5 für Richtung/Streuung). */
  const force = (vals) => S.evaluate((v) => {
    const q = v.map((w) => (w - 1) / 2 ** 32);
    window.__ttgRand = () => (q.length ? q.shift() : 0.5);
  }, vals);
  const phase = () => S.getAttribute('.dt', 'data-phase');
  const waitPhase = (list, timeout = 8000) => S.waitForFunction((l) => l.includes(document.querySelector('.dt')?.dataset.phase), list, { timeout });
  const felt = async () => S.locator('.dt-felt').boundingBox();
  const tap = async () => { const b = await felt(); await S.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  const swipe = async () => {
    const b = await felt();
    await S.mouse.move(b.x + b.width / 2, b.y + b.height - 70);
    await S.mouse.down();
    await S.mouse.move(b.x + b.width / 2 + 40, b.y + b.height - 260, { steps: 4 });
    await S.mouse.up();
  };
  const starterText = async () => (await S.textContent('.su-startrow b')).trim();

  // ---------------------------------------------------------------- Setup mit 4 Spielern
  await S.goto(BASE + '#/spiel-neu');
  await S.waitForSelector('.su-row');
  const ids = Object.fromEntries(await S.$$eval('[data-act="member"]', (bs) => bs.map((b) => [b.querySelector('span').textContent.trim(), b.dataset.id])));
  const A = ids['Franco Test'], B = ids['Luka Test'], C = ids['Tim Echt'], J = ids['Jo Test'];
  ok('Würfel: A, B, C, Jo in der Gruppe', !!(A && B && C && J), JSON.stringify(ids));
  const sel = async (id, on) => { if ((await S.getAttribute(`[data-act="member"][data-id="${id}"]`, 'aria-pressed')) !== String(on)) await S.click(`[data-act="member"][data-id="${id}"]`); };
  for (const id of [A, C, J]) await sel(id, false); // feste Sitzordnung: B, A, C, Jo
  await sel(B, true);
  for (const id of [A, C, J]) await sel(id, true);
  for (const id of [C, J]) if ((await S.locator(`.su-row[data-mid="${id}"] .su-deckbtn`).count()) === 0) await S.click(`.su-row[data-mid="${id}"] .su-borrow`);
  const order = await S.$$eval('.su-row', (rs) => rs.map((r) => r.dataset.mid));
  ok('Würfel: Sitzordnung B, A, C, Jo', JSON.stringify(order) === JSON.stringify([B, A, C, J]), JSON.stringify(order));
  ok('Würfel: Start möglich (alle mit Deck)', !(await S.isDisabled('[data-act="start"]')));
  const NAMES = ['Luka Test', 'Franco Test', 'Tim Echt', 'Jo Test'];

  // ---------------------------------------------------------------- Kriterium 2: Bilder je Look (ohne Übernehmen)
  for (const look of ['arktis', 'lachs', 'nacht']) {
    await S.goto(BASE + '#/einstellungen'); await S.waitForSelector('[data-look]');
    await S.click(`[data-look="${look}"]`);
    await S.waitForFunction((l) => document.documentElement.dataset.theme === l, look);
    await S.goto(BASE + '#/spiel-neu'); await S.waitForSelector('.su-row');
    const before = await starterText();
    await S.click('[data-act="roll"]');
    await S.waitForSelector('.dt .dt-die');
    await S.waitForTimeout(400);
    ok(`K2 ${look}: Würfeltisch offen, 4 Würfel mit Namensschild`, (await S.locator('.dt-die').count()) === 4
      && JSON.stringify(await S.$$eval('.dt-tag', (t) => t.map((x) => x.textContent))) === JSON.stringify(NAMES));
    await S.shot(`wuerfel-K2-${look}-1-bereit`);
    await force([2, 6, 6, 5]);
    await tap();
    await waitPhase(['tie']);
    await S.waitForTimeout(200);
    await S.shot(`wuerfel-K2-${look}-3-gleichstand`);
    await force([3, 5]);
    await swipe();
    await S.waitForTimeout(250);
    await S.shot(`wuerfel-K2-${look}-2-flug`);
    await waitPhase(['done']);
    await S.waitForTimeout(200);
    await S.shot(`wuerfel-K2-${look}-4-ergebnis`);
    await S.click('[data-dice="close"]');
    await S.waitForSelector('.dt', { state: 'detached' });
    ok(`${look}: Schließen ohne Übernehmen ändert nichts`, (await starterText()) === before, `${before} → ${await starterText()}`);
  }

  // ---------------------------------------------------------------- Kriterien 3 + 5 (Look nacht)
  await S.click('[data-act="roll"]');
  await S.waitForSelector('.dt .dt-die');
  await S.waitForTimeout(300);
  await force([2, 6, 6, 5]);
  await tap();
  await waitPhase(['tie']);
  const idle = await S.$$eval('.dt-die', (ds) => ds.map((d) => d.classList.contains('idle')));
  ok('K3 Gleichstand ⇒ nur die Gleichstehenden aktiv (Sitz 1, 2)', JSON.stringify(idle) === JSON.stringify([true, false, false, true]), JSON.stringify(idle));
  ok('K3 Gleichstand angezeigt', (await S.textContent('.dt-status b')).includes('Gleichstand bei 6') && (await S.textContent('.dt-status span')).includes('Franco Test und Tim Echt'),
    await S.textContent('.dt-status'));
  ok('K3 Kein „übernehmen“ bei Gleichstand', await S.locator('[data-dice="accept"]').isHidden());

  await force([3, 5]);
  const dieBefore = await S.$('.dt-die[data-die="1"]');
  await swipe();
  await S.waitForTimeout(200);
  const k5 = await S.evaluate((el) => ({
    same: el.isConnected && el === document.querySelector('.dt-die[data-die="1"]'),
    phase: document.querySelector('.dt').dataset.phase,
    anims: document.getAnimations().length,
  }), dieBefore);
  ok('K5 Während des Flugs dasselbe Würfel-Element im DOM (nach 200 ms)', k5.same && k5.phase === 'fly' && k5.anims > 0, JSON.stringify(k5));
  // mehrfaches Wischen während des Flugs wird ignoriert
  await swipe();
  await waitPhase(['done']);
  const k5b = await S.evaluate((el) => el.isConnected && el === document.querySelector('.dt-die[data-die="1"]'), dieBefore);
  ok('K5 Nach dem Flug weiter dasselbe Element, Animationen beendet', k5b && (await S.evaluate(() => document.getAnimations().length)) === 0);
  ok('K3 Ergebnis: Tim Echt beginnt', (await S.textContent('.dt-status b')).trim() === 'Tim Echt beginnt', await S.textContent('.dt-status b'));
  const tags = await S.$$eval('.dt-tag', (t) => t.map((x) => x.textContent));
  ok('K3 Nachwurf nur für Gleichstehende (Schilder 2 · 3 · 5 · 5)', JSON.stringify(tags) === JSON.stringify(['Luka Test · 2', 'Franco Test · 3', 'Tim Echt · 5', 'Jo Test · 5']), JSON.stringify(tags));
  ok('K3 „übernehmen“-Knopf nennt den Sieger', (await S.textContent('[data-dice="accept"]')).includes('Tim Echt beginnt · übernehmen'));
  await S.click('[data-dice="accept"]');
  await S.waitForSelector('.dt', { state: 'detached' });
  ok('K3 Setup zeigt „Tim Echt beginnt“', (await starterText()) === 'Tim Echt beginnt', await starterText());
  ok('K3 Startspieler-Markierung an Sitz 2', (await S.locator(`.su-row[data-mid="${C}"] .who small`).count()) === 1);
  await S.shot('wuerfel-K3-setup-uebernommen');

  await S.click('[data-act="start"]');
  await waitHash(S, '#/spiel/');
  const gameId = hash(S).split('/')[2];
  const g = await poll("const r = await sb.from('games').select('first_seat').eq('id', a).single(); return r.data;", gameId, (d) => d != null);
  ok('K3 games.first_seat = Gewinnersitz 2', g?.first_seat === 2, JSON.stringify(g));
  const rolls = await poll("const r = await sb.from('game_events').select('type, payload').eq('game_id', a).eq('type', 'roll'); return r.data;", gameId, (d) => d?.length >= 1);
  ok('K3 genau ein roll-Ereignis kind start mit winner_seat 2 und Werten je Sitz', rolls?.length === 1 && rolls[0].payload?.kind === 'start'
    && rolls[0].payload?.winner_seat === 2 && JSON.stringify(rolls[0].payload?.values) === JSON.stringify([2, 3, 5, 5]), JSON.stringify(rolls));

  // ---------------------------------------------------------------- Negativraum: Schließen mitten im Flug
  await S.goto(BASE + '#/spiel-neu');
  await S.waitForSelector('.su-row');
  await sel(A, true);
  const before = await starterText();
  await S.click('[data-act="roll"]');
  await S.waitForSelector('.dt .dt-die');
  await S.waitForTimeout(300);
  await swipe();
  await S.waitForTimeout(150);
  const midFly = await phase();
  await S.click('[data-dice="close"]');
  await S.waitForSelector('.dt', { state: 'detached' });
  await S.waitForTimeout(2500); // Ende der Bahn abwarten: kein später Fehler
  ok('Schließen im Flug ⇒ Overlay weg, Animationen abgebrochen, Setup unverändert', midFly === 'fly'
    && (await S.evaluate(() => document.getAnimations().length)) === 0 && (await starterText()) === before, `${midFly} · ${before} → ${await starterText()}`);

  // ---------------------------------------------------------------- Kriterium 4: reduced-motion
  await S.emulateMedia({ reducedMotion: 'reduce' });
  await S.click('[data-act="roll"]');
  await S.waitForSelector('.dt .dt-die');
  await force([5, 3]);
  const k4 = await S.evaluate(async () => {
    const f = document.querySelector('.dt-felt').getBoundingClientRect();
    const opt = { bubbles: true, clientX: f.left + f.width / 2, clientY: f.top + f.height / 2, pointerId: 7, button: 0, isPrimary: true, pointerType: 'touch' };
    const t0 = performance.now();
    document.querySelector('.dt-felt').dispatchEvent(new PointerEvent('pointerdown', opt));
    let at = null;
    while (performance.now() - t0 <= 100) {
      if (document.querySelector('.dt').dataset.phase === 'done') { at = performance.now() - t0; break; }
      await new Promise((r) => setTimeout(r, 5));
    }
    window.dispatchEvent(new PointerEvent('pointerup', opt));
    await new Promise((r) => setTimeout(r, 30));
    return { at, anims: document.getAnimations().length, text: document.querySelector('.dt-status b').textContent };
  });
  ok('K4 reduced-motion: Ergebnis ≤ 100 ms nach Tipp, keine Animationen', k4.at !== null && k4.at <= 100 && k4.anims === 0 && k4.text === 'Luka Test beginnt', JSON.stringify(k4));
  await S.shot('wuerfel-K4-reduced-ergebnis');
  await S.keyboard.press('Escape');
  await S.waitForSelector('.dt', { state: 'detached' });
  ok('K4 Escape schließt ohne Übernehmen', (await starterText()) === before);
  await S.emulateMedia({ reducedMotion: 'no-preference' });

  // ---------------------------------------------------------------- Negativraum: 2 Spieler / 375 px
  await S.setViewportSize({ width: 375, height: 812 });
  await S.click('[data-act="roll"]');
  await S.waitForSelector('.dt .dt-die');
  const fit = await S.evaluate(() => {
    const f = document.querySelector('.dt-felt').getBoundingClientRect();
    return [...document.querySelectorAll('.dt-die')].map((d) => { const r = d.getBoundingClientRect(); return r.left >= f.left && r.right <= f.right && r.top >= f.top && r.bottom <= f.bottom; });
  });
  ok('375 px, 2 Spieler: Startreihe liegt im Tisch', fit.length === 2 && fit.every(Boolean), JSON.stringify(fit));
  await S.click('[data-dice="close"]');
  await S.setViewportSize({ width: 390, height: 844 });

  ok('Keine JS-Fehler im Würfel-Lauf', S.errs.length === 0, S.errs.join(' | '));
  ok('Keine HTTP-Fehler im Würfel-Lauf', S.bad.length === 0, JSON.stringify(S.bad));
}
