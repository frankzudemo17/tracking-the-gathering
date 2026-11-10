// Spieler aus der Gruppe entfernen, Ablauf ohne DOM und ohne Netz-Import (Spec P10 G/H; Unit-Test
// tests/unit/member-remove.test.mjs). Eigene Datei wie group-delete.js: profile.js importiert supabase.js.
// Dazu die Zeile der Liste „Entfernte Spieler“ (groups.js) als reiner String-Baustein.
import { html } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { t } from '../i18n/index.js';

/**
 * Art einer entfernten Zeile (Spec-Nachtrag „Gelöschte Konten“): 'invite' = frühere Zeile eines bestehenden Kontos
 * (kommt über den Einladungslink zurück) · 'deleted' = gehörte einem inzwischen gelöschten Konto (kein Knopf, der
 * Server lehnt restore_member ab) · 'restore' = Platzhalter ohne Konto. former_profile_id geht vor; had_account fehlt
 * vor dem db push (undefined) ⇒ wie bisher.
 * @param {{ former_profile_id?: string|null, had_account?: boolean }} m
 */
export const removedRowKind = (m) => (m.former_profile_id ? 'invite' : m.had_account ? 'deleted' : 'restore');

/**
 * Zeile in „Entfernte Spieler“: Name, Hinweis je Art, Wiederherstellen-Knopf nur bei 'restore'.
 * @param {{ id: string, former_profile_id?: string|null, had_account?: boolean }} m
 * @param {string} name
 */
export function removedRow(m, name) {
  const kind = removedRowKind(m);
  const note = kind === 'invite' ? t('memberRemove.viaInvite') : kind === 'deleted' ? t('memberRemove.accountDeleted') : '';
  return html`
          <div class="row" data-removed-row="${m.id}">
            <a class="grow" href="#/profil/${m.id}"><span class="title">${name}</span>${note ? html`<span class="tiny muted">${note}</span>` : ''}</a>
            ${kind === 'restore' ? html`<button type="button" class="btn small soft" data-act="restore" data-id="${m.id}">${icon('arrowCounterClockwise', 16)}${t('memberRemove.restore')}</button>` : ''}
          </div>`;
}

/** RPC fehlt (Migration noch nicht gepusht): PostgREST PGRST202. */
export const isUnavailable = (e) => e?.code === 'PGRST202';

/** RPC aufrufen; fehlt sie ⇒ { unavailable: true } statt Fehler (Übergangsregel H). */
export async function rpcOrUnavailable(client, fn, args) {
  const r = await client.rpc(fn, args);
  return r.error && isUnavailable(r.error) ? { unavailable: true } : r;
}

/**
 * Zeigt die Profilseite den Knopf „Aus Gruppe entfernen“? (Spec P10 H/K7 + Nachtrag B1) Nur für Gruppen-Admins
 * und den Superadmin; nicht bei entfernten Zeilen, nicht bei sich selbst, nicht bei Admins, nicht beim
 * Superadmin als Ziel (der Server lehnt mit superadmin_only ab). `m.profiles.is_superadmin` kommt aus dem
 * Profil-Select der Profilseite (Spalte seit P9 in Prod, für authenticated lesbar); fehlt sie ⇒ false.
 * @param {{ removed_at?: string|null, role?: string, profiles?: { is_superadmin?: boolean }|null }} m
 * @param {{ isMe: boolean, isAdmin: boolean, isSuperadmin: boolean }} who
 */
export const canRemoveMember = (m, { isMe, isAdmin, isSuperadmin }) =>
  !m.removed_at && !isMe && m.role !== 'admin' && !m.profiles?.is_superadmin && (isAdmin || isSuperadmin);

const has = (e, word) => new RegExp(word).test(e?.message || '');

/** Ist die Zeile nach Neuladen noch da? (nur id — nie die neuen Spalten in einem select, Übergangsregel H) */
async function stillThere(client, id) {
  const { data, error } = await client.from('members').select('id').eq('id', id);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/** Fehler eines Aufrufs: zweites Gerät war schneller (Zeile weg) ⇒ 'already', sonst werfen. */
async function goneOrThrow(client, member, error) {
  if (has(error, 'not_group_admin') && !(await stillThere(client, member.id))) return 'already';
  throw error;
}

/**
 * Spieler entfernen (Spec G, jeder Schritt bricht bei Fehler ab; Muster runGroupDeletion):
 *   1. member_removal_check: Modus delete|mark|already, Zahlen, Dateien.
 *   ·  confirm(check) zeigt die Bestätigung; lehnt sie ab ⇒ 'cancelled', nichts geschrieben.
 *   2. nur delete mit Dateien: avatar_path der Zeile leeren (mit Fehlerprüfung).
 *   3. nur delete mit Dateien: storage.remove(files) — Fehler oder weniger gelöscht ⇒ Abbruch vor dem RPC.
 *   4. remove_member(id, Modus des Probelaufs). member_state_changed ⇒ neuer Probelauf, neue Bestätigung.
 * Jeder Abbruch hinterlässt einen gültigen Zustand (Spec G): Zeile ohne Bild, Datei wird beim nächsten
 * Probelauf wieder gelistet; nie eine Zeile, die auf eine fehlende Datei zeigt.
 * @param {any} client Supabase-Client (rpc, from, storage)
 * @param {{ id: string }} member Mitgliedszeile
 * @param {{ confirm: (check: any) => Promise<boolean>, invalidate?: () => void }} opts
 * @returns {Promise<'deleted'|'marked'|'already'|'cancelled'|'unavailable'>}
 */
export async function runMemberRemoval(client, member, { confirm, invalidate } = /** @type {any} */ ({})) {
  for (let round = 0; round < 3; round++) {
    const chk = await client.rpc('member_removal_check', { p_member: member.id });
    if (chk.error) {
      if (isUnavailable(chk.error)) return 'unavailable';
      return goneOrThrow(client, member, chk.error);
    }
    const c = chk.data;
    if (c.mode === 'already') return 'already';
    if (!(await confirm(c))) return 'cancelled';
    const files = Array.isArray(c.files) ? c.files : [];
    if (c.mode === 'delete' && files.length) {
      const up = await client.from('members').update({ avatar_path: null }).eq('id', member.id).select('id');
      if (up.error) throw up.error;
      const { data, error } = await client.storage.from('avatars').remove(files);
      if (error) throw error;
      // Storage meldet verweigerte Löschungen nicht als Fehler, sondern liefert sie nur nicht zurück
      if (!Array.isArray(data) || data.length < files.length) throw new Error(`Storage: ${files.length - (data?.length || 0)} Datei(en) nicht gelöscht`);
    }
    const r = await client.rpc('remove_member', { p_member: member.id, p_expect: c.mode });
    if (r.error) {
      if (has(r.error, 'member_state_changed')) continue;
      if (isUnavailable(r.error)) return 'unavailable';
      return goneOrThrow(client, member, r.error);
    }
    invalidate?.();
    return r.data?.result || 'already';
  }
  throw new Error('member_state_changed');
}
