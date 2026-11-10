// Ergebnis-Screen nach „Werten und beenden“ (#/spiel/:id/ende): Sieger, Platzierung, Schaden, Siegbedingung,
// eigene Bewertung, Deck-Salz, Play of the Game, Notiz, Foto. Besitzer: P20 (spec-p20-ende.md).
// Daten nur über groupData.loadGame, Zahlen nur aus stats.js (gameSummary), Anzeige über format.js.
// Schreiben: Bewertung nur über RPC rate_game (D4), Siegbedingung/Notiz/Foto direkt auf games.
// Spielerfarben nur in den Schadenszeilen (Diagramm-Ausnahme, WELLE UI-Regel 2).
import { sb, photoUrls, forgetPhoto } from '../supabase.js';
import { state, currentMembership } from '../state.js';
import { groupData } from '../lib/data.js';
import { gameSummary } from '../lib/stats.js';
import { fmtMmss } from '../lib/format.js';
import { playerColor } from '../lib/decks.js';
import { html, mount, on, $, $$ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { backHead, empty } from '../lib/parts.js';
import { toast, errText } from '../lib/ui.js';
import { go } from '../router.js';
import { t } from '../i18n/index.js';
import { byId, deckArt, colorDeck, num } from './history-ui.js';
import {
  WINCONS, POTG_MAX, NOTE_MAX, PHOTO_EDGE, PHOTO_QUALITY, initialForm, toggleScore, setDeckSalt, pickSaltiest, pickPotg,
  pickWincon, formCheck, saltDecks, rateArgs, gamePatch, fitSize, photoPath, saveErrorKey, damageTop,
} from './result-ui.js';

const SCORES = [1, 2, 3, 4, 5];

export default async function result(el, { params, isStale }) {
  const id = params?.id || '';
  const back = backHead('', '#/start');
  // Startseite/Historie sollen das gerade beendete Spiel zeigen (life.js leert den Zwischenspeicher nicht).
  // P12: vor jedem frühen Ausstieg verwerfen (Entscheid 12).
  groupData.invalidate(state.groupId);
  /** @type {any} */
  let data = null;
  try { data = await groupData.loadGame(id); } catch (e) { console.warn('Spiel laden', e); data = null; }
  if (isStale()) return;

  // Unbekannt, nicht sichtbar (RLS) oder aus einer anderen Playgroup ⇒ Leerzustand
  if (!data || !data.game || data.groupId !== state.groupId) {
    mount(el, html`${back}<div class="card">${empty('history', t('result.unknown'), t('result.unknownSub'))}
      <a class="btn soft block" href="#/start">${t('result.toStart')}</a></div>`);
    return;
  }
  const game = data.game;
  if (game.status === 'live') {
    mount(el, html`${back}<div class="card">${empty('live', t('result.live'), t('result.liveSub'))}
      <a class="btn block" href="#/spiel/${encodeURIComponent(game.id)}">${icon('play', 20)}${t('result.backToGame')}</a></div>`);
    return;
  }
  if (game.status !== 'finished') {
    mount(el, html`${back}<div class="card">${empty('close', t('result.aborted'), t('result.abortedSub'))}
      <a class="btn soft block" href="#/start">${t('result.toStart')}</a></div>`);
    return;
  }
  const s = gameSummary(data, game.id);
  if (!s) {
    mount(el, html`${back}<div class="card">${empty('history', t('result.unknown'), t('result.unknownSub'))}</div>`);
    return;
  }
  /** @type {Record<string, string|null>} */
  let phUrls = {};
  if (s.photoPath) { try { phUrls = await photoUrls([s.photoPath]); } catch { /* Foto ist Beiwerk */ } }
  if (isStale()) return;

  const members = byId(data.members);
  const decks = byId(data.decks);
  const name = (mid) => members.get(mid)?.name || '–';
  const deckOf = (did) => decks.get(did ?? '') || null;
  const deckTitle = (d) => d?.shortName || d?.commanderName || '–';
  const meId = currentMembership()?.id ?? null;
  const iPlayed = !!meId && s.placements.some((p) => p.memberId === meId);
  const myDeck = deckOf(s.placements.find((p) => p.memberId === meId)?.deckId);
  const salters = iPlayed ? saltDecks(s.placements, meId) : [];
  const allowed = salters.map((x) => x.deckId);
  const winner = s.placements.find((p) => p.memberId === s.winnerId) || null;
  const wDeck = deckOf(winner?.deckId);

  let form = initialForm(data, meId);
  let saving = false;
  /** Foto: vorhandenes (Server) oder neu gewähltes (verkleinert, noch nicht hochgeladen). */
  const photo = {
    url: s.photoPath ? phUrls[s.photoPath] || null : null,
    blob: /** @type {Blob|null} */ (null),
    preview: /** @type {string|null} */ (null),
    removed: false,
  };

  const outcomeText = (p) => {
    const life = num(p.finalLife);
    const round = num(p.eliminatedRound);
    const base = p.outcome === 'win' ? t('result.outcome.win', { life })
      : p.outcome === 'out' ? t('result.outcome.out', { round, name: name(p.eliminatedBy) })
        : p.outcome === 'conceded' ? t('result.outcome.conceded', { round })
          : t('result.outcome.alive', { life });
    return p.avgTurnSec != null ? `${base} · ${t('result.avgTurn', { t: fmtMmss(p.avgTurnSec) })}` : base;
  };

  // ---- 1 Sieger-Kopf (Commander-Bild groß, ungetönt)
  const hero = html`<section class="rs-hero">
    <span class="rs-hero-art" style="${deckArt(wDeck)}" role="img" aria-label="${t('result.deckArt', { name: wDeck?.commanderName || deckTitle(wDeck) })}"></span>
    <div class="rs-hero-text">
      <span class="rs-label">${icon('crown', 18)}<span>${t('result.label')}</span></span>
      <h2>${winner ? t('result.winsWith', { name: name(winner.memberId) }) : t('result.label')}</h2>
      <span class="rs-hero-deck">${wDeck?.commanderName || deckTitle(wDeck)}</span>
      ${winner ? html`<span class="rs-hero-life">${t('result.outcome.win', { life: num(winner.finalLife) })}</span>` : ''}
      <span class="rs-hero-meta num">${t('result.meta', { rounds: num(s.rounds), min: num(s.minutes) })}</span>
    </div>
  </section>`;

  // ---- 2 Platzierung
  const placement = html`<section class="section">
    <h3 class="section-title">${t('result.placement')}</h3>
    <div class="rs-card rs-rows">${s.placements.map((p) => {
      const isWin = p.outcome === 'win';
      return html`<div class="rs-place ${isWin ? 'win' : ''}">
        <span class="rs-disc num" aria-label="${t('result.place', { n: num(p.place) })}">${isWin ? icon('crown', 16) : num(p.place)}</span>
        <span class="rs-grow">
          <span class="rs-name">${name(p.memberId)}${isWin ? html`<span class="sr-only"> · ${t('result.winner')}</span>` : ''} <span class="rs-deckname">· ${deckTitle(deckOf(p.deckId))}</span></span>
          <span class="rs-sub">${outcomeText(p)}</span>
        </span>
        <b class="rs-pts num">${t('result.points', { n: num(p.points) })}</b>
      </div>`;
    })}</div>
  </section>`;

  // ---- 3 Schaden (die 6 größten Zeilen; Spielerfarbe nur hier)
  const dot = (mid) => {
    const p = s.placements.find((x) => x.memberId === mid);
    return html`<span class="rs-dot" style="background:${playerColor(colorDeck(deckOf(p?.deckId)))}" aria-hidden="true"></span>`;
  };
  const dmg = damageTop(data.damage);
  const damage = html`<section class="section">
    <h3 class="section-title">${t('result.damage')}</h3>
    <div class="rs-card rs-rows">${dmg.length ? dmg.map((r) => {
      const extra = [r.commanderDamage ? t('result.damageCmd', { n: r.commanderDamage }) : '', r.poison ? t('result.damagePoison', { n: r.poison }) : ''].filter(Boolean).join(' · ');
      return html`<div class="rs-dmg" data-dmg="${r.source}>${r.target}">
        <span class="rs-grow">
          <span class="rs-name rs-pair">${dot(r.source)}<span>${t('result.damageRow', { src: name(r.source), tgt: name(r.target) })}</span>${dot(r.target)}</span>
          ${extra ? html`<span class="rs-sub">${extra}</span>` : ''}
        </span>
        <span class="rs-dmg-n num">${num(r.damage)}</span>
      </div>`;
    }) : html`<p class="rs-none">${t('result.damageNone')}</p>`}</div>
  </section>`;

  // ---- 4 Siegbedingung
  const wincon = html`<section class="section">
    <h3 class="section-title" id="rs-wincon">${t('result.wincon')}</h3>
    <div class="rs-chips" role="group" aria-labelledby="rs-wincon">${WINCONS.map((w) => html`<button type="button" class="rs-chip" data-pick="wincon" data-v="${w}" aria-pressed="false">${t(`result.wincons.${w}`)}</button>`)}</div>
  </section>`;

  // ---- 5–7 Bewertung (nur Mitspieler)
  const scale = (key, label, ic, what) => html`<div class="rs-q">
    <div class="rs-q-head"><span class="rs-q-label">${ic ? icon(ic, 18) : ''}<span id="rs-q-${key}">${label}</span></span><span class="rs-word" data-word="${key}"></span></div>
    <div class="rs-scale" role="group" aria-labelledby="rs-q-${key}">${SCORES.map((n) => html`<button type="button" class="rs-score num" data-pick="${key}" data-v="${n}" aria-pressed="false" aria-label="${t('result.scoreOf', { what, n })}">${n}</button>`)}</div>
  </div>`;
  const stars = html`<div class="rs-q">
    <div class="rs-q-head"><span class="rs-q-label"><span id="rs-q-deck">${t('result.deck')}</span>${myDeck ? html`<span class="rs-q-deck">· ${deckTitle(myDeck)}</span>` : ''}</span><span class="rs-word" data-word="deckRating"></span></div>
    <div class="rs-stars" role="group" aria-labelledby="rs-q-deck">${SCORES.map((n) => html`<button type="button" class="rs-star" data-pick="deckRating" data-v="${n}" aria-pressed="false" aria-label="${t('result.starsOf', { n })}"><span class="on">${icon('starFill', 28)}</span><span class="off">${icon('star', 28)}</span></button>`)}</div>
  </div>`;
  const ownerNames = (ids) => ids.map(name).join(', ');
  const deckSalt = salters.length ? html`<div class="rs-q rs-ds">
    <div class="rs-q-head"><span class="rs-q-label">${icon('salt', 18)}<span>${t('result.deckSalt')}</span></span></div>
    <p class="rs-hint">${t('result.deckSaltSub')}</p>
    ${salters.map((x) => {
      const d = deckOf(x.deckId);
      return html`<div class="rs-ds-row" data-ds="${x.deckId}">
        <span class="rs-ds-thumb" style="${deckArt(d)}" role="img" aria-label="${t('result.deckArt', { name: d?.commanderName || deckTitle(d) })}"></span>
        <span class="rs-grow"><span class="rs-name">${deckTitle(d)}</span><span class="rs-sub">${ownerNames(x.memberIds)}</span></span>
        <span class="rs-salts">${SCORES.map((n) => html`<button type="button" class="rs-salt" data-pick="dsalt" data-deck="${x.deckId}" data-v="${n}" aria-pressed="false" aria-label="${t('result.deckSaltOf', { deck: deckTitle(d), n })}">${icon('salt', 20)}</button>`)}</span>
      </div>`;
    })}
    <div class="rs-saltiest">
      <span class="rs-q-label" id="rs-saltiest">${t('result.saltiest')}</span>
      <div class="rs-chips" role="group" aria-labelledby="rs-saltiest">${salters.map((x) => html`<button type="button" class="rs-chip" data-pick="saltiest" data-deck="${x.deckId}" aria-pressed="false">${icon('salt', 16)}${deckTitle(deckOf(x.deckId))}</button>`)}</div>
    </div>
  </div>` : '';
  const rating = iPlayed ? html`<section class="section">
    <div class="rs-card rs-pad rs-rating">
      <div class="rs-card-head"><h3 class="rs-card-title">${t('result.rating')}</h3><span class="rs-hint">${t('result.ratingSub')}</span></div>
      ${scale('salt', t('result.salt'), 'salt', t('result.saltName'))}
      ${scale('fun', t('result.fun'), 'smiley', t('result.funName'))}
      ${stars}
      ${deckSalt}
    </div>
  </section>
  <section class="section">
    <div class="rs-card rs-pad rs-potg">
      <div class="rs-card-head"><h3 class="rs-card-title" id="rs-potg">${icon('medal', 18)}<span>${t('result.potg')}</span></h3></div>
      <p class="rs-hint">${t('result.potgSub')}</p>
      <div class="rs-chips" role="group" aria-labelledby="rs-potg">${s.placements.map((p) => html`<button type="button" class="rs-chip" data-pick="potg" data-v="${p.memberId}" aria-pressed="false">${name(p.memberId)}${p.memberId === meId ? html` <span class="rs-you">${t('result.you')}</span>` : ''}</button>`)}</div>
      <div class="field">
        <label for="rs-potg-text">${t('result.potgText')}</label>
        <input class="input" id="rs-potg-text" data-text="potgText" autocomplete="off" maxlength="${POTG_MAX + 50}" placeholder="${t('result.potgPlaceholder')}" value="${form.potgText}">
        <span class="rs-count" data-count="potgText" aria-live="polite"></span>
      </div>
    </div>
  </section>` : html`<section class="section"><div class="card">${empty('users', t('result.onlyPlayers'), t('result.onlyPlayersSub'))}</div></section>`;

  // ---- 8 Notiz + Foto
  const notes = html`<section class="section">
    <div class="rs-card rs-pad">
      <div class="field">
        <label for="rs-note" class="rs-card-title rs-lbl">${icon('notePencil', 18)}<span>${t('result.note')}</span></label>
        <textarea class="input rs-note" id="rs-note" data-text="note" rows="3" maxlength="${NOTE_MAX + 100}" placeholder="${t('result.notePlaceholder')}">${form.note}</textarea>
        <span class="rs-count" data-count="note" aria-live="polite"></span>
      </div>
      <div class="rs-photo">
        <span class="rs-card-title rs-lbl">${icon('camera', 18)}<span>${t('result.photo')}</span></span>
        <div data-photo></div>
      </div>
    </div>
  </section>`;

  mount(el, html`<div class="rs">
    ${back}
    ${hero}
    ${placement}
    ${damage}
    ${wincon}
    ${rating}
    ${notes}
    <div class="rs-actions">
      <button type="button" class="btn block" data-act="save">${icon('check', 20)}${t('result.save')}</button>
      <a class="btn soft block" href="#/start">${t('result.later')}</a>
    </div>
  </div>`);

  const saveBtn = /** @type {HTMLButtonElement} */ ($('[data-act="save"]', el));

  // ---------- Zustand ⇒ Anzeige (ohne neu zu zeichnen: Texteingaben behalten Fokus)
  const word = (key, v) => (v ? t(`result.${key === 'salt' ? 'saltWords' : key === 'fun' ? 'funWords' : 'deckWords'}.${v}`) : t('result.noScore'));
  function paint() {
    for (const b of $$('[data-pick]', el)) {
      const kind = b.dataset.pick;
      const v = b.dataset.v;
      const n = Number(v);
      let pressed = false;
      let fill = false;
      if (kind === 'wincon') pressed = form.wincon === v;
      else if (kind === 'potg') pressed = form.potg === v;
      else if (kind === 'salt' || kind === 'fun' || kind === 'deckRating') {
        const cur = form[kind];
        pressed = cur === n;
        fill = cur != null && cur >= n;
      } else if (kind === 'dsalt') {
        const cur = form.deckSalt[b.dataset.deck];
        pressed = cur === n;
        fill = cur != null && cur >= n;
      } else if (kind === 'saltiest') pressed = form.saltiest === b.dataset.deck;
      b.setAttribute('aria-pressed', String(pressed));
      b.classList.toggle('fill', fill);
    }
    for (const w of $$('[data-word]', el)) w.textContent = word(w.dataset.word, form[w.dataset.word]);
    const chk = formCheck(form);
    paintCount('potgText', POTG_MAX, chk.potgTooLong);
    paintCount('note', NOTE_MAX, chk.noteTooLong);
    saveBtn.disabled = saving || !chk.ok;
  }
  function paintCount(key, max, bad) {
    const c = $(`[data-count="${key}"]`, el);
    if (!c) return;
    const n = String(form[key] || '').trim().length;
    c.textContent = bad ? `${t('result.counter', { n, max })} · ${t('result.tooLong', { max })}` : t('result.counter', { n, max });
    c.classList.toggle('bad', bad);
    $(`[data-text="${key}"]`, el)?.setAttribute('aria-invalid', String(bad));
  }

  function paintPhoto() {
    const box = $('[data-photo]', el);
    if (!box) return;
    const src = photo.preview || (!photo.removed ? photo.url : null);
    const has = !!src || (!photo.removed && !!s.photoPath && !photo.blob);
    const pickers = html`<label class="btn soft rs-file">${icon('camera', 18)}<span>${has ? t('result.photoReplace') : t('result.photoTake')}</span>
        <input type="file" accept="image/*" capture="environment" data-file></label>
      <label class="btn soft rs-file">${icon('image', 18)}<span>${t('result.photoPick')}</span><input type="file" accept="image/*" data-file></label>`;
    mount(box, html`${src ? html`<img class="rs-photo-img" src="${src}" alt="${t('result.photoAlt')}">` : has ? '' : html`<p class="rs-none">${t('result.photoNone')}</p>`}
      <div class="rs-photo-btns">${pickers}${has ? html`<button type="button" class="btn soft rs-file" data-act="photo-remove">${icon('trash', 18)}<span>${t('result.photoRemove')}</span></button>` : ''}</div>`);
    // Ladefehler ⇒ Bild weglassen (error bubbelt nicht ⇒ direkt am Bild)
    $('.rs-photo-img', box)?.addEventListener('error', (e) => /** @type {HTMLElement} */ (e.target).remove(), { once: true });
  }

  paint();
  paintPhoto();

  // ---------- Eingaben
  on(el, 'click', '[data-pick]', (_e, b) => {
    if (saving) return;
    const kind = b.dataset.pick;
    const v = b.dataset.v;
    if (kind === 'wincon') form = pickWincon(form, v);
    else if (kind === 'potg') form = pickPotg(form, v);
    else if (kind === 'salt' || kind === 'fun' || kind === 'deckRating') form = { ...form, [kind]: toggleScore(form[kind], Number(v)) };
    else if (kind === 'dsalt') form = setDeckSalt(form, b.dataset.deck, Number(v));
    else if (kind === 'saltiest') form = pickSaltiest(form, b.dataset.deck);
    paint();
  });
  on(el, 'input', '[data-text]', (_e, inp) => {
    form = { ...form, [inp.dataset.text]: inp.value };
    paint();
  });
  on(el, 'change', '[data-file]', async (_e, inp) => {
    const file = inp.files?.[0];
    inp.value = '';
    if (!file) return;
    try {
      const blob = await shrink(file);
      if (photo.preview) URL.revokeObjectURL(photo.preview);
      photo.blob = blob;
      photo.preview = URL.createObjectURL(blob);
      photo.removed = false;
    } catch (ex) {
      console.warn('Foto lesen', ex);
      toast(t('result.photoBad'));
    }
    paintPhoto();
  });
  on(el, 'click', '[data-act="photo-remove"]', () => {
    if (photo.preview) URL.revokeObjectURL(photo.preview);
    photo.blob = null;
    photo.preview = null;
    photo.removed = true;
    paintPhoto();
  });
  on(el, 'click', '[data-act="save"]', () => { save(); });

  // ---------- Speichern: Bewertung (RPC) ⇒ Foto ⇒ games (Siegbedingung, Notiz, Fotopfad)
  async function save() {
    if (saving || !formCheck(form).ok) return;
    saving = true;
    saveBtn.setAttribute('aria-busy', 'true');
    paint();
    try {
      if (iPlayed) {
        const { error } = await sb.rpc('rate_game', rateArgs(game.id, form, allowed));
        if (error) throw error;
      }
      /** @type {Record<string, unknown>} */
      const patch = gamePatch(form);
      const path = photoPath(data.groupId, game.id);
      let photoFailed = false;
      if (photo.blob) {
        try {
          const up = await sb.storage.from('game-photos').upload(path, photo.blob, { upsert: true, contentType: 'image/jpeg' });
          if (up.error) throw up.error;
          patch.photo_path = path;
          forgetPhoto(path);
        } catch (ex) {
          console.warn('Foto hochladen', ex);
          photoFailed = true;
        }
      } else if (photo.removed && s.photoPath) patch.photo_path = null;
      const { error: ge } = await sb.from('games').update(patch).eq('id', game.id);
      if (ge) throw ge;
      if (photo.removed && s.photoPath && !photo.blob) {
        const rm = await sb.storage.from('game-photos').remove([s.photoPath]).catch((ex) => ({ error: ex }));
        if (rm?.error) console.warn('Foto entfernen', rm.error);
        forgetPhoto(s.photoPath);
      }
      groupData.invalidate(state.groupId);
      if (photo.preview) URL.revokeObjectURL(photo.preview);
      toast(photoFailed ? t('result.photoFailed') : t('result.saved'));
      go(`/partie/${encodeURIComponent(game.id)}`);
    } catch (ex) {
      const key = saveErrorKey(ex, navigator.onLine);
      toast(key ? t(`result.err.${key}`) : errText(ex));
    } finally {
      saving = false;
      if (saveBtn.isConnected) { saveBtn.removeAttribute('aria-busy'); paint(); }
    }
  }
}

/** Bild ⇒ JPEG, längste Kante ≤ 1600 px, Qualität 0,8 (Canvas). */
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  try {
    const { width, height } = fitSize(bmp.width, bmp.height, PHOTO_EDGE);
    if (!width || !height) throw new Error('Bild leer');
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const g = c.getContext('2d');
    if (!g) throw new Error('Canvas fehlt');
    g.drawImage(bmp, 0, 0, width, height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', PHOTO_QUALITY));
    if (!blob) throw new Error('JPEG fehlgeschlagen');
    return /** @type {Blob} */ (blob);
  } finally {
    bmp.close?.();
  }
}
