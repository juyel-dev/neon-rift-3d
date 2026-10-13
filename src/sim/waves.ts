import { clamp } from '../core/math';
import { createRng } from '../core/rng';
import { ENEMY_DEFS } from './enemyDefs';
import type { EnemyKind } from './types';
import { enemyCost } from './progression';

export interface WaveGroup {
  kind: EnemyKind;
  count: number;
}

export interface WavePlan {
  wave: number;
  groups: WaveGroup[];
  totalEnemies: number;
  budget: number;
  maxAlive: number;
  /** Score awarded when every enemy of the wave is destroyed. */
  clearBonus: number;
  /** Reserve ammunition granted at the start of the wave. */
  reserveRefill: number;
  healthScale: number;
  damageScale: number;
  speedScale: number;
  /** Downtime before the first enemies of the wave spawn. */
  introTime: number;
  spawnInterval: number;
}

/** Enemy archetypes available on a given wave (unlocks are progressive). */
export function unlockedKinds(wave: number): EnemyKind[] {
  return (Object.keys(ENEMY_DEFS) as EnemyKind[]).filter((kind) => ENEMY_DEFS[kind].unlockWave <= wave);
}

/** Hard ceiling on enemies in a single wave so the arena stays readable. */
export const MAX_WAVE_ENEMIES = 40;

/**
 * Builds the composition of a wave.
 *
 * The function is fully deterministic: the same wave number always produces the
 * same plan, which makes balance assertions (and therefore tests) reliable.
 * Cheap archetypes get a diminishing weight as the wave fills up, so later waves
 * are a varied mix instead of an avalanche of the cheapest unit.
 */
export function computeWavePlan(wave: number): WavePlan {
  const index = Math.max(0, wave - 1);
  const budget = Math.round(5 + wave * 2.8 + Math.pow(index, 1.25) * 0.55);
  const totalCap = Math.round(clamp(6 + wave * 1.5, 6, MAX_WAVE_ENEMIES));
  const kinds = unlockedKinds(wave);
  const rng = createRng(0x9e3779b9 ^ (wave * 2654435761));

  const counts = new Map<EnemyKind, number>();
  const remaining = [...kinds];
  let points = budget;
  let total = 0;

  while (points > 0 && total < totalCap && remaining.length > 0) {
    // Weight each candidate, penalising archetypes already over-represented.
    let weightTotal = 0;
    const weights = new Map<EnemyKind, number>();
    for (const kind of remaining) {
      const def = ENEMY_DEFS[kind];
      const waveBias = Math.max(0.2, 1 + (wave - def.unlockWave) * 0.45);
      const weight = Math.max(0.05, def.weight * waveBias * Math.pow(0.7, counts.get(kind) ?? 0));
      weights.set(kind, weight);
      weightTotal += weight;
    }

    let roll = rng.next() * weightTotal;
    let choice = remaining[remaining.length - 1];
    for (const kind of remaining) {
      roll -= weights.get(kind) ?? 0;
      if (roll <= 0) {
        choice = kind;
        break;
      }
    }

    const cost = enemyCost(choice);
    if (cost > points) {
      const idx = remaining.indexOf(choice);
      remaining.splice(idx, 1);
      continue;
    }

    counts.set(choice, (counts.get(choice) ?? 0) + 1);
    total += 1;
    points -= cost;
  }

  const groups: WaveGroup[] = [];
  let totalEnemies = 0;
  for (const kind of kinds) {
    const count = counts.get(kind) ?? 0;
    if (count <= 0) continue;
    groups.push({ kind, count });
    totalEnemies += count;
  }

  return {
    wave,
    groups,
    totalEnemies,
    budget,
    maxAlive: Math.round(clamp(9 + wave * 1.4, 9, 24)),
    clearBonus: Math.round(120 * wave + 60 * Math.pow(wave, 1.4)),
    reserveRefill: 60 + wave * 12,
    healthScale: 1 + index * 0.13,
    damageScale: 1 + index * 0.07,
    speedScale: Math.min(1.35, 1 + index * 0.02),
    introTime: wave === 1 ? 8 : 5,
    spawnInterval: Number(clamp(1.35 - wave * 0.05, 0.35, 1.35).toFixed(3)),
  };
}
