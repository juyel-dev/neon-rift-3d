import type { Vec3 } from './vec';
import type { Box } from './collision';

export type GameStateName = 'title' | 'playing' | 'paused' | 'upgrade' | 'gameover';

export type EnemyKind = 'shade' | 'warden' | 'seeker' | 'bulwark';

export type EnemyAiState = 'spawn' | 'chase' | 'windup' | 'strike' | 'recover';

export type DamageKind = 'bullet' | 'melee' | 'projectile' | 'shockwave';

/** All mutable player attributes. Upgrades mutate this object. */
export interface PlayerStats {
  maxHealth: number;
  moveSpeed: number;
  sprintMultiplier: number;
  dashCooldown: number;
  dashDuration: number;
  dashSpeed: number;
  fireInterval: number;
  damage: number;
  critChance: number;
  critMultiplier: number;
  spread: number;
  magSize: number;
  reloadTime: number;
  reserveAmmo: number;
  overdriveCost: number;
  lifesteal: number;
  regenDelay: number;
  regenRate: number;
  dashShockwave: number;
  pickupBonus: number;
  damageReduction: number;
}

export interface InputState {
  /** Forward/right movement intent in local space, magnitude <= 1. */
  moveForward: number;
  moveRight: number;
  sprint: boolean;
  firing: boolean;
  dashQueued: boolean;
  reloadQueued: boolean;
  overdriveQueued: boolean;
  /** Look deltas (radians) accumulated since the last frame. */
  yawDelta: number;
  pitchDelta: number;
}

export function createInputState(): InputState {
  return {
    moveForward: 0,
    moveRight: 0,
    sprint: false,
    firing: false,
    dashQueued: false,
    reloadQueued: false,
    overdriveQueued: false,
    yawDelta: 0,
    pitchDelta: 0,
  };
}

/** Result of a hit-scan query against the world and the enemies. */
export interface HitScanResult {
  distance: number;
  point: Vec3;
  normal: Vec3;
  entityId: number | null;
  headshot: boolean;
}

export interface PickupSnapshot {
  id: number;
  kind: 'energy' | 'health';
  position: Vec3;
}

/** Snapshot handed to the renderer each frame for entity bookkeeping. */
export interface EnemySnapshot {
  id: number;
  kind: EnemyKind;
  position: Vec3;
  facing: number;
  health: number;
  maxHealth: number;
  state: EnemyAiState;
  /** 0..1 progress through the current windup, used for telegraphs. */
  charge: number;
  spawnProgress: number;
}

export const WORLD = {
  halfExtent: 36,
  wallHeight: 9,
  gravity: 22,
  playerRadius: 0.42,
  eyeHeight: 1.62,
  stepHeight: 0.7,
  maxPitch: 1.45,
} as const;

export type { Box };
