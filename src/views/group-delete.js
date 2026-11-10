// Gruppe löschen, Ablauf ohne DOM und ohne Netz-Import (Spec P3 Block A; Unit-Test tests/unit/group-delete.test.mjs).
// Eigene Datei, weil groups.js src/supabase.js importiert und in Node nicht ladbar ist (tests/unit/README.md).
import { filesByBucket } from './settings-rules.js';

/** Name zum Bestätigen: Rand und Groß-/Kleinschreibung egal, leer nie. */
export function groupNameMatches(input, name) {
  const a = String(input ?? '').trim().toLocaleLowerCase('de');
  return a !== '' && a === String(name ?? '').trim().toLocaleLowerCase('de');
}

/** „Gruppe nicht gefunden“: ein früherer Aufruf (Doppelklick, anderer Admin) hat schon gelöscht. */
const groupGone = (e) => /Gruppe nicht gefunden/.test(e?.message || '');

/**
 * Gruppe löschen (Muster runAccountDeletion, E3-P12):
 *   0. Name lokal prüfen (groupNameMatches). Passt er nicht ⇒ Fehler „Name stimmt nicht“, kein Aufruf.
 *   1. playgroup_files(): Vorprüfung auf dem Server (Admin, Leihdeck ⇒ deck_used_elsewhere, Probelauf
 *      ⇒ member_used_elsewhere) und Dateiliste. Wirft sie, endet der Ablauf, BEVOR eine Datei gelöscht ist.
 *   2. Storage-remove der Bilder der Spieler ohne Konto und der Spielfotos. Nur jetzt möglich: nach dem
 *      Löschen gibt es die Mitgliedschaft nicht mehr, die Storage-Policies erlauben dann nichts, und SQL
 *      darf storage.objects nicht löschen. Fehler oder weniger gelöscht als verlangt ⇒ Abbruch vor der RPC.
 *   3. delete_playgroup() mit dem KANONISCHEN Namen g.name (Befund B2): die lokale Prüfung ist großzügiger
 *      als die des Servers (trim() entfernt jeden Unicode-Leerraum, btrim nur U+0020). Mit der Eingabe
 *      könnte der Server den Namen erst NACH dem Storage-Schritt ablehnen ⇒ Bilder weg, Gruppe da.
 * @param {any} client Supabase-Client (rpc, storage)
 * @param {{ id: string, name: string }} g Gruppe
 * @param {string} input Eingabe im Bestätigungsfeld
 * @returns {Promise<'deleted'|'already'>} 'already' = schon gelöscht. Wirft bei jedem anderen Fehler.
 */
export async function runGroupDeletion(client, g, input) {
  if (!groupNameMatches(input, g.name)) throw new Error('Name stimmt nicht');
  const list = await client.rpc('playgroup_files', { p_group: g.id });
  if (list.error) {
    if (groupGone(list.error)) return 'already';
    throw list.error;
  }
  for (const [bucket, paths] of Object.entries(filesByBucket(list.data))) {
    for (let i = 0; i < paths.length; i += 100) {
      const part = paths.slice(i, i + 100);
      const { data, error } = await client.storage.from(bucket).remove(part);
      if (error) throw error;
      // Storage meldet verweigerte Löschungen nicht als Fehler, sondern liefert sie nur nicht zurück
      if (Array.isArray(data) && data.length < part.length) throw new Error(`Storage: ${part.length - data.length} Datei(en) in ${bucket} nicht gelöscht`);
    }
  }
  const { error } = await client.rpc('delete_playgroup', { p_group: g.id, p_name: g.name });
  if (error && !groupGone(error)) throw error;
  return error ? 'already' : 'deleted';
}
