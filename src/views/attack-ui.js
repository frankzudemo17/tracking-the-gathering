// Reine Hilfen für Angriff per Ziehen und Angriffsfenster (Spec P10). Ohne Importe, ohne DOM:
// Zielauswahl, Ziel-Ermittlung beim Ziehen, Knopf- und Kopftexte, Zielfernrohr-Geometrie.
// Gerechnet wird hier nichts — Werte der Vorschau kommen ausschließlich aus previewAttack (P3).

/** Ab dieser Bewegung (px, Bildschirm) wird aus einem Tippen ein Ziehen (Main.dc.html:1840). */
export const DRAG_PX = 14;
/** Tipps so kurz nach einem Ziehen zählen nicht (Main.dc.html:1772). */
export const TAP_BLOCK_MS = 400;
/** Kennung des Mittelknopfs als Ziel „alle Gegner“. */
export const ALL = '__all';
/** Schnellwahl der Menge (Main.dc.html:2527). */
export const QUICK = [5, 10, 15, 20];

/** Ist die Bewegung seit dem Zeiger-Down ein Ziehen? */
export const isDrag = (dx, dy) => Math.hypot(dx, dy) >= DRAG_PX;

/** Lebende Gegner von `from` in Sitzreihenfolge des Zustands. */
export const opponents = (players, from) => players.filter((p) => p.id !== from && !p.out);

/**
 * Gültiges Ziel unter dem Finger: ALL (Mittelknopf), die id eines lebenden Gegners, sonst null.
 * Eigenes Feld, Ausgeschiedene und Unbekannte sind kein Ziel (Main.dc.html:1847–1848).
 */
export function hoverTarget(over, from, players) {
  if (!over || over === from) return null;
  if (over === ALL) return opponents(players, from).length ? ALL : null;
  const p = players.find((x) => x.id === over);
  return p && !p.out ? p.id : null;
}

/** Ziele beim Loslassen: ALL ⇒ alle lebenden Gegner, Gegner ⇒ [id], sonst []. */
export function dropTargets(over, from, players) {
  const h = hoverTarget(over, from, players);
  if (!h) return [];
  return h === ALL ? opponents(players, from).map((p) => p.id) : [h];
}

/** Ziel an-/abwählen (frei kombinierbar). */
export const toggleTarget = (to, id) => (to.includes(id) ? to.filter((x) => x !== id) : [...to, id]);

/** Sind alle (mindestens zwei) Gegner gewählt? */
export const allSelected = (to, oppIds) => oppIds.length > 1 && oppIds.every((id) => to.includes(id));

/** „Alle Gegner“-Chip: alle gewählt ⇒ keiner, sonst alle. */
export const toggleAll = (to, oppIds) => (allSelected(to, oppIds) ? [] : oppIds.slice());

/** Zeigt das Fenster den Chip „Alle Gegner“? Nur bei mehr als einem Gegner (Spec P10). */
export const showAllChip = (oppIds) => oppIds.length > 1;

/** Nur Ziele, die noch lebende Gegner sind, in Sitzreihenfolge. */
export const validTo = (to, oppIds) => oppIds.filter((id) => to.includes(id));

/**
 * Arten des Angriffs. Partner ⇒ beide Commander-Namen einzeln (cmd / cmd2, HANDOFF 5.4).
 * @param {{ damage: string, cmd: string, poison: string }} L Beschriftungen
 * @param {string[] | null} partnerNames [Commander 1, Commander 2] oder null
 * @returns {{ kind: string, label: string }[]}
 */
export function kinds(L, partnerNames) {
  const cmd = partnerNames && partnerNames.length === 2
    ? [{ kind: 'cmd', label: partnerNames[0] }, { kind: 'cmd2', label: partnerNames[1] }]
    : [{ kind: 'cmd', label: L.cmd }];
  return [{ kind: 'damage', label: L.damage }, ...cmd, { kind: 'poison', label: L.poison }];
}

/** Lifelink ist bei Gift wirkungslos (P3 E8) ⇒ Schalter ausblenden. */
export const canLifelink = (kind) => kind !== 'poison';

/** Menge ändern, min 1. */
export const stepAmount = (amount, d) => Math.max(1, (Number(amount) || 1) + d);

/** Platzhalter {name} ersetzen. */
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

/**
 * Text und Zustand des Eintragen-Knopfs (Main.dc.html:2533). Ohne Ziel deaktiviert: „Ziel wählen“.
 * @param {{ pick: string, apply: string, applyMulti: string, word: Record<string,string> }} L
 */
export function confirmLabel(L, { amount, kind, n }) {
  if (!n) return { text: L.pick, disabled: true };
  const word = L.word[kind === 'cmd2' ? 'cmd' : kind];
  return { text: fill(n > 1 ? L.applyMulti : L.apply, { amount, word, n }), disabled: false };
}

/** Kopfzeile rechts: „Alle Gegner“ · Name · „N Gegner“ · leer. */
export function headTo(L, to, oppIds, nameOf) {
  const v = validTo(to, oppIds);
  if (allSelected(v, oppIds)) return L.allOpp;
  if (v.length === 1) return nameOf(v[0]);
  if (v.length === 0) return L.noTarget;
  return fill(L.nOpp, { n: v.length });
}

/** Balkenbreite in Prozent (0–100) für Commander „/ 21“ und Gift „/ 10“. */
export const barPct = (v, max) => Math.max(0, Math.min(100, (v / max) * 100));

/**
 * Zielfernrohr: Radien und Fadenkreuz. Über gültigem Ziel eingerastet: R 22, sonst R 30
 * (Main.dc.html:2539–2541).
 */
export function scopeGeom(locked) {
  const R = locked ? 22 : 30;
  return {
    r1: R,
    r2: R - 9,
    cross: `M${-R - 12} 0H${-R + 8}M${R - 8} 0H${R + 12}M0 ${-R - 12}V${-R + 8}M0 ${R - 8}V${R + 12}`,
  };
}
