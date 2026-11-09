// Decks: laden, Spielerfarbe, Brackets, Deck-Links
import { sb, must } from '../supabase.js';

export const BRACKETS = [
  { n: 1, de: 'Exhibition', en: 'Exhibition' },
  { n: 2, de: 'Core', en: 'Core' },
  { n: 3, de: 'Upgraded', en: 'Upgraded' },
  { n: 4, de: 'Optimized', en: 'Optimized' },
  { n: 5, de: 'cEDH', en: 'cEDH' },
];
export const bracketName = (n) => BRACKETS.find((b) => b.n === n)?.de || '';

const WUBRG = ['W', 'U', 'B', 'R', 'G'];
/** Farben in WUBRG-Reihenfolge */
export const sortColors = (cols) => WUBRG.filter((c) => (cols || []).includes(c));

/** Farbe aus erster Commander-Farbe (WUBRG), farblos = grau. Nur für Diagramme gedacht, nicht als Spielerfarbe in der Oberfläche (Franco, 09.11.2026). */
export function playerColor(deck) {
  const c = sortColors(deck?.color_identity)[0];
  return c ? `var(--p-${c.toLowerCase()})` : 'var(--p-c)';
}

/** Decks eines Mitglieds: Konto → owner_profile_id, Spieler ohne Konto → owner_member_id */
export function decksOf(member, { archived = false } = {}) {
  let q = sb.from('decks').select('*').eq('archived', archived).order('created_at', { ascending: false });
  q = member.profile_id ? q.eq('owner_profile_id', member.profile_id) : q.eq('owner_member_id', member.id);
  return q.then(must);
}

/** Neuestes Deck je Mitglied (für Farbe und Bild auf der Startseite) */
export async function latestDeckByMember(members) {
  const pids = members.filter((m) => m.profile_id).map((m) => m.profile_id);
  const mids = members.filter((m) => !m.profile_id).map((m) => m.id);
  const ors = [];
  if (pids.length) ors.push(`owner_profile_id.in.(${pids.join(',')})`);
  if (mids.length) ors.push(`owner_member_id.in.(${mids.join(',')})`);
  if (!ors.length) return {};
  const rows = await sb.from('decks').select('id, owner_profile_id, owner_member_id, color_identity, image_url, short_name, created_at')
    .eq('archived', false).or(ors.join(',')).order('created_at', { ascending: false }).then(must);
  const out = {};
  for (const m of members) {
    out[m.id] = rows.find((d) => (m.profile_id ? d.owner_profile_id === m.profile_id : d.owner_member_id === m.id)) || null;
  }
  return out;
}

/** Deck-Link erkennen: Moxfield, Archidekt, sonst Hostname */
export function linkInfo(url) {
  try {
    if (/\s/.test(url)) return null;
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    // Browser sind beim Hostnamen großzügig; wir verlangen einen echten Domainnamen
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return null;
    const host = u.hostname.replace(/^www\./, '');
    if (host.endsWith('moxfield.com')) return { label: 'Moxfield', host };
    if (host.endsWith('archidekt.com')) return { label: 'Archidekt', host };
    if (host.endsWith('manabox.app')) return { label: 'ManaBox', host };
    return { label: host, host };
  } catch { return null; }
}

/** Eingabe zu einer gültigen URL machen (fehlendes https:// ergänzen) oder null */
export function normalizeLink(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return linkInfo(withProto) ? withProto : null;
}
