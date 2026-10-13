import type { EnemyKind, GameStateName } from './types';
import type { Vec3 } from './vec';
import type { UpgradeId, UpgradeRarity } from './upgradeDefs';

export interface ShotEvent {
  type: 'shot';
  origin: Vec3;
  direction: Vec3;
  spread: number;
}

export interface ImpactEvent {
  type: 'impact';
  point: Vec3;
  normal: Vec3;
  surface: 'world' | 'enemy';
  damage: number;
  headshot: boolean;
  crit: boolean;
}

export interface EnemySpawnedEvent {
  type: 'enemySpawned';
  id: number;
  kind: EnemyKind;
  position: Vec3;
}

export interface EnemyDamagedEvent {
  type: 'enemyDamaged';
  id: number;
  kind: EnemyKind;
  position: Vec3;
  amount: number;
  crit: boolean;
}

export interface EnemyKilledEvent {
  type: 'enemyKilled';
  id: number;
  kind: EnemyKind;
  position: Vec3;
  points: number;
  combo: number;
  /** True when the kill was the last one of the wave. */
  waveFinal: boolean;
}

export interface EnemyAttackEvent {
  type: 'enemyAttack';
  id: number;
  kind: EnemyKind;
  position: Vec3;
  phase: 'windup' | 'strike' | 'fire';
}

export interface ProjectileFireEvent {
  type: 'projectileFired';
  origin: Vec3;
  direction: Vec3;
  damage: number;
}

export interface ProjectileImpactEvent {
  type: 'projectileImpact';
  point: Vec3;
  normal: Vec3;
  nearPlayer: boolean;
}

export interface PlayerDamagedEvent {
  type: 'playerDamaged';
  amount: number;
  health: number;
  /** Yaw (relative to the camera) of the attack, for the damage arc. */
  relativeYaw: number;
}

export interface PlayerHealedEvent {
  type: 'playerHealed';
  amount: number;
  health: number;
}

export interface PlayerDiedEvent {
  type: 'playerDied';
  score: number;
  wave: number;
  kills: number;
}

export interface PickupSpawnedEvent {
  type: 'pickupSpawned';
  id: number;
  kind: 'energy' | 'health';
  position: Vec3;
}

export interface PickupCollectedEvent {
  type: 'pickupCollected';
  kind: 'energy' | 'health';
  value: number;
  position: Vec3;
  energy: number;
  overdriveReady: boolean;
}

export interface WeaponEvent {
  type: 'reload' | 'dryFire' | 'dash' | 'overdriveStart' | 'overdriveEnd' | 'shockwave';
  position?: Vec3;
  radius?: number;
  shockwaveDamage?: number;
  streak?: number;
}

export interface WaveStartEvent {
  type: 'waveStart';
  wave: number;
  total: number;
  introTime: number;
}

export interface WaveClearedEvent {
  type: 'waveCleared';
  wave: number;
  bonus: number;
  nextWave: number;
}

export interface UpgradeOfferEvent {
  type: 'upgradeOffer';
  wave: number;
  offers: Array<{ id: UpgradeId; name: string; short: string; rarity: UpgradeRarity; stacks: number; maxStacks: number }>;
}

export interface UpgradeChosenEvent {
  type: 'upgradeChosen';
  id: UpgradeId;
  stacks: number;
  wave: number;
}

export interface StateEvent {
  type: 'state';
  state: GameStateName;
  previous: GameStateName | null;
}

export interface ScoreEvent {
  type: 'score';
  score: number;
  delta: number;
  combo: number;
  multiplier: number;
}

export type SimEvent =
  | ShotEvent
  | ImpactEvent
  | EnemySpawnedEvent
  | EnemyDamagedEvent
  | EnemyKilledEvent
  | EnemyAttackEvent
  | ProjectileFireEvent
  | ProjectileImpactEvent
  | PlayerDamagedEvent
  | PlayerHealedEvent
  | PlayerDiedEvent
  | PickupSpawnedEvent
  | PickupCollectedEvent
  | WeaponEvent
  | WaveStartEvent
  | WaveClearedEvent
  | UpgradeOfferEvent
  | UpgradeChosenEvent
  | StateEvent
  | ScoreEvent;
