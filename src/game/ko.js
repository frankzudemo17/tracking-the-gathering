// K.O.-Auswahl (HANDOFF 5.5, Main.dc.html:1909–1914): Variante A/B/C und Spruch 0..7.
// Variante B zeigt nie Spruch 0.
import { randInt } from './rng.js';

export const KO_VARIANTS = ['A', 'B', 'C'];
export const KO_QUOTES = 8;

/** @returns {{ variant: 'A'|'B'|'C', quote: number }} */
export function koPick(rand) {
  const variant = KO_VARIANTS[randInt(KO_VARIANTS.length, rand)];
  let quote = randInt(KO_QUOTES, rand);
  if (variant === 'B' && quote === 0) quote = 1 + randInt(KO_QUOTES - 1, rand);
  return { variant, quote };
}
