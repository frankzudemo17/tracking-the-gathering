// Einstellungen „Am Tisch“ und „Spiel-Standards“ (P7, Welle ttg-live-feinschliff-decks; HANDOFF 5.10).
// renderTableSettings(slot) füllt den Einhängepunkt in settings.js. Gespeichert wird je Gerät (src/lib/prefs.js),
// sofort beim Ändern; nur der Slot wird neu gezeichnet (kein Seitenwechsel, kein Sprung nach oben).
import { html, mount, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { toast } from '../lib/ui.js';
import { t } from '../i18n/index.js';
import { getPrefs, setPref, onPrefs, canWakeLock, canVibrate, START_LIVES, PIN_KEYS, KO_MODES, MOTION_MODES } from '../lib/prefs.js';
import { KO_VARIANTS } from '../game/ko.js';
import { LAYOUTS } from '../game/layouts.js';

const pinLabel = (k) => (k === 'tax2' ? t('table.pins.tax2') : t(`life.counters.labels.${k}`));

function switchRow(key, ic, title, sub, value, na = false) {
  const id = `tb-${key}`;
  return html`<div class="row static tb-row">
    <span class="row-ic">${icon(ic, 20)}</span>
    <span class="grow"><span class="title" id="${id}">${title}</span><span class="sub">${na ? t('table.na') : sub}</span></span>
    <button type="button" class="tb-switch" role="switch" data-pref="${key}" aria-checked="${String(value)}" aria-labelledby="${id}" ${na ? 'disabled' : ''}><i></i></button>
  </div>`;
}

function segRow(key, ic, title, sub, options, value, label, extra = '') {
  const id = `tb-${key}`;
  return html`<div class="row static tb-row tb-stack">
    <span class="row-ic">${icon(ic, 20)}</span>
    <span class="grow"><span class="title" id="${id}">${title}</span>${sub ? html`<span class="sub" data-sub="${key}">${sub}</span>` : ''}</span>
    <div class="seg tb-seg" role="group" aria-labelledby="${id}">${options.map((o) => html`<button type="button" data-pref="${key}" data-v="${String(o)}" aria-pressed="${String(o === value)}">${label(o)}</button>`)}</div>
    ${extra}
  </div>`;
}

function view(p) {
  const variants = p.koScreens === 'some'
    ? html`<div class="tb-checks" role="group" aria-label="${t('table.ko.title')}">${KO_VARIANTS.map((v) => {
      const on = p.koVariants.includes(v);
      const last = on && p.koVariants.length === 1;
      return html`<button type="button" class="tb-check" role="checkbox" data-pref="koVariants" data-v="${v}" aria-checked="${String(on)}" ${last ? html`aria-disabled="true" title="${t('table.ko.last')}"` : ''}>
        <span class="tb-box">${on ? icon('check', 14) : ''}</span><span class="tb-letter">${v}</span><span>${t(`table.ko.variants.${v}`)}</span></button>`;
    })}</div>`
    : '';
  return html`
    <div class="section" data-settings="table">
      <div class="section-head"><h3 class="section-title">${t('table.tableTitle')}</h3></div>
      <div class="list">
        ${switchRow('wakeLock', 'sun', t('table.wake.title'), t('table.wake.sub'), p.wakeLock, !canWakeLock())}
        ${switchRow('vibration', 'vibrate', t('table.vibration.title'), t('table.vibration.sub'), p.vibration, !canVibrate())}
        ${segRow('reduceMotion', 'sliders', t('table.motion.title'), t(`table.motion.subs.${p.reduceMotion}`), MOTION_MODES, p.reduceMotion, (m) => t(`table.motion.modes.${m}`))}
        ${segRow('koScreens', 'skull', t('table.ko.title'), t(`table.ko.subs.${p.koScreens}`), KO_MODES, p.koScreens, (m) => t(`table.ko.modes.${m}`), variants)}
      </div>
    </div>

    <div class="section" data-settings="game">
      <div class="section-head"><h3 class="section-title">${t('table.gameTitle')}</h3></div>
      <div class="list">
        ${segRow('startLife', 'heart', t('table.life.title'), t('table.life.sub'), START_LIVES, p.startLife, (v) => String(v))}
        ${segRow('layout', 'deviceMobile', t('table.layout.title'), t(`setup.layoutDesc.${p.layout}`), LAYOUTS, p.layout, (k) => t(`setup.layouts.${k}`))}
        <div class="row static tb-row tb-stack">
          <span class="row-ic">${icon('pushPin', 20)}</span>
          <span class="grow"><span class="title" id="tb-defaultPins">${t('table.pins.title')}</span><span class="sub">${t('table.pins.sub')}</span></span>
          <div class="tb-chips" role="group" aria-labelledby="tb-defaultPins">${PIN_KEYS.map((k) => html`<button type="button" class="tb-chip" data-pref="defaultPins" data-v="${k}" aria-pressed="${String(p.defaultPins.includes(k))}">${p.defaultPins.includes(k) ? icon('pushPinFill', 14) : ''}${pinLabel(k)}</button>`)}</div>
        </div>
        ${switchRow('turnTime', 'timer', t('table.turn.title'), t('table.turn.sub'), p.turnTime)}
      </div>
    </div>`;
}

/** Wert aus dem angetippten Bedienelement und dem aktuellen Stand. */
function nextValue(p, key, b) {
  const v = b.dataset.v;
  switch (key) {
    case 'wakeLock': case 'vibration': case 'turnTime': return !p[key];
    case 'startLife': return Number(v);
    case 'koVariants': {
      if (!p.koVariants.includes(v)) return KO_VARIANTS.filter((x) => x === v || p.koVariants.includes(x));
      return p.koVariants.length > 1 ? p.koVariants.filter((x) => x !== v) : null; // letzte bleibt an
    }
    case 'defaultPins': return p.defaultPins.includes(v) ? p.defaultPins.filter((x) => x !== v) : PIN_KEYS.filter((x) => x === v || p.defaultPins.includes(x));
    default: return v;
  }
}

export function renderTableSettings(slot) {
  const paint = () => {
    const focus = document.activeElement && slot.contains(document.activeElement)
      ? { pref: document.activeElement.dataset.pref, v: document.activeElement.dataset.v } : null;
    mount(slot, view(getPrefs()));
    if (focus?.pref) {
      const sel = `[data-pref="${focus.pref}"]${focus.v != null ? `[data-v="${focus.v}"]` : ''}`;
      slot.querySelector(sel)?.focus({ preventScroll: true });
    }
  };
  on(slot, 'click', '[data-pref]', (e, b) => {
    if (b.disabled || b.getAttribute('aria-disabled') === 'true') return;
    const key = b.dataset.pref;
    const v = nextValue(getPrefs(), key, b);
    if (v == null) return;
    if (!setPref(key, v)) toast(t('table.saveFailed'));
  });
  // Eigene und fremde (anderer Tab) Änderungen zeichnen den Slot neu; verlassene Seite meldet sich ab
  const off = onPrefs(() => { if (!slot.isConnected) { off(); return; } paint(); });
  paint();
}
