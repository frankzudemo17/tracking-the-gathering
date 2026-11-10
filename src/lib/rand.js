// Zufallsquelle der App (Spec P7). Alle Views holen Zufall nur hierüber und übergeben appRand
// direkt als rand(): randInt(6, appRand), roll(kind, players, appRand), koPick(appRand).
// Testhaken: window.__ttgRand() wirkt NUR auf localhost/127.0.0.1 (E2E erzwingt Würfe,
// K.O.-Varianten, Sprüche); in Prod immer crypto.getRandomValues (src/game/rng.js).
import { randomSource } from '../game/rng.js';

let source = null;

/** rand() ∈ [0, 1). Hostname und Haken werden bei jedem Aufruf neu gelesen. */
export function appRand() {
  const host = globalThis.location?.hostname;
  const hook = globalThis.__ttgRand;
  if ((host === 'localhost' || host === '127.0.0.1') && typeof hook === 'function') {
    const v = Number(hook());
    if (v >= 0 && v < 1) return v;
  }
  if (!source) source = randomSource();
  return source();
}
