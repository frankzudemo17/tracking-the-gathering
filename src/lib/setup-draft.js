// Setup-Entwurf „Neues Spiel“ an einer Stelle (P2 Revanche, Welle ttg-features, spec-p2-revanche.md Entscheide 2, 3, 6).
// Der Entwurf liegt in sessionStorage unter draftKey(<groupId>) und übersteht Neuladen und die Umwege über
// „+ Spieler“/„+ Commander“. Lesen/Schreiben/Löschen verhaltensgleich aus src/views/setup.js umgezogen.
// Die Revanche (Ergebnisseite, Partie-Detail) schreibt hier einen vollständigen Entwurf; geprüft wird er wie jeder
// andere Entwurf im Setup (aktive Mitglieder, verfügbare Decks, Layout/Leben gültig, höchstens 6).
// Keine DOM-Importe; sessionStorage nur in try (Node-testbar: tests/unit/setup-draft.test.mjs).
import { LAYOUTS } from '../game/layouts.js';

export const draftKey = (gid) => `ttg.setup.${gid}`;

export function readDraft(gid) {
  try { const raw = sessionStorage.getItem(draftKey(gid)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Nur die bekannten Felder; `rematch` (Marke der Revanche) nur, wenn es als String gesetzt ist. */
export function writeDraft(gid, s) {
  try {
    /** @type {Record<string, unknown>} */
    const d = { sel: s.sel, deck: s.deck, layout: s.layout, life: s.life, layoutSet: s.layoutSet, lifeSet: s.lifeSet, start: s.start, roll: s.roll };
    if (typeof s.rematch === 'string') d.rematch = s.rematch;
    sessionStorage.setItem(draftKey(gid), JSON.stringify(d));
  } catch { /* Privatmodus */ }
}

export function clearDraft(gid) { try { sessionStorage.removeItem(draftKey(gid)); } catch { /* egal */ } }

/**
 * Revanche: Entwurf mit derselben Aufstellung (Spieler in Sitzordnung, ihre Decks, Layout, Startleben).
 * Startspieler und Startwurf werden nie übernommen (neu bestimmen, Würfeltisch wie immer). Keine Filterung nach
 * entfernt/archiviert und kein Kürzen auf 6 — das macht das Setup beim Wiederherstellen.
 * @param {{ game?: { id: string, layout?: unknown, startingLife?: unknown }|null, players?: { gameId: string, memberId: string, deckId: string|null, seat: number }[] }|null|undefined} data
 */
export function rematchDraft(data) {
  const game = data?.game;
  if (!game) return null;
  const seatOf = (p) => (Number.isFinite(p.seat) ? p.seat : Number.MAX_SAFE_INTEGER);
  const rows = (Array.isArray(data.players) ? data.players : [])
    .filter((p) => p && p.gameId === game.id)
    .slice()
    .sort((a, b) => seatOf(a) - seatOf(b));
  /** @type {string[]} */
  const sel = [];
  /** @type {Record<string, string|null>} */
  const deck = {};
  for (const p of rows) {
    if (sel.includes(p.memberId)) continue; // jedes Mitglied einmal, die erste Zeile (kleinster Sitz) gewinnt
    sel.push(p.memberId);
    deck[p.memberId] = p.deckId ?? null;
  }
  const layoutOk = typeof game.layout === 'string' && LAYOUTS.includes(game.layout);
  const life = game.startingLife;
  const lifeOk = Number.isInteger(life) && /** @type {number} */ (life) >= 5 && /** @type {number} */ (life) <= 99;
  return {
    sel, deck,
    layout: layoutOk ? game.layout : null, layoutSet: layoutOk,
    life: lifeOk ? life : null, lifeSet: lifeOk,
    start: null, roll: null,
    rematch: game.id,
  };
}

/**
 * Was beim Wiederherstellen eines Revanche-Entwurfs verloren ging (einmaliger Hinweis im Setup).
 * Ohne Marke ⇒ null. players = verschiedene Mitglieder aus draft.sel, die nicht in s.sel stehen;
 * decks = Mitglieder in s.sel, deren Entwurfs-Deck ein String war und deren Deck jetzt davon abweicht.
 * @param {any} draft gelesener Entwurf
 * @param {{ sel: string[], deck: Record<string, string|null> }} s wiederhergestellter Zustand des Setups
 * @returns {{ players: number, decks: number }|null}
 */
export function rematchLoss(draft, s) {
  if (typeof draft?.rematch !== 'string') return null;
  const kept = new Set(Array.isArray(s?.sel) ? s.sel : []);
  const lost = new Set((Array.isArray(draft.sel) ? draft.sel : []).filter((id) => !kept.has(id)));
  let decks = 0;
  for (const id of kept) {
    const was = draft.deck?.[id];
    if (typeof was === 'string' && s.deck?.[id] !== was) decks++;
  }
  return { players: lost.size, decks };
}
