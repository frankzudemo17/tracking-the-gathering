// E2E Würfeltisch (Spec P9, Kriterien 2–5 + Negativraum; Review-Nacharbeit B1, B2, Wunsch b).
// Braucht die Konten aus etappe1-2.e2e.mjs und „Jo Test“ aus setup.e2e.mjs (Harness: höchstens 3 Konten
// je Lauf) ⇒ muss NACH beiden laufen. Angemeldet ist B („Luka Test“, Deck Krenko); A („Franco Test“) hat
// Tymna, C („Tim Echt“) und Jo leihen. Würfe werden über den Testhaken window.__ttgRand erzwungen
// (src/lib/rand.js, nur localhost): randInt(6) = floor(v·2^32) % 6 ⇒ v = (w − 1) / 2^32 ergibt w.
// B1 (Endlage frei): gemessen am Tisch des Setups (390 px) und an einem direkt geöffneten Tisch
// (375 × 667, 4 und 6 Spieler, Flug und reduzierte Bewegung, je Look) — Bilder D-wuerfel-B1-….png.
// B2 (Wurf im Entwurf): Umweg „+ Commander“, Neuladen, Gegenfälle Sitz-Tausch — je ein gestartetes Spiel.
// P9b: feste Testkonten (login(page, 'a'|'b'|'c')) in TTG-E2E-Fixture; run.mjs stellt vorher den Grundzustand her,
// prepare() den Stand, den die alte Kette hier hinterließ (nach setup: zusätzlich Platzhalter „Jo Test“ und B mit Krenko).
import { ok, ctx, hash, waitHash, login, prepare } from './harness.mjs';

export default async function diceE2e({ browser, base: BASE }) {
  await prepare({ members: ['b', 'c'], placeholders: ['Jo Test'], decks: [['a', 'tymna'], ['b', 'krenko']] });
  console.log('\nWürfeltisch: Anmelden als B (Luka Test)');
  const S = await ctx(browser, 'D');
  await S.goto(BASE);
  await waitHash(S, '#/login');
  await login(S, 'b');
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
  /** Wie force, aber Richtung/Streuung danach aus einer gesäten Folge (verschiedene Bahnen je Würfel). */
  const forceSeeded = (vals, seed) => S.evaluate(([v, s0]) => {
    const q = v.map((w) => (w - 1) / 2 ** 32); let x = s0;
    window.__ttgRand = () => { if (q.length) return q.shift(); x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; };
  }, [vals, seed]);
  /**
   * Endlage messen (Review B1), alles über getBoundingClientRect: Schilder paarweise disjunkt (tagTag),
   * Schild/Würfel im Filz (tagOut, dieOut), kein Würfel auf einem anderen (Mittelpunkte ≥ 60 px = 2·R:
   * dieClose), kein Schild auf einem fremden Würfel (cover).
   */
  const geo = () => S.evaluate(() => {
    const f = document.querySelector('.dt-felt').getBoundingClientRect();
    const tags = [...document.querySelectorAll('.dt-tag')].map((x) => x.getBoundingClientRect());
    const dice = [...document.querySelectorAll('.dt-die')].map((x) => x.getBoundingClientRect());
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const out = (a) => a.width === 0 || a.left < f.left || a.right > f.right || a.top < f.top || a.bottom > f.bottom;
    const mid = (a) => [(a.left + a.right) / 2, (a.top + a.bottom) / 2];
    const r = { dice: dice.length, tags: tags.length, tagTag: 0, tagOut: 0, dieOut: 0, dieClose: 0, cover: 0, minDist: 9999 };
    for (let i = 0; i < tags.length; i++) {
      if (out(tags[i])) r.tagOut++;
      if (out(dice[i])) r.dieOut++;
      for (let j = 0; j < tags.length; j++) {
        if (j === i) continue;
        if (hit(tags[i], dice[j])) r.cover++;
        if (j < i) continue;
        if (hit(tags[i], tags[j])) r.tagTag++;
        const a = mid(dice[i]), b = mid(dice[j]); const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        r.minDist = Math.min(r.minDist, Math.round(d)); if (d < 60) r.dieClose++;
      }
    }
    return r;
  });
  const free = (g, n) => g.dice === n && g.tags === n && g.tagTag === 0 && g.tagOut === 0 && g.dieOut === 0 && g.dieClose === 0 && g.cover === 0;
  const xy = (tf) => (tf || '').match(/-?\d+(\.\d+)?/g)?.slice(0, 2).map(Number) || [NaN, NaN];
  /** Letzter Bahnpunkt je fliegendem Würfel (Keyframe) bzw. liegende Lage (style) — für „kein Sprung am Ende“. */
  const lastKeyframes = () => S.$$eval('.dt-die', (ds) => ds.map((d) => { const a = d.getAnimations()[0]; return a ? a.effect.getKeyframes().at(-1).transform : null; }));
  const restTransforms = () => S.$$eval('.dt-die', (ds) => ds.map((d) => d.style.transform));
  const jump = (kf, rest) => Math.max(0, ...kf.map((tf, i) => { if (!tf) return 0; const a = xy(tf), b = xy(rest[i]); return Math.hypot(a[0] - b[0], a[1] - b[1]); }));

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
  const SIX = [...NAMES, 'Anna-Magdalena Lang', 'Bea Kurz']; // 6 Spieler für die B1-Bilder (ein langer Name)
  const LOOKS = ['arktis', 'lachs', 'nacht'];

  // ---------------------------------------------------------------- Kriterium 2: Bilder je Look (ohne Übernehmen)
  for (const look of LOOKS) {
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
    await S.waitForTimeout(200); // Schild-Übergang (.25 s) zu Ende
    const gTie = await geo();
    ok(`B1 ${look}: Gleichstand — 4 Würfel und 4 Schilder frei und im Tisch`, free(gTie, 4), JSON.stringify(gTie));
    await force([3, 5]);
    await swipe();
    await S.waitForTimeout(250);
    await S.shot(`wuerfel-K2-${look}-2-flug`);
    await waitPhase(['done']);
    await S.waitForTimeout(400);
    await S.shot(`wuerfel-K2-${look}-4-ergebnis`);
    const gEnd = await geo();
    ok(`B1 ${look}: Ergebnis nach Nachwurf — 4 Würfel und 4 Schilder frei und im Tisch`, free(gEnd, 4), JSON.stringify(gEnd));
    await S.click('[data-dice="close"]');
    await S.waitForSelector('.dt', { state: 'detached' });
    ok(`${look}: Schließen ohne Übernehmen ändert nichts`, (await starterText()) === before, `${before} → ${await starterText()}`);

    // Review B1: Ergebnisbild bei 375 × 667 für 4 und 6 Spieler, mit Flug und bei reduzierter Bewegung.
    // Der Tisch wird direkt geöffnet (die Testgruppe hat nur 4 Mitglieder); nichts wird übernommen.
    await S.setViewportSize({ width: 375, height: 667 });
    for (const n of [4, 6]) for (const reduced of [false, true]) {
      const mode = reduced ? 'reduziert' : 'flug';
      await S.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
      await S.evaluate(async (list) => {
        const { openDiceTable } = await import('/src/views/dice.js');
        openDiceTable(document.body, { players: list.map((name, seat) => ({ seat, name })), onAccept() {} });
      }, SIX.slice(0, n));
      await S.waitForSelector('.dt .dt-die');
      await S.waitForTimeout(300);
      const plan = n === 4 ? [[2, 6, 6, 5], [3, 5]] : [[6, 6, 6, 2, 1, 3], [4, 5, 2]];
      const res = [];
      for (let k = 0; k < plan.length; k++) {
        await forceSeeded(plan[k], 1000 * n + 10 * LOOKS.indexOf(look) + k + 1);
        let kf = null;
        if (reduced) await tap(); else { await swipe(); await S.waitForTimeout(120); kf = await lastKeyframes(); }
        await waitPhase([k ? 'done' : 'tie']);
        await S.waitForTimeout(400);
        const g = await geo();
        res.push({ ...g, sprung: kf ? Number(jump(kf, await restTransforms()).toFixed(2)) : 0, flug: kf ? kf.filter(Boolean).length : 0 });
      }
      await S.shot(`wuerfel-B1-${look}-${n}-${mode}`);
      ok(`B1 ${look} 375×667, ${n} Spieler, ${mode}: Gleichstand und Ergebnis — Schilder paarweise disjunkt und im Tisch, kein Würfel auf einem anderen`,
        res.length === 2 && res.every((g) => free(g, n)), JSON.stringify(res));
      if (!reduced) ok(`B1 ${look} ${n} Spieler: letzter Bahnpunkt = Endlage (kein Sprung), Würfel flogen`, res.every((g) => g.sprung <= 0.11 && g.flug >= 2), JSON.stringify(res.map((g) => [g.sprung, g.flug])));
      ok(`B1 ${look} ${n} Spieler, ${mode}: Sieger steht fest`, (await S.textContent('.dt-status b')).trim() === `${SIX[n === 4 ? 2 : 1]} beginnt`, await S.textContent('.dt-status b'));
      await S.click('[data-dice="close"]');
      await S.waitForSelector('.dt', { state: 'detached' });
    }
    await S.emulateMedia({ reducedMotion: 'no-preference' });
    await S.setViewportSize({ width: 390, height: 844 });
    ok(`B1 ${look}: direkt geöffneter Tisch ändert das Setup nicht`, (await starterText()) === before, `${before} → ${await starterText()}`);
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
  const foc = await S.evaluate(() => {
    const a = document.activeElement; const r = a?.getBoundingClientRect();
    return { tag: a?.tagName, act: a?.dataset?.act ?? null, inSetup: !!a?.closest?.('.su'), connected: !!a?.isConnected, visible: !!r && r.width > 0 && r.height > 0 && getComputedStyle(a).visibility !== 'hidden' };
  });
  ok('Wunsch b: Fokus nach „übernehmen“ auf sichtbarem Setup-Element („Auswürfeln“)', foc.act === 'roll' && foc.inSetup && foc.connected && foc.visible, JSON.stringify(foc));
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
  await S.waitForSelector('.dt', { state: 'detached' });
  await S.setViewportSize({ width: 390, height: 844 });

  // ---------------------------------------------------------------- Review B2: Wurf übersteht Umweg und Neuladen
  const ROLLS = "const r = await sb.from('game_events').select('type, payload').eq('game_id', a).eq('type', 'roll'); if (r.error) throw r.error; return r.data;";
  const FIRST = "const r = await sb.from('games').select('first_seat').eq('id', a).single(); if (r.error) throw r.error; return r.data;";
  /** Sitzordnung B, A, Jo herstellen (An-/Abwählen setzt Startspieler und Jo-Deck zurück). */
  const three = async () => {
    for (const id of [A, C, J]) await sel(id, false);
    await sel(B, true); await sel(A, true); await sel(J, true);
    return S.$$eval('.su-row', (rs) => rs.map((r) => r.dataset.mid));
  };
  /** Auswürfeln mit erzwungenen Werten (kein Gleichstand) und übernehmen. */
  const rollAccept = async (vals) => {
    await S.click('[data-act="roll"]');
    await S.waitForSelector('.dt .dt-die');
    await S.waitForTimeout(300);
    await force(vals);
    await tap();
    await waitPhase(['done']);
    await S.click('[data-dice="accept"]');
    await S.waitForSelector('.dt', { state: 'detached' });
  };
  const swapSeats = async (i, j) => { await S.click(`[data-act="swap"][data-i="${i}"]`); await S.click(`[data-act="swap"][data-i="${j}"]`); };
  const startGame = async () => {
    await S.click('[data-act="start"]');
    await waitHash(S, '#/spiel/');
    return hash(S).split('/')[2];
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const rows = () => S.$$eval('.su-row', (rs) => rs.map((r) => r.dataset.mid));

  // (1) auswürfeln → übernehmen → Umweg „+ Commander“ (Jo bekommt ein Deck) → zurück → Start
  const o1 = await three();
  ok('B2 Umweg: Sitzordnung B, A, Jo — Jo ohne Deck zeigt „+ Commander“', same(o1, [B, A, J]) && (await S.locator(`.su-row[data-mid="${J}"] .su-addcmd`).count()) === 1, JSON.stringify(o1));
  await rollAccept([3, 5, 1]);
  ok('B2 Umweg: Setup zeigt „Franco Test beginnt“', (await starterText()) === 'Franco Test beginnt', await starterText());
  await S.click(`.su-row[data-mid="${J}"] .su-addcmd`);
  await waitHash(S, '#/deck-neu/');
  await S.fill('#ad-q', 'krenko');
  await S.waitForSelector('.result >> text=Krenko, Mob Boss', { timeout: 20000 });
  await S.click('.result >> text=Krenko, Mob Boss');
  await S.click('[data-act="save"]');
  await waitHash(S, '#/spiel-neu');
  await S.waitForSelector(`.su-row[data-mid="${J}"] .su-deckbtn`);
  ok('B2 Umweg: zurück im Setup — Startspieler erhalten, Start möglich', (await starterText()) === 'Franco Test beginnt' && !(await S.isDisabled('[data-act="start"]')), await starterText());
  await S.shot('wuerfel-B2-nach-umweg');
  const g1 = await startGame();
  const r1 = await poll(ROLLS, g1, (d) => d?.length >= 1);
  await S.waitForTimeout(1500); // ein zweites Ereignis käme spätestens jetzt
  const r1b = await db(ROLLS, g1);
  ok('B2 Umweg: genau ein roll-Ereignis kind start, winner_seat 1, Werte je Sitz [3, 5, 1]', r1?.length === 1 && r1b?.length === 1 && r1[0].payload?.kind === 'start'
    && r1[0].payload?.winner_seat === 1 && same(r1[0].payload?.values, [3, 5, 1]), JSON.stringify([r1, r1b]));
  const f1 = await db(FIRST, g1);
  ok('B2 Umweg: games.first_seat = 1', f1?.first_seat === 1, JSON.stringify(f1));

  // (2) auswürfeln → übernehmen → Neuladen → Start
  await S.goto(BASE + '#/spiel-neu');
  await S.waitForSelector('.su-row');
  const o2 = await three();
  ok('B2 Neuladen: Sitzordnung B, A, Jo — alle mit Deck', same(o2, [B, A, J]) && !(await S.isDisabled('[data-act="start"]')), JSON.stringify(o2));
  await rollAccept([4, 2, 6]);
  ok('B2 Neuladen: Setup zeigt „Jo Test beginnt“', (await starterText()) === 'Jo Test beginnt', await starterText());
  await S.reload();
  await S.waitForSelector('.su-row');
  ok('B2 Neuladen: Startspieler und Sitzordnung erhalten', (await starterText()) === 'Jo Test beginnt' && same(await rows(), [B, A, J]), await starterText());
  const g2 = await startGame();
  const r2 = await poll(ROLLS, g2, (d) => d?.length >= 1);
  await S.waitForTimeout(1500);
  const r2b = await db(ROLLS, g2);
  ok('B2 Neuladen: genau ein roll-Ereignis kind start, winner_seat 2, Werte je Sitz [4, 2, 6]', r2?.length === 1 && r2b?.length === 1 && r2[0].payload?.kind === 'start'
    && r2[0].payload?.winner_seat === 2 && same(r2[0].payload?.values, [4, 2, 6]), JSON.stringify([r2, r2b]));
  const f2 = await db(FIRST, g2);
  ok('B2 Neuladen: games.first_seat = 2', f2?.first_seat === 2, JSON.stringify(f2));

  // (3) Gegenfall: nach dem Wurf Sitze tauschen ⇒ Wurf verfällt, kein roll-Ereignis
  await S.goto(BASE + '#/spiel-neu');
  await S.waitForSelector('.su-row');
  await three();
  await rollAccept([2, 6, 3]);
  ok('B2 Gegenfall: Setup zeigt „Franco Test beginnt“', (await starterText()) === 'Franco Test beginnt', await starterText());
  await swapSeats(0, 2); // Sitz 1 (Gewinner) bleibt, aber die Werte je Sitz passen nicht mehr
  ok('B2 Gegenfall: Sitz-Tausch ⇒ „Noch nicht ausgewürfelt“', (await starterText()) === 'Noch nicht ausgewürfelt' && same(await rows(), [J, A, B]), await starterText());
  const g3 = await startGame();
  const f3 = await poll(FIRST, g3, (d) => d != null);
  await S.waitForTimeout(4000); // (1) und (2) zeigen: ein roll-Ereignis wäre längst da
  const r3 = await db(ROLLS, g3);
  ok('B2 Gegenfall: Spiel gestartet (first_seat 0), kein roll-Ereignis', f3?.first_seat === 0 && Array.isArray(r3) && r3.length === 0, JSON.stringify([f3, r3]));

  // (4) Gegenfall mit Neuladen: der verfallene Wurf lebt auch aus dem Entwurf nicht wieder auf
  await S.goto(BASE + '#/spiel-neu');
  await S.waitForSelector('.su-row');
  await three();
  await rollAccept([2, 6, 3]);
  await swapSeats(0, 2);
  await S.reload();
  await S.waitForSelector('.su-row');
  await swapSeats(0, 2); // wieder B, A, Jo — dieselbe Sitzbelegung wie beim Wurf
  ok('B2 Gegenfall Neuladen: Tausch → Neuladen → zurücktauschen ⇒ „Noch nicht ausgewürfelt“', (await starterText()) === 'Noch nicht ausgewürfelt' && same(await rows(), [B, A, J]), await starterText());
  const g4 = await startGame();
  const f4 = await poll(FIRST, g4, (d) => d != null);
  await S.waitForTimeout(4000);
  const r4 = await db(ROLLS, g4);
  ok('B2 Gegenfall Neuladen: Spiel gestartet (first_seat 0), kein roll-Ereignis', f4?.first_seat === 0 && Array.isArray(r4) && r4.length === 0, JSON.stringify([f4, r4]));

  ok('Keine JS-Fehler im Würfel-Lauf', S.errs.length === 0, S.errs.join(' | '));
  ok('Keine HTTP-Fehler im Würfel-Lauf', S.bad.length === 0, JSON.stringify(S.bad));
}
