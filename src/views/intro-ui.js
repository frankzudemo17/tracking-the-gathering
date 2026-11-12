// Spielstart-Intro, reine Logik (Spec P3, Welle ttg-features): Startbedingung, Reihenfolge, Bilanz/Salz,
// automatische Zeile (Entscheid 9 + Nachtrag 1) und Motto vor Auto-Zeile. Ohne DOM, in Node testbar
// (tests/unit/intro-ui.test.mjs, Muster life-ui.js). Texte kommen aus dem Wörterbuch (`L` = Namensraum
// `intro` der Sprache, src/i18n/de-intro.js / en-intro.js); einzige Ausnahme ist die Typ-Tabelle TRIBES_DE (Nachtrag 1).
import { fmtAvg } from '../lib/format.js';

export const INTRO_CARD_MS = 2500; // Standzeit je Karte (Entscheid 5)
export const INTRO_WAIT_MS = 700; // spätestens so lange nach dem Öffnen erscheint die erste Karte (Entscheid 6)
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
