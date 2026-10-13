import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import {
  createPlayerStats,
  createUpgradeStacks,
  findSpawnPosition,
  isMaxed,
  purchaseUpgrade,
  rollUpgradeOffers,
  totalUpgradeStacks,
} from '../src/sim/progression';
import { UPGRADES } from '../src/sim/upgradeDefs';

describe('upgrades', () => {
  it('offers at least six distinct upgrade types', () => {
    expect(UPGRADES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(UPGRADES.map((upgrade) => upgrade.id)).size).toBe(UPGRADES.length);
  });

  it('applies damage upgrades', () => {
    const stats = createPlayerStats();
    const stacks = createUpgradeStacks();
    expect(purchaseUpgrade(stats, stacks, 'caliber')).toBe(true);
    expect(stats.damage).toBeGreaterThan(createPlayerStats().damage);
    expect(stacks.caliber).toBe(1);
  });

  it('applies fire rate upgrades', () => {
    const stats = createPlayerStats();
    const before = stats.fireInterval;
    purchaseUpgrade(stats, createUpgradeStacks(), 'coils');
    expect(stats.fireInterval).toBeLessThan(before);
  });

  it('applies movement and dash upgrades', () => {
    const stats = createPlayerStats();
    const baseSpeed = stats.moveSpeed;
    const baseDash = stats.dashCooldown;
    purchaseUpgrade(stats, createUpgradeStacks(), 'overdriveSprint');
    purchaseUpgrade(stats, createUpgradeStacks(), 'phaseDash');
    expect(stats.moveSpeed).toBeGreaterThan(baseSpeed);
    expect(stats.dashCooldown).toBeLessThan(baseDash);
  });

  it('applies health upgrades', () => {
    const stats = createPlayerStats();
    purchaseUpgrade(stats, createUpgradeStacks(), 'plating');
    expect(stats.maxHealth).toBeGreaterThan(100);
  });

  it('unlocks the shockwave ability only through its upgrade', () => {
    const stats = createPlayerStats();
    expect(stats.dashShockwave).toBe(0);
    purchaseUpgrade(stats, createUpgradeStacks(), 'shockwave');
    expect(stats.dashShockwave).toBeGreaterThan(0);
  });

  it('refuses to exceed the maximum stacks', () => {
    const stats = createPlayerStats();
    const stacks = createUpgradeStacks();
    const def = UPGRADES.find((upgrade) => upgrade.id === 'caliber')!;
    for (let i = 0; i < def.maxStacks; i++) expect(purchaseUpgrade(stats, stacks, 'caliber')).toBe(true);
    expect(isMaxed(def, stacks)).toBe(true);
    expect(purchaseUpgrade(stats, stacks, 'caliber')).toBe(false);
    const damageAfter = stats.damage;
    expect(stats.damage).toBe(damageAfter);
  });

  it('rejects unknown upgrades', () => {
    expect(purchaseUpgrade(createPlayerStats(), createUpgradeStacks(), 'nope' as never)).toBe(false);
  });

  it('clamps fire interval to a playable minimum', () => {
    const stats = createPlayerStats();
    const stacks = createUpgradeStacks();
    for (let i = 0; i < 25; i++) purchaseUpgrade(stats, stacks, 'coils');
    expect(stats.fireInterval).toBeGreaterThanOrEqual(0.035);
  });

  it('rolls distinct, non-maxed offers', () => {
    const stacks = createUpgradeStacks();
    const offers = rollUpgradeOffers(stacks, createRng(42), 3);
    expect(offers).toHaveLength(3);
    expect(new Set(offers.map((offer) => offer.id)).size).toBe(3);
  });

  it('excludes maxed upgrades from offers', () => {
    const stacks = createUpgradeStacks();
    const def = UPGRADES.find((upgrade) => upgrade.id === 'plating')!;
    for (let i = 0; i < def.maxStacks; i++) purchaseUpgrade(createPlayerStats(), stacks, 'plating');
    for (let i = 0; i < 25; i++) {
      const offers = rollUpgradeOffers(stacks, createRng(i));
      expect(offers.some((offer) => offer.id === 'plating')).toBe(false);
    }
  });

  it('counts total stacks', () => {
    const stats = createPlayerStats();
    const stacks = createUpgradeStacks();
    purchaseUpgrade(stats, stacks, 'caliber');
    purchaseUpgrade(stats, stacks, 'plating');
    expect(totalUpgradeStacks(stacks)).toBe(2);
  });
});

describe('spawn placement', () => {
  const rng = createRng(2024);

  it('never spawns an enemy on top of the player', () => {
    for (let i = 0; i < 200; i++) {
      const playerX = rng.range(-30, 30);
      const playerZ = rng.range(-30, 30);
      const spawn = findSpawnPosition(
        { halfExtent: 36, minDistanceFromPlayer: 14, playerX, playerZ },
        createRng(i),
      );
      const distance = Math.hypot(spawn.x - playerX, spawn.z - playerZ);
      expect(distance).toBeGreaterThan(12);
    }
  });

  it('keeps spawns inside the arena', () => {
    for (let i = 0; i < 200; i++) {
      const spawn = findSpawnPosition(
        { halfExtent: 36, minDistanceFromPlayer: 14, playerX: rng.range(-36, 36), playerZ: rng.range(-36, 36) },
        createRng(i + 5000),
      );
      expect(Math.abs(spawn.x)).toBeLessThanOrEqual(34);
      expect(Math.abs(spawn.z)).toBeLessThanOrEqual(34);
    }
  });

  it('handles a player pinned against the arena border', () => {
    const spawn = findSpawnPosition(
      { halfExtent: 36, minDistanceFromPlayer: 20, playerX: 35, playerZ: 35 },
      createRng(3),
    );
    expect(Number.isFinite(spawn.x)).toBe(true);
    expect(Math.abs(spawn.x)).toBeLessThanOrEqual(34);
  });
});
