// Zufall (HANDOFF 5.4b): Quelle ist crypto.getRandomValues, alles Weitere bekommt rand() injiziert.

const TWO32 = 2 ** 32;

/** rand() ∈ [0,1) aus crypto.getRandomValues (Uint32 / 2^32). */
export function randomSource() {
  const buf = new Uint32Array(1);
  return () => {
    globalThis.crypto.getRandomValues(buf);
    return buf[0] / TWO32;
  };
}

/** Gleichverteilte Ganzzahl 0..n-1 per Verwerfen (kein Modulo-Bias). */
export function randInt(n, rand) {
  if (!Number.isInteger(n) || n < 1 || n > TWO32) throw new Error(`randInt: ungültiges n '${n}'`);
  const limit = Math.floor(TWO32 / n) * n;
  for (let i = 0; i < 1000; i++) {
    const u = Math.floor(rand() * TWO32);
    if (u < limit) return u % n;
  }
  throw new Error('randInt: Zufallsquelle liefert nur verworfene Werte');
}

/**
 * Ein Wurf. kind ∈ w6, w6x2, w20, coin (0 = Kopf, 1 = Zahl), player (Sitz eines Lebenden).
 * @returns {{ kind: string, values: number[], winnerSeat?: number }}
 */
export function roll(kind, players, rand) {
  switch (kind) {
    case 'w6': return { kind, values: [1 + randInt(6, rand)] };
    case 'w6x2': return { kind, values: [1 + randInt(6, rand), 1 + randInt(6, rand)] };
    case 'w20': return { kind, values: [1 + randInt(20, rand)] };
    case 'coin': return { kind, values: [randInt(2, rand)] };
    case 'player': {
      const alive = (players || []).filter((p) => !p.out);
      if (!alive.length) throw new Error('roll player: niemand mehr im Spiel');
      const seat = alive[randInt(alive.length, rand)].seat;
      return { kind, values: [seat], winnerSeat: seat };
    }
    default: throw new Error(`roll: unbekannte Wurfart '${kind}'`);
  }
}
