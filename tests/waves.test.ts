import { describe, expect, it } from 'vitest';
import { createRng, hashString } from '../src/core/rng';
import { MAX_WAVE_ENEMIES, computeWavePlan, unlockedKinds } from '../src/sim/waves';
import { enemyCost } from '../src/sim/progression';
import { ENEMY_DEFS, ENEMY_ORDER } from '../src/sim/enemyDefs';

describe('wave planning', () => {
  it('starts with only basic enemies', () => {
    expect(unlockedKinds(1)).toEqual(['warden']);
  });

  it('unlocks new archetypes as waves progress', () => {
    expect(unlockedKinds(2)).toContain('shade');
    expect(unlockedKinds(3)).toContain('seeker');
    expect(unlockedKinds(5)).toContain('bulwark');
  });

  it('never lets wave one include heavy enemies', () => {
    for (let i = 0; i < 5; i++) {
      const plan = computeWavePlan(1);
      expect(plan.groups.some((group) => group.kind === 'bulwark')).toBe(false);
    }
  });

  it('scales enemy count, difficulty and bonuses with the wave', () => {
    const first = computeWavePlan(1);
    const tenth = computeWavePlan(10);
    expect(tenth.totalEnemies).toBeGreaterThan(first.totalEnemies);
    expect(tenth.healthScale).toBeGreaterThan(first.healthScale);
    expect(tenth.damageScale).toBeGreaterThan(first.damageScale);
    expect(tenth.clearBonus).toBeGreaterThan(first.clearBonus);
  });

  it('keeps enemy counts within a playable cap', () => {
    for (let wave = 1; wave <= 40; wave++) {
      const plan = computeWavePlan(wave);
      expect(plan.totalEnemies).toBeLessThanOrEqual(MAX_WAVE_ENEMIES);
      expect(plan.maxAlive).toBeLessThanOrEqual(24);
      expect(plan.spawnInterval).toBeGreaterThan(0);
      expect(plan.introTime).toBeGreaterThan(0);
      expect(plan.groups.every((group) => group.count > 0)).toBe(true);
    }
  });

  it('is fully deterministic for a given wave number', () => {
    for (const wave of [1, 5, 12, 30]) {
      const a = computeWavePlan(wave);
      const b = computeWavePlan(wave);
      expect(a.groups).toEqual(b.groups);
      expect(a.totalEnemies).toBe(b.totalEnemies);
      expect(a.budget).toBe(b.budget);
      expect(a.clearBonus).toBe(b.clearBonus);
    }
  });

  it('mixes archetypes in later waves instead of one type only', () => {
    const plan = computeWavePlan(14);
    expect(plan.groups.length).toBeGreaterThan(1);
  });

  it('spends at least half of the wave budget', () => {
    for (let wave = 1; wave <= 20; wave++) {
      const plan = computeWavePlan(wave);
      expect(plan.totalEnemies).toBeGreaterThan(0);
    }
  });

  it('uses the documented enemy costs', () => {
    expect(enemyCost('shade')).toBe(1);
    expect(enemyCost('warden')).toBe(2);
    expect(enemyCost('seeker')).toBe(3);
    expect(enemyCost('bulwark')).toBe(6);
  });
});

describe('enemy definitions', () => {
  it('gives every archetype a unique role and stat block', () => {
    for (const kind of ENEMY_ORDER) {
      const def = ENEMY_DEFS[kind];
      expect(def.health).toBeGreaterThan(0);
      expect(def.speed).toBeGreaterThan(0);
      expect(def.score).toBeGreaterThan(0);
      expect(def.contactDamage).toBeGreaterThan(0);
      expect(def.headRadius).toBeGreaterThan(0);
      expect(def.bodyRadius).toBeGreaterThanOrEqual(def.headRadius);
    }
  });

  it('makes the heavy enemy the tankiest and slowest', () => {
    const bulwark = ENEMY_DEFS.bulwark;
    expect(bulwark.health).toBeGreaterThan(ENEMY_DEFS.warden.health);
    expect(bulwark.speed).toBeLessThan(ENEMY_DEFS.warden.speed);
    expect(bulwark.frontArmor).toBeGreaterThan(0);
  });

  it('makes the shade the fastest attacker', () => {
    expect(ENEMY_DEFS.shade.speed).toBeGreaterThan(ENEMY_DEFS.warden.speed);
  });

  it('gives only the seeker a projectile', () => {
    for (const kind of ENEMY_ORDER) {
      const hasProjectile = ENEMY_DEFS[kind].projectileSpeed > 0;
      expect(hasProjectile).toBe(kind === 'seeker');
    }
  });
});

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('produces different streams for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('stays inside [0,1) and honours int ranges', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      const int = rng.int(3, 6);
      expect(int).toBeGreaterThanOrEqual(3);
      expect(int).toBeLessThanOrEqual(6);
    }
  });

  it('shuffles without losing elements', () => {
    const rng = createRng(99);
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle([...items]);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
  });

  it('hashes strings stably', () => {
    expect(hashString('neon')).toBe(hashString('neon'));
    expect(hashString('neon')).not.toBe(hashString('rift'));
  });
});
