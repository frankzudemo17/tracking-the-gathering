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

/** Dateiliste aus my_account_files() nach Bucket bündeln: { avatars: [...], 'game-photos': [...] } */
export function filesByBucket(rows) {
  const out = {};
  for (const r of rows || []) if (r?.bucket && r?.path) (out[r.bucket] ||= []).push(r.path);
  return out;
}
