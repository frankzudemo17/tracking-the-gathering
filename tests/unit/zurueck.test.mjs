// P14 Zurück-Schleife (Franco 17.11.): Profil → Deck → Zurück → Profil → Zurück landete wieder auf dem Deck, endlos.
// Ursache: backTarget nahm die zuletzt besuchte Route statt der Route davor im App-Verlauf. Jetzt führt router.js
// einen Pfad (Stapel): ein Wechsel auf die vorletzte Route gilt als „zurück“ und nimmt die letzte vom Stapel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Browser-Ersatz: hashchange-Ereignisse, location.hash, history.replaceState
const win = new EventTarget();
const loc = { hash: '#/start' };
globalThis.window = /** @type {any} */ (win);
globalThis.location = /** @type {any} */ (loc);
globalThis.history = /** @type {any} */ ({ replaceState: (_s, _t, h) => { loc.hash = h; } });
if (typeof globalThis.HashChangeEvent === 'undefined') globalThis.HashChangeEvent = /** @type {any} */ (class extends Event {});
const { backTarget, go } = await import('../../src/router.js');

/** Navigation wie ein Tipp auf einen Link: neuer Verlaufseintrag */
const nav = (h) => { loc.hash = h; win.dispatchEvent(new Event('hashchange')); };
// Regeln wie in den Views
const profileBack = () => backTarget('#/gruppen', (h) => !/^#\/(profil\/|login|registrieren|beitreten|passwort)/.test(h));
const deckBack = (owner) => backTarget(owner, (h) => !/^#\/(deck\/|login|registrieren|beitreten|passwort)/.test(h));

test('Z1: Rangliste → Profil → Deck → Zurück → Zurück endet auf der Rangliste, nicht wieder auf dem Deck', () => {
  nav('#/rangliste');
  nav('#/profil/m-L');
  assert.equal(profileBack(), '#/rangliste');
  nav('#/deck/d1');
  assert.equal(deckBack('#/profil/m-L'), '#/profil/m-L');
  nav(deckBack('#/profil/m-L')); // Tipp auf Zurück im Deck
  assert.equal(profileBack(), '#/rangliste', 'Profil-Zurück zeigte vorher auf das Deck (Schleife)');
  nav(profileBack());
  assert.equal(loc.hash, '#/rangliste');
});

test('Z2: Rangliste (Decks) → Deck → Zurück führt zur Rangliste, nicht ins Profil des Besitzers', () => {
  nav('#/rangliste');
  nav('#/deck/d2');
  assert.equal(deckBack('#/profil/m-M'), '#/rangliste');
});

test('Z3: Ohne Vorgänger (Direktaufruf) gilt das Ersatzziel; zwei Decks hintereinander springen nicht aufeinander zurück', () => {
  nav('#/profil/m-D');
  nav('#/deck/d3');
  nav('#/deck/d4'); // z. B. Link aus einer anderen Ansicht
  assert.equal(deckBack('#/profil/m-D'), '#/profil/m-D', 'Vorgänger ist ein Deck ⇒ Besitzerprofil statt Deck-Schleife');
});

test('Z4: go(…, { replace: true }) ersetzt die letzte Route statt sie zu stapeln', () => {
  nav('#/historie');
  nav('#/profil/m-T');
  nav('#/deck/d5');
  go('/profil/m-T', { replace: true }); // z. B. nach „Deck archivieren“
  assert.equal(loc.hash, '#/profil/m-T');
  assert.equal(profileBack(), '#/historie');
});

test('Z6: Eigenes Profil (#/profil) → Deck → Zurück landet auf #/profil, nicht auf #/profil/<id> als neuem Eintrag', () => {
  nav('#/profil');
  nav('#/deck/d6');
  const back = deckBack('#/profil/m-F'); // Besitzer-Ersatz wäre die Mitglieds-Adresse
  assert.equal(back, '#/profil');
  nav(back);
  assert.equal(backTarget('#/start'), '#/profil/m-T', 'Pfad davor bleibt erhalten (Stapel genommen, nicht gewachsen)');
});

test('Z5: Deck-Seite nutzt backTarget mit Besitzerprofil als Ersatz', () => {
  const src = read('src/views/deck.js');
  assert.match(src, /backTarget\(\s*ownerBack/);
  assert.match(read('src/views/profile.js'), /backTarget\('#\/gruppen'/);
});
