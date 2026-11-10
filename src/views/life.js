// PLATZHALTER (Spec P7) für #/spiel/:id — P8 ersetzt diese Datei vollständig durch den Lifecounter.
// Zeigt die Spieler des Spiels (store.loadGame) und „Spiel verwerfen“ ⇒ finishGame(aborted) ⇒ /start.
import { sb } from '../supabase.js';
import { html, mount, on, busy } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { empty } from '../lib/parts.js';
import { errText, toast } from '../lib/ui.js';
import { createStore } from '../lib/game-store.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';

export default async function life(el, { params, isStale }) {
  const store = createStore(sb);
  let g;
  try { g = await store.loadGame(params.id); } catch (ex) {
    if (isStale()) return;
    mount(el, html`<div class="head"><a class="icon-btn" href="#/start" aria-label="${t('common.back')}">${icon('back', 20)}</a></div>${empty('warn', t('common.error'), errText(ex))}`);
    return;
  }
  if (isStale()) return;
  const live = g.game.status === 'live';

  mount(el, html`<div class="su">
    <div class="head"><a class="icon-btn" href="#/start" aria-label="${t('common.back')}">${icon('back', 20)}</a><h2 class="su-title">${t('setup.placeholder.title')}</h2></div>
    <p class="hint">${live ? t('setup.placeholder.text') : t('setup.placeholder.notLive')}</p>
    <section class="su-sec"><span class="su-eyebrow">${t('setup.placeholder.players')}</span>
      <div class="su-decks su-ph-list">${g.players.map((p) => html`<div class="su-row"><span class="seat">${p.seat + 1}</span>
        <span class="who"><b>${p.name}</b></span><span class="deck">${g.decks[p.deck_id]?.short_name || ''}</span></div>`)}</div></section>
    <p class="error" role="alert" hidden></p>
    ${live
      ? html`<button type="button" class="btn block outline" data-act="discard">${icon('trash', 18)}${t('setup.placeholder.discard')}</button>`
      : html`<a class="btn block" href="#/start">${t('setup.placeholder.home')}</a>`}
  </div>`);

  on(el, 'click', '[data-act="discard"]', async (e, b) => {
    const err = el.querySelector('.error');
    await busy(b, async () => {
      try {
        await store.finishGame(params.id, g.state, 'aborted');
        toast(t('setup.placeholder.discarded'));
        go('/start', { replace: true });
      } catch (ex) { err.textContent = errText(ex); err.hidden = false; }
    });
  });
}
