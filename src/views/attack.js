// Angriff per Ziehen (Spec P10, HANDOFF 5.4, Mockup P2 Bildschirm 6, Logik Main.dc.html:1830–1861):
// Ziehen von einem lebenden Feld auf einen Gegner (oder auf den Mittelknopf = alle Gegner) öffnet
// das Angriffsfenster. Vorschau ausschließlich aus previewAttack (P3), Eintragen = genau eine
// Engine-Aktion `attack` über onApply (= doAct in life.js) — dort laufen recorder.push, newlyLethal
// und der K.O.-Ablauf mit by = Angreifer (Quelle der Ereignisse). Dazu der einmalige Hinweis-Banner.
//
//   attachAttack(root, { getState, onApply, name, deck, busy })
//     root      Lifecounter-Ansicht (enthält .lc mit .lc-field[data-pid] und .lc-hub[data-pid="__all"])
//     getState  () ⇒ aktueller Engine-Zustand
//     onApply   (action) ⇒ führt die Aktion aus (doAct)
//     name      (member_id) ⇒ Anzeigename
//     deck      (member_id) ⇒ decks-Zeile oder null (Partner-Commander)
//     busy      () ⇒ true, solange ein K.O.-Fenster offen ist
//
// Ziel-Ermittlung in Bildschirmkoordinaten (elementFromPoint), keine Skalierung — gedrehte Felder
// treffen damit von selbst richtig. Alle Zuhörer hängen an root und verschwinden mit der Ansicht.
import { html, mount, $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { sheet } from '../lib/ui.js';
import { previewAttack } from '../game/engine.js';
import { t } from '../i18n/index.js';
import { shortCmd } from './life-ui.js';
import {
  ALL, QUICK, TAP_BLOCK_MS, isDrag, hoverTarget, dropTargets, opponents, toggleTarget, toggleAll, allSelected,
  showAllChip, validTo, kinds, canLifelink, stepAmount, confirmLabel, headTo, barPct, scopeGeom,
} from './attack-ui.js';

const HINT_KEY = 'ttg.hint.drag';
const SVG_NS = 'http://www.w3.org/2000/svg';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* Privatmodus: Banner kommt wieder */ } };

/** member_id unter dem Punkt (Bildschirmkoordinaten): Feld, Knopf im Feld oder Mittelknopf. */
function pidAt(x, y) {
  try {
    const el = document.elementFromPoint(x, y);
    return el?.closest?.('[data-pid]')?.getAttribute('data-pid') ?? null;
  } catch { return null; }
}

const svgEl = (tag, attrs) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

export function attachAttack(root, { getState, onApply, name, deck, busy = () => false }) {
  const L = t('attack');
  const sheetOpen = () => !!document.querySelector('.sheet-wrap');
  const blocked = () => { const s = getState(); return !s || s.finished || busy() || sheetOpen(); };
  let dd = null; // { pid, sx, sy, el, pointer, active, over }
  let lastDrag = 0;
  let fx = null; // Zielfernrohr-Ebene { layer, line, scope, c1, c2, cross, alle }

  // ---------- Hinweis-Banner (einmalig, HANDOFF 5.4)
  let bannerEl = null;
  function hideBanner(remember) {
    if (remember) lsSet(HINT_KEY, '1');
    if (!bannerEl) return;
    bannerEl.remove(); bannerEl = null;
    window.dispatchEvent(new Event('resize')); // Brett wird größer ⇒ Namen neu ausrichten (clearHub)
  }
  if (!lsGet(HINT_KEY) && !getState()?.finished) {
    bannerEl = document.createElement('div');
    bannerEl.className = 'atk-banner';
    bannerEl.setAttribute('role', 'status');
    mount(bannerEl, html`${icon('handSwipeRight', 20)}<span>${L.hint}</span><button type="button" data-hint="ok">${L.hintOk}</button>`);
    root.prepend(bannerEl);
    $('[data-hint="ok"]', bannerEl).addEventListener('click', () => hideBanner(true));
  }

  // ---------- Zielfernrohr (folgt dem Finger, rastet über gültigem Ziel optisch ein)
  function startFx(d) {
    const layer = document.createElement('div');
    layer.className = 'atk-layer';
    layer.setAttribute('aria-hidden', 'true');
    const svg = svgEl('svg', { width: '100%', height: '100%' });
    const line = svgEl('line', { x1: d.sx, y1: d.sy, x2: d.sx, y2: d.sy, class: 'atk-line' });
    const start = svgEl('circle', { cx: d.sx, cy: d.sy, r: 7, class: 'atk-start' });
    const scope = svgEl('g', { class: 'atk-scope' });
    const g0 = scopeGeom(false);
    const c1 = svgEl('circle', { r: g0.r1, class: 'atk-c1' });
    const c2 = svgEl('circle', { r: g0.r2, class: 'atk-c2' });
    const cross = svgEl('path', { d: g0.cross, class: 'atk-cross' });
    scope.append(c1, c2, cross, svgEl('circle', { r: 3, class: 'atk-dot' }));
    svg.append(line, start, scope);
    layer.append(svg);
    root.append(layer);
    d.el.classList.add('atk-from');
    const hub = $('.lc-hub', root);
    let alle = null;
    if (hub) {
      alle = document.createElement('span');
      alle.className = 'atk-alle';
      mount(alle, html`${icon('crosshair', 24)}<span>${L.all}</span>`);
      hub.append(alle);
      hub.classList.add('atk-drag');
    }
    fx = { layer, line, scope, c1, c2, cross, alle, hub };
  }

  function moveFx(x, y, over) {
    if (!fx) return;
    const locked = !!over;
    const g = scopeGeom(locked);
    fx.line.setAttribute('x2', String(x)); fx.line.setAttribute('y2', String(y));
    fx.scope.setAttribute('transform', `translate(${x} ${y})`);
    fx.c1.setAttribute('r', String(g.r1)); fx.c2.setAttribute('r', String(g.r2)); fx.cross.setAttribute('d', g.cross);
    fx.layer.classList.toggle('locked', locked);
    for (const f of root.querySelectorAll('.lc-field.atk-over')) if (f.dataset.pid !== over) f.classList.remove('atk-over');
    if (over && over !== ALL) root.querySelector(`.lc-field[data-pid="${CSS.escape(over)}"]`)?.classList.add('atk-over');
    fx.hub?.classList.toggle('atk-over', over === ALL);
  }

  function endFx() {
    for (const f of root.querySelectorAll('.lc-field.atk-from, .lc-field.atk-over')) f.classList.remove('atk-from', 'atk-over');
    if (!fx) return;
    fx.layer.remove();
    fx.alle?.remove();
    fx.hub?.classList.remove('atk-drag', 'atk-over');
    fx = null;
  }

  // ---------- Geste
  root.addEventListener('pointerdown', (e) => {
    if (dd || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const f = e.target.closest?.('.lc-field[data-pid]');
    if (!f || !root.contains(f) || blocked()) return;
    const p = getState().players.find((x) => x.id === f.dataset.pid);
    if (!p || p.out) return;
    dd = { pid: p.id, sx: e.clientX, sy: e.clientY, el: f, pointer: e.pointerId, active: false, over: null };
  });

  root.addEventListener('pointermove', (e) => {
    if (!dd || e.pointerId !== dd.pointer) return;
    if (!dd.active) {
      if (!isDrag(e.clientX - dd.sx, e.clientY - dd.sy)) return;
      if (blocked()) { dd = null; return; }
      dd.active = true;
      try { dd.el.setPointerCapture(dd.pointer); } catch { /* Zeiger schon weg */ }
      startFx(dd);
    }
    e.preventDefault();
    dd.over = hoverTarget(pidAt(e.clientX, e.clientY), dd.pid, getState().players);
    moveFx(e.clientX, e.clientY, dd.over);
  }, { passive: false });

  root.addEventListener('pointerup', (e) => {
    if (!dd || e.pointerId !== dd.pointer) return;
    const d = dd; dd = null;
    if (!d.active) return; // unter der Schwelle: bleibt ein Tippen (life.js)
    lastDrag = Date.now();
    endFx();
    if (blocked()) return;
    const to = dropTargets(pidAt(e.clientX, e.clientY), d.pid, getState().players);
    if (!to.length) return;
    hideBanner(true);
    openAttack(d.pid, to);
  });

  const cancel = (e) => {
    if (!dd || (e.pointerId != null && e.pointerId !== dd.pointer)) return;
    if (dd.active) lastDrag = Date.now();
    dd = null;
    endFx();
  };
  root.addEventListener('pointercancel', cancel);
  // Während des Ziehens scrollt und federt nichts, kein Kontextmenü (Nachtrag Spec P10, iOS)
  root.addEventListener('touchmove', (e) => { if (dd?.active) e.preventDefault(); }, { passive: false });
  root.addEventListener('contextmenu', (e) => { if (dd) e.preventDefault(); });
  // Tipps kurz nach einem Ziehen ignorieren (Main.dc.html:1772) — vor den Zuhörern von life.js
  root.addEventListener('click', (e) => {
    if (Date.now() - lastDrag < TAP_BLOCK_MS) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // ---------- Angriffsfenster (Main.dc.html:996–1051, 2497–2533)
  function openAttack(from, to) {
    if (sheetOpen()) return;
    const A = { from, to: to.slice(), kind: 'damage', amount: 1, lifelink: false };

    const body = () => {
      const s = getState();
      const me = s.players.find((p) => p.id === A.from);
      const opps = opponents(s.players, A.from).map((p) => p.id);
      const tg = validTo(A.to, opps);
      const d = deck(A.from);
      const partner = me?.partner && d?.partner_name ? [shortCmd(d.commander_name || d.short_name), shortCmd(d.partner_name)] : null;
      const ks = kinds(L, partner);
      if (!ks.some((k) => k.kind === A.kind)) A.kind = 'cmd';
      const link = canLifelink(A.kind) && A.lifelink;
      const pv = tg.length ? previewAttack(s, { from: A.from, to: tg, kind: A.kind, amount: A.amount, lifelink: link }) : { targets: [], lifelinkGain: 0 };
      const cmdName = A.kind === 'cmd2' ? partner?.[1] : partner ? partner[0] : shortCmd(d?.commander_name || d?.short_name) || name(A.from);
      const btn = confirmLabel(L, { amount: A.amount, kind: A.kind, n: tg.length });
      const arrow = icon('arrowRight', 16);
      const rows = pv.targets.map((r) => {
        if (r.poison) {
          const dead = r.lethal && r.poison[1] >= r.poison[2];
          return html`<div class="atk-pvrow ${r.lethal ? 'lethal' : ''}" data-pv="${r.id}"><div class="l"><span class="grow"><b>${name(r.id)}</b><small>${L.poison}</small></span>
            <span class="from num">${r.poison[0]}</span>${arrow}<span class="to num ${dead ? 'dead' : ''}" data-to-poison>${r.poison[1]}<small>/${r.poison[2]}</small></span></div>
            <div class="atk-bar"><i class="${dead ? 'dead' : ''}" style="width:${barPct(r.poison[1], r.poison[2])}%"></i></div></div>`;
        }
        const deadLife = r.lethal && r.life[1] <= 0;
        const cmd = r.cmd ? (() => {
          const dead = r.lethal && r.cmd[1] >= r.cmd[2];
          return html`<div class="l sub"><span class="grow"><small>${t('attack.cmdFrom', { name: cmdName })}</small></span>
            <span class="num cmdv ${dead ? 'dead' : ''}" data-to-cmd="${r.cmd[1]}">${r.cmd[1]} / ${r.cmd[2]}</span></div>
            <div class="atk-bar"><i class="${dead ? 'dead' : 'cmd'}" style="width:${barPct(r.cmd[1], r.cmd[2])}%"></i></div>`;
        })() : '';
        return html`<div class="atk-pvrow ${r.lethal ? 'lethal' : ''}" data-pv="${r.id}"><div class="l"><span class="grow"><b>${name(r.id)}</b><small>${L.life}</small></span>
          <span class="from num">${r.life[0]}</span>${arrow}<span class="to num ${deadLife ? 'dead' : ''}" data-to-life>${r.life[1]}</span></div>${cmd}</div>`;
      });
      const gain = pv.lifelinkGain > 0 && me ? html`<div class="atk-pvrow gain" data-pv-gain><div class="l"><span class="grow"><b>${name(A.from)}</b>
          <small>${t('attack.lifelinkRow', { amount: A.amount, n: tg.length })}</small></span>
          <span class="from num">${me.life}</span>${arrow}<span class="to num" data-to-life>${me.life + pv.lifelinkGain}</span></div></div>` : '';
      return html`<div class="atk-h"><span>${name(A.from)}</span>${icon('sword', 22)}<span data-head>${headTo(L, A.to, opps, name)}</span></div>
        <div class="atk-tgts" role="group" aria-label="${L.targets}">
          ${showAllChip(opps) ? html`<button type="button" class="lc-pill" data-a="all" aria-pressed="${String(allSelected(tg, opps))}">${L.allOpp}</button>` : ''}
          ${opps.map((id) => html`<button type="button" class="lc-pill" data-a="tgt" data-id="${id}" aria-pressed="${String(tg.includes(id))}">${name(id)}</button>`)}</div>
        <div class="seg atk-kinds" style="grid-template-columns:repeat(${ks.length},minmax(0,1fr))">${ks.map((k) => html`<button type="button" data-a="kind" data-k="${k.kind}" aria-pressed="${String(A.kind === k.kind)}">${icon(k.kind === 'damage' ? 'sword' : k.kind === 'poison' ? 'drop' : 'crown', 15)}<span>${k.label}</span></button>`)}</div>
        <div class="atk-amt"><button type="button" data-a="amt" data-v="-1" aria-label="${L.less}" ${A.amount <= 1 ? 'disabled' : ''}>${icon('minus', 22)}</button>
          <b class="num" data-amt aria-label="${L.amount}">${A.amount}</b>
          <button type="button" data-a="amt" data-v="1" aria-label="${L.more}">${icon('plus', 22)}</button></div>
        <div class="atk-quick">${QUICK.map((q) => html`<button type="button" class="lc-pill" data-a="quick" data-v="${q}" aria-pressed="${String(A.amount === q)}">${q}</button>`)}</div>
        ${tg.length ? html`<div class="atk-pv" data-preview>${rows}${gain}</div>` : ''}
        <div class="atk-foot">${canLifelink(A.kind) ? html`<button type="button" class="atk-link" data-a="link" aria-pressed="${String(A.lifelink)}">${icon(A.lifelink ? 'heartFill' : 'heart', 16)}${L.lifelink}</button>` : ''}
          <button type="button" class="btn" data-a="apply" ${btn.disabled ? 'disabled' : ''}>${btn.text}</button></div>`;
    };

    sheet(L.label, html`<div class="su-sheet atk-sheet" data-sheet="attack">${body()}</div>`, (sh, close) => {
      const box = $('[data-sheet="attack"]', sh);
      const repaint = () => { if (box.isConnected) mount(box, body()); };
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]');
        if (!b || b.disabled) return;
        const a = b.dataset.a;
        const opps = opponents(getState().players, A.from).map((p) => p.id);
        if (a === 'all') A.to = toggleAll(validTo(A.to, opps), opps);
        else if (a === 'tgt') A.to = toggleTarget(validTo(A.to, opps), b.dataset.id);
        else if (a === 'kind') A.kind = b.dataset.k;
        else if (a === 'amt') A.amount = stepAmount(A.amount, Number(b.dataset.v));
        else if (a === 'quick') A.amount = Number(b.dataset.v);
        else if (a === 'link') A.lifelink = !A.lifelink;
        else if (a === 'apply') {
          const tg = validTo(A.to, opps);
          if (!tg.length) return;
          const action = { type: 'attack', from: A.from, to: tg, kind: A.kind, amount: A.amount, lifelink: canLifelink(A.kind) && A.lifelink };
          close(); // vor onApply: ein K.O.-Fenster darf sofort aufgehen
          onApply(action);
          return;
        }
        repaint();
      });
    });
  }
}
