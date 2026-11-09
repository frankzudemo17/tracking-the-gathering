// Scryfall: Commander-Suche inkl. Partner. https://scryfall.com/docs/api
// Kein Schlüssel nötig; Scryfall bittet um höchstens ~10 Anfragen pro Sekunde.
const API = 'https://api.scryfall.com';
let lastCall = 0;

async function call(path, params, signal) {
  // sanfte Drosselung: mindestens 100 ms zwischen zwei Anfragen
  const wait = Math.max(0, lastCall + 100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  const json = await res.json().catch(() => null);
  if (res.status === 404 && json?.object === 'error') return { data: [] }; // keine Treffer
  if (!res.ok) throw new Error(json?.details || `Scryfall ${res.status}`);
  return json;
}

const face = (c) => c.image_uris || c.card_faces?.[0]?.image_uris || {};
export const artUrl = (c) => face(c).art_crop || null;
export const thumbUrl = (c) => face(c).small || face(c).art_crop || null;

/** Welche Art Partner hat diese Karte? */
export function partnerKind(c) {
  const oracle = c.oracle_text || c.card_faces?.map((f) => f.oracle_text).join('\n') || '';
  const kw = c.keywords || [];
  const withMatch = oracle.match(/Partner with ([^(\n]+?)(?:\s*\(|\n|$)/);
  if (withMatch) return { kind: 'with', name: withMatch[1].trim() };
  if (/Friends forever/i.test(oracle)) return { kind: 'friends' };
  if (kw.includes('Partner')) return { kind: 'partner' };
  if (kw.some((k) => /choose a background/i.test(k))) return { kind: 'background' };
  if (kw.includes("Doctor's companion")) return { kind: 'companion' };
  if (/Time Lord Doctor/.test(c.type_line || '')) return { kind: 'doctor' };
  return null;
}

function partnerQuery(p) {
  switch (p?.kind) {
    case 'with': return `!"${p.name.replace(/"/g, '')}"`;
    case 'partner': return 'is:commander keyword:partner -o:"Partner with"';
    case 'friends': return 'is:commander o:"Friends forever"';
    case 'background': return 't:background';
    case 'companion': return 'is:commander t:"Time Lord Doctor"';
    case 'doctor': return `is:commander o:"Doctor's companion"`;
    default: return null;
  }
}

/**
 * Commander suchen. partner: Ergebnis von partnerKind() des ersten Commanders → nur passende Partner.
 * Treffer, deren Name mit dem Suchbegriff beginnt, stehen vorn.
 */
export async function searchCommanders(term, { partner = null, signal } = {}) {
  const t = term.trim().replace(/["\\]/g, '');
  const base = partner ? partnerQuery(partner) : 'is:commander -t:background';
  if (!base) return [];
  if (!partner && t.length < 2) return [];
  const q = t ? `${base} ${t.split(/\s+/).map((w) => `name:${JSON.stringify(w)}`).join(' ')}` : base;
  const res = await call('/cards/search', { q, order: 'edhrec', unique: 'cards' }, signal);
  const low = t.toLowerCase();
  const cards = (res.data || []).filter((c) => artUrl(c));
  cards.sort((a, b) => (b.name.toLowerCase().startsWith(low) - a.name.toLowerCase().startsWith(low)));
  return cards.slice(0, 30);
}

/**
 * Kurzname: Teil vor dem Komma (Atraxa, Praetors' Voice → Atraxa),
 * bei „Vorname the/of …“ nur der Vorname (Tymna the Weaver → Tymna). „The Tenth Doctor“ bleibt.
 */
export function shortName(name) {
  const n = name.split(' // ')[0].split(',')[0].trim();
  const m = n.match(/^(?!the\s)(\S+)\s+(the|of)\s/i);
  return m ? m[1] : n;
}
