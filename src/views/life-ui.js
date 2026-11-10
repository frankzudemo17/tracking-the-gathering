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

// ---------------------------------------------------------------------------
// Anzeige-Schwellen (keine Spielregeln: „tödlich“ entscheidet allein engine.isLethal)

/** Rote Zahl im Feld (WELLE E2 F6 a): wenig Leben, solange nicht ausgeschieden. */
export const LOW_LIFE = 10;
export const lowLife = (p) => !!p && !p.out && Number(p.life) <= LOW_LIFE;

/** „kritisch“ auf der Anzeigetafel (HANDOFF 4 Startseite): Leben ≤ 10, Gift ≥ 7 oder Commander-Schaden ≥ 15. */
export const CRIT = { life: 10, poison: 7, cmd: 15 };
export function critical(sp) {
  if (!sp || sp.out) return false;
  return Number(sp.life) <= CRIT.life || Number(sp.poison) >= CRIT.poison || Number(sp.cmdMax) >= CRIT.cmd;
}

/** Commander-Name ohne Beinamen nach dem Komma („Thrasios, Triton Hero“ ⇒ „Thrasios“). */
export const shortCmd = (name) => String(name ?? '').split(',')[0].trim();

/** Zeile unter dem Spielernamen: Commander, bei Partner beide. */
export function cmdLine(deck) {
  if (!deck) return '';
  const a = shortCmd(deck.commander_name || deck.short_name);
  return deck.partner_name ? `${a} & ${shortCmd(deck.partner_name)}` : a;
}

/** Ergebnis-Zeilen (engine.results) nach Platz sortiert. */
export const byPlace = (rows) => (rows || []).slice().sort((a, b) => (a.place ?? 99) - (b.place ?? 99));

/**
 * Flacker-Werte des Randomizers (rein optisch, kein Zufall nötig): Schritt i ⇒ Anzeige.
 * Würfel laufen durch die Augenzahlen, Münze wechselt (0 Kopf, 1 Zahl), Spieler = Index.
 */
export function flickerValue(kind, i, n = 2) {
  const k = Math.abs(Math.floor(Number(i) || 0));
  switch (kind) {
    case 'w6': return String(1 + ((k * 5 + 2) % 6));
    case 'w6x2': return String(2 + ((k * 7 + 3) % 11));
    case 'w20': return String(1 + ((k * 13 + 6) % 20));
    case 'coin': return k % 2;
    case 'player': return k % Math.max(1, n);
    default: return '';
  }
}

/** Ganze Sekunden von `fromMs` bis `nowMs`, nie negativ (Uhrabweichung zum Server). */
export const secondsSince = (fromMs, nowMs) => Math.max(0, Math.floor((Number(nowMs) - Number(fromMs)) / 1000) || 0);

// ---------- Treffer (Spec P13): Rand-Puls im Feld bei Lebensverlust und -gewinn, stärker ab HIT_BIG

/** Schaden eines Feldes im Sammelfenster, ab dem der Puls „groß“ ist. */
export const HIT_BIG = 10;

/**
 * Ein Schritt der Treffer-Stufe eines Feldes. `acc` = null | { sum, at } (Schadenssumme des
 * laufenden Fensters, Zeit der letzten Schadensänderung), `d` = Lebensänderung mit Vorzeichen.
 * @returns {{ level: 'dmg'|'big'|'gain'|null, acc: { sum: number, at: number }|null }}
 */
export function hitStep(acc, d, now, windowMs = 1800) {
  if (typeof d !== 'number' || !Number.isFinite(d) || d === 0) return { level: null, acc };
  if (d > 0) return { level: 'gain', acc: null };
  const sum = (acc && now - acc.at < windowMs ? acc.sum : 0) + Math.abs(d);
  return { level: sum >= HIT_BIG ? 'big' : 'dmg', acc: { sum, at: now } };
}

const HIT_REASONS = ['local', 'remote'];

/**
 * Lebensänderungen zwischen zwei gezeigten Zuständen, die einen Puls auslösen: je Spieler mit
 * geänderter `life` ein { id, d }. Still (leer): ohne prev/next, Grund nicht local/remote,
 * neues Rückgängig im Übergang. Ohne Eintrag: Spieler, die prev nicht kennt, Ausgeschiedene, d = 0.
 */
export function hitDiff(prev, next, reason = 'local') {
  if (!prev || !next || !HIT_REASONS.includes(reason)) return [];
  const seen = new Set((prev.events || []).map((e) => e.seq));
  if ((next.events || []).some((e) => e.type === 'undo' && !seen.has(e.seq))) return [];
  const out = [];
  for (const p of next.players || []) {
    if (p.out) continue;
    const q = (prev.players || []).find((x) => x.id === p.id);
    if (!q) continue;
    const d = p.life - q.life;
    if (Number.isFinite(d) && d !== 0) out.push({ id: p.id, d });
  }
  return out;
}
