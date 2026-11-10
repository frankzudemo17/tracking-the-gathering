// E2E Etappe 1+2 (Konten, Gruppen, Platzhalter, Übernahme, Decks, Looks) — übernommen aus
// test-entwurf/e2e.js (Welle ttg-spielen), Sollwerte und Ablauf unverändert, ESM statt CommonJS.
// Angepasst an den App-Stand seit dem Entwurf (nur Weg/Selektor, keine Prüfung geändert):
//   · Look, Sprache und Abmelden liegen seit fd223b2 auf #/einstellungen (vorher #/profil)
//   · Look „Burgund“ heißt seit Migration 20261110010000_lachs.sql „Lachs“ (WELLE.md)
// 49 Prüfungen zur Laufzeit (inkl. je 2 Fehlerprüfungen für A, B, C).
import { ok, ctx, hash, waitHash, register, mail, testImage, TARGET } from './harness.mjs';

export default async function etappe12({ browser, base: BASE }) {
  const IMG = await testImage(browser);
  const pages = [];

  console.log('\nA: Registrieren, Gruppe, Platzhalter');
  const A = await ctx(browser, 'A'); pages.push(['A', A]);
  await A.goto(BASE);
  await waitHash(A, '#/login');
  ok('Ohne Login → #/login', hash(A) === '#/login');
  await A.waitForSelector('#li-mail');
  await A.shot('01-login');
  // Falsches Passwort
  await A.fill('#li-mail', mail('niemand')); await A.fill('#li-pass', 'falschfalsch'); await A.click('button[type=submit]');
  await A.waitForSelector('.error:not([hidden])');
  ok('Falsches Login zeigt deutsche Meldung', (await A.textContent('.error')).includes('stimmt nicht'), await A.textContent('.error'));

  await register(A, 'Franco Test', mail('a'));
  await waitHash(A, '#/willkommen');
  ok('Nach Registrierung → Willkommen', true);
  ok('Willkommen nennt Namen', (await A.textContent('h1')).includes('Franco Test'));
  await A.shot('02-willkommen');

  await A.click('[data-act="new"]');
  await A.fill('#ng-name', 'Küchentisch <b>Test</b>');
  await A.click('.sheet button[type=submit]');
  await waitHash(A, '#/gruppen');
  await A.waitForSelector('.code');
  const invite = (await A.textContent('.code')).trim();
  ok('Einladungscode sichtbar', /^TTG-[A-Z2-9]{6}$/.test(invite), invite);
  ok('Gruppenname escaped (kein HTML)', (await A.locator('.pick b').first().textContent()).includes('<b>Test</b>'));
  await A.shot('03-gruppen');

  await A.click('text=Spieler ohne Konto anlegen');
  await waitHash(A, '#/spieler-neu');
  await A.fill('#ap-name', 'Tim');
  await A.click('button[type=submit]');
  await waitHash(A, '#/profil/');
  await A.waitForSelector('.guest-card .code');
  const timCode = (await A.textContent('.guest-card .code')).trim();
  ok('Tim hat Übernahme-Code', /^TIM-[A-Z2-9]{6}$/.test(timCode), timCode);
  // Profilbild für Tim
  await A.click('[data-act="photo"]');
  await A.setInputFiles('.sheet input[type=file]:not([capture])', IMG);
  await A.waitForSelector('.sheet-wrap', { state: 'detached', timeout: 20000 });
  await A.waitForSelector('.prof-head .avatar[style*="background-image"]', { timeout: 15000 });
  ok('Profilbild für Spieler ohne Konto gesetzt', true);
  await A.shot('04-tim');

  // Eigenes Profil: Bild; Look und Sprache (seit fd223b2 auf #/einstellungen)
  await A.goto(BASE + '#/profil');
  await A.waitForSelector('[data-act="photo"]');
  await A.click('[data-act="photo"]');
  await A.setInputFiles('.sheet input[type=file]:not([capture])', IMG);
  await A.waitForSelector('.sheet-wrap', { state: 'detached', timeout: 20000 });
  await A.waitForSelector('.prof-head .avatar[style*="background-image"]', { timeout: 15000 });
  ok('Eigenes Profilbild gesetzt', true);
  await A.goto(BASE + '#/einstellungen');
  await A.waitForSelector('[data-look]');
  await A.click('[data-look="lachs"]');
  await A.waitForFunction(() => document.documentElement.dataset.theme === 'lachs');
  ok('Look Lachs aktiv', true);
  await A.waitForSelector('[data-look="lachs"][aria-pressed="true"]');
  await A.shot('05-einstellungen-lachs');
  await A.click('[data-look="arktis"]');
  await A.waitForFunction(() => document.documentElement.dataset.theme === 'arktis');
  await A.click('[data-lang="en"]');
  await A.waitForSelector('text=Settings');
  ok('Sprache EN', true);
  await A.click('[data-lang="de"]');
  await A.waitForSelector('text=Einstellungen');
  await A.shot('06-einstellungen');
  await A.goto(BASE + '#/start');
  await A.waitForSelector('.art-hero');
  await A.waitForSelector('.top .avatar[style*="background-image"]', { timeout: 15000 });
  ok('Startseite mit Profilbild oben rechts', true);
  await A.shot('07-start');

  console.log('\nB: Beitritt per Einladungscode');
  const B = await ctx(browser, 'B'); pages.push(['B', B]);
  await B.goto(BASE);
  await waitHash(B, '#/login');
  await register(B, 'Luka Test', mail('b'));
  await waitHash(B, '#/willkommen');
  await B.click('[data-act="code"]');
  await B.fill('#code-in', 'TTG-ZZZZZZ');
  await B.click('.sheet button[type=submit]');
  await B.waitForSelector('.sheet .error:not([hidden])');
  ok('Falscher Code → Meldung', (await B.textContent('.sheet .error')).includes('kennen wir nicht'));
  await B.fill('#code-in', invite.toLowerCase());
  await B.click('.sheet button[type=submit]');
  await waitHash(B, '#/start');
  ok('B ist beigetreten', (await B.textContent('.group-switch')).includes('Küchentisch'));
  await B.goto(BASE + '#/gruppen');
  await B.waitForSelector('.list .row');
  const names = await B.locator('.list .row .title').allTextContents();
  ok('B sieht Franco, Luka, Tim', ['Franco Test', 'Luka Test', 'Tim'].every((n) => names.some((x) => x.includes(n))), JSON.stringify(names));
  // B ist kein Admin → kein Rollen-Knopf bei Franco
  await B.click('.list .row >> text=Franco Test');
  await waitHash(B, '#/profil/');
  await B.waitForSelector('.prof-head');
  ok('Mitglied sieht keinen Rollen-Knopf', (await B.locator('[data-act="role"]').count()) === 0);
  ok('Fremdes Profil: kein Kamera-Knopf', (await B.locator('[data-act="photo"]').count()) === 0);
  await B.shot('08-fremdes-profil');

  console.log('\nA: Admin befördert B');
  await A.goto(BASE + '#/gruppen');
  await A.waitForSelector('.list .row');
  await A.click('.list .row >> text=Luka Test');
  await A.waitForSelector('[data-act="role"]');
  await A.click('[data-act="role"]');
  await A.waitForSelector('text=Admin-Rechte entziehen');
  ok('Admin kann Luka befördern', true);

  console.log('\nDecks');
  // Eigenes Partner-Deck: Tymna + Thrasios, mit Moxfield-Link
  await A.goto(BASE + '#/profil');
  await A.waitForSelector('a[href^="#/deck-neu/"]');
  await A.click('a[href^="#/deck-neu/"]');
  await waitHash(A, '#/deck-neu/');
  await A.fill('#ad-q', 'tymna');
  await A.waitForSelector('.result >> text=Tymna the Weaver', { timeout: 20000 });
  await A.click('.result >> text=Tymna the Weaver');
  await A.waitForSelector('[data-act="partner"]');
  ok('Partner-Hinweis bei Tymna', (await A.textContent('#ad-pick')).includes('Partner'));
  await A.click('[data-act="partner"]');
  await A.fill('#ad-q', 'thras');
  await A.waitForSelector('.result >> text=Thrasios, Triton Hero', { timeout: 20000 });
  await A.click('.result >> text=Thrasios, Triton Hero');
  await A.waitForSelector('.deck-hero.split');
  ok('Zwei Commander nebeneinander', (await A.locator('.deck-hero.split .art').count()) === 2);
  await A.click('[data-br="4"]');
  await A.fill('#ad-link', 'moxfield.com/decks/abc123');
  await A.shot('10-deck-neu');
  await A.click('[data-act="save"]');
  await waitHash(A, '#/deck/');
  await A.waitForSelector('.deck-hero-text h2');
  const deckTitle = await A.textContent('.deck-hero-text h2');
  ok('Deckprofil zeigt beide Commander', deckTitle.includes('Tymna the Weaver') && deckTitle.includes('Thrasios'), deckTitle);
  ok('Bracket 4 gespeichert', (await A.textContent('.deck-hero .chip')).includes('4'));
  ok('Moxfield erkannt', (await A.textContent('.screen')).includes('Moxfield'));
  ok('Öffnen-Link mit https', (await A.getAttribute('a[target=_blank]', 'href')) === 'https://moxfield.com/decks/abc123');
  const deckUrl = A.url();
  await A.shot('11-deckprofil');
  // Bracket ändern
  await A.click('[data-act="bracket"]');
  await A.click('.sheet [data-br="2"]');
  await A.waitForSelector('.deck-hero .chip >> text=Core');
  ok('Bracket über Sheet geändert', true);
  // Falscher Link wird abgelehnt
  await A.click('[data-act="link"]');
  await A.fill('#dl-url', 'kein link mit leerzeichen');
  await A.click('.sheet button[type=submit]');
  await A.waitForSelector('.sheet .error:not([hidden])', { timeout: 8000 }).catch(async (e) => {
    await A.shot('FEHLER-link');
    console.log('HTML:', (await A.evaluate(() => document.querySelector('.sheet')?.outerHTML || 'kein Sheet')).slice(0, 600));
    throw e;
  });
  ok('Ungültiger Link abgelehnt', true);
  await A.keyboard.press('Escape');

  // Deck für Tim (Spieler ohne Konto) – nach Übernahme gehört es C
  await A.goto(BASE + '#/gruppen');
  await A.waitForSelector('.list .row');
  await A.click('.list .row >> text=Tim');
  await A.waitForSelector('a[href^="#/deck-neu/"]');
  await A.click('a[href^="#/deck-neu/"]');
  await A.fill('#ad-q', 'kinnan');
  await A.waitForSelector('.result >> text=Kinnan, Bonder Prodigy', { timeout: 20000 });
  await A.click('.result >> text=Kinnan, Bonder Prodigy');
  ok('Kinnan ohne Partner-Knopf', (await A.locator('[data-act="partner"]').count()) === 0);
  await A.click('[data-act="save"]');
  await waitHash(A, '#/deck/');
  ok('Deck für Spieler ohne Konto angelegt', (await A.textContent('.deck-hero-text h2')).includes('Kinnan'));

  // Profil zeigt Deck-Karten
  await A.goto(BASE + '#/profil');
  await A.waitForSelector('.deck-card');
  ok('Profil zeigt Deck-Karte', (await A.locator('.deck-card').count()) === 1);
  await A.shot('12-profil-decks');
  await A.goto(BASE + '#/start');
  await A.waitForSelector('.art-hero[style*="--art"]');
  ok('Startseite nutzt eigenes Commander-Bild', true);
  await A.waitForTimeout(800);
  await A.shot('13-start-mit-deck');

  // Fremdes Mitglied B: sieht das Deck, darf es nicht ändern
  await B.goto(deckUrl);
  await B.waitForSelector('.deck-hero-text h2');
  ok('B sieht Decks von A', (await B.textContent('.deck-hero-text h2')).includes('Tymna'));
  ok('B hat keine Bearbeiten-Knöpfe', (await B.locator('[data-act="bracket"], [data-act="remove"], [data-act="link"]').count()) === 0);

  console.log('\nC: Tim übernimmt per Link');
  const C = await ctx(browser, 'C'); pages.push(['C', C]);
  await C.goto(BASE + '#/code/' + timCode);
  await waitHash(C, '#/login');
  ok('Link ohne Login → Login mit Hinweis', (await C.textContent('.screen')).includes(timCode));
  await register(C, 'Tim Echt', mail('c'));
  await waitHash(C, '#/start');
  ok('Nach Registrierung automatisch übernommen → Start', (await C.textContent('.group-switch')).includes('Küchentisch'));
  await C.goto(BASE + '#/profil');
  await C.waitForSelector('.prof-head');
  ok('Übernommenes Profilbild da', (await C.locator('.prof-head .avatar[style*="background-image"]').count()) === 1);
  ok('Kein Gast-Hinweis mehr', (await C.locator('.guest-card .code').count()) === 0);
  await C.shot('09-tim-uebernommen');
  ok('Übernommenes Deck gehört jetzt C', (await C.locator('.deck-card').count()) === 1);
  await C.click('.deck-card');
  await C.waitForSelector('[data-act="remove"]');
  await C.click('[data-act="remove"]');
  await C.click('.sheet [data-act="yes"]');
  await waitHash(C, '#/profil');
  await C.waitForSelector('.prof-head');
  await C.waitForTimeout(500);
  ok('Deck entfernt', (await C.locator('.deck-card').count()) === 0);

  console.log('\nLooks');
  for (const look of ['nacht', 'arktis', 'lachs']) {
    await A.goto(BASE + '#/einstellungen'); await A.waitForSelector('[data-look]');
    await A.click(`[data-look="${look}"]`);
    await A.waitForFunction((l) => document.documentElement.dataset.theme === l, look);
    await A.goto(BASE + '#/start'); await A.waitForSelector('.art-hero'); await A.waitForTimeout(800);
    await A.shot('20-start-' + look);
    await A.goto(BASE + '#/gruppen'); await A.waitForSelector('.list .row'); await A.waitForTimeout(300);
    await A.shot('21-gruppen-' + look);
    ok('Look ' + look + ' gerendert', true);
  }
  await A.goto(BASE + '#/einstellungen'); await A.waitForSelector('[data-look]'); await A.shot('22-einstellungen-lachs');
  await A.click('[data-look="nacht"]');

  console.log('\nAbmelden');
  await A.goto(BASE + '#/einstellungen');
  await A.waitForSelector('[data-act="logout"]');
  await A.click('[data-act="logout"]');
  await waitHash(A, '#/login');
  ok('Abmelden → Login', true);
  await A.goto(BASE + '#/gruppen');
  await waitHash(A, '#/login');
  ok('Geschützte Route nach Abmelden → Login', true);

  const expected400 = `400 ${TARGET.url}/auth/v1/token?grant_type=password`;
  for (const [n, p] of pages) {
    ok(`Keine JS-Fehler bei ${n}`, p.errs.length === 0, p.errs.join(' | '));
    const unexpected = p.bad.filter((x) => !(n === 'A' && x === expected400));
    console.log('    HTTP-Fehler', n, JSON.stringify(p.bad));
    ok(`Keine unerwarteten HTTP-Fehler bei ${n}`, unexpected.length === 0, JSON.stringify(unexpected));
  }
}
