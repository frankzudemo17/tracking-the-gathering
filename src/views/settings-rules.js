// Reine Prüfregeln der Konto-Einstellungen (ohne DOM, ohne Netz; Unit-Test tests/unit/settings-rules.test.mjs)

/** Wort, das zum Löschen eingetippt werden muss, je Sprache */
export const DELETE_WORD = { de: 'LÖSCHEN', en: 'DELETE' };

/** Neues Passwort zweimal: null = in Ordnung, sonst i18n-Schlüssel des Problems */
export function passwordProblem(pw, repeat) {
  if (typeof pw !== 'string' || pw.length < 8) return 'auth.errors.weak';
  if (pw !== repeat) return 'account.pwMismatch';
  return null;
}

/** Neue E-Mail: null = in Ordnung, sonst i18n-Schlüssel */
export function emailProblem(next, current) {
  const v = String(next || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'account.emailBad';
  if (current && v.toLowerCase() === String(current).toLowerCase()) return 'account.emailSame';
  return null;
}

/** Ist das Bestätigungswort richtig eingetippt? (Groß-/Kleinschreibung egal, Leerzeichen außen egal) */
export function deleteConfirmed(input, lang) {
  const word = DELETE_WORD[lang] || DELETE_WORD.de;
  return String(input || '').trim().toLocaleUpperCase(lang === 'en' ? 'en' : 'de') === word;
}

/** „Konto nicht gefunden“: ein früherer Aufruf (Doppelklick, zweiter Tab) hat schon gelöscht */
const alreadyGone = (error) => /Konto nicht gefunden/.test(error?.message || '');

/**
 * Konto löschen, Ablauf ohne DOM (sb wird hereingegeben, damit der Unit-Test ihn vorspielen kann).
 * Reihenfolge (Befund B2, „halb gelöscht“ verhindern):
 *   1. check_delete_my_account(): Probelauf auf dem Server (dieselbe Löschung in einem Savepoint,
 *      zurückgerollt). Scheitert er, bricht der Ablauf ab, BEVOR eine Datei gelöscht ist.
 *   2. my_account_files() + Storage-remove: nur eigene Profilbilder und Dateien von Gruppen, die
 *      mitgelöscht werden — nie Fotos bestehender Gruppen. Das geht nur jetzt: nach der RPC gibt es
 *      die Mitgliedschaft nicht mehr, die Storage-Policies erlauben dann nichts mehr, und SQL darf
 *      storage.objects nicht löschen.
 *   3. delete_my_account(): die eigentliche Löschung (eine Transaktion).
 * Rückgabe: 'deleted' oder 'already' (schon gelöscht). Wirft bei jedem anderen Fehler.
 */
export async function runAccountDeletion(sb) {
  const pre = await sb.rpc('check_delete_my_account');
  if (pre.error) {
    if (alreadyGone(pre.error)) return 'already';
    throw pre.error;
  }
  const list = await sb.rpc('my_account_files');
  if (list.error) throw list.error;
  for (const [bucket, paths] of Object.entries(filesByBucket(list.data))) {
    const { error } = await sb.storage.from(bucket).remove(paths);
    if (error) throw error;
  }
  const { error } = await sb.rpc('delete_my_account');
  if (error && !alreadyGone(error)) throw error;
  return error ? 'already' : 'deleted';
}

/** Dateiliste aus my_account_files() nach Bucket bündeln: { avatars: [...], 'game-photos': [...] } */
export function filesByBucket(rows) {
  const out = {};
  for (const r of rows || []) if (r?.bucket && r?.path) (out[r.bucket] ||= []).push(r.path);
  return out;
}
