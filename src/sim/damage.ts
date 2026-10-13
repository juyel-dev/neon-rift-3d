import type { DamageKind } from './types';
import type { Vec3 } from './vec';

export interface DamageContext {
  kind: DamageKind;
  base: number;
  /** Distance travelled by a bullet, used for falloff. Ignored otherwise. */
  distance?: number;
  attackerX?: number;
  attackerZ?: number;
  /** Facing (yaw) of the target, for flanking/front armour. */
  targetX?: number;
  targetZ?: number;
  targetFacing?: number;
  /** Damage reduction of the target (0..0.45). */
  reduction?: number;
  /** Fraction of damage taken when hit from the front (enemy armour). */
  frontArmor?: number;
  critChance?: number;
  critMultiplier?: number;
  /** Deterministic random value in [0,1) driving the crit roll. */
  roll?: number;
  /** Instantly fatal (e.g. falling into the void) - ignores armour. */
  lethal?: boolean;
}

export interface DamageOutcome {
  amount: number;
  crit: boolean;
  /** True when front armour absorbed part of the hit. */
  armored: boolean;
  /** True when the hit landed on the target's back. */
  flanked: boolean;
}

const FULL_DAMAGE_RANGE = 22;
const MAX_FALLOFF_RANGE = 95;
const MIN_FALLOFF = 0.5;
const FLANK_MIN_DOT = 0.45;
const FLANK_DAMAGE_MULTIPLIER = 1.35;

/** Distance based damage falloff for hitscan weapons. */
export function bulletFalloff(distance: number): number {
  if (distance <= FULL_DAMAGE_RANGE) return 1;
  if (distance >= MAX_FALLOFF_RANGE) return MIN_FALLOFF;
  const t = (distance - FULL_DAMAGE_RANGE) / (MAX_FALLOFF_RANGE - FULL_DAMAGE_RANGE);
  return 1 - (1 - MIN_FALLOFF) * t;
}

/**
 * Centralised damage computation: falloff, crits, front armour, flanking bonus
 * and target damage reduction. Pure and deterministic for a given `roll`.
 */
export function computeDamage(context: DamageContext): DamageOutcome {
  let amount = context.base;

  if (context.kind === 'bullet' && context.distance !== undefined) {
    amount *= bulletFalloff(context.distance);
  }

  let crit = false;
  const critChance = context.critChance ?? 0;
  if (critChance > 0) {
    const roll = context.roll ?? 0;
    if (roll < critChance) {
      crit = true;
      amount *= context.critMultiplier ?? 2;
    }
  }

  let armored = false;
  let flanked = false;
  if (!context.lethal) {
    const armor = context.frontArmor ?? 0;
    if (armor > 0 && context.attackerX !== undefined && context.attackerZ !== undefined && context.targetFacing !== undefined) {
      // Vector from the target towards the attacker, compared against the
      // target's facing. Convention: yaw 0 looks towards -Z.
      const dx = context.attackerX - (context.targetX ?? 0);
      const dz = context.attackerZ - (context.targetZ ?? 0);
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) {
        const fx = -Math.sin(context.targetFacing);
        const fz = -Math.cos(context.targetFacing);
        const dot = (dx / len) * fx + (dz / len) * fz;
        if (dot <= -FLANK_MIN_DOT) {
          flanked = true;
          amount *= FLANK_DAMAGE_MULTIPLIER;
        } else if (dot >= FLANK_MIN_DOT) {
          armored = true;
          amount *= 1 - armor;
        }
      }
    }

    const reduction = context.reduction ?? 0;
    if (reduction > 0) amount *= 1 - Math.min(0.9, reduction);
  }

  return {
    amount: Math.max(1, Math.round(amount)),
    crit,
    armored,
    flanked,
  };
}

export interface HealthResult {
  health: number;
  died: boolean;
}

export function applyDamage(health: number, amount: number): HealthResult {
  const next = health - amount;
  return { health: next, died: next <= 0 };
}

export function applyHealing(health: number, maxHealth: number, amount: number): number {
  return Math.min(maxHealth, health + Math.max(0, amount));
}

/**
 * Yaw (in radians) that an entity at `target` needs to face in order to look
 * towards `source`. Convention: yaw 0 looks towards -Z.
 */
export function yawToFace(target: Vec3, source: Vec3): number {
  return Math.atan2(-(source.x - target.x), -(source.z - target.z));
}
