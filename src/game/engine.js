// Spiel-Engine (rein): Zustand + Ereignis → Zustand.
// Wahrheit ist die Ereignisliste; der Zustand ist replay(init, events).
// Kein DOM, keine Uhr, kein Zufall: Zeit kommt als Wert (`at`) in die Aktion.
// Logik nach mockup/design-canvas-quellen/Main.dc.html (mk, advance, endTurn, eliminate,
// endGame, applyAttack, cnt, flag, isLethal), ohne die in der Spec P3 markierten Fehler.

export const COUNTER_MAX = { energy: 999, exp: 999, tax: 999, tax2: 999, rad: 999, speed: 4, ring: 4, dungeon: 999 };
export const POISON_MAX = 10;
export const CMD_LETHAL = 21;
const FLAGS = ['monarch', 'init', 'city'];
const EXCLUSIVE = ['monarch', 'init'];
const DAYNIGHT = [null, 'tag', 'nacht'];
const ROLL_KINDS = ['w6', 'w6x2', 'w20', 'coin', 'player', 'start'];
const ATTACK_KINDS = ['damage', 'cmd', 'cmd2', 'poison'];
const TURN_START = 'turnStartedAt'; // global-Schlüssel (P8 Nachtrag 1), nicht rückgängig machbar, nicht im Verlauf
/** Ereignisse, die Rückgängig nie trifft: Würfe und der Zugbeginn nach dem Intro. */
const fixedEvent = (e) => e.type === 'roll' || (e.type === 'global' && e.payload?.key === TURN_START);

// ---------------------------------------------------------------------------
// Aufbau

function mkPlayer({ id, name, seat, partner }, life) {
  return {
    id, name: name ?? '', seat, partner: partner ?? false,
    life, poison: 0, energy: 0, exp: 0, tax: 0, tax2: 0, rad: 0, speed: 0, ring: 0, dungeon: 0,
    cmd: {}, dmgFrom: {}, poisonFrom: {},
    monarch: false, init: false, city: false,
    out: false, outBy: null, outRound: null, place: null,
  };
}

/**
 * Neues Spiel. `players` in beliebiger Reihenfolge; intern nach `seat` sortiert.
 * `turn` und `first` sind Sitz-Werte.
 */
export function createGame({ players, startingLife = 40, firstSeat = 0, startedAt = 0 }) {
  const roster = players
    .map(({ id, name, seat, partner }) => ({ id, name: name ?? '', seat, partner: partner ?? false }))
    .sort((a, b) => a.seat - b.seat);
  const setup = { players: roster, startingLife, firstSeat, startedAt };
  return fresh(setup);
}

function fresh(setup) {
  return {
    round: 1,
    turn: setup.firstSeat,
    first: setup.firstSeat,
    finished: false,
    daynight: null,
    storm: 0,
    turnStartedAt: setup.startedAt,
    nextSeq: 1,
    nextAct: 1,
    players: setup.players.map((p) => mkPlayer(p, setup.startingLife)),
    events: [],
    setup,
  };
}

function clonePlayer(p) {
  return { ...p, cmd: { ...p.cmd }, dmgFrom: { ...p.dmgFrom }, poisonFrom: { ...p.poisonFrom } };
}

function cloneState(s) {
  return { ...s, players: s.players.map(clonePlayer), events: s.events.slice() };
}

const byId = (s, id) => s.players.find((p) => p.id === id);
const seatIndex = (s, seat) => s.players.findIndex((p) => p.seat === seat);

function need(s, id) {
  const p = byId(s, id);
  if (!p) throw new Error(`Spieler '${id}' gibt es in diesem Spiel nicht`);
  return p;
}

// ---------------------------------------------------------------------------
// Regeln

/** Die einzige Tödlich-Prüfung (CR 704.5a, 704.5c, 704.5u + 903.10a). */
export function isLethal(p) {
  return !p.out && (p.life <= 0 || p.poison >= POISON_MAX || Object.values(p.cmd).some((v) => v >= CMD_LETHAL));
}

/** Spieler-IDs, die in `next` tödlich und in `prev` nicht tödlich sind, in Sitzreihenfolge. */
export function newlyLethal(prev, next) {
  return next.players
    .filter((p) => {
      if (!isLethal(p)) return false;
      const q = byId(prev, p.id);
      return !q || !isLethal(q);
    })
    .map((p) => p.id);
}

/** Nächster nicht ausgeschiedener Sitz; Runde +1 beim Erreichen von `first` (Main.dc.html:2077–2081). */
function advance(s) {
  const n = s.players.length;
  let j = seatIndex(s, s.turn);
  if (j < 0) j = 0;
  for (let k = 0; k < n; k++) {
    j = (j + 1) % n;
    if (s.players[j].seat === s.first) s.round++;
    if (!s.players[j].out) break;
  }
  s.turn = s.players[j].seat;
}

// ---------------------------------------------------------------------------
// Ereignis anwenden (mutierend, nur intern)

function applyMut(s, ev) {
  s.events.push(ev);
  s.nextSeq = Math.max(s.nextSeq, ev.seq + 1);
  const act = ev.payload?.act;
  if (Number.isInteger(act)) s.nextAct = Math.max(s.nextAct, act + 1);
  if (ev.type === 'undo') { rebuild(s); return; }
  effect(s, ev);
}

/** Wirkung eines Ereignisses auf den Zustand (ohne Buchführung). */
function effect(s, ev) {
  const t = ev.target != null ? byId(s, ev.target) : null;
  const pl = ev.payload || {};
  switch (ev.type) {
    case 'life':
      t.life += ev.amount; break;
    case 'damage':
      t.life -= ev.amount;
      t.dmgFrom[ev.source] = (t.dmgFrom[ev.source] || 0) + ev.amount; break;
    case 'cmd_damage': {
      const key = pl.partner ? `${ev.source}#2` : ev.source;
      t.life -= ev.amount;
      t.cmd[key] = (t.cmd[key] || 0) + ev.amount; break;
    }
    case 'poison':
      t.poison += ev.amount;
      if (ev.source != null) t.poisonFrom[ev.source] = (t.poisonFrom[ev.source] || 0) + ev.amount;
      break;
    case 'lifelink':
      t.life += ev.amount; break;
    case 'counter':
      t[pl.key] = (t[pl.key] || 0) + ev.amount; break;
    case 'flag':
      if (EXCLUSIVE.includes(pl.key)) for (const p of s.players) p[pl.key] = false;
      t[pl.key] = pl.value; break;
    case 'global':
      s[pl.key] = pl.value; break;
    case 'turn_end':
      advance(s);
      s.storm = 0;
      s.turnStartedAt = pl.at; break;
    case 'eliminate': {
      const wasTurn = t.seat === s.turn;
      t.out = true; t.outBy = ev.source ?? null; t.outRound = s.round; t.place = pl.place;
      const rest = s.players.filter((p) => !p.out);
      if (rest.length === 1) { rest[0].place = 1; s.finished = true; }
      else if (wasTurn) {
        advance(s);
        // Folgezug beginnt beim K.O. (payload.at, Gerätezeit); nie vor dem bisherigen Zugbeginn. Alte Ereignisse ohne at: wie bisher.
        if (typeof pl.at === 'number' && Number.isFinite(pl.at)) s.turnStartedAt = Math.max(s.turnStartedAt, pl.at);
      }
      break;
    }
    case 'roll':
      break;
    default:
      throw new Error(`Unbekannter Ereignistyp '${ev.type}'`);
  }
}

/** Menge der rückgängig gemachten seq. */
function undoneSeqs(events) {
  const set = new Set();
  for (const e of events) if (e.type === 'undo' && e.payload?.seq != null) set.add(e.payload.seq);
  return set;
}

/**
 * Zustand aus Startaufstellung und Ereignisliste neu ableiten: ein Durchlauf über die
 * wirksamen Ereignisse (nicht rückgängig, kein undo). Buchführung über alle Ereignisse.
 */
function derive(setup, events) {
  const s = fresh(setup);
  const undone = undoneSeqs(events);
  for (const e of events) {
    if (e.type !== 'undo' && !undone.has(e.seq)) effect(s, e);
    s.nextSeq = Math.max(s.nextSeq, e.seq + 1);
    const a = e.payload?.act;
    if (Number.isInteger(a)) s.nextAct = Math.max(s.nextAct, a + 1);
  }
  s.events = events.slice();
  return s;
}

function rebuild(s) {
  const d = derive(s.setup, s.events);
  Object.assign(s, d);
}

/** Ein Ereignis anwenden (gibt neuen Zustand zurück, `state` bleibt unverändert). */
export function apply(state, event) {
  const s = cloneState(state);
  applyMut(s, event);
  return s;
}

/**
 * Zustand aus Start und Ereignissen. `init` ist der Zustand aus createGame oder dessen
 * Eingabe ({ players, startingLife, firstSeat, startedAt }). Ereignisse werden nach seq sortiert.
 */
export function replay(init, events) {
  const setup = init && init.setup ? init.setup : createGame(init).setup;
  const sorted = events.slice().sort((a, b) => a.seq - b.seq);
  return derive(setup, sorted);
}

// ---------------------------------------------------------------------------
// Rückgängig

/** Höchstes noch wirksames act (kein roll/undo/Zugbeginn, nicht rückgängig) oder null. */
function lastUndoableAct(s) {
  const undone = undoneSeqs(s.events);
  let best = null;
  for (const e of s.events) {
    if (e.type === 'undo' || fixedEvent(e) || undone.has(e.seq)) continue;
    const a = e.payload?.act;
    if (Number.isInteger(a) && (best === null || a > best)) best = a;
  }
  return best;
}

export function canUndo(state) {
  return lastUndoableAct(state) !== null;
}

// ---------------------------------------------------------------------------
// Aktionen → Ereignis-Entwürfe

const draft = (type, { source = null, target = null, amount = null, payload = {} } = {}) =>
  ({ type, source, target, amount, payload });

const clampDelta = (cur, d, max) => Math.max(0, Math.min(max, cur + d)) - cur;

/** Ziele eines Angriffs: ohne Angreifer, ohne Ausgeschiedene, Sitzreihenfolge, ohne Doppelte. */
function attackTargets(s, from, to) {
  const ids = new Set(to || []);
  return s.players.filter((p) => ids.has(p.id) && p.id !== from && !p.out);
}

function validAttack(s, a) {
  const src = byId(s, a.from);
  if (!src) return false;
  if (!ATTACK_KINDS.includes(a.kind)) return false;
  if (!Number.isInteger(a.amount) || a.amount < 1) return false;
  if (a.kind === 'cmd2' && !src.partner) return false;
  return true;
}

function planAttack(s, a) {
  if (!validAttack(s, a)) return [];
  const targets = attackTargets(s, a.from, a.to);
  const out = [];
  if (a.kind === 'poison') {
    for (const t of targets) {
      const real = clampDelta(t.poison, a.amount, POISON_MAX);
      if (real !== 0) out.push(draft('poison', { source: a.from, target: t.id, amount: real }));
    }
    return out;
  }
  for (const t of targets) {
    if (a.kind === 'damage') out.push(draft('damage', { source: a.from, target: t.id, amount: a.amount }));
    else out.push(draft('cmd_damage', { source: a.from, target: t.id, amount: a.amount, payload: { partner: a.kind === 'cmd2' } }));
  }
  if (a.lifelink && targets.length) {
    out.push(draft('lifelink', { source: a.from, target: a.from, amount: a.amount * targets.length }));
  }
  return out;
}

function plan(s, action) {
  switch (action.type) {
    case 'life': {
      need(s, action.target);
      const d = action.d;
      if (!Number.isInteger(d) || d === 0) return [];
      return [draft('life', { target: action.target, amount: d })];
    }
    case 'attack':
      return planAttack(s, action);
    case 'counter': {
      const p = need(s, action.target);
      const max = COUNTER_MAX[action.key];
      if (max === undefined) throw new Error(`Unbekannter Zähler '${action.key}'`);
      if (!Number.isInteger(action.d)) return [];
      const real = clampDelta(p[action.key] || 0, action.d, max);
      return real === 0 ? [] : [draft('counter', { target: p.id, amount: real, payload: { key: action.key } })];
    }
    case 'poison': {
      const p = need(s, action.target);
      if (!Number.isInteger(action.d)) return [];
      const real = clampDelta(p.poison, action.d, POISON_MAX);
      return real === 0 ? [] : [draft('poison', { target: p.id, amount: real })];
    }
    case 'flag': {
      const p = need(s, action.target);
      if (!FLAGS.includes(action.key)) throw new Error(`Unbekannter Status '${action.key}'`);
      return [draft('flag', { target: p.id, payload: { key: action.key, value: !p[action.key] } })];
    }
    case 'global': {
      if (action.key === 'daynight') {
        const v = action.value ?? null;
        if (!DAYNIGHT.includes(v)) throw new Error(`Ungültiger Wert für daynight: '${v}'`);
        return v === s.daynight ? [] : [draft('global', { payload: { key: 'daynight', value: v } })];
      }
      if (action.key === 'storm') {
        const v = action.value;
        if (!Number.isInteger(v) || v < 0) throw new Error(`Ungültiger Wert für storm: '${v}'`);
        return v === s.storm ? [] : [draft('global', { payload: { key: 'storm', value: v } })];
      }
      if (action.key === TURN_START) {
        // P8 Nachtrag 1: Zugbeginn des ersten Zugs = Intro-Ende (ms seit Epoch). Nur ganz am Anfang:
        // Runde 1, Startspieler am Zug, bisher nur Würfe (Startwurf); sonst still nichts.
        const v = action.value;
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Ungültiger Wert für ${TURN_START}: '${v}'`);
        const fresh0 = s.round === 1 && s.turn === s.first && s.events.every((e) => e.type === 'roll');
        return fresh0 ? [draft('global', { payload: { key: TURN_START, value: v } })] : [];
      }
      throw new Error(`Unbekannter globaler Schlüssel '${action.key}'`);
    }
    case 'storm': {
      if (!Number.isInteger(action.d)) return [];
      const v = Math.max(0, s.storm + action.d);
      return v === s.storm ? [] : [draft('global', { payload: { key: 'storm', value: v } })];
    }
    case 'endTurn': {
      if (typeof action.at !== 'number' || !Number.isFinite(action.at)) throw new Error('endTurn braucht at (ms seit Epoch)');
      const cur = s.players[seatIndex(s, s.turn)];
      const seconds = Math.max(0, Math.round((action.at - s.turnStartedAt) / 1000));
      return [{ ...draft('turn_end', { target: cur.id, payload: { seconds, at: action.at } }), actor: cur.id }];
    }
    case 'eliminate': {
      const p = need(s, action.target);
      if (p.out) return [];
      const alive = s.players.filter((x) => !x.out).length;
      const payload = { place: alive };
      if (typeof action.at === 'number' && Number.isFinite(action.at)) payload.at = action.at; // optional: Zeitpunkt des K.O. (ms seit Epoch)
      return [draft('eliminate', { source: action.by ?? null, target: p.id, payload })];
    }
    case 'roll': {
      if (!ROLL_KINDS.includes(action.kind)) throw new Error(`Unbekannte Wurfart '${action.kind}'`);
      const payload = { kind: action.kind, values: (action.values || []).slice() };
      if (action.winnerSeat != null) payload.winner_seat = action.winnerSeat;
      return [draft('roll', { payload })];
    }
    case 'undo': {
      const target = lastUndoableAct(s);
      if (target === null) return [];
      const undone = undoneSeqs(s.events);
      return s.events
        .filter((e) => e.payload?.act === target && e.type !== 'undo' && !fixedEvent(e) && !undone.has(e.seq))
        .map((e) => draft('undo', { payload: { seq: e.seq } }));
    }
    default:
      throw new Error(`Unbekannte Aktion '${action.type}'`);
  }
}

/**
 * Eine Nutzeraktion ausführen. Alle erzeugten Ereignisse teilen `payload.act`.
 * Nach Spielende erzeugt jede Aktion außer `undo` keine Ereignisse.
 * @returns {{ state: object, events: object[] }}
 */
export function act(state, action, { actor = null } = {}) {
  if (!action || typeof action.type !== 'string') throw new Error('Aktion ohne type');
  if (state.finished && action.type !== 'undo') return { state, events: [] };
  const drafts = plan(state, action);
  if (drafts.length === 0) return { state, events: [] };
  const s = cloneState(state);
  const actNo = s.nextAct;
  const round = s.round;
  const events = [];
  for (const d of drafts) {
    const ev = {
      seq: s.nextSeq,
      type: d.type,
      round,
      actor: d.actor !== undefined ? d.actor : actor,
      source: d.source,
      target: d.target,
      amount: d.amount,
      payload: { ...d.payload, act: actNo },
    };
    applyMut(s, ev);
    events.push(ev);
  }
  s.nextAct = Math.max(s.nextAct, actNo + 1);
  return { state: s, events };
}

// ---------------------------------------------------------------------------
// Ableitungen für die UI

/**
 * Vorschau eines Angriffs: je Ziel alte/neue Werte, ob tödlich, und Lifelink-Gewinn.
 * Rechnet über act() — damit ist sie per Bau gleich dem Ergebnis.
 * @returns {{ targets: { id, life: number[], cmd?: number[], poison?: number[], lethal: boolean }[], lifelinkGain: number }}
 */
export function previewAttack(state, attack) {
  if (state.finished || !validAttack(state, attack)) return { targets: [], lifelinkGain: 0 };
  const targets = attackTargets(state, attack.from, attack.to);
  const { state: next } = act(state, { ...attack, type: 'attack' });
  const key = attack.kind === 'cmd2' ? `${attack.from}#2` : attack.from;
  const rows = targets.map((t) => {
    const n = byId(next, t.id);
    const row = { id: t.id, life: [t.life, n.life] };
    if (attack.kind === 'cmd' || attack.kind === 'cmd2') row.cmd = [t.cmd[key] || 0, n.cmd[key] || 0, CMD_LETHAL];
    if (attack.kind === 'poison') row.poison = [t.poison, n.poison, POISON_MAX];
    row.lethal = isLethal(n);
    return row;
  });
  const lifelinkGain = byId(next, attack.from).life - byId(state, attack.from).life;
  return { targets: rows, lifelinkGain };
}

/**
 * „Wer war es?“: alle anderen Spieler, sortiert nach verursachtem Lebensschaden am Ziel
 * (dmgFrom + beide cmd-Schlüssel), dann Gift, dann Sitz. Erster hat top, wenn er etwas verursacht hat.
 * @returns {{ id, damage: number, poison: number, top: boolean }[]}
 */
export function killerCandidates(state, targetId) {
  const t = need(state, targetId);
  const list = state.players
    .filter((p) => p.id !== targetId)
    .map((p) => ({
      id: p.id,
      seat: p.seat,
      damage: (t.dmgFrom[p.id] || 0) + (t.cmd[p.id] || 0) + (t.cmd[`${p.id}#2`] || 0),
      poison: t.poisonFrom[p.id] || 0,
    }))
    .sort((a, b) => b.damage - a.damage || b.poison - a.poison || a.seat - b.seat);
  return list.map(({ id, damage, poison }, i) => ({ id, damage, poison, top: i === 0 && (damage > 0 || poison > 0) }));
}

/**
 * Verlauf als strukturierte Einträge (Texte macht die UI). Rückgängig gemachte Aktionen
 * und undo-Ereignisse erscheinen nicht. Ereignisse einer Aktion mit gleichem Typ und Betrag
 * bilden einen Eintrag (targets = alle Ziele). Aufeinanderfolgende life-Einträge auf dasselbe
 * Ziel und counter-Einträge mit gleichem Ziel+key werden summiert; Summe 0 entfällt.
 * `value`: Wert bei flag/global, Platz bei eliminate, Würfe bei roll (sonst null).
 */
export function history(state) {
  const undone = undoneSeqs(state.events);
  const live = state.events.filter((e) => e.type !== 'undo' && !undone.has(e.seq)
    && !(e.type === 'global' && e.payload?.key === TURN_START)); // Zugbeginn ist keine Spielhandlung
  const entries = [];
  for (const e of live) {
    const pl = e.payload || {};
    const key = e.type === 'counter' || e.type === 'flag' || e.type === 'global' ? pl.key
      : e.type === 'cmd_damage' ? (pl.partner ? 'cmd2' : 'cmd')
        : e.type === 'roll' ? pl.kind : null;
    const value = e.type === 'flag' || e.type === 'global' ? pl.value
      : e.type === 'eliminate' ? pl.place
        : e.type === 'roll' ? { values: pl.values, winnerSeat: pl.winner_seat ?? null } : null;
    const last = entries[entries.length - 1];
    if (last && last.act === pl.act && last.type === e.type && last.amount === e.amount && last.key === key && e.target != null) {
      last.targets.push(e.target);
      continue;
    }
    entries.push({ act: pl.act, round: e.round, type: e.type, actor: e.actor, source: e.source,
      targets: e.target != null ? [e.target] : [], amount: e.amount, key, value });
  }
  // Summieren aufeinanderfolgender life- bzw. counter-Einträge (Main.dc.html:1752–1755)
  const merged = [];
  for (const en of entries) {
    const last = merged[merged.length - 1];
    const summable = (en.type === 'life' || en.type === 'counter') && en.targets.length === 1;
    if (summable && last && last.type === en.type && last.targets.length === 1
      && last.targets[0] === en.targets[0] && last.key === en.key) {
      last.amount += en.amount;
      continue;
    }
    merged.push({ ...en, targets: en.targets.slice() });
  }
  return merged.filter((en) => !((en.type === 'life' || en.type === 'counter') && en.amount === 0));
}

/**
 * Ergebnis fürs Spielende (Sitzreihenfolge). Noch Lebende ohne Platz werden nach Leben
 * absteigend auf die freien Plätze verteilt, Gleichstand ⇒ Sitz (Main.dc.html:2097–2101).
 */
export function results(state) {
  const place = new Map(state.players.map((p) => [p.id, p.place]));
  const alive = state.players.filter((p) => !p.out && p.place == null)
    .slice().sort((a, b) => b.life - a.life || a.seat - b.seat);
  alive.forEach((p, i) => place.set(p.id, i + 1));
  return state.players.map((p) => ({
    id: p.id,
    place: place.get(p.id),
    eliminatedRound: p.outRound,
    eliminatedBy: p.outBy,
    finalLife: p.life,
  }));
}

/** Momentaufnahme für games.live_state und die Anzeigetafel (wird nie zurückgelesen). */
export function snapshot(state) {
  return {
    v: 1,
    round: state.round,
    turn: state.turn,
    first: state.first,
    finished: state.finished,
    daynight: state.daynight,
    storm: state.storm,
    turnStartedAt: state.turnStartedAt,
    players: state.players.map((p) => ({
      id: p.id, seat: p.seat, life: p.life, poison: p.poison,
      cmdMax: Object.values(p.cmd).reduce((m, v) => Math.max(m, v), 0),
      out: p.out, place: p.place, monarch: p.monarch, init: p.init, city: p.city,
    })),
  };
}
