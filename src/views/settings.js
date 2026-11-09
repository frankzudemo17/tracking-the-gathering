// Einstellungen: Sprache, Erscheinungsbild, Playgroups, Abmelden (erreichbar über das Zahnrad im Profil)
import { sb } from '../supabase.js';
import { state, updateProfile } from '../state.js';
import { html, mount, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { backHead } from '../lib/parts.js';
import { toast, errText } from '../lib/ui.js';
import { t } from '../i18n/index.js';
import { go } from '../router.js';

// Vorschau je Look: Hintergrund, Fläche, Hauptknopf
const LOOKS = {
  nacht: ['#0F1729', '#24325A', '#F3F6FC'], arktis: ['#DCE7F3', '#F7FAFD', '#0E1A2B'], lachs: ['#F2DCD3', '#FFF7F4', '#3B2420'],
};

export default function settings(el) {
  const p = state.profile;
  mount(el, html`
    ${backHead(t('profile.settings'), '#/profil')}

    <div class="section">
      <div class="section-head"><h3 class="section-title">${t('profile.look')}</h3></div>
      <div class="looks">${Object.entries(LOOKS).map(([k, [a, b, c]]) => html`
        <button type="button" class="look" data-look="${k}" aria-pressed="${p.theme === k}">
          <span class="sw" style="background:${a}"><i style="background:${b}"></i><i style="background:${c}"></i></span>${t(`profile.looks.${k}`)}</button>`)}
      </div>
    </div>

    <div class="list">
      <div class="row">
        <span class="grow"><span class="title">${t('profile.language')}</span></span>
        <div class="seg">${['de', 'en'].map((l) => html`<button type="button" data-lang="${l}" aria-pressed="${p.locale === l}">${l.toUpperCase()}</button>`)}</div>
      </div>
      <a class="row" href="#/gruppen">
        <span class="row-ic">${icon('users', 20)}</span>
        <span class="grow"><span class="title">${t('profile.manageGroups')}</span></span>
        <span class="chev">${icon('chevRight', 18)}</span>
      </a>
    </div>

    <button type="button" class="btn danger" data-act="logout">${icon('logout', 18)}${t('profile.logout')}</button>`);

  const rerender = () => go(location.hash.slice(1));
  on(el, 'click', '[data-lang]', async (e, b) => { try { await updateProfile({ locale: b.dataset.lang }); rerender(); } catch (ex) { toast(errText(ex)); } });
  on(el, 'click', '[data-look]', async (e, b) => { try { await updateProfile({ theme: b.dataset.look }); rerender(); } catch (ex) { toast(errText(ex)); } });
  on(el, 'click', '[data-act="logout"]', () => sb.auth.signOut());
}
