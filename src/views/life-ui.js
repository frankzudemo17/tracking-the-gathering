// Reine Anzeige-Hilfen des Lifecounters (Spec P8): keine Importe, kein DOM ⇒ in Node testbar.
// Hier wird keine Spielregel gerechnet — Werte, Grenzen und Verlauf kommen aus der Engine (P3)
// und werden nur in Text oder Reihenfolge gebracht.

const MINUS = '−';

/** Sekunden ⇒ „mm:ss“, ab einer Stunde „h:mm:ss“ (Main.dc.html mmss). Negativ/ungültig ⇒ 0. */
export function mmss(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return (h ? `${h}:${p(m)}` : p(m)) + ':' + p(x);
}

/** Vorzeichen mit echtem Minus: +3 · −3 · 0. */
export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `${MINUS}${Math.abs(n)}` : '0');

/** Zähler im Sheet in fester Reihenfolge (HANDOFF 5.4, Main.dc.html:2431–2440). */
export const COUNTER_KEYS = ['poison', 'tax', 'tax2', 'energy', 'exp', 'rad', 'speed', 'ring', 'dungeon'];
export const DEFAULT_PINS = ['poison', 'tax'];

/**
 * Zeilen des Zähler-Sheets. `tax2` nur bei Partner. Pin-Schlüssel: `tax2` hängt an `tax`
 * (wie im Mockup), alle anderen an sich selbst. Oben: angepinnt oder Wert > 0 (Werte > 0 zuerst),
 * Rest unter „Weitere Zähler“. `max` je Zähler kommt von außen (Engine-Konstanten).
 * @returns {{ top: object[], rest: object[] }}
 */
export function counterRows(player, { partner = false, pins = DEFAULT_PINS, max = {} } = {}) {
  const pinned = new Set(Array.isArray(pins) ? pins : DEFAULT_PINS);
  const rows = COUNTER_KEYS
    .filter((k) => k !== 'tax2' || partner)
    .map((k) => {
      const pin = k === 'tax2' ? 'tax' : k;
      return { key: k, pin, value: Number(player?.[k]) || 0, max: max[k] ?? null, pinned: pinned.has(pin) };
    });
  const top = rows.filter((r) => r.pinned || r.value > 0);
  // stabil: aktive (Wert > 0) vor nur angepinnten, sonst Reihenfolge wie COUNTER_KEYS
  top.sort((a, b) => (b.value > 0) - (a.value > 0));
  const rest = rows.filter((r) => !top.includes(r));
  return { top, rest };
}

/** Pins umschalten (ein Schlüssel), Reihenfolge erhalten, ohne Dubletten. */
export function togglePin(pins, key) {
  const list = (Array.isArray(pins) ? pins : DEFAULT_PINS).filter((k, i, a) => a.indexOf(k) === i);
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

/**
 * Text eines Wurfs für den Randomizer (HANDOFF 5.4b). `L` = Textbausteine (i18n), `name(seat)` für „Spieler“.
 * @returns {{ big: string, sub: string }}
 */
export function rollText(r, L, name = (s) => String(s)) {
  const v = r?.values || [];
  switch (r?.kind) {
    case 'w6': return { big: String(v[0]), sub: v[0] === 1 ? L.ouch : v[0] === 6 ? L.six : '' };
    case 'w6x2': return { big: String(v[0] + v[1]), sub: v[0] === v[1] ? L.double : L.and.replace('{a}', v[0]).replace('{b}', v[1]) };
    case 'w20': return { big: String(v[0]), sub: v[0] === 20 ? L.nat20 : v[0] === 1 ? L.ouch : '' };
    case 'coin': return { big: v[0] === 0 ? L.heads : L.tails, sub: '' };
    case 'player': return { big: name(r.winnerSeat ?? v[0]), sub: L.picked };
    default: return { big: '', sub: '' };
  }
}

const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

/**
 * Verlaufstext eines Eintrags aus engine.history(). `L` = Textbausteine (i18n `life.log`),
 * `name(id)` liefert den Anzeigenamen, `counter(key)` die Zählerbezeichnung.
 */
export function logText(en, L, name = (id) => String(id), counter = (k) => k) {
  const who = (en.targets || []).map(name).join(', ');
  const src = en.source != null ? name(en.source) : '';
  const v = { who, src, n: en.amount, d: signed(en.amount ?? 0), key: en.key ? counter(en.key) : '', place: en.value };
  switch (en.type) {
    case 'life': return fill(L.life, v);
    case 'damage': return fill(L.damage, v);
    case 'cmd_damage': return fill(en.key === 'cmd2' ? L.cmd2 : L.cmd, v);
    case 'poison': return fill(en.source != null ? L.poisonFrom : L.poison, v);
    case 'lifelink': return fill(L.lifelink, v);
    case 'counter': return fill(L.counter, v);
    case 'flag': return fill(L.flag[`${en.key}${en.value ? 'On' : 'Off'}`] ?? '', v);
    case 'global':
      if (en.key === 'daynight') return fill(L.daynight[en.value ?? 'off'] ?? '', v);
      return fill(L.storm, { ...v, n: en.value });
    case 'turn_end': return fill(L.turnEnd, v);
    case 'eliminate': return fill(en.source != null ? L.outBy : L.outGaveUp, v);
    case 'roll': {
      const vals = en.value?.values || [];
      if (en.key === 'start' || en.key === 'player') return fill(en.key === 'start' ? L.rollStart : L.rollPlayer, { who: name(en.value?.winnerSeat, 'seat') });
      if (en.key === 'coin') return fill(L.rollCoin, { r: vals[0] === 0 ? L.heads : L.tails });
      return fill(L.roll, { kind: L.kinds[en.key] ?? en.key, r: vals.join(' + ') });
    }
    default: return en.type;
  }
}
