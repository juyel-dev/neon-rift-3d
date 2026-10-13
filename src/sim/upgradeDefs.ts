import type { PlayerStats } from './types';

export type UpgradeId =
  | 'caliber'
  | 'coils'
  | 'magazine'
  | 'plating'
  | 'phaseDash'
  | 'overdriveSprint'
  | 'vampiric'
  | 'shockwave'
  | 'optics'
  | 'recycler';

export type UpgradeRarity = 'common' | 'rare' | 'epic';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  short: string;
  rarity: UpgradeRarity;
  maxStacks: number;
  /** Relative chance to appear in an offer roll. */
  weight: number;
  /** Applied once per purchase. */
  apply: (stats: PlayerStats) => void;
}

export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'caliber',
    name: 'HIGH-CALIBER ROUNDS',
    short: '+18% weapon damage',
    rarity: 'common',
    maxStacks: 5,
    weight: 10,
    apply: (stats) => {
      stats.damage *= 1.18;
    },
  },
  {
    id: 'coils',
    name: 'RAPID COILS',
    short: '+15% fire rate',
    rarity: 'common',
    maxStacks: 5,
    weight: 10,
    apply: (stats) => {
      stats.fireInterval *= 0.87;
    },
  },
  {
    id: 'magazine',
    name: 'EXTENDED MAGAZINE',
    short: '+6 rounds per magazine',
    rarity: 'common',
    maxStacks: 5,
    weight: 8,
    apply: (stats) => {
      stats.magSize += 6;
    },
  },
  {
    id: 'plating',
    name: 'KINETIC PLATING',
    short: '+25 max shield, heals 25',
    rarity: 'rare',
    maxStacks: 5,
    weight: 8,
    apply: (stats) => {
      stats.maxHealth += 25;
      stats.damageReduction = Math.min(0.45, stats.damageReduction + 0.03);
    },
  },
  {
    id: 'phaseDash',
    name: 'PHASE DASH',
    short: '-30% dash cooldown',
    rarity: 'rare',
    maxStacks: 4,
    weight: 8,
    apply: (stats) => {
      stats.dashCooldown *= 0.7;
    },
  },
  {
    id: 'overdriveSprint',
    name: 'OVERDRIVE SERVOS',
    short: '+10% movement speed',
    rarity: 'common',
    maxStacks: 4,
    weight: 8,
    apply: (stats) => {
      stats.moveSpeed *= 1.1;
    },
  },
  {
    id: 'vampiric',
    name: 'VAMPIRIC CORE',
    short: 'Kills restore 4 shield',
    rarity: 'rare',
    maxStacks: 3,
    weight: 6,
    apply: (stats) => {
      stats.lifesteal += 4;
    },
  },
  {
    id: 'shockwave',
    name: 'DETONATOR DASH',
    short: 'Dash triggers a 55 damage shockwave',
    rarity: 'epic',
    maxStacks: 3,
    weight: 5,
    apply: (stats) => {
      stats.dashShockwave += 55;
    },
  },
  {
    id: 'optics',
    name: 'PRECISION OPTICS',
    short: '+12% crit chance, tighter spread',
    rarity: 'rare',
    maxStacks: 3,
    weight: 6,
    apply: (stats) => {
      stats.critChance += 0.12;
      stats.spread *= 0.75;
    },
  },
  {
    id: 'recycler',
    name: 'FLUX RECYCLER',
    short: 'Pickups yield +50% energy and ammo',
    rarity: 'common',
    maxStacks: 2,
    weight: 6,
    apply: (stats) => {
      stats.pickupBonus += 0.5;
      stats.reserveAmmo += 60;
      stats.overdriveCost = Math.max(60, stats.overdriveCost - 10);
    },
  },
];

export const UPGRADE_MAP: Record<UpgradeId, UpgradeDef> = UPGRADES.reduce(
  (map, upgrade) => {
    map[upgrade.id] = upgrade;
    return map;
  },
  {} as Record<UpgradeId, UpgradeDef>,
);
