// Deckel für Konten (Spec P9b F): gleiche Grenzen wie set_max_accounts in der Datenbank (P9).
export const MAX_MIN = 1;
export const MAX_MAX = 1000;
/** Eingabe prüfen: ganze Zahl MAX_MIN–MAX_MAX, sonst null (dann kein Aufruf, Feldfehler). */
export const parseMax = (v) => (/^\s*\d+\s*$/.test(String(v ?? '')) && +v >= MAX_MIN && +v <= MAX_MAX ? +v : null);
