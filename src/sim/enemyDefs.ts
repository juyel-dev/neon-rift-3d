import type { EnemyKind } from './types';

export interface EnemyDef {
  kind: EnemyKind;
  /** Display name used in the HUD kill feed. */
  name: string;
  health: number;
  speed: number;
  /** Horizontal body collision radius (also used for separation). */
  radius: number;
  bodyHeight: number;
  bodyRadius: number;
  headHeight: number;
  headRadius: number;
  contactDamage: number;
  attackRange: number;
  windupTime: number;
  recoverTime: number;
  attackCooldown: number;
  score: number;
  turnRate: number;
  /** Preferred distance kept from the player, for ranged units. */
  preferredRange: number;
  projectileSpeed: number;
  fireCooldown: number;
  /** Fraction of damage taken when hit from the front (0..1). */
  frontArmor: number;
  knockbackResistance: number;
  /** Relative spawn weight. */
  weight: number;
  unlockWave: number;
  minDrop: number;
  maxDrop: number;
  healthDropChance: number;
  /** Visual/scale hint for the renderer. */
  scale: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  shade: {
    kind: 'shade',
    name: 'SHADE',
    health: 16,
    speed: 6.6,
    radius: 0.34,
    bodyHeight: 0.42,
    bodyRadius: 0.32,
    headHeight: 0.82,
    headRadius: 0.2,
    contactDamage: 5,
    attackRange: 1.7,
    windupTime: 0.12,
    recoverTime: 0.1,
    attackCooldown: 0.7,
    score: 12,
    turnRate: 12,
    preferredRange: 0,
    projectileSpeed: 0,
    fireCooldown: 0,
    frontArmor: 0,
    knockbackResistance: 0.85,
    weight: 3,
    unlockWave: 2,
    minDrop: 1,
    maxDrop: 2,
    healthDropChance: 0.02,
    scale: 0.85,
  },
  warden: {
    kind: 'warden',
    name: 'WARDEN',
    health: 38,
    speed: 4.9,
    radius: 0.5,
    bodyHeight: 0.72,
    bodyRadius: 0.48,
    headHeight: 1.42,
    headRadius: 0.3,
    contactDamage: 10,
    attackRange: 2.1,
    windupTime: 0.26,
    recoverTime: 0.34,
    attackCooldown: 0.85,
    score: 28,
    turnRate: 7,
    preferredRange: 0,
    projectileSpeed: 0,
    fireCooldown: 0,
    frontArmor: 0,
    knockbackResistance: 0.6,
    weight: 5,
    unlockWave: 1,
    minDrop: 1,
    maxDrop: 3,
    healthDropChance: 0.06,
    scale: 1.05,
  },
  seeker: {
    kind: 'seeker',
    name: 'SEEKER',
    health: 44,
    speed: 3.9,
    radius: 0.48,
    bodyHeight: 0.95,
    bodyRadius: 0.46,
    headHeight: 1.45,
    headRadius: 0.26,
    contactDamage: 8,
    attackRange: 15,
    windupTime: 0.6,
    recoverTime: 0.4,
    attackCooldown: 1.9,
    score: 46,
    turnRate: 3.4,
    preferredRange: 12,
    projectileSpeed: 27,
    fireCooldown: 1.9,
    frontArmor: 0,
    knockbackResistance: 0.75,
    weight: 4,
    unlockWave: 3,
    minDrop: 2,
    maxDrop: 4,
    healthDropChance: 0.14,
    scale: 1.0,
  },
  bulwark: {
    kind: 'bulwark',
    name: 'BULWARK',
    health: 230,
    speed: 2.35,
    radius: 0.95,
    bodyHeight: 1.05,
    bodyRadius: 0.92,
    headHeight: 1.98,
    headRadius: 0.42,
    contactDamage: 22,
    attackRange: 3.3,
    windupTime: 0.85,
    recoverTime: 0.7,
    attackCooldown: 2.1,
    score: 140,
    turnRate: 1.7,
    preferredRange: 0,
    projectileSpeed: 0,
    fireCooldown: 0,
    frontArmor: 0.45,
    knockbackResistance: 0.95,
    weight: 2,
    unlockWave: 5,
    minDrop: 4,
    maxDrop: 7,
    healthDropChance: 0.45,
    scale: 1.85,
  },
};

export const ENEMY_ORDER: readonly EnemyKind[] = ['shade', 'warden', 'seeker', 'bulwark'];
