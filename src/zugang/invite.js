// Einladung (Spec P9b A): Einladungscode einer Gruppe lesen und einen Code ohne Anmeldung prüfen.
// Der Client läuft vor UND nach dem db push der Migration 20261116000000_zugang.sql ⇒ genau zwei
// Übergangsstellen. Jeder andere Fehler (Netz, 5xx, 42501) wird geworfen und angezeigt — nie „weiter“.

/** PostgREST: Tabelle bzw. Funktion unbekannt (Migration noch nicht in der Datenbank). */
const tableUnknown = (e) => e?.code === 'PGRST205' || e?.code === '42P01';
const fnUnknown = (e) => e?.code === 'PGRST202';

/**
 * Einladungscode der Gruppe (nur Admins und Superadmin sehen ihn), sonst null.
 * @param {any} sb Supabase-Client
 * @param {{ id: string, invite_code?: string }} group
 * @returns {Promise<string|null>}
 */
export async function inviteCode(sb, group) {
  const { data, error } = await sb.from('playgroup_invites').select('code').eq('playgroup_id', group.id).maybeSingle();
  if (!error) return data?.code ?? null;
  // ÜBERGANG P9b: entfernen, sobald 20261116000000_zugang.sql in Prod ist
  if (tableUnknown(error)) return group.invite_code ?? null;
  throw error;
}

/**
 * Code prüfen (auch ohne Anmeldung): { status: 'ok', group_name } | { status: 'invalid' } | { status: 'full' }
 * oder { status: 'unknown' } (Datenbank kennt die Prüfung noch nicht ⇒ Aufrufer fährt fort wie bei ok).
 * @param {any} sb
 * @param {string} code
 * @returns {Promise<{ status: 'ok'|'invalid'|'full'|'unknown', group_name?: string }>}
 */
export async function checkInvite(sb, code) {
  const { data, error } = await sb.rpc('check_invite', { p_code: code });
  if (!error) {
    if (!data || !['ok', 'invalid', 'full'].includes(data.status)) throw new Error('check_invite: unerwartete Antwort');
    return data;
  }
  // ÜBERGANG P9b: entfernen, sobald 20261116000000_zugang.sql in Prod ist
  if (fnUnknown(error)) return { status: 'unknown' };
  throw error;
}

/** Link aus einer Eingabe herauslösen: ganzer Link (…#/beitreten/CODE, …#/code/CODE) oder nur der Code. */
export function codeFromInput(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/#\/(?:beitreten|code)\/([^/?#\s]+)/i);
  return m ? decodeSafe(m[1]) : s;
}
const decodeSafe = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
