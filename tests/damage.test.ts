import { describe, expect, it } from 'vitest';
import { bulletFalloff, computeDamage, yawToFace } from '../src/sim/damage';

describe('damage computation', () => {
  it('deals full base damage within the falloff range', () => {
    const outcome = computeDamage({ kind: 'bullet', base: 20, distance: 5 });
    expect(outcome.amount).toBe(20);
  });

  it('reduces damage with distance for bullets', () => {
    expect(computeDamage({ kind: 'bullet', base: 20, distance: 95 }).amount).toBeLessThan(
      computeDamage({ kind: 'bullet', base: 20, distance: 30 }).amount,
    );
  });

  it('never drops below the falloff floor', () => {
    expect(computeDamage({ kind: 'bullet', base: 20, distance: 500 }).amount).toBe(Math.round(20 * 0.5));
  });

  it('crits when the roll is below the crit chance', () => {
    const outcome = computeDamage({ kind: 'bullet', base: 10, critChance: 0.5, critMultiplier: 2, roll: 0.1 });
    expect(outcome.crit).toBe(true);
    expect(outcome.amount).toBe(20);
  });

  it('does not crit when the roll is above the crit chance', () => {
    const outcome = computeDamage({ kind: 'bullet', base: 10, critChance: 0.5, critMultiplier: 2, roll: 0.9 });
    expect(outcome.crit).toBe(false);
  });

  it('applies front armour when the attacker is in front of the target', () => {
    // Target faces +X (yaw such that forward is +X).
    const targetX = 0;
    const targetZ = 0;
    const targetFacing = -Math.PI / 2;
    const outcome = computeDamage({
      kind: 'bullet',
      base: 100,
      frontArmor: 0.45,
      targetX,
      targetZ,
      targetFacing,
      attackerX: 5,
      attackerZ: 0,
    });
    expect(outcome.armored).toBe(true);
    expect(outcome.amount).toBe(55);
  });

  it('applies the flanking bonus when attacking from behind', () => {
    const outcome = computeDamage({
      kind: 'bullet',
      base: 100,
      frontArmor: 0.45,
      targetX: 0,
      targetZ: 0,
      targetFacing: -Math.PI / 2,
      attackerX: -5,
      attackerZ: 0,
    });
    expect(outcome.flanked).toBe(true);
    expect(outcome.amount).toBe(135);
  });

  it('applies player damage reduction', () => {
    const outcome = computeDamage({ kind: 'melee', base: 20, reduction: 0.35 });
    expect(outcome.amount).toBe(13);
  });

  it('always deals at least one damage', () => {
    const outcome = computeDamage({ kind: 'melee', base: 1, reduction: 0.9 });
    expect(outcome.amount).toBeGreaterThanOrEqual(1);
  });

  it('ignores armour for lethal damage', () => {
    const outcome = computeDamage({
      kind: 'melee',
      base: 20,
      lethal: true,
      frontArmor: 0.9,
      targetX: 0,
      targetZ: 0,
      targetFacing: 0,
      attackerX: 0,
      attackerZ: -5,
    });
    expect(outcome.armored).toBe(false);
    expect(outcome.amount).toBe(20);
  });
});

describe('bullet falloff curve', () => {
  it('is one at point blank', () => {
    expect(bulletFalloff(0)).toBe(1);
  });

  it('is monotonically decreasing', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let distance = 0; distance <= 100; distance += 5) {
      const value = bulletFalloff(distance);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('facing helpers', () => {
  it('returns yaw 0 when the source is directly in front (-Z)', () => {
    const yaw = yawToFace({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -5 });
    expect(Math.abs(yaw)).toBeLessThan(1e-6);
  });

  it('returns a negative yaw when the source is to the right (+X)', () => {
    const yaw = yawToFace({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });
    expect(yaw).toBeCloseTo(-Math.PI / 2, 5);
  });
});
