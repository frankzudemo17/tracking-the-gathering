// Abend-Rückblick (#/abend/:id): Tageskönig, Salzigster, Längster Zug, Play of the Game, Fuß, Spiele des Abends,
// Teilen-Karte (PNG über recap-card.js). Besitzer: P19.
// Daten nur über groupData, Zahlen nur aus stats.js (recap, evenings, gameSummary), Anzeige nur über format.js.
// Keine Spielerfarben; Commander-Bilder ungetönt (Verlauf in die Fläche, keine Tönung). Quelle: Prototyp recapFor
// (mockup/design-canvas-quellen/Main.dc.html:2761-2810), HANDOFF 5.7.
import { avatarUrls } from '../supabase.js';
import { state } from '../state.js';
import { groupData } from '../lib/data.js';
import { recap, evenings, gameSummary } from '../lib/stats.js';
import { fmtAvg, fmtMmss, fmtHm } from '../lib/format.js';
import { html, mount, on, busy, initials } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, backHead, empty } from '../lib/parts.js';
import { toast } from '../lib/ui.js';
import { t, getLang } from '../i18n/index.js';
import { makeCard, cardFileName } from './recap-card.js';

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

/** 'YYYY-MM-DD' ⇒ „Samstag, 31. Oktober 2026“ (kalendarisch, ohne Zeitzonen-Verschiebung). */
function longDate(day, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  if (!m) return '–';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** Uhrzeit eines Spielbeginns (Europe/Berlin), fehlt ⇒ „–“. */
function clock(iso, lang) {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return '–';
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(ms);
}

/** Commander-Bild als CSS-Variablen: `--art` ungetönt, darunter Fläche aus den Mana-Token (Rückfall ohne Bild). */
function deckArt(deck) {
  const cols = WUBRG.filter((c) => (deck?.colors || []).includes(c));
  const stops = cols.length ? cols.map((c) => `var(--mana-${c})`) : ['var(--sf2)'];
  if (stops.length === 1) stops.push('var(--sf2)');
  const fb = `linear-gradient(135deg, ${stops.join(', ')})`;
  const url = deck?.imageUrl;
  return url ? `--art:url('${String(url).replace(/'/g, '%27')}');--art-fb:${fb}` : `--art:${fb}`;
}

const plural = (n, one, many) => (n === 1 ? t(one) : t(many, { n }));

export default async function recapView(el, { params, isStale }) {
  const id = params?.id || '';
  const lang = getLang();
  const back = backHead(t('recap.title'), '#/historie');
  const unknown = (title = t('recap.unknown'), sub = t('recap.unknownSub')) => mount(el, html`${back}<div class="card">${empty('history', title, sub)}
      <a class="btn soft block" href="#/historie">${icon('back', 18)}${t('recap.backToHistory')}</a></div>`);

  /** @type {any} */
  let data = null;
  try { data = await groupData.loadGroup(state.groupId); } catch (e) {
    console.warn('Abend laden', e);
    if (isStale()) return;
    unknown(t('recap.loadError'), '');
    return;
  }
  if (isStale()) return;

  /** @type {import('../lib/stats.js').Recap|null} */
  let r = null;
  try { r = data ? recap(data, id) : null; } catch (e) { console.warn('Rückblick', e); r = null; }
  if (!r || !r.games) { unknown(); return; }

  const members = new Map((data.members || []).map((m) => [m.id, m]));
  const decks = new Map((data.decks || []).map((d) => [d.id, d]));
  /** @type {Record<string, string|null>} */
  let avUrls = {};
  try { avUrls = await avatarUrls((data.members || []).map((m) => m.avatarPath)); } catch { /* Bilder sind Beiwerk */ }
  if (isStale()) return;

  const name = (mid) => members.get(mid)?.name || '–';
  const avUrl = (mid) => { const p = members.get(mid)?.avatarPath; return p ? avUrls[p] || null : null; };
  const av = (mid, size) => avatar({ name: name(mid), url: avUrl(mid), size });
  const deckTitle = (d) => d?.shortName || d?.commanderName || '–';

  const date = longDate(r.playedOn, lang);
  const foot = `${plural(r.games, 'recap.games1', 'recap.gamesN')} · ${fmtHm(r.minutes)}`;

  // ---- Kacheln (fehlende Werte ⇒ Kachel weglassen)
  const king = r.dayWinner;
  const kDeck = king ? decks.get(king.deckId ?? '') || null : null;
  const kingSub = king ? `${plural(king.wins, 'recap.wins1', 'recap.winsN')} · ${plural(king.points, 'recap.points1', 'recap.pointsN')}` : '';
  const salt = r.saltiest;
  const saltVal = salt ? fmtAvg(salt.avgSalt, lang) : '';
  const saltFilled = salt ? Math.round(salt.avgSalt) : 0; // Anzahl gefüllter Salz-Symbole (Anzeige)
  const turn = r.longestTurn;
  const potg = r.potg;
  const potgVotes = potg ? plural(potg.votes, 'recap.votes1', 'recap.votesN') : '';
  const quote = potg ? (potg.text && potg.text.trim()) || t('recap.noWords') : '';

  const saltIcons = (n) => html`<span class="rc-salts" role="img" aria-label="${t('recap.saltLabel', { v: saltVal })}">${[0, 1, 2, 3, 4].map((i) => html`<span class="${i < n ? 'on' : ''}">${icon('salt', 15)}</span>`)}</span>`;

  const kingTile = king ? html`<article class="rc-king">
      <span class="rc-king-art" style="${deckArt(kDeck)}" role="img" aria-label="${t('recap.deckArt', { name: kDeck?.commanderName || deckTitle(kDeck) })}"></span>
      <div class="rc-king-body">
        ${av(king.memberId, 72)}
        <span class="grow-col">
          <span class="rc-label hi">${icon('crown', 15)}${t('recap.dayKing')}</span>
          <b class="rc-king-name">${name(king.memberId)}</b>
          <span class="rc-sub num">${kingSub}</span>
          ${kDeck ? html`<span class="rc-sub">${t('recap.withDeck', { deck: deckTitle(kDeck) })}</span>` : ''}
        </span>
      </div>
    </article>` : '';

  const saltTile = salt ? html`<div class="rc-tile">
      <span class="rc-tile-top"><span class="rc-ic">${icon('salt', 22)}</span>${saltIcons(saltFilled)}</span>
      <span class="rc-label">${t('recap.saltiest')}</span>
      <b class="rc-name">${name(salt.memberId)}</b>
      <span class="rc-sub num">${t('recap.saltSub', { v: saltVal })}</span>
    </div>` : '';

  const turnTile = turn ? html`<a class="rc-tile rc-link" href="#/partie/${encodeURIComponent(turn.gameId)}">
      <span class="rc-tile-top"><span class="rc-ic">${icon('timer', 22)}</span><span class="rc-chev">${icon('chevRight', 16)}</span></span>
      <span class="rc-label">${t('recap.longestTurn')}</span>
      <b class="rc-name">${name(turn.memberId)}</b>
      <span class="rc-sub num">${t('recap.turnSub', { t: fmtMmss(turn.seconds) })}</span>
      <span class="sr-only">${t('recap.turnLink')}</span>
    </a>` : '';

  const potgTile = potg ? html`<figure class="rc-tile rc-potg">
      <span class="rc-potg-head"><span class="rc-label hi">${icon('starFill', 15)}${t('recap.potg')}</span><span class="rc-sub num">${potgVotes}</span></span>
      <b class="rc-name">${name(potg.memberId)}</b>
      <span class="rc-quote"><span class="rc-quote-ic">${icon('quotes', 18)}</span><blockquote>${quote}</blockquote></span>
    </figure>` : '';

  // ---- Spiele des Abends (chronologisch)
  const ev = evenings(data).find((e) => e.sessionId === r.sessionId);
  const gameIds = ev ? [...ev.gameIds].reverse() : [];
  const rows = gameIds.map((gid) => {
    const s = gameSummary(data, gid);
    if (!s) return '';
    const w = s.placements.find((p) => p.memberId === s.winnerId) || null;
    const wd = w ? decks.get(w.deckId ?? '') || null : null;
    return html`<a class="row rc-game" href="#/partie/${encodeURIComponent(gid)}">
      <span class="rc-game-art" style="${deckArt(wd)}" role="img" aria-label="${t('recap.deckArt', { name: wd?.commanderName || deckTitle(wd) })}"></span>
      <span class="grow">
        <span class="title">${w ? t('recap.winnerWith', { name: name(w.memberId) }) : t('recap.noWinner')}</span>
        <span class="sub">${wd ? deckTitle(wd) : '–'}</span>
      </span>
      <span class="rc-game-side num"><b>${clock(s.startedAt, lang)}</b><span>${s.minutes == null ? '–' : t('recap.minutes', { n: s.minutes })}</span></span>
      <span class="chev">${icon('chevRight', 18)}</span>
    </a>`;
  });

  mount(el, html`
    ${back}
    <section class="rc" aria-label="${t('recap.title')}">
      <header class="rc-head">
        <span class="rc-label">${t('recap.evening')}</span>
        <h2>${date}</h2>
        ${r.location ? html`<span class="rc-where">${icon('mapPin', 15)}<span>${r.location}</span></span>` : ''}
      </header>
      ${kingTile}
      ${saltTile || turnTile ? html`<div class="rc-pair ${saltTile && turnTile ? '' : 'one'}">${saltTile}${turnTile}</div>` : ''}
      ${potgTile}
      <p class="rc-foot num"><span>${foot}</span><span class="rc-tag">${t('recap.tag')}</span></p>
    </section>
    <div class="rc-actions">
      <button type="button" class="btn grow-btn" data-act="share">${icon('shareNetwork', 20)}${t('recap.share')}</button>
      <button type="button" class="icon-btn rc-save" data-act="save" aria-label="${t('recap.save')}" title="${t('recap.save')}">${icon('downloadSimple', 22)}</button>
    </div>
    <p class="small muted rc-hint">${t('recap.shareHint')}</p>
    ${rows.length ? html`<section class="rc-games">
      <h3 class="section-title">${t('recap.gamesTitle')}</h3>
      <div class="list">${rows}</div>
    </section>` : ''}
  `);

  // ---- Teilen-Karte: Modell aus den schon formatierten Texten
  /** @type {import('./recap-card.js').CardModel} */
  const model = {
    brand: t('recap.brand'), tag: t('recap.tag'), title: t('recap.evening'), date, location: r.location || null,
    king: king ? {
      label: t('recap.dayKing'), name: name(king.memberId), initials: initials(name(king.memberId)), sub: kingSub,
      deck: kDeck ? deckTitle(kDeck) : null, avatarUrl: avUrl(king.memberId), artUrl: kDeck?.imageUrl || null, colors: kDeck?.colors || [],
    } : null,
    salt: salt ? { label: t('recap.saltiest'), name: name(salt.memberId), sub: t('recap.saltSub', { v: saltVal }), filled: saltFilled } : null,
    turn: turn ? { label: t('recap.longestTurn'), name: name(turn.memberId), sub: t('recap.turnSub', { t: fmtMmss(turn.seconds) }) } : null,
    potg: potg ? { label: t('recap.potg'), name: name(potg.memberId), sub: potgVotes, quote } : null,
    foot,
  };
  const fileName = cardFileName(r.playedOn);

  const download = (blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.hidden = true;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast(t('recap.saved'));
  };

  on(el, 'click', '[data-act]', (e, btn) => {
    const act = btn.getAttribute('data-act');
    busy(/** @type {HTMLButtonElement} */ (btn), async () => {
      const t0 = performance.now();
      let blob;
      try { ({ blob } = await makeCard(model)); } catch (err) { console.warn('Karte', err); toast(t('recap.shareFailed')); return; }
      const ms = Math.round(performance.now() - t0);
      if (ms > 1000) console.info(`Karte: Erzeugung ${ms} ms`);
      if (act === 'save') { download(blob); return; }
      const file = new File([blob], fileName, { type: 'image/png' });
      const files = [file];
      if (typeof navigator.share === 'function' && navigator.canShare?.({ files })) {
        try { await navigator.share({ files, title: `${t('recap.evening')} · ${date}` }); return; } catch (err) {
          if (err && err.name === 'AbortError') return; // Nutzer hat abgebrochen — kein Fehler
          console.info('Teilen nicht möglich, lade herunter', err?.name || err);
        }
      }
      download(blob);
    });
  });
}
