import de from './de.js';
import en from './en.js';

const DICTS = { de, en };
let lang = 'de';

export function setLang(l) {
  lang = DICTS[l] ? l : 'de';
  document.documentElement.lang = lang;
}
export const getLang = () => lang;

function lookup(dict, key) {
  return key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);
}

/** t('groups.joined', { name }) – fällt auf Deutsch zurück, dann auf den Schlüssel. */
export function t(key, vars) {
  let s = lookup(DICTS[lang], key);
  if (s == null) s = lookup(de, key);
  if (s == null) return key;
  if (vars) s = String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}

export function fmtDate(d) {
  return new Date(d).toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE', { month: 'long', year: 'numeric' });
}
