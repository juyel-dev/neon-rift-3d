import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import type { EnemyKind, PlayerStats } from './types';
import { UPGRADES, type UpgradeDef, type UpgradeId } from './upgradeDefs';

export function createPlayerStats(): PlayerStats {
  return {
    maxHealth: 100,
    moveSpeed: 6.1,
    sprintMultiplier: 1.45,
    dashCooldown: 3.2,
    dashDuration: 0.18,
    dashSpeed: 17,
    fireInterval: 0.125,
    damage: 14,
    critChance: 0.06,
    critMultiplier: 2.2,
    spread: 0.011,
    magSize: 30,
    reloadTime: 1.15,
    reserveAmmo: 180,
    overdriveCost: 100,
    lifesteal: 0,
    regenDelay: 5,
    regenRate: 3,
    dashShockwave: 0,
    pickupBonus: 1,
    damageReduction: 0,
  };
}

/**
 * Base player spawn: on the outer tier of the central dais, facing the arena.
 * Deliberately clear of the core collider so shots are never blocked at the
 * spawn point.
 */
export const PLAYER_SPAWN = { x: 0, y: 0.55, z: 3.4 } as const;

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

export type UpgradeStacks = Record<UpgradeId, number>;

export function createUpgradeStacks(): UpgradeStacks {
  const stacks = {} as UpgradeStacks;
  for (const upgrade of UPGRADES) stacks[upgrade.id] = 0;
  return stacks;
}

export function isMaxed(def: UpgradeDef, stacks: UpgradeStacks): boolean {
  return stacks[def.id] >= def.maxStacks;
}

export function totalUpgradeStacks(stacks: UpgradeStacks): number {
  return UPGRADES.reduce((sum, upgrade) => sum + stacks[upgrade.id], 0);
}

/** Applies an upgrade purchase. Returns false when the upgrade is unknown or maxed. */
export function purchaseUpgrade(stats: PlayerStats, stacks: UpgradeStacks, id: UpgradeId): boolean {
  const def = UPGRADES.find((upgrade) => upgrade.id === id);
  if (!def) return false;
  if (isMaxed(def, stacks)) return false;
  def.apply(stats);
  stacks[id] += 1;
  stats.fireInterval = clamp(stats.fireInterval, 0.035, 1);
  stats.dashCooldown = clamp(stats.dashCooldown, 0.5, 30);
  stats.spread = clamp(stats.spread, 0.002, 0.05);
  return true;
}

/**
 * Rolls `count` distinct upgrade offers. Maxed upgrades are excluded and the
 * result never contains duplicates, so exactly `count` cards are shown whenever
 * enough upgrades remain un-maxed.
 */
export function rollUpgradeOffers(stacks: UpgradeStacks, rng: Rng, count = 3): UpgradeDef[] {
  const pool = UPGRADES.filter((upgrade) => !isMaxed(upgrade, stacks));
  const offers: UpgradeDef[] = [];
  while (offers.length < Math.min(count, pool.length) && pool.length > 0) {
    const total = pool.reduce((sum, upgrade) => sum + upgrade.weight, 0);
    let roll = rng.next() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].weight;
      if (roll <= 0) {
        index = i;
        break;
      }
    }
    offers.push(pool[index]);
    pool.splice(index, 1);
  }
  return offers;
}

// ---------------------------------------------------------------------------
// Spawn placement
// ---------------------------------------------------------------------------

export interface SpawnRequest {
  halfExtent: number;
  minDistanceFromPlayer: number;
  playerX: number;
  playerZ: number;
}

/**
 * Picks a spawn position away from the player and inside the arena bounds.
 * Uses rejection sampling around the player so enemies never materialise on top
 * of (or inside) the player.
 */
export function findSpawnPosition(
  request: SpawnRequest,
  rng: Rng,
): { x: number; z: number; angle: number } {
  const { halfExtent, minDistanceFromPlayer, playerX, playerZ } = request;
  const limit = halfExtent - 2.5;
  const baseAngle = rng.next() * Math.PI * 2;
  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = baseAngle + attempt * (Math.PI / 6);
    const radius = Math.min(limit, minDistanceFromPlayer + rng.range(1, 9));
    const x = clamp(playerX + Math.cos(angle) * radius, -limit, limit);
    const z = clamp(playerZ + Math.sin(angle) * radius, -limit, limit);
    const dist = Math.hypot(x - playerX, z - playerZ);
    if (dist >= Math.min(minDistanceFromPlayer, limit * 0.9)) return { x, z, angle };
  }
  const angle = baseAngle + Math.PI;
  return {
    x: clamp(playerX + Math.cos(angle) * 12, -limit, limit),
    z: clamp(playerZ + Math.sin(angle) * 12, -limit, limit),
    angle,
  };
}

// ---------------------------------------------------------------------------
// Enemy costs / scaling
// ---------------------------------------------------------------------------

/** Spawn "cost" of an enemy type; used to keep wave budgets balanced. */
export function enemyCost(kind: EnemyKind): number {
  switch (kind) {
    case 'shade':
      return 1;
    case 'warden':
      return 2;
    case 'seeker':
      return 3;
    case 'bulwark':
      return 6;
    default:
      return 1;
  }
}

export function waveHealthScale(wave: number): number {
  return 1 + Math.max(0, wave - 1) * 0.13;
}

export function waveDamageScale(wave: number): number {
  return 1 + Math.max(0, wave - 1) * 0.07;
}

export function waveSpeedScale(wave: number): number {
  return Math.min(1.35, 1 + Math.max(0, wave - 1) * 0.02);
}
