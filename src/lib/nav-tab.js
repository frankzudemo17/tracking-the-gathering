// P13: welcher Reiter der Leiste ist hell?
// Das Profil eines Mitspielers ist nicht „Profil“ (das ist das eigene) — dort bleibt der Reiter hell, von dem man kam
// (Rangliste, Start, Historie …); kam man von „Profil“ oder per Direktlink, ist keiner hell. Ein Deck folgt dem Reiter,
// von dem man kam (eigenes Profil ⇒ „Profil“, Rangliste ⇒ „Rangliste“).

/**
 * @param {{ path: string, params?: Record<string, string>, opts: { nav?: string } }} r aktuelle Route
 * @param {string[]} mine eigene Mitglieds-Ids (alle Gruppen)
 * @param {string|null} prev zuletzt heller Reiter
 * @returns {string|null}
 */
export function activeTab(r, mine, prev) {
  const nav = r.opts.nav || null;
  if (!nav) return null;
  const memberId = r.params?.memberId;
  if (memberId != null && /^\/profil\//.test(r.path)) {
    if (mine.includes(memberId)) return 'me';
    return prev && prev !== 'me' ? prev : null;
  }
  if (/^\/deck\//.test(r.path)) return prev || nav;
  return nav;
}
