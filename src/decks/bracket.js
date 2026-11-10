// Bracket-Rechner (rein, ohne Netz, ohne DOM). Eingabe = gekürzte Antwort der Edge Function
// `spellbook` (supabase/functions/spellbook/core.js → trim). Ausgabe sind Codes, keine Texte —
// die Übersetzung macht die Oberfläche (P5).
//
// Grundlage: offizielle Commander Brackets (Wizards of the Coast).
// • „Introducing Commander Brackets Beta“ (Feb. 2025)
//   https://magic.wizards.com/en/news/announcements/introducing-commander-brackets-beta
//   Bracket 1 Exhibition, Deck Building: „No cards from the Game Changers list. No intentional
//     two-card infinite combos, mass land denial, or extra-turn cards. Tutors should be sparse.“
//   Bracket 2 Core, Deck Building: „No cards from the Game Changers list. No intentional two-card
//     infinite combos or mass land denial. Extra-turn cards should only appear in low quantities
//     and are not intended to be chained in succession or looped. Tutors should be sparse.“
//   Bracket 3 Upgraded, Deck Building: „Up to three cards from the Game Changers list. No
//     intentional early-game two-card infinite combos. Extra-turn cards should only appear in low
//     quantities and are not intended to be chained in succession or looped. No mass land denial.“
//     Experience: „These decks should generally not have any two-card infinite combos that can
//     happen cheaply and in about the first six or so turns of the game“.
//   Bracket 4 Optimized, Deck Building: „There are no restrictions (other than the banned list).“
// • Update 21.10.2025: „remove the tutor restrictions from Commander Brackets entirely and rely on
//   Game Changers to catch the most efficient tutors.“
//   https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-october-21-2025
//   ⇒ Tutoren sind nur noch ein Hinweis (vom Aufrufer durchgereicht), nie ein Grund.
// • Update 09.02.2026: nur die Game-Changer-Liste, keine Bracket-Regeln („we really want to cool it
//   on bracket-level changes for the time being“). Die Liste selbst pflegt Commander Spellbook
//   (Feld `gameChanger` je Karte).
//   https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026
//
// floor = kleinstes Bracket, das die Liste nach diesen Regeln zulässt. floor 1 bedeutet
// „passt zu 1–2“ (die Regeln trennen 1 und 2 nur über Absicht/Thema und Extrazüge in geringer
// Zahl, das lässt sich aus der Liste nicht sicher ablesen). Bracket 5 (cEDH) wird nie errechnet:
// es unterscheidet sich von 4 nur durch die Absicht (Metagame), nicht durch Karten.

/** Grenzen (an einer Stelle, damit die Gegenprobe sie gezielt verdrehen kann). */
export const RULES = Object.freeze({
  /** Bracket 3: „Up to three cards from the Game Changers list“ — ab der vierten ⇒ 4. */
  gcMaxBracket3: 3,
  /**
   * „Low quantities“ / „not intended to be chained“: ab so vielen Extrazug-Karten wertet der
   * Rechner das als Kette (⇒ 4). Triage-Grenze dieser Welle, kein WotC-Zahlenwert.
   */
  extraTurnChainCards: 3,
  /**
   * „early-game two-card infinite combos“ / „cheaply and in about the first six or so turns“:
   * Kombo gilt als früh, wenn sie höchstens so viel Mana braucht (Spellbook `manaValueNeeded`).
   * Triage-Heuristik dieser Welle (4 Mana ≈ bis Zug 4–5 spielbar), kein WotC-Zahlenwert.
   * Fehlt die Angabe, gilt die Kombo NICHT als früh (nur `combo`, floor 3).
   */
  earlyComboMaxMana: 4,
});

const list = (x) => (Array.isArray(x) ? x : []);
const names = (xs) => [...new Set(xs.filter((n) => typeof n === 'string' && n))].sort((a, b) => a.localeCompare(b, 'en'));

/** Hinweis aus dem Aufrufer: Anzahl (Zahl) oder Kartennamen (Array). */
function callerHint(code, h) {
  if (Array.isArray(h)) {
    const cards = names(h);
    return cards.length ? { code, cards, count: cards.length } : null;
  }
  const n = Number(h);
  return Number.isFinite(n) && n > 0 ? { code, cards: [], count: Math.floor(n) } : null;
}

/**
 * Mindest-Bracket einer Deckliste aus der Spellbook-Antwort.
 * @param {{ tag?: string, cards?: object[], combos?: object[], unknown?: { count: number, cards?: string[] } } | null | undefined} spellbook
 * @param {{ tutorsHint?: number | string[], fastManaHint?: number | string[] }} [opts]
 * @returns {{ floor: 1|2|3|4, reasons: { code: string, floor: number, cards: string[] }[],
 *   hints: { code: string, cards: string[], count?: number }[], banned: string[], tag: string | null }}
 */
export function bracketFloor(spellbook, opts = {}) {
  const cards = list(spellbook?.cards).filter((c) => c && typeof c === 'object');
  const combos = list(spellbook?.combos).filter((c) => c && typeof c === 'object');
  const reasons = [];
  const hints = [];
  const nameOf = (c) => c.name;

  // Game Changers: 0 ⇒ 1–2 · 1–3 ⇒ 3 · ab 4 ⇒ 4
  const gc = names(cards.filter((c) => c.gameChanger === true).map(nameOf));
  if (gc.length > RULES.gcMaxBracket3) reasons.push({ code: 'gc', floor: 4, cards: gc });
  else if (gc.length > 0) reasons.push({ code: 'gc', floor: 3, cards: gc });

  // Massen-Landzerstörung (Karte oder Kombo): Bracket 1–3 „No mass land denial“ ⇒ 4
  const mldCombos = combos.filter((k) => k.massLandDenial === true);
  const mld = names([
    ...cards.filter((c) => c.massLandDenial === true).map(nameOf),
    ...mldCombos.flatMap((k) => list(k.cards)),
  ]);
  if (mld.length || mldCombos.length) reasons.push({ code: 'mld', floor: 4, cards: mld });

  // Extrazüge: Kombo mit Extrazug oder ≥ 3 Karten ⇒ Kette (4); 1–2 Karten ⇒ nur Hinweis
  const etCards = names(cards.filter((c) => c.extraTurn === true).map(nameOf));
  const etCombos = combos.filter((k) => k.extraTurn === true);
  if (etCombos.length || etCards.length >= RULES.extraTurnChainCards) {
    reasons.push({ code: 'extra_turn_chain', floor: 4, cards: names([...etCards, ...etCombos.flatMap((k) => list(k.cards))]) });
  } else if (etCards.length) {
    hints.push({ code: 'extra_turns', cards: etCards });
  }

  // Zwei-Karten-Kombos: früh (≤ 4 Mana) ⇒ 4 · sonst ⇒ 3 · nur „arguably“ ⇒ Hinweis
  const early = [];
  const late = [];
  const arguable = [];
  for (const k of combos) {
    if (k.definitelyTwoCard === true) {
      const mv = k.manaValueNeeded;
      const isEarly = typeof mv === 'number' && Number.isFinite(mv) && mv <= RULES.earlyComboMaxMana;
      (isEarly ? early : late).push(...list(k.cards));
    } else if (k.arguablyTwoCard === true) {
      arguable.push(...list(k.cards));
    }
  }
  if (early.length) reasons.push({ code: 'combo_early', floor: 4, cards: names(early) });
  if (late.length) reasons.push({ code: 'combo', floor: 3, cards: names(late) });
  if (arguable.length) hints.push({ code: 'combo_arguable', cards: names(arguable) });

  // Hinweise ohne Grenze
  const tutors = callerHint('tutors', opts?.tutorsHint);
  if (tutors) hints.push(tutors);
  const fast = callerHint('fast_mana', opts?.fastManaHint);
  if (fast) hints.push(fast);
  const unknown = spellbook?.unknown;
  const unknownCount = Number(unknown?.count);
  if (Number.isFinite(unknownCount) && unknownCount > 0) {
    hints.push({ code: 'unknown_cards', cards: names(list(unknown.cards)), count: unknownCount });
  }

  const floor = /** @type {1|2|3|4} */ (Math.max(1, ...reasons.map((r) => r.floor)));
  return {
    floor,
    reasons,
    hints,
    banned: names(cards.filter((c) => c.banned === true).map(nameOf)),
    tag: typeof spellbook?.tag === 'string' ? spellbook.tag : null,
  };
}

/**
 * Besitzer-Bracket gegen das Ergebnis. Nur ein Hinweis — nie automatisch ändern.
 * `below` ⇔ Besitzer < floor · `above` ⇔ Besitzer ≥ floor + 2 und Besitzer ≥ 3 · sonst `ok`.
 * (floor 1 heißt „1–2“, daher gilt Besitzer 2 bei floor 1 als passend.)
 * Ohne gültiges Besitzer-Bracket (1–5) gibt es nichts zu vergleichen ⇒ `ok`.
 * @param {number | null | undefined} ownerBracket
 * @param {{ floor: number } | number} result
 * @returns {'ok' | 'below' | 'above'}
 */
export function compareBracket(ownerBracket, result) {
  const owner = Number(ownerBracket);
  const floor = Number(typeof result === 'object' && result !== null ? result.floor : result);
  if (ownerBracket == null || !Number.isInteger(owner) || owner < 1 || owner > 5) return 'ok';
  if (!Number.isFinite(floor)) return 'ok';
  if (owner < floor) return 'below';
  if (owner >= floor + 2 && owner >= 3) return 'above';
  return 'ok';
}
