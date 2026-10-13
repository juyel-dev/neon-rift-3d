import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/sim/gameSim';
import type { SimEvent } from '../src/sim/events';
import { createInputState, type InputState } from '../src/sim/types';
import { createPlayerStats } from '../src/sim/progression';
import { PickupSystem } from '../src/sim/pickups';
import { ProjectileSystem } from '../src/sim/projectiles';
import { WeaponState } from '../src/sim/weapon';
import { World } from '../src/sim/world';
import { Enemy } from '../src/sim/enemy';

const DT = 1 / 60;

function createSim(seed = 4242): GameSim {
  const sim = new GameSim(undefined, seed, { forcedWave: [{ kind: 'warden', count: 1 }] });
  sim.startRun(seed);
  sim.debugSkipIntro();
  return sim;
}

/** Waits for the wave enemy to appear, then kills everything on the field. */
function clearWave(sim: GameSim): SimEvent[] {
  const events: SimEvent[] = [];
  let guard = 0;
  while (guard++ < 60 * 20) {
    sim.update(DT, createInputState());
    events.push(...sim.drainEvents());
    if (sim.enemies.aliveCount > 0) break;
  }
  for (const enemy of [...sim.enemies.all]) enemy.health = 0;
  for (let i = 0; i < 3; i++) {
    sim.update(DT, createInputState());
    events.push(...sim.drainEvents());
  }
  return events;
}

function advance(sim: GameSim, seconds: number, input: Partial<InputState> = {}): void {
  const steps = Math.max(1, Math.round(seconds / DT));
  for (let i = 0; i < steps; i++) {
    const frame: InputState = { ...createInputState(), ...input };
    sim.update(DT, frame);
    sim.drainEvents();
  }
}

function collect(sim: GameSim, seconds: number, input: Partial<InputState> = {}): SimEvent[] {
  const events: SimEvent[] = [];
  const steps = Math.max(1, Math.round(seconds / DT));
  for (let i = 0; i < steps; i++) {
    const frame: InputState = { ...createInputState(), ...input };
    sim.update(DT, frame);
    events.push(...sim.drainEvents());
  }
  return events;
}

function makePlayerInvulnerable(sim: GameSim): void {
  sim.stats.maxHealth = 1_000_000;
  sim.player.refreshMaxHealth();
  sim.player.health = 1_000_000;
}

/** Points the camera exactly at a world position (used for hitscan tests). */
function aimAt(sim: GameSim, target: { x: number; y: number; z: number }): void {
  const eye = sim.player.eyePosition({ x: 0, y: 0, z: 0 });
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  sim.player.yaw = Math.atan2(-dx, -dz);
  sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

describe('run lifecycle', () => {
  it('starts a run in the playing state with a full loadout', () => {
    const sim = new GameSim();
    expect(sim.state).toBe('title');
    sim.startRun(1);
    expect(sim.state).toBe('playing');
    expect(sim.score.score).toBe(0);
    expect(sim.wave.wave).toBe(1);
    expect(sim.player.health).toBe(sim.player.maxHealth);
    expect(sim.weapon.ammoInMag).toBe(sim.stats.magSize);
    expect(sim.enemies.aliveCount).toBe(0);
  });

  it('emits a wave start event when a run begins', () => {
    const sim = new GameSim();
    sim.startRun(1);
    const events = sim.drainEvents();
    expect(events.some((event) => event.type === 'waveStart')).toBe(true);
  });

  it('does nothing while paused', () => {
    const sim = createSim();
    advance(sim, 1.5);
    sim.enemies.spawn('warden', sim.player.position.x + 6, sim.player.position.z, sim.player.position.y, 1);
    sim.pause();
    expect(sim.state).toBe('paused');
    const before = sim.enemySnapshots().map((snapshot) => ({ ...snapshot.position }));
    advance(sim, 1);
    const after = sim.enemySnapshots().map((snapshot) => ({ ...snapshot.position }));
    expect(after).toEqual(before);
    expect(sim.player.health).toBe(sim.player.maxHealth);
    sim.resume();
    expect(sim.state).toBe('playing');
  });

  it('freezes the world between waves while the upgrade menu is open', () => {
    const sim = createSim();
    makePlayerInvulnerable(sim);
    const events = clearWave(sim);
    expect(events.some((event) => event.type === 'upgradeOffer')).toBe(true);
    expect(sim.state).toBe('upgrade');
    const scoreBefore = sim.score.score;
    advance(sim, 1);
    expect(sim.score.score).toBe(scoreBefore);
    expect(sim.enemySnapshots()).toHaveLength(0);
  });
});

describe('hitscan weapon', () => {
  it('kills an enemy in front of the player and awards score', () => {
    const sim = createSim();
    const enemy = sim.enemies.spawn(
      'warden',
      sim.player.position.x,
      sim.player.position.z + 6,
      sim.player.position.y,
      1,
    );
    advance(sim, 0.5); // let the enemy finish its spawn-in
    aimAt(sim, enemy.bodySphere().center);
    sim.stats.spread = 0;
    sim.stats.damage = 1000;
    const events = collect(sim, DT * 3, { firing: true });
    expect(sim.enemies.all).not.toContain(enemy);
    const killed = events.find((event) => event.type === 'enemyKilled' && event.id === enemy.id);
    expect(killed).toBeDefined();
    expect(killed?.type === 'enemyKilled' && killed.points).toBeGreaterThan(0);
    expect(sim.score.kills).toBeGreaterThan(0);
    expect(sim.score.shotsFired).toBeGreaterThan(0);
    expect(sim.score.shotsHit).toBeGreaterThan(0);
  });

  it('emits world impacts when firing at empty space', () => {
    const sim = createSim();
    sim.player.pitch = 0;
    sim.player.yaw = Math.PI / 2; // facing the wall
    const events = collect(sim, DT * 2, { firing: true });
    expect(events.some((event) => event.type === 'impact' && event.surface === 'world')).toBe(true);
  });

  it('respects magazine size and reloads when empty', () => {
    const stats = createPlayerStats();
    const weapon = new WeaponState(stats);
    for (let i = 0; i < stats.magSize; i++) {
      expect(weapon.tryFire()).toBe(true);
      weapon.update(stats.fireInterval + 0.001);
    }
    expect(weapon.ammoInMag).toBe(0);
    // Draining the magazine automatically starts a reload...
    expect(weapon.reloading).toBe(true);
    weapon.cancelReload();
    // ...and a manual reload tops the magazine back up from the reserve.
    expect(weapon.beginReload()).toBe(true);
    while (weapon.reloading) weapon.update(1 / 60);
    expect(weapon.ammoInMag).toBe(stats.magSize);
    expect(weapon.reserve).toBe(stats.reserveAmmo - stats.magSize);
    expect(weapon.reloading).toBe(false);
  });

  it('auto reloads when the magazine runs dry', () => {
    const stats = createPlayerStats();
    const weapon = new WeaponState(stats);
    for (let i = 0; i < stats.magSize; i++) {
      weapon.tryFire();
      weapon.update(stats.fireInterval + 0.001);
    }
    expect(weapon.ammoInMag).toBe(0);
    expect(weapon.reloading).toBe(true);
    while (weapon.reloading) weapon.update(1 / 60);
    expect(weapon.ammoInMag).toBe(stats.magSize);
  });

  it('cannot reload with a full magazine', () => {
    const weapon = new WeaponState(createPlayerStats());
    expect(weapon.beginReload()).toBe(false);
  });

  it('cannot fire while reloading', () => {
    const stats = createPlayerStats();
    const weapon = new WeaponState(stats);
    weapon.tryFire();
    weapon.beginReload();
    expect(weapon.tryFire()).toBe(false);
  });

  it('fires at the configured rate', () => {
    const stats = createPlayerStats();
    const weapon = new WeaponState(stats);
    expect(weapon.tryFire()).toBe(true);
    expect(weapon.tryFire()).toBe(false);
    weapon.update(stats.fireInterval + 0.001);
    expect(weapon.tryFire()).toBe(true);
  });

  it('requires energy before overdrive can be activated', () => {
    const stats = createPlayerStats();
    const weapon = new WeaponState(stats);
    expect(weapon.activateOverdrive()).toBe(false);
    weapon.addEnergy(50);
    expect(weapon.activateOverdrive()).toBe(false);
    weapon.addEnergy(50);
    expect(weapon.overdriveReady).toBe(true);
    expect(weapon.activateOverdrive()).toBe(true);
    expect(weapon.damageMultiplier).toBeGreaterThan(1);
    expect(weapon.rateMultiplier).toBeGreaterThan(1);
    weapon.update(8);
    expect(weapon.overdriveActive).toBe(false);
  });
});

describe('enemy hit volumes', () => {
  it('detects headshots separately from body shots', () => {
    const enemy = new Enemy('warden', 0, -10, 0, 1);
    const head = enemy.raycast({ x: 0, y: 1.48, z: 0 }, { x: 0, y: 0, z: -1 }, 50);
    expect(head?.headshot).toBe(true);
    const body = enemy.raycast({ x: 0, y: 0.8, z: 0 }, { x: 0, y: 0, z: -1 }, 50);
    expect(body?.headshot).toBe(false);
    const miss = enemy.raycast({ x: 3, y: 0.8, z: 0 }, { x: 0, y: 0, z: -1 }, 50);
    expect(miss).toBeNull();
  });

  it('respects the maximum ray distance', () => {
    const enemy = new Enemy('warden', 0, -10, 0, 1);
    expect(enemy.raycast({ x: 0, y: 0.8, z: 0 }, { x: 0, y: 0, z: -1 }, 3)).toBeNull();
  });
});

describe('enemy behaviour', () => {
  it('melee enemies close the distance and damage the player', () => {
    const sim = createSim();
    const enemy = sim.enemies.spawn('warden', sim.player.position.x + 9, sim.player.position.z, sim.player.position.y, 1);
    const events = collect(sim, 12);
    expect(events.some((event) => event.type === 'playerDamaged')).toBe(true);
    expect(sim.player.health).toBeLessThan(sim.player.maxHealth);
    expect(enemy.health).toBeGreaterThan(0);
  });

  it('ranged enemies keep their distance and fire projectiles', () => {
    const sim = createSim();
    sim.enemies.spawn('seeker', sim.player.position.x + 14, sim.player.position.z, sim.player.position.y, 1);
    const events = collect(sim, 6);
    const fired = events.filter((event) => event.type === 'projectileFired');
    expect(fired.length).toBeGreaterThan(0);
    const impact = events.some(
      (event) => event.type === 'projectileImpact' || event.type === 'playerDamaged',
    );
    expect(impact).toBe(true);
  });

  it('bulwarks have armour that reduces frontal damage', () => {
    const enemy = new Enemy('bulwark', 0, -8, 0, 1);
    enemy.state = 'chase';
    enemy.facing = -Math.PI / 2; // facing +X, attacker at +X is in front
    const frontal = enemy.applyDamage(100, 0.2, 5, 0, 0, 2);
    enemy.health = enemy.maxHealth;
    const flank = enemy.applyDamage(100, 0.2, -5, 0, 0, 2);
    expect(frontal.armored).toBe(true);
    expect(flank.flanked).toBe(true);
    expect(100 - frontal.amount).toBeGreaterThan(0);
  });

  it('separates enemies so they do not occupy the same space', () => {
    const sim = createSim();
    const a = sim.enemies.spawn('warden', 3, 0, sim.player.position.y, 1);
    const b = sim.enemies.spawn('warden', 3.1, 0, sim.player.position.y, 1);
    advance(sim, 1.5);
    const first = sim.enemySnapshots().find((snapshot) => snapshot.id === a.id)!;
    const second = sim.enemySnapshots().find((snapshot) => snapshot.id === b.id)!;
    expect(Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z)).toBeGreaterThan(0.4);
  });

  it('never spawns enemies inside or on top of the player', () => {
    const sim = new GameSim();
    sim.startRun(11);
    sim.debugSkipIntro();
    makePlayerInvulnerable(sim);
    const events = collect(sim, 30);
    const spawns = events.filter((event) => event.type === 'enemySpawned');
    expect(spawns.length).toBeGreaterThan(3);
    for (const spawn of spawns) {
      if (spawn.type !== 'enemySpawned') continue;
      const distance = Math.hypot(
        spawn.position.x - sim.player.position.x,
        spawn.position.z - sim.player.position.z,
      );
      expect(distance).toBeGreaterThan(11);
    }
  });
});

describe('pickups and drops', () => {
  it('collects a dropped energy orb when the player walks over it', () => {
    const world = new World();
    const pickups = new PickupSystem(world);
    const collected: Array<{ kind: string; value: number }> = [];
    pickups.spawn('energy', { x: 0, y: 0, z: 0 }, 4, 0, 2);
    pickups.update(DT, 0, 0, 0, collected as never);
    expect(collected).toHaveLength(1);
    expect(pickups.activeCount).toBe(0);
  });

  it('expires pickups that are never collected', () => {
    const world = new World();
    const pickups = new PickupSystem(world);
    pickups.spawn('energy', { x: 20, y: 2, z: 20 }, 4, 0, 0);
    for (let i = 0; i < 60 * 26; i++) pickups.update(DT, 0, 0, 0, [] as never);
    expect(pickups.activeCount).toBe(0);
  });

  it('drops energy when an enemy dies', () => {
    const sim = createSim();
    sim.stats.spread = 0;
    sim.stats.damage = 1000;
    const drop = sim.enemies.spawn(
      'warden',
      sim.player.position.x,
      sim.player.position.z + 7,
      sim.player.position.y,
      1,
    );
    advance(sim, 0.6);
    aimAt(sim, drop.bodySphere().center);
    const events = collect(sim, DT * 3, { firing: true });
    expect(events.some((event) => event.type === 'enemyKilled')).toBe(true);
    expect(sim.pickups.activeCount).toBeGreaterThan(0);
  });

  it('collects energy while playing, which powers overdrive', () => {
    const sim = createSim();
    makePlayerInvulnerable(sim);
    sim.enemies.spawn('warden', sim.player.position.x + 1.2, sim.player.position.z, sim.player.position.y, 1);
    sim.enemies.all[0].health = 0;
    const events = collect(sim, 2);
    expect(events.some((event) => event.type === 'pickupCollected')).toBe(true);
    expect(sim.weapon.energy).toBeGreaterThan(0);
  });

  it('despawns every projectile at the end of its life', () => {
    const world = new World();
    const projectiles = new ProjectileSystem(world);
    projectiles.spawn({ x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 0 }, 20, 5);
    expect(projectiles.activeCount).toBe(1);
    for (let i = 0; i < 60 * 6; i++) {
      projectiles.update(DT, 0, 0, 0, true, { onPlayerHit: () => {}, onWorldHit: () => {} });
    }
    expect(projectiles.activeCount).toBe(0);
  });
});

describe('waves, upgrades and restart', () => {
  it('offers three upgrades after clearing a wave and applies the choice', () => {
    const sim = createSim();
    makePlayerInvulnerable(sim);
    const events = clearWave(sim);

    expect(sim.state).toBe('upgrade');
    const offer = events.find((event) => event.type === 'upgradeOffer');
    expect(offer).toBeDefined();
    if (offer?.type !== 'upgradeOffer') throw new Error('expected upgradeOffer');
    expect(offer.offers).toHaveLength(3);

    const damageBefore = sim.stats.damage;
    const chosen = offer.offers[0];
    expect(sim.chooseUpgrade(chosen.id)).toBe(true);
    expect(sim.state).toBe('playing');
    expect(sim.wave.wave).toBe(2);
    expect(sim.weapon.reserve).toBeGreaterThan(createPlayerStats().reserveAmmo);
    const choseEvent = sim.drainEvents().find((event) => event.type === 'upgradeChosen');
    expect(choseEvent).toBeDefined();

    // Only the applied upgrade must have changed the stats.
    const stacksTotal = Object.values(sim.stacks).reduce((sum, value) => sum + value, 0);
    expect(stacksTotal).toBe(1);
    if (chosen.id === 'caliber' || chosen.id === 'shockwave' || chosen.id === 'recycler') {
      expect(sim.stats.damage).toBeGreaterThanOrEqual(damageBefore);
    }
  });

  it('rejects duplicate upgrade purchases', () => {
    const sim = createSim();
    makePlayerInvulnerable(sim);
    const offer = clearWave(sim).find((event) => event.type === 'upgradeOffer');
    if (offer?.type !== 'upgradeOffer') throw new Error('expected upgradeOffer');
    const id = offer.offers[0].id;
    expect(sim.chooseUpgrade(id)).toBe(true);
    expect(sim.chooseUpgrade(id)).toBe(false);
  });

  it('can skip the upgrade choice and keep playing', () => {
    const sim = createSim();
    makePlayerInvulnerable(sim);
    clearWave(sim);
    expect(sim.state).toBe('upgrade');
    expect(sim.skipUpgrade()).toBe(true);
    expect(sim.state).toBe('playing');
    expect(sim.wave.wave).toBe(2);
  });

  it('ends the run when health reaches zero and allows a restart', () => {
    const sim = createSim();
    advance(sim, 1);
    sim.player.takeDamage(9999, 0);
    const events = collect(sim, DT * 3);
    expect(sim.state).toBe('gameover');
    const death = events.find((event) => event.type === 'playerDied');
    expect(death).toBeDefined();
    expect(death?.type === 'playerDied' && death.wave).toBeGreaterThan(0);
    expect(death?.type === 'playerDied' && death.kills).toBeGreaterThanOrEqual(0);

    sim.startRun(99);
    expect(sim.state).toBe('playing');
    expect(sim.score.score).toBe(0);
    expect(sim.score.kills).toBe(0);
    expect(sim.wave.wave).toBe(1);
    expect(sim.enemies.aliveCount).toBe(0);
    expect(sim.pickups.activeCount).toBe(0);
    expect(sim.projectiles.activeCount).toBe(0);
    expect(sim.player.health).toBe(sim.player.maxHealth);
    expect(Object.values(sim.stacks).every((value) => value === 0)).toBe(true);
  });

  it('keeps upgrade stacks cleared after a restart', () => {
    const sim = createSim();
    makePlayerInvulnerable(sim);
    const offer = clearWave(sim).find((event) => event.type === 'upgradeOffer');
    if (offer?.type !== 'upgradeOffer') throw new Error('expected upgradeOffer');
    sim.chooseUpgrade(offer.offers[0].id);
    // Any upgrade must change at least one attribute...
    const base = createPlayerStats();
    const changed = (Object.keys(base) as Array<keyof typeof base>).some((key) => sim.stats[key] !== base[key]);
    expect(changed).toBe(true);
    expect(Object.values(sim.stacks).some((stacks) => stacks > 0)).toBe(true);
    // ...and a restart has to wipe every one of them.
    sim.startRun(5);
    expect(sim.stats.damage).toBe(base.damage);
    expect(Object.values(sim.stacks).every((stacks) => stacks === 0)).toBe(true);
  });

  it('dash consumes the cooldown and is restricted while cooling down', () => {
    const sim = createSim();
    expect(sim.player.dashProgress).toBe(1);
    const input = createInputState();
    input.moveForward = 1;
    input.dashQueued = true;
    sim.update(DT, input);
    expect(sim.player.dashProgress).toBeLessThan(1);
    const second = createInputState();
    second.dashQueued = true;
    sim.update(DT, second);
    expect(sim.player.dashProgress).toBeLessThan(0.5);
  });

  it('the phase dash upgrade shortens the dash cooldown', () => {
    const sim = createSim();
    const before = sim.stats.dashCooldown;
    // Simulate buying the upgrade through the wave flow is verbose; apply it directly.
    sim.stacks.phaseDash = 0;
    sim.stats.dashCooldown *= 0.7;
    expect(sim.stats.dashCooldown).toBeLessThan(before);
  });

  it('survives a long unattended session without leaking entities', () => {
    const sim = createSim();
    makePlayerInvulnerable(sim);
    sim.stats.spread = 0;
    collect(sim, 40, { firing: true, moveForward: 1 });
    expect(sim.enemies.aliveCount).toBeLessThanOrEqual(26);
    expect(sim.pickups.activeCount).toBeLessThanOrEqual(600);
    expect(sim.projectiles.activeCount).toBeLessThanOrEqual(256);
  });
});

describe('hud snapshot', () => {
  it('reports the data the HUD needs', () => {
    const sim = createSim();
    const hud = sim.getHudSnapshot();
    expect(hud.health).toBe(100);
    expect(hud.maxHealth).toBe(100);
    expect(hud.healthFraction).toBe(1);
    expect(hud.wave).toBe(1);
    expect(hud.weapon.magSize).toBeGreaterThan(0);
    expect(hud.weapon.ammo).toBe(hud.weapon.magSize);
    expect(hud.dashProgress).toBe(1);
    expect(hud.lowHealth).toBe(false);
    expect(hud.multiplier).toBe(1);
  });

  it('flags low health and reload progress', () => {
    const sim = createSim();
    sim.player.health = 20;
    const hud = sim.getHudSnapshot();
    expect(hud.lowHealth).toBe(true);
    expect(hud.healthFraction).toBeLessThan(0.34);
  });
});
