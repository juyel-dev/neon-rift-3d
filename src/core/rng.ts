/**
 * Deterministic pseudo random number generator (mulberry32).
 * Determinism keeps the wave/upgrade logic unit-testable.
 */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Next float in [min, max). */
  range(min: number, max: number): number;
  /** Next integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** True with probability `chance` (0..1). */
  chance(chance: number): boolean;
  /** Random element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** In-place Fisher-Yates shuffle (returns the same array). */
  shuffle<T>(items: T[]): T[];
  /** Current internal state, useful for snapshotting. */
  state(): number;
}

export function createRng(seed: number): Rng {
  let state = (Math.floor(seed) || 0x2f6e2b1) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (chance) => next() < chance,
    pick: (items) => items[Math.floor(next() * items.length)],
    shuffle: (items) => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = items[i];
        items[i] = items[j];
        items[j] = tmp;
      }
      return items;
    },
    state: () => state,
  };
  return rng;
}

/** A stable string hash, used to derive seeds from text such as a seed phrase. */
export function hashString(text: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
