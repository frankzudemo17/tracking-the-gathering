// Spielstart-Intro, reine Logik (Spec P3, Welle ttg-features): Startbedingung, Reihenfolge, Bilanz/Salz,
// automatische Zeile (Entscheid 9 + Nachtrag 1) und Motto vor Auto-Zeile. Ohne DOM, in Node testbar
// (tests/unit/intro-ui.test.mjs, Muster life-ui.js). Texte kommen aus dem Wörterbuch (`L` = Namensraum
// `intro` der Sprache, src/i18n/de-intro.js / en-intro.js); einzige Ausnahme ist die Typ-Tabelle TRIBES_DE (Nachtrag 1).
import { fmtAvg } from '../lib/format.js';

// P8 Intro 2.0 (spec-p8-intro2.md): die Standzeit je Karte ist eine Gruppen-Einstellung (playgroups.intro_seconds,
// 2–10 s, Standard 4) = Liegezeit ab „Karte liegt“; der Anflug (INTRO_FLY_MS) kommt dazu (Entscheide 1, 9).
export const INTRO_FLY_MS = 900; // Anflug + Aufprall bis „Karte liegt“ (Entscheid 8)
export const INTRO_WAIT_MS = 1200; // spätestens so lange nach dem Öffnen erscheint die erste Karte (P3: 700 + 500 Bild-Budget, Entscheid 13)
export const INTRO_SECONDS_DEFAULT = 4;
export const INTRO_SECONDS_MIN = 2;
export const INTRO_SECONDS_MAX = 10;
export const INTRO_FADE_MS = 200; // Überblenden bei Weniger Bewegung (Entscheid 15)
export const INTRO_FRESH_MS = 60000; // Merker „hier gestartet“ gilt so lange (Entscheid 1 d)
export const AUTO_MAX = 60; // Auto-Zeile höchstens 60 Codepunkte, sonst hinten Fakten streichen
const AUTO_FACTS = 3; // nach den Farben höchstens drei Fakten
const SHARE_HEAVY = 0.4; // Kreaturen / Nicht-Länder ≥ 0,40 ⇒ kreaturenlastig
const SHARE_FEW = 0.15; // ≤ 0,15 ⇒ kaum Kreaturen
const SEP = ' · ';

/**
 * Nachtrag 1 (Dirigent 12.11.): Kreaturentypen der deutschen Auto-Zeile als Plural, Scryfall-Typ ⇒ Anzeige.
 * Die häufigsten Commander-Typen; was fehlt, nimmt den Rückfall `auto.tribe` des Wörterbuchs.
 */
export const TRIBES_DE = Object.freeze({
  Advisor: 'Berater', Angel: 'Engel', Assassin: 'Assassinen', Beast: 'Bestien', Berserker: 'Berserker', Bird: 'Vögel',
  Cat: 'Katzen', Cleric: 'Kleriker', Construct: 'Konstrukte', Demon: 'Dämonen', Dinosaur: 'Dinosaurier', Dog: 'Hunde',
  Dragon: 'Drachen', Druid: 'Druiden', Dwarf: 'Zwerge', Eldrazi: 'Eldrazi', Elemental: 'Elementare', Elf: 'Elfen',
  Faerie: 'Feen', Fox: 'Füchse', Frog: 'Frösche', Giant: 'Riesen', Goblin: 'Goblins', Horror: 'Schrecken',
  Human: 'Menschen', Hydra: 'Hydren', Insect: 'Insekten', Knight: 'Ritter', Merfolk: 'Meervolk', Monk: 'Mönche',
  Myr: 'Myr', Ninja: 'Ninjas', Phyrexian: 'Phyrexianer', Pirate: 'Piraten', Rat: 'Ratten', Rogue: 'Schurken',
  Samurai: 'Samurai', Shaman: 'Schamanen', Skeleton: 'Skelette', Sliver: 'Slivers', Snake: 'Schlangen', Soldier: 'Soldaten',
  Sphinx: 'Sphingen', Spirit: 'Geister', Squirrel: 'Eichhörnchen', Thopter: 'Thopter', Treefolk: 'Baumvolk',
  Vampire: 'Vampire', Warrior: 'Krieger', Werewolf: 'Werwölfe', Wizard: 'Zauberer', Wolf: 'Wölfe', Zombie: 'Zombies',
});
const TRIBE_NAMES = { de: TRIBES_DE };

/** Platzhalter {k} füllen (wie t() in src/i18n/index.js, hier ohne Import ⇒ Node-testbar). */
export const fill = (s, vars = {}) => String(s ?? '').replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
const cp = (s) => [...String(s)].length;

/**
 * Startbedingung (Entscheid 1 a, d–f): Schalter an, Merker 0…60 s alt, Spiel live und offen,
 * kein Ereignis außer dem Startwurf (`roll`).
 * @param {{ enabled: boolean, mark: number | null | undefined, now: number, status: string, finished: boolean, events: { type: string }[] }} o
 */
export function introDue({ enabled, mark, now, status, finished, events }) {
  if (enabled !== true) return false;
  if (typeof mark !== 'number' || !Number.isFinite(mark)) return false;
  const age = now - mark;
  if (!(age >= 0 && age <= INTRO_FRESH_MS)) return false;
  if (status !== 'live' || finished) return false;
  return (events || []).every((e) => e?.type === 'roll');
}

/**
 * Zugreihenfolge ab dem Startspieler (Entscheid 4): nach seat aufsteigend, rotiert, sodass seat === turn vorn steht.
 * Kein Treffer ⇒ Sitzfolge ab dem kleinsten Sitz. Die Eingabe bleibt unverändert.
 * @template {{ seat: number }} P
 * @param {P[]} players
 * @param {number} turn
 * @returns {P[]}
 */
export function introOrder(players, turn) {
  const sorted = (players || []).slice().sort((a, b) => a.seat - b.seat);
  const i = sorted.findIndex((p) => p.seat === turn);
  return i <= 0 ? sorted : [...sorted.slice(i), ...sorted.slice(0, i)];
}

/** Deck-Bilanz (deckProfile): nicht geladen ⇒ null; 0 Spiele ⇒ „Erstes Spiel“; sonst „{w} von {g} gewonnen“. */
export function recordText(dp, L) {
  if (!dp || typeof dp.games !== 'number') return null;
  if (dp.games <= 0) return L.record.first;
  return fill(L.record.won, { w: dp.wins ?? 0, g: dp.games });
}

/** Salz des Decks (deckProfile.salt.avgSalt), eine Nachkommastelle; ohne Stimme ⇒ null. */
export function saltText(dp, lang) {
  const v = dp?.salt?.avgSalt;
  return typeof v === 'number' && Number.isFinite(v) ? fmtAvg(v, lang) : null;
}

function colorsText(colors, A) {
  const n = colors.length;
  if (!n) return A.colorless;
  if (n === 1) return A.mono[colors[0]];
  return A.multi[Math.min(n, 5)];
}

function tribeText(type, A, lang) {
  const name = TRIBE_NAMES[lang]?.[type];
  return name ? fill(A.tribeKnown, { name, type }) : fill(A.tribe, { type });
}

/**
 * Automatische Zeile (Entscheid 9): [Farben, …die ersten 3 vorhandenen Fakten aus Endlos-Kombos, Game Changer,
 * Kreaturentyp | Kreaturenanteil, Manakurve], getrennt mit „ · “; > 60 Codepunkte ⇒ hinten Fakten streichen
 * (Farben bleiben). Ohne Fakten (deckTraits = null) ⇒ null.
 * @param {ReturnType<typeof import('../decks/cards.js').deckTraits>} traits
 * @param {any} L Namensraum `intro` der Sprache
 * @param {string} lang
 */
export function autoLine(traits, L, lang) {
  if (!traits) return null;
  const A = L.auto;
  const facts = [];
  if (traits.infinite >= 1) facts.push(traits.infinite === 1 ? A.infinite1 : fill(A.infiniteN, { n: traits.infinite }));
  if (traits.gameChangers >= 1) facts.push(traits.gameChangers === 1 ? A.gc1 : fill(A.gcN, { n: traits.gameChangers }));
  if (traits.tribe) facts.push(tribeText(traits.tribe, A, lang));
  else if (traits.creatureShare >= SHARE_HEAVY) facts.push(A.heavy);
  else if (traits.creatureShare <= SHARE_FEW) facts.push(A.few);
  if (traits.curve) facts.push(A.curve[traits.curve]);
  const parts = [colorsText(traits.colors || [], A), ...facts.slice(0, AUTO_FACTS)];
  while (parts.length > 1 && cp(parts.join(SEP)) > AUTO_MAX) parts.pop();
  return parts.join(SEP);
}

/**
 * Zeile unter der Faktenzeile: Motto (getrimmt, nicht leer) gewinnt, sonst Auto-Zeile, sonst null.
 * Ein Deck ohne Schlüssel `motto` (Spalte noch nicht in der Datenbank) zählt wie „kein Motto“.
 * @returns {{ kind: 'motto' | 'auto', text: string } | null}
 */
export function cardLine(deck, traits, L, lang) {
  const motto = typeof deck?.motto === 'string' ? deck.motto.trim() : '';
  if (motto) return { kind: 'motto', text: motto };
  const auto = autoLine(traits, L, lang);
  return auto ? { kind: 'auto', text: auto } : null;
}

// ---------------------------------------------------------------- P8 Intro 2.0 (Entscheide 1, 9, 12; Bühne „Tisch“)

/** Liegezeit in Sekunden (Entscheid 1): ganze Zahl 2–10, sonst der Standard 4 — keine Umwandlung von Texten. */
export function introSeconds(v) {
  return Number.isInteger(v) && v >= INTRO_SECONDS_MIN && v <= INTRO_SECONDS_MAX ? v : INTRO_SECONDS_DEFAULT;
}

/**
 * Zeiten je Karte (Entscheid 9): Liegezeit = eingestellte Zeit, der Anflug kommt dazu; Weniger Bewegung ⇒ kein Anflug.
 * @returns {{ flyMs: number, lieMs: number, cardMs: number }}
 */
export function introTiming(seconds, still) {
  const flyMs = still ? 0 : INTRO_FLY_MS;
  const lieMs = introSeconds(seconds) * 1000;
  return { flyMs, lieMs, cardMs: flyMs + lieMs };
}

/**
 * Startversatz des Anflugs (Entscheid 12): aus der Bildschirmmitte zur Mitte des Spielerfelds, normiert auf die
 * Bildschirmdiagonale (Karte startet sicher außerhalb). Kein Feld oder Abstand < 1 px ⇒ von unten. dir = Drehsinn.
 * @param {{ left: number, top: number, width: number, height: number } | null | undefined} rect
 * @returns {{ x: number, y: number, dir: 1 | -1 }}
 */
export function flightFrom(rect, vw, vh) {
  const D = Math.hypot(vw, vh);
  let ux = 0, uy = 1;
  if (rect && [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)) {
    const dx = rect.left + rect.width / 2 - vw / 2;
    const dy = rect.top + rect.height / 2 - vh / 2;
    const len = Math.hypot(dx, dy);
    if (len >= 1) { ux = dx / len; uy = dy / len; }
  }
  const x = Math.round(ux * D) || 0; // −0 ⇒ 0
  const y = Math.round(uy * D) || 0;
  return { x, y, dir: x < 0 ? -1 : 1 };
}

const TILTS = [-2, 1.5, -1, 2.5, -1.5, 1]; // Grad, fest je Sitz (kein Zufall, Lint L1)
/** Leichte Neigung der liegenden Karte je Sitz (|w| ≤ 3°, Periode 6). */
export function tiltFor(seat) {
  return Number.isInteger(seat) ? TILTS[((seat % 6) + 6) % 6] : 0;
}
