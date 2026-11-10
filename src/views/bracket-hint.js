// Bracket-Hinweis beim Spielstart (P7, Welle ttg-live-feinschliff-decks; NOTIZEN.md Decks 2). Reine Funktion, keine Imports.
// Liegt unter views/, weil Views von der SHELL-Pflicht B4 ausgenommen sind (WELLE.md R3).
//
// bracketHint(decks) ⇒ null oder Liste der Hinweise (Reihenfolge: zuerst alle check, dann höchstens ein spread)
//   decks  [{ bracket, bracket_check }] je gewähltem Spieler (fehlendes Deck: null/undefined, zählt nicht)
//   { kind: 'check', deck, floor }   bracket_check.floor > decks.bracket („Deck X prüft als Bracket 4“), deck = Index
//   { kind: 'spread', min, max }     wirksame Brackets ≥ 2 Stufen auseinander („Brackets 2 und 4 am Tisch — passt das?“)
// Wirksames Bracket: bevorzugt bracket_check.floor, sonst decks.bracket; floor 1 zählt als 2 (floor 1 heißt „1–2“).
// Erst ab zwei Decks gibt es einen Hinweis.

const num = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);

export function bracketHint(decks) {
  if (!Array.isArray(decks)) return null;
  const checks = [];
  const eff = [];
  decks.forEach((d, i) => {
    if (!d || typeof d !== 'object') return;
    const bracket = num(d.bracket);
    const c = d.bracket_check;
    const floor = c && typeof c === 'object' ? num(c.floor) : null;
    if (floor != null && bracket != null && floor > bracket) checks.push({ kind: 'check', deck: i, floor });
    const e = floor != null ? Math.max(2, floor) : bracket;
    if (e != null) eff.push(e);
  });
  if (eff.length < 2) return null;
  const out = [...checks];
  const min = Math.min(...eff), max = Math.max(...eff);
  if (max - min >= 2) out.push({ kind: 'spread', min, max });
  return out.length ? out : null;
}
