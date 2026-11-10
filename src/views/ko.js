// K.O.-Screens (Spec P11, HANDOFF 5.5): Variante A · Anime, B · Reich der Schatten, C · Arcade.
// Ersetzt die einfache P8-Fassung; die Schnittstelle bleibt dieselbe:
//
//   showKo(host, { player, deck, by, pick, candidates, onEliminate, onCancel }) ⇒ close()
//     player      { id, name }                        wer tödlich ist
//     deck        decks-Zeile oder null               Commander-Bild(er), Farben, Commander-Name
//     by          member_id | null                    bekannter Verursacher (Angriff), sonst null
//     pick        { variant, quote } aus koPick()      Variante A|B|C und Spruch 0..7 (ko.js zieht keinen Zufall)
//     candidates  [{ id, name, damage, poison, top }]  lebende Gegner, Spitzenreiter markiert (life.js)
//     onEliminate(byId | null)                         „Ausscheiden“/„Verbannen“ bzw. Auswahl / „Aufgegeben“ (null)
//     onCancel()                                       „Doch nicht“, Escape, Seitenwechsel
//
// Genau einer der beiden Rückrufe wird genau einmal aufgerufen, und zwar NACH dem Abräumen
// (ein zweiter K.O. aus der Warteschlange kann sofort einen neuen Screen öffnen).
// Ablauf: Stufen 0–9 nach Main.dc.html:1897–1903 (data-stage + Klassen ko-s1…ko-sN am Wurzelelement,
// Aussehen je Stufe in ko.css), Wackeln in Stufen 3–8 (Main.dc.html:2549–2550, Klasse ko-shake).
// prefers-reduced-motion: sofort Stufe 9, kein Blitz, kein Wackeln. Knöpfe erst ab Stufe 9.
import { html, raw, mount, $, initials } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { sheet } from '../lib/ui.js';
import { fieldColors } from '../lib/field-color.js';
import { t } from '../i18n/index.js';
import { cmdLine } from './life-ui.js';
import * as ART from './ko-art.js';

const W = 390;
const H = 844;
const PLAN = [[30, 1], [110, 2], [260, 3], [320, 4], [380, 5], [440, 6], [500, 7], [560, 8], [700, 9]];
const SHAKE = [[0, 0], [-9, 5], [8, -6], [-6, -4], [5, 6], [-3, 2], [0, 0]];

// Schriften der K.O.-Screens (HANDOFF 4: Bangers, Cinzel, Press Start 2P, Noto Sans JP) werden beim
// ersten K.O. einmalig nachgeladen. Quelle OFFEN (GO-Gate Franco): Die Spec sieht einen Google-Fonts-
// Link vor, die Datenschutzerklärung (P12, de.js „keine Anfrage an Google Fonts“) schließt das aus.
// Bis zur Entscheidung bleibt die Quelle leer ⇒ Systemschriften aus ko.css (feste Boxgrößen, kein Fehler).
// Selbst gehostet wäre z. B. 'src/styles/ko-fonts.css' (mit @font-face auf assets/fonts/…).
export const KO_FONTS_HREF = '';
let fontsAsked = false;
function loadKoFonts() {
  if (fontsAsked || !KO_FONTS_HREF) return;
  fontsAsked = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = KO_FONTS_HREF;
  l.dataset.koFonts = '';
  document.head.append(l);
}

const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const cut = (s, n) => { const a = [...String(s ?? '')]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
const len = (s) => [...String(s ?? '')].length;

/** Mana-Kreise und Streifen der Spielerkarte (Main.dc.html:2559–2577), Farben aus fieldColors (P7). */
function cardColors(cols) {
  const n = cols.length;
  const x0 = 12, y0 = 36, w = 130, h = 84;
  const P = (q) => { const d = q * (w + h); return d <= w ? [x0 + d, y0] : [x0 + w, y0 + (d - w)]; };
  const Q = (q) => { const d = q * (w + h); return d <= h ? [x0, y0 + d] : [x0 + (d - h), y0 + h]; };
  const stripes = cols.map((c, i) => {
    const t0 = i / n, t1 = (i + 1) / n;
    const pts = [P(t0), P(t1)]; if (t0 * (w + h) < w && t1 * (w + h) > w) pts.splice(1, 0, [x0 + w, y0]);
    const qs = [Q(t1), Q(t0)]; if (t0 * (w + h) < h && t1 * (w + h) > h) qs.splice(1, 0, [x0, y0 + h]);
    return { pts: pts.concat(qs).map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '), fill: c };
  });
  const pips = cols.map((c, i) => ({ cx: 134 - (n - 1 - i) * 10, fill: c }));
  return { stripes, pips };
}

function viewModel({ player, deck, by, pick, candidates }) {
  const quotes = t('ko.quotes');
  const variant = ['A', 'B', 'C'].includes(pick?.variant) ? pick.variant : 'A';
  let q = Number.isInteger(pick?.quote) ? pick.quote : 0;
  if (variant === 'B' && q === 0) q = 1; // HANDOFF 5.5: B nie Spruch 1 (koPick sorgt dafür, hier nur Absicherung)
  const quote = Array.isArray(quotes) ? quotes[q] ?? '' : '';
  const byC = by != null ? candidates.find((c) => c.id === by) : null;
  const byName = by != null ? (byC?.name || '?') : '';
  const place = candidates.length + 1; // lebende Gegner + der Ausscheidende
  return { variant, quote, quoteIndex: q, name: String(player?.name ?? ''), by, byName, byDamage: byC?.damage ?? 0, place, deck };
}

// ------------------------------------------------------------------ Variante A · Anime
function variantA(v) {
  const sub = [v.by != null ? t('ko.by', { name: v.byName }) : t('ko.noCause'), t('ko.place', { n: v.place })].join(' · ');
  return html`<div class="ko-layer ko-fade ko-a">
    <div class="ko-dots" aria-hidden="true"></div>
    <div class="ko-stage" aria-hidden="true">
      <div class="ko-lines"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${raw(ART.A_LINES)}</svg></div>
      <div class="ko-box ko-burst"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${raw(ART.A_BURST)}</svg></div>
      <span class="ko-sfx1 ko-don">ドォン!!</span>
      <span class="ko-sfx2 ko-gogo">ゴゴゴ</span>
    </div>
    <div class="ko-sub ko-a-sub">
      <div class="ko-panel">
        <span class="ko-tag">${t('ko.title')}</span>
        <span class="ko-name" style="--nl:${Math.max(1, len(v.name))}">${v.name}</span>
        <span class="ko-line">${sub}</span>
        <div class="ko-bubble"><span data-ko-quote>„${v.quote}“</span></div>
      </div>
      ${buttons(v, false)}
    </div>
  </div>`;
}

// ------------------------------------------------------------------ Variante B · Reich der Schatten
function variantB(v) {
  const d = v.deck;
  const { stripes, pips } = cardColors(fieldColors(d));
  const arts = [d?.image_url, d?.partner_image_url].filter(Boolean);
  const aw = 130 / Math.max(1, arts.length);
  const line1 = cut(cmdLine(d) || v.name, 34);
  const line2 = v.by != null ? t('ko.bDamage', { n: v.byDamage, name: cut(v.byName, 16) }) : t('ko.noCause') + '.';
  const title = t('ko.bTitle', { name: v.name });
  const sub = [v.by != null ? t('ko.bBy', { name: v.byName }) : '', t('ko.place', { n: v.place })].filter(Boolean).join(' · ');
  return html`<div class="ko-layer ko-fade ko-b">
    <svg class="ko-bg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${raw(ART.B_BG)}</svg>
    <div class="ko-stage" aria-hidden="true">
      <div class="ko-lines"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${raw(ART.B_CIRCLE)}</svg></div>
      <div class="ko-box ko-card"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <defs><clipPath id="ko-art-clip"><rect x="12" y="36" width="130" height="84"></rect></clipPath></defs>
        <g transform="translate(118 168) rotate(-9 77 107)">
          <rect x="0" y="0" width="154" height="214" rx="12" style="fill: url(#ko-frame)"></rect>
          <rect x="7" y="7" width="140" height="200" rx="7" style="fill: #15102A"></rect>
          <rect x="12" y="12" width="130" height="20" rx="4" style="fill: #EDE6D2"></rect>
          <text x="18" y="27" class="ko-cz" style="font-weight: 700; font-size: 12px; fill: #16191D" data-ko-card-name>${cut(v.name, 15)}</text>
          ${pips.map((m) => html`<circle cx="${m.cx}" cy="22" r="4" style="stroke: #16191D; stroke-width: .6; fill: ${m.fill}"></circle>`)}
          ${stripes.map((st) => html`<polygon points="${st.pts}" style="fill: ${st.fill}"></polygon>`)}
          ${arts.length
            ? html`<g clip-path="url(#ko-art-clip)" data-ko-card-art>${arts.map((u, i) => html`<image href="${u}" x="${12 + i * aw}" y="36" width="${aw}" height="84" preserveAspectRatio="xMidYMid slice"></image>`)}</g>`
            : ''}
          <rect x="12" y="36" width="130" height="84" style="fill: #000000; opacity: .25"></rect>
          ${arts.length ? '' : html`<text x="77" y="92" text-anchor="middle" class="ko-cz" style="font-weight: 700; font-size: 36px; fill: #FFFFFF; opacity: .9" data-ko-initials>${initials(v.name)}</text>`}
          <rect x="12" y="124" width="130" height="16" rx="3" style="fill: #EDE6D2"></rect>
          <text x="17" y="135.5" class="ko-cz" style="font-weight: 700; font-size: 8.5px; fill: #16191D">${t('ko.bRole')}</text>
          <rect x="12" y="144" width="130" height="56" rx="3" style="fill: #E4DCC7"></rect>
          <text x="18" y="160" class="ko-body" style="font-weight: 700; font-size: 8px; fill: #2A2440">${line1}</text>
          <text x="18" y="173" class="ko-body" style="font-size: 8px; fill: #2A2440">${line2}</text>
          <text x="18" y="190" class="ko-cz" style="font-style: italic; font-size: 7.5px; fill: #5A4E7A">${t('ko.bMotto')}</text>
          <g class="ko-cracks">
            <polyline points="40,0 58,46 46,82 76,118 70,160 98,214" style="fill: none; stroke: #F1E8FF; stroke-width: 2.2" filter="url(#ko-glowS)"></polyline>
            <polyline points="58,46 96,40 120,70 154,64" style="fill: none; stroke: #F1E8FF; stroke-width: 1.6" filter="url(#ko-glowS)"></polyline>
            <polyline points="76,118 104,128 130,112" style="fill: none; stroke: #F1E8FF; stroke-width: 1.4" filter="url(#ko-glowS)"></polyline>
            <polygon points="120,180 154,170 154,214 112,214" style="fill: #120A24; stroke: #E7D9FF; stroke-width: 1.6" filter="url(#ko-glowS)"></polygon>
          </g>
        </g>
      </svg></div>
      <div class="ko-shards"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${raw(ART.B_SHARDS)}</svg></div>
    </div>
    <div class="ko-sub ko-b-sub">
      <div class="ko-rule"><span></span><b>${t('ko.bBanished')}</b><span></span></div>
      <h2 class="ko-b-title" style="--tl:${Math.max(1, len(title))}">${title}</h2>
      <span class="ko-b-line">${sub}</span>
      <div class="ko-b-quote"><i aria-hidden="true"></i><span data-ko-quote>„${v.quote}“</span></div>
      ${buttons(v, true)}
    </div>
  </div>`;
}

// ------------------------------------------------------------------ Variante C · Arcade
function variantC(v) {
  const seg = (n) => Array.from({ length: 10 }, (_, i) => html`<i class="${i < n ? 'on' : ''}"></i>`);
  const left = v.by != null ? v.byName : '???';
  const wins = v.by != null ? t('ko.cWins', { name: v.byName }) : '';
  return html`<div class="ko-layer ko-fade ko-c">
    <svg class="ko-bg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${raw(ART.C_BG)}</svg>
    <div class="ko-scan" aria-hidden="true"></div>
    <div class="ko-vig" aria-hidden="true"></div>
    <div class="ko-stage">
      <div class="ko-hud" aria-hidden="true">
        <div class="ko-score"><span>1P 012400</span><span>HI 099900</span></div>
        <div class="ko-bars">
          <svg class="ko-face" width="40" height="40" viewBox="0 0 40 40">${raw(ART.C_FACE)}</svg>
          <div class="ko-seg">${seg(v.by != null ? 10 : 0)}</div>
          <div class="ko-vs">${t('ko.cVs')}</div>
          <div class="ko-seg">${seg(0)}</div>
          <svg class="ko-face out" width="40" height="40" viewBox="0 0 40 40">${raw(ART.C_FACE_OUT)}</svg>
        </div>
        <div class="ko-names"><span class="l">${left}</span><span class="r">${v.name}</span></div>
      </div>
      <div class="ko-c-mid">
        <div class="ko-box"><span class="ko-3d">${t('ko.title')}</span></div>
        ${wins ? html`<span class="ko-sfx1 ko-wins" style="--wl:${Math.max(1, len(wins))}" data-ko-wins>${wins}</span>` : ''}
      </div>
    </div>
    <div class="ko-sub ko-c-dialog">
      <svg class="ko-face talk" width="48" height="48" viewBox="0 0 40 40" aria-hidden="true">${raw(ART.C_FACE_TALK)}</svg>
      <span class="ko-c-text"><span class="ko-c-who">${v.by != null ? v.byName : t('ko.cSystem')}:</span><span data-ko-quote>„${v.quote}“</span></span>
    </div>
    <div class="ko-sub ko-c-sub">
      <div class="ko-continue" aria-hidden="true"><span>${t('ko.cContinue')}</span><b>9</b><small>${t('ko.cCoin')}</small></div>
      ${buttons(v, false)}
    </div>
  </div>`;
}

function buttons(v, banish) {
  const confirm = v.by != null
    ? html`<button type="button" class="ko-btn ko-go" data-ko="out">${banish ? t('ko.banish') : t('ko.out')}</button>`
    : html`<button type="button" class="ko-btn ko-go" data-ko="ask">${t('ko.who')}</button>`;
  return html`<div class="ko-btns"><button type="button" class="ko-btn ko-no" data-ko="cancel">${t('ko.cancel')}</button>${confirm}</div>`;
}

// ------------------------------------------------------------------ „Wer war es?“ (aus P8)
function pickerHtml(player, candidates) {
  return html`<div class="su-sheet lc-ko-sheet" data-sheet="ko"><div class="su-sh-head"><span class="t"><h3>${t('ko.whoTitle', { name: player.name })}</h3><small>${t('ko.whoSub')}</small></span></div>
    <div class="lc-opps">${candidates.map((c) => html`<button type="button" class="lc-pill ${c.top ? 'top' : ''}" data-ko="by" data-by="${c.id}">
      ${c.top ? icon('crown', 15) : ''}<span>${c.name}</span><small class="num">${c.poison && !c.damage ? t('ko.poison', { n: c.poison }) : t('ko.damage', { n: c.damage })}</small></button>`)}
      <button type="button" class="lc-pill dash" data-ko="gaveup">${icon('flag', 15)}<span>${t('ko.gaveUp')}</span></button></div>
    <button type="button" class="btn soft" data-ko="back">${t('ko.back')}</button></div>`;
}

export function showKo(host, { player, deck = null, by = null, pick = null, candidates = [], onEliminate, onCancel }) {
  loadKoFonts();
  const v = viewModel({ player, deck, by, pick, candidates });
  const reduce = reduceMotion();
  const timers = [];
  let done = false;
  let stage = 0;
  let picker = null; // { close } solange das Auswahl-Sheet offen ist

  const root = document.createElement('div');
  root.className = 'ko';
  root.dataset.sheet = 'ko';
  root.dataset.variant = v.variant;
  root.dataset.quote = String(v.quoteIndex);
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', t('ko.label', { name: v.name }));
  root.tabIndex = -1;
  mount(root, v.variant === 'B' ? variantB(v) : v.variant === 'C' ? variantC(v) : variantA(v));

  const fit = () => {
    const vw = window.innerWidth || W, vh = window.innerHeight || H;
    root.style.setProperty('--ks', String(Math.min(vw / W, vh / H)));
  };
  const setStage = (n) => {
    stage = n;
    root.dataset.stage = String(n);
    root.style.setProperty('--st', String(n));
    for (let i = 1; i <= 9; i++) root.classList.toggle(`ko-s${i}`, i <= n);
    const shaking = n >= 3 && n <= 8;
    root.classList.toggle('ko-shake', shaking);
    const [sx, sy] = shaking ? SHAKE[(n - 3) % SHAKE.length] : [0, 0];
    root.style.setProperty('--sx', `${sx}px`);
    root.style.setProperty('--sy', `${sy}px`);
    if (n === 9) {
      const first = $('[data-ko="cancel"]', root);
      if (document.activeElement === root || !root.contains(document.activeElement)) first?.focus({ preventScroll: true });
    }
  };

  const teardown = () => {
    for (const h of timers) clearTimeout(h);
    timers.length = 0;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onLeave);
    window.removeEventListener('resize', fit);
    mo.disconnect();
    if (picker) { const p = picker; picker = null; p.close(); }
    root.remove();
  };
  const finish = (fn, arg) => {
    if (done) return;
    done = true;
    teardown();
    fn?.(arg);
  };
  const cancel = () => finish(onCancel);
  const eliminate = (arg) => finish(onEliminate, arg);

  const openPicker = () => {
    if (picker || done) return;
    const close = sheet(t('ko.label', { name: v.name }), pickerHtml(player, candidates), (sh, closeSheet) => {
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ko]');
        if (!b) return;
        const k = b.dataset.ko;
        if (k === 'back') { closeSheet(); return; }
        if (k === 'by') eliminate(b.dataset.by);
        else if (k === 'gaveup') eliminate(null);
      });
    });
    picker = { close };
  };

  function onKey(e) {
    if (e.key !== 'Escape' || done) return;
    if (picker) return; // das Sheet schließt sich selbst, der Screen bleibt
    e.preventDefault();
    cancel();
  }
  function onLeave() { cancel(); }

  // Sheet geschlossen (Zurück, Hintergrund, Escape) ⇒ Auswahl vergessen; Screen aus dem DOM (View verlassen) ⇒ „Doch nicht“
  const mo = new MutationObserver(() => {
    if (picker && !document.querySelector('.sheet-wrap [data-sheet="ko"]')) picker = null;
    if (!done && !root.isConnected) cancel();
  });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ko]');
    if (!b || done || stage < 9) return;
    const k = b.dataset.ko;
    if (k === 'cancel') cancel();
    else if (k === 'out') eliminate(by);
    else if (k === 'ask') openPicker();
  });

  fit();
  setStage(reduce ? 9 : 0);
  (host?.isConnected ? host : document.body).append(root);
  mo.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onLeave);
  window.addEventListener('resize', fit);
  if (!reduce) for (const [ms, n] of PLAN) timers.push(setTimeout(() => { if (!done) setStage(n); }, ms));
  if (document.activeElement !== root && stage < 9) root.focus({ preventScroll: true });
  return cancel;
}
