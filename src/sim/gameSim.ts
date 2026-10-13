import { clamp } from '../core/math';
import { createRng, type Rng } from '../core/rng';
import { StateMachine, type TransitionTable } from '../core/stateMachine';
import {
  computeWavePlan,
  type WaveGroup,
  type WavePlan,
} from './waves';
import { ENEMY_DEFS } from './enemyDefs';
import type { Enemy } from './enemy';
import { EnemyManager } from './enemyManager';
import { PickupSystem } from './pickups';
import { PlayerState } from './player';
import {
  createPlayerStats,
  createUpgradeStacks,
  findSpawnPosition,
  purchaseUpgrade,
  rollUpgradeOffers,
  PLAYER_SPAWN,
  type UpgradeStacks,
} from './progression';
import { ProjectileSystem } from './projectiles';
import {
  accuracy,
  comboMultiplier,
  createScoreTracker,
  registerKill,
  registerPickup,
  registerPlayerDamage,
  registerShot,
  tickCombo,
  type ScoreTracker,
} from './score';
import { WeaponState } from './weapon';
import { World } from './world';
import {
  createInputState,
  WORLD,
  type EnemyKind,
  type GameStateName,
  type InputState,
  type PlayerStats,
} from './types';
import type { Vec3 } from './vec';
import type { SimEvent } from './events';
import type { UpgradeDef, UpgradeId } from './upgradeDefs';

export const TRANSITIONS: TransitionTable<GameStateName> = {
  title: ['playing'],
  playing: ['paused', 'upgrade', 'gameover'],
  paused: ['playing', 'title'],
  upgrade: ['playing'],
  gameover: ['playing', 'title'],
};

export type WavePhase = 'intro' | 'active' | 'cleared';

export interface GameSimOptions {
  /**
   * Fixed composition used for every wave. Intended for tests and balancing so a
   * scenario can be replayed deterministically.
   */
  forcedWave?: WaveGroup[];
}

export interface HUDWeaponState {
  ammo: number;
  magSize: number;
  reserve: number;
  reloading: boolean;
  reloadProgress: number;
  overdriveActive: boolean;
  overdriveProgress: number;
  overdriveEnergy: number;
  overdriveReady: boolean;
  dry: boolean;
}

export interface HudSnapshot {
  health: number;
  maxHealth: number;
  healthFraction: number;
  score: number;
  wave: number;
  enemiesAlive: number;
  enemiesRemaining: number;
  combo: number;
  multiplier: number;
  accuracy: number;
  kills: number;
  dashProgress: number;
  weapon: HUDWeaponState;
  bestScore: number;
  elapsed: number;
  lowHealth: boolean;
}

const ENERGY_ORB_VALUE = 4;
const ENERGY_ORB_SCORE = 6;
const HEALTH_CELL_VALUE = 28;
const SHOCKWAVE_RADIUS = 6.5;
const SPAWN_MIN_DISTANCE = 14;
const HEADSHOT_MULTIPLIER = 2;
const SPAWN_CLUSTER_LIMIT = 3;
const MAX_ENEMIES_PER_WAVE = 26;

/**
 * The simulation: owns every entity and rules of the game. It never touches the
 * DOM, WebGL or three.js, which keeps it deterministic and unit-testable. The
 * renderer consumes `snapshot*()` data and `drainEvents()`.
 */
export class GameSim {
  readonly world: World;
  readonly player: PlayerState;
  readonly weapon: WeaponState;
  readonly enemies: EnemyManager;
  readonly projectiles: ProjectileSystem;
  readonly pickups: PickupSystem;
  readonly states: StateMachine<GameStateName>;
  readonly score: ScoreTracker;

  stats: PlayerStats = createPlayerStats();
  stacks: UpgradeStacks = createUpgradeStacks();

  wave: WavePlan;
  private wavePhase: WavePhase = 'intro';
  private waveTimer = 0;
  private spawnInterval = 0;
  private spawnQueue: WaveGroup[] = [];
  offers: UpgradeDef[] = [];
  elapsed = 0;
  bestScore = 0;
  seed: number;
  private input: InputState = createInputState();
  private events: SimEvent[] = [];
  private rng: Rng;
  private collectedThisFrame: Array<{ kind: 'energy' | 'health'; value: number; position: Vec3 }> = [];

  private readonly forcedWave?: WaveGroup[];

  constructor(world: World = new World(), seed = 0x5eed, options: GameSimOptions = {}) {
    this.world = world;
    this.seed = seed >>> 0;
    this.rng = createRng(this.seed);
    this.forcedWave = options.forcedWave;
    this.stats = createPlayerStats();
    this.player = new PlayerState(world, this.stats);
    this.weapon = new WeaponState(this.stats);
    this.projectiles = new ProjectileSystem(world);
    this.pickups = new PickupSystem(world);
    this.score = createScoreTracker();
    this.wave = computeWavePlan(1);
    this.states = new StateMachine<GameStateName>('title', TRANSITIONS);
    this.enemies = new EnemyManager(world, {
      playerX: 0,
      playerY: PLAYER_SPAWN.y,
      playerZ: 0,
      playerVX: 0,
      playerVZ: 0,
      playerAlive: false,
      wave: 1,
      healthScale: 1,
      damageScale: 1,
      speedScale: 1,
      spawnProjectile: (origin, direction, speed, damage) => {
        this.projectiles.spawn(origin, direction, speed, damage);
        this.emit({ type: 'projectileFired', origin: { ...origin }, direction: { ...direction }, damage });
      },
      damagePlayer: (amount, fromYaw) => this.damagePlayer(amount, fromYaw),
      onAttackPhase: (enemy, phase) =>
        this.emit({
          type: 'enemyAttack',
          id: enemy.id,
          kind: enemy.kind,
          position: { ...enemy.position },
          phase,
        }),
    });
    this.beginWave(1);
    this.states.onChange((state, previous) => this.emit({ type: 'state', state, previous }));
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Starts a brand new run. All state is rebuilt from scratch. */
  startRun(seed = Math.floor(Math.random() * 0xffffffff)): void {
    this.seed = seed >>> 0;
    this.rng = createRng(this.seed);
    this.stats = createPlayerStats();
    this.player.stats = this.stats;
    this.stacks = createUpgradeStacks();
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.events.length = 0;
    this.offers = [];
    this.elapsed = 0;
    this.score.score = 0;
    this.score.kills = 0;
    this.score.shotsFired = 0;
    this.score.shotsHit = 0;
    this.score.headshots = 0;
    this.score.combo = 0;
    this.score.comboTimer = 0;
    this.score.bestCombo = 0;
    this.score.energyCollected = 0;
    this.score.wave = 1;
    this.player.reset();
    this.weapon.reset(this.stats);
    this.beginWave(1);
    this.states.resetTo('title');
    this.states.transition('playing');
    this.emit({ type: 'waveStart', wave: 1, total: this.wave.totalEnemies, introTime: this.wave.introTime });
  }

  pause(): boolean {
    return this.states.transition('paused');
  }

  resume(): boolean {
    return this.states.transition('playing');
  }

  returnToTitle(): boolean {
    return this.states.transition('title');
  }

  /** Human readable state for the UI. */
  get state(): GameStateName {
    return this.states.state;
  }

  get phase(): WavePhase {
    return this.wavePhase;
  }

  get waveIntroRemaining(): number {
    return Math.max(0, this.waveTimer);
  }

  // -------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------

  update(dt: number, rawInput: InputState): void {
    this.input = rawInput;
    this.collectedThisFrame.length = 0;

    switch (this.states.state) {
      case 'title':
        this.updateTitle(dt);
        break;
      case 'playing':
        this.elapsed += dt;
        this.updatePlaying(dt);
        break;
      default:
        // paused / upgrade / gameover: the world is frozen on purpose so the
        // player can read the UI without taking damage.
        break;
    }

    // One-shot inputs are always consumed, whichever state processed them, so
    // queued actions can never leak into a later frame or a new run.
    rawInput.dashQueued = false;
    rawInput.overdriveQueued = false;
    rawInput.reloadQueued = false;
    rawInput.yawDelta = 0;
    rawInput.pitchDelta = 0;
  }

  /** Slow orbit around the arena centre for the title attract camera. */
  private updateTitle(dt: number): void {
    const idle = createInputState();
    idle.yawDelta = dt * 0.12;
    this.player.stats = this.stats;
    this.player.update(dt, idle);
    this.enemies.update({ dt, playerAlive: false });
  }

  private updatePlaying(dt: number): void {
    const input = this.input;
    const player = this.player;

    this.updateWave(dt);

    player.update(dt, input, this.weapon.speedMultiplier);
    this.weapon.update(dt);

    if (input.dashQueued) this.tryDash();
    if (input.overdriveQueued && this.weapon.activateOverdrive()) {
      this.emit({ type: 'overdriveStart', position: { ...player.position } });
    }
    if (input.reloadQueued && this.weapon.beginReload()) {
      this.emit({ type: 'reload' });
    }
    if (input.firing) this.tryShoot();

    // Enemies.
    this.enemies.update({
      dt,
      playerX: player.position.x,
      playerY: player.position.y,
      playerZ: player.position.z,
      playerVX: player.velocity.x,
      playerVZ: player.velocity.z,
      playerAlive: player.alive,
      wave: this.wave.wave,
      healthScale: this.wave.healthScale,
      damageScale: this.wave.damageScale,
      speedScale: this.wave.speedScale,
    });

    this.projectiles.update(dt, player.position.x, player.position.y, player.position.z, player.alive, {
      onPlayerHit: (damage, fromYaw) => this.damagePlayer(damage, fromYaw),
      onWorldHit: (point, normal) => this.emit({ type: 'projectileImpact', point, normal, nearPlayer: true }),
    });

    this.pickups.update(dt, player.position.x, player.position.y, player.position.z, this.collectedThisFrame);
    for (const pickup of this.collectedThisFrame) this.collectPickup(pickup.kind, pickup.value, pickup.position);

    this.processDeaths();
    tickCombo(this.score, dt);

    if (!player.alive) this.handlePlayerDeath();
  }

  private tryDash(): void {
    const player = this.player;
    if (!player.requestDash()) return;
    this.emit({ type: 'dash', position: { ...player.position } });
    if (this.stats.dashShockwave > 0) {
      const originX = player.position.x;
      const originZ = player.position.z;
      const victims = this.enemies.withinRadius(originX, originZ, SHOCKWAVE_RADIUS);
      for (const enemy of victims) {
        const dx = enemy.position.x - originX;
        const dz = enemy.position.z - originZ;
        const length = Math.max(0.001, Math.hypot(dx, dz));
        enemy.velocity.x += (dx / length) * 6;
        enemy.velocity.z += (dz / length) * 6;
        enemy.applyDamage(this.stats.dashShockwave, this.rng.next(), originX, originZ, 0, 1);
      }
      this.emit({
        type: 'shockwave',
        position: { ...player.position },
        radius: SHOCKWAVE_RADIUS,
        shockwaveDamage: this.stats.dashShockwave,
      });
    }
  }

  private processDeaths(): void {
    const list = this.enemies.enemies;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].health <= 0) this.killEnemy(list[i]);
    }
  }

  private killEnemy(enemy: Enemy): void {
    const removed = this.enemies.remove(enemy);
    if (!removed) return;
    const def = ENEMY_DEFS[enemy.kind];
    const points = registerKill(this.score, def.score);
    const waveFinal = this.spawnQueue.length === 0 && this.enemies.aliveCount === 0;
    this.emit({
      type: 'enemyKilled',
      id: enemy.id,
      kind: enemy.kind,
      position: { ...enemy.position },
      points,
      combo: this.score.combo,
      waveFinal,
    });
    this.emit({
      type: 'score',
      score: this.score.score,
      delta: points,
      combo: this.score.combo,
      multiplier: comboMultiplier(this.score),
    });

    if (this.stats.lifesteal > 0) {
      const healed = this.player.heal(this.stats.lifesteal);
      if (healed > 0) this.emit({ type: 'playerHealed', amount: healed, health: this.player.health });
    }

    this.dropPickups(enemy.position, enemy.kind);
  }

  private dropPickups(position: Vec3, kind: EnemyKind): void {
    const def = ENEMY_DEFS[kind];
    const orbs = def.minDrop + this.rng.int(0, Math.max(0, def.maxDrop - def.minDrop));
    for (let i = 0; i < orbs; i++) {
      this.pickups.spawn('energy', position, ENERGY_ORB_VALUE * this.stats.pickupBonus, this.rng.range(0, Math.PI * 2), this.rng.range(1.4, 3.6));
    }
    if (this.rng.next() < def.healthDropChance * this.stats.pickupBonus) {
      this.pickups.spawn('health', position, HEALTH_CELL_VALUE, this.rng.range(0, Math.PI * 2), 2.4);
    }
  }

  private collectPickup(kind: 'energy' | 'health', value: number, position: Vec3): void {
    if (kind === 'energy') {
      const accepted = this.weapon.addEnergy(value);
      this.weapon.addReserve(2 * this.stats.pickupBonus);
      const points = ENERGY_ORB_SCORE * this.stats.pickupBonus;
      registerPickup(this.score, accepted, points);
      this.emit({
        type: 'pickupCollected',
        kind,
        value: accepted,
        position,
        energy: this.weapon.energy,
        overdriveReady: this.weapon.overdriveReady,
      });
    } else {
      const healed = this.player.heal(value);
      this.emit({ type: 'pickupCollected', kind, value: healed, position, energy: this.weapon.energy, overdriveReady: this.weapon.overdriveReady });
      if (healed > 0) this.emit({ type: 'playerHealed', amount: healed, health: this.player.health });
    }
  }

  private damagePlayer(amount: number, fromYaw: number): void {
    if (!this.player.alive || this.states.state !== 'playing') return;
    const reduced = Math.max(1, Math.round(amount * (1 - this.stats.damageReduction)));
    const result = this.player.takeDamage(reduced, fromYaw);
    registerPlayerDamage(this.score);
    const relativeYaw = fromYaw - this.player.yaw;
    this.emit({ type: 'playerDamaged', amount: reduced, health: this.player.health, relativeYaw });
    if (result.died) this.handlePlayerDeath();
  }

  private handlePlayerDeath(): void {
    if (this.states.state === 'gameover') return;
    this.player.alive = false;
    this.emit({
      type: 'playerDied',
      score: this.score.score,
      wave: this.wave.wave,
      kills: this.score.kills,
    });
    this.states.transition('gameover');
  }

  // -------------------------------------------------------------------------
  // Weapon
  // -------------------------------------------------------------------------

  private tryShoot(): void {
    const weapon = this.weapon;
    if (!weapon.tryFire()) {
      if (weapon.ammoInMag === 0 && !weapon.reloading && weapon.reserve <= 0) {
        this.emit({ type: 'dryFire' });
      }
      return;
    }

    const player = this.player;
    const spread = weapon.currentSpread();
    const pitch = player.aimPitch();
    const yaw = player.aimYaw();
    const direction = this.spreadDirection(yaw, pitch, spread);
    const origin = player.eyePosition({ x: 0, y: 0, z: 0 });

    this.emit({ type: 'shot', origin: { ...origin }, direction: { ...direction }, spread });

    const maxDistance = 110;
    const worldHit = this.world.raycast(origin, direction, maxDistance);
    const limit = worldHit ? worldHit.distance : maxDistance;
    const enemyHit = this.enemies.raycast(origin, direction, limit);

    if (enemyHit) {
      const { enemy, distance, headshot } = enemyHit;
      const base = this.stats.damage * weapon.damageMultiplier * (headshot ? HEADSHOT_MULTIPLIER : 1);
      const outcome = enemy.applyDamage(base, this.rng.next(), origin.x, origin.z, this.stats.critChance, this.stats.critMultiplier);
      registerShot(this.score, true, headshot);
      this.emit({
        type: 'impact',
        point: {
          x: origin.x + direction.x * distance,
          y: origin.y + direction.y * distance,
          z: origin.z + direction.z * distance,
        },
        normal: { x: -direction.x, y: 0, z: -direction.z },
        surface: 'enemy',
        damage: outcome.amount,
        headshot,
        crit: outcome.crit,
      });
      if (outcome.amount > 0) {
        this.emit({
          type: 'enemyDamaged',
          id: enemy.id,
          kind: enemy.kind,
          position: { ...enemy.position },
          amount: outcome.amount,
          crit: outcome.crit,
        });
      }
    } else if (worldHit) {
      registerShot(this.score, false, false);
      this.emit({
        type: 'impact',
        point: { ...worldHit.point },
        normal: { ...worldHit.normal },
        surface: 'world',
        damage: 0,
        headshot: false,
        crit: false,
      });
    } else {
      registerShot(this.score, false, false);
    }

    const recoilPitch = (0.011 + this.rng.next() * 0.005) * (weapon.overdriveActive ? 0.8 : 1);
    player.addRecoil(recoilPitch, (this.rng.next() - 0.5) * 0.004);
  }

  /** Randomised direction inside the weapon's cone. */
  private spreadDirection(yaw: number, pitch: number, spread: number): Vec3 {
    const randomYaw = (this.rng.next() - 0.5) * 2 * spread * 12;
    const randomPitch = (this.rng.next() - 0.5) * 2 * spread * 12;
    const cp = Math.cos(pitch);
    return {
      x: -Math.sin(yaw + randomYaw) * cp,
      y: Math.sin(pitch + randomPitch),
      z: -Math.cos(yaw + randomYaw) * cp,
    };
  }

  // -------------------------------------------------------------------------
  // Waves
  // -------------------------------------------------------------------------

  private beginWave(wave: number): void {
    const plan = computeWavePlan(wave);
    if (this.forcedWave) {
      this.wave = {
        ...plan,
        groups: this.forcedWave.map((group) => ({ ...group })),
        totalEnemies: this.forcedWave.reduce((sum, group) => sum + group.count, 0),
      };
    } else {
      this.wave = plan;
    }
    this.wavePhase = 'intro';
    this.waveTimer = this.wave.introTime;
    this.spawnInterval = 0;
    this.spawnQueue = this.wave.groups.map((group) => ({ ...group }));
    this.weapon.addReserve(this.wave.reserveRefill);
  }

  private updateWave(dt: number): void {
    switch (this.wavePhase) {
      case 'intro':
        this.waveTimer -= dt;
        if (this.waveTimer <= 0) {
          this.waveTimer = 0;
          this.wavePhase = 'active';
          this.spawnInterval = 0.2;
        }
        break;
      case 'active':
        this.spawnInterval -= dt;
        if (this.spawnInterval <= 0 && this.spawnQueue.length > 0 && this.enemies.aliveCount < Math.min(this.wave.maxAlive, MAX_ENEMIES_PER_WAVE)) {
          this.spawnNextGroup();
          this.spawnInterval = this.wave.spawnInterval;
        }
        if (this.spawnQueue.length === 0 && this.enemies.aliveCount === 0) {
          this.clearWave();
        }
        break;
      case 'cleared':
        break;
      default:
        break;
    }
  }

  private spawnNextGroup(): void {
    const group = this.spawnQueue[0];
    if (!group) return;
    const spawn = this.findFreeSpawn();
    const cluster = group.kind === 'shade' ? Math.min(group.count, SPAWN_CLUSTER_LIMIT) : 1;

    for (let i = 0; i < cluster; i++) {
      const angle = (i / cluster) * Math.PI * 2 + this.rng.range(-0.4, 0.4);
      const offset = cluster === 1 ? 0 : this.rng.range(1.1, 2.6);
      const x = spawn.x + Math.cos(angle) * offset;
      const z = spawn.z + Math.sin(angle) * offset;
      const y = this.world.surfaceHeightAt(x, z) + 0.05;
      const enemy = this.enemies.spawn(group.kind, x, z, y, this.wave.wave);
      this.emit({ type: 'enemySpawned', id: enemy.id, kind: enemy.kind, position: { ...enemy.position } });
    }

    group.count -= cluster;
    if (group.count <= 0) this.spawnQueue.shift();
  }

  /**
   * Picks a spawn position that is genuinely free of geometry, so enemies can
   * never materialise inside a wall, pillar, stair or the player.
   */
  private findFreeSpawn(): { x: number; z: number } {
    const playerX = this.player.position.x;
    const playerZ = this.player.position.z;
    const request = {
      halfExtent: this.world.halfExtent,
      minDistanceFromPlayer: SPAWN_MIN_DISTANCE,
      playerX,
      playerZ,
    };
    let fallback: { x: number; z: number } | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = findSpawnPosition(request, this.rng);
      if (this.world.isFreePosition(candidate.x, candidate.z, 1.6)) return candidate;
      fallback = candidate;
    }
    const anchor = this.world.findFreeAnchor(playerX, playerZ, 1.6);
    if (anchor) return anchor;
    // Extremely defensive: the arena always has room on the border.
    const lastResort = fallback ?? { x: playerX + SPAWN_MIN_DISTANCE, z: playerZ };
    return {
      x: Math.max(-34, Math.min(34, lastResort.x)),
      z: Math.max(-34, Math.min(34, lastResort.z)),
    };
  }

  private clearWave(): void {
    this.wavePhase = 'cleared';
    const awarded = Math.round(this.wave.clearBonus);
    this.score.score += awarded;
    this.score.wave = this.wave.wave;
    this.weapon.addReserve(this.wave.reserveRefill);
    this.emit({ type: 'waveCleared', wave: this.wave.wave, bonus: awarded, nextWave: this.wave.wave + 1 });

    this.offers = rollUpgradeOffers(this.stacks, this.rng, 3);
    this.emit({
      type: 'upgradeOffer',
      wave: this.wave.wave,
      offers: this.offers.map((upgrade) => ({
        id: upgrade.id,
        name: upgrade.name,
        short: upgrade.short,
        rarity: upgrade.rarity,
        stacks: this.stacks[upgrade.id],
        maxStacks: upgrade.maxStacks,
      })),
    });
    this.states.transition('upgrade');
  }

  /** Applies the chosen upgrade and starts the next wave. */
  chooseUpgrade(id: UpgradeId): boolean {
    if (this.states.state !== 'upgrade') return false;
    const applied = purchaseUpgrade(this.stats, this.stacks, id);
    if (!applied) return false;
    const healthIncrease = this.player.refreshMaxHealth();
    if (healthIncrease > 0) this.emit({ type: 'playerHealed', amount: healthIncrease, health: this.player.health });
    this.emit({ type: 'upgradeChosen', id, stacks: this.stacks[id], wave: this.wave.wave });
    this.resume();
    this.beginWave(this.wave.wave + 1);
    this.emit({ type: 'waveStart', wave: this.wave.wave, total: this.wave.totalEnemies, introTime: this.wave.introTime });
    return true;
  }

  /** Skips the upgrade choice (used by the "skip" button). */
  skipUpgrade(): boolean {
    if (this.states.state !== 'upgrade') return false;
    this.resume();
    this.beginWave(this.wave.wave + 1);
    this.emit({ type: 'waveStart', wave: this.wave.wave, total: this.wave.totalEnemies, introTime: this.wave.introTime });
    return true;
  }

  // -------------------------------------------------------------------------
  // Events and queries
  // -------------------------------------------------------------------------

  private emit(event: SimEvent): void {
    if (this.events.length > 512) this.events.shift();
    this.events.push(event);
  }

  drainEvents(): SimEvent[] {
    if (this.events.length === 0) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  clearEvents(): void {
    this.events.length = 0;
  }

  getHudSnapshot(): HudSnapshot {
    const weapon = this.weapon;
    const reloadProgress = weapon.reloading ? 1 - clamp(weapon.reloadTimer / Math.max(0.001, this.stats.reloadTime), 0, 1) : 0;
    return {
      health: Math.round(this.player.health),
      maxHealth: Math.round(this.player.maxHealth),
      healthFraction: this.player.healthFraction(),
      score: this.score.score,
      wave: this.wave.wave,
      enemiesAlive: this.enemies.aliveCount,
      enemiesRemaining: this.spawnQueue.reduce((sum, group) => sum + group.count, 0) + this.enemies.aliveCount,
      combo: this.score.combo,
      multiplier: comboMultiplier(this.score),
      accuracy: accuracy(this.score),
      kills: this.score.kills,
      dashProgress: this.player.dashProgress,
      weapon: {
        ammo: weapon.ammoInMag,
        magSize: this.stats.magSize,
        reserve: weapon.reserve,
        reloading: weapon.reloading,
        reloadProgress,
        overdriveActive: weapon.overdriveActive,
        overdriveProgress: weapon.overdriveProgress,
        overdriveEnergy: weapon.energy,
        overdriveReady: weapon.overdriveReady,
        dry: weapon.ammoInMag === 0 && weapon.reserve <= 0,
      },
      bestScore: Math.max(this.bestScore, this.score.score),
      elapsed: this.elapsed,
      lowHealth: this.player.healthFraction() <= 0.34,
    };
  }

  enemySnapshots(): ReturnType<EnemyManager['snapshot']> {
    return this.enemies.snapshot();
  }

  pickupSnapshots(): Array<{ id: number; kind: 'energy' | 'health'; position: Vec3; life: number; value: number }> {
    const out: Array<{ id: number; kind: 'energy' | 'health'; position: Vec3; life: number; value: number }> = [];
    this.pickups.pool.forEachActive((pickup) => {
      out.push({
        id: pickup.id,
        kind: pickup.kind,
        position: { ...pickup.position },
        life: pickup.life,
        value: pickup.value,
      });
    });
    return out;
  }

  projectileSnapshots(): Array<{ id: number; position: Vec3; velocity: Vec3 }> {
    const out: Array<{ id: number; position: Vec3; velocity: Vec3 }> = [];
    this.projectiles.pool.forEachActive((projectile) => {
      out.push({ id: projectile.id, position: { ...projectile.position }, velocity: { ...projectile.velocity } });
    });
    return out;
  }

  setBestScore(score: number): void {
    this.bestScore = Math.max(this.bestScore, score);
  }

  /** Camera target for the engine (eye position plus head bob). */
  cameraPosition(out: Vec3): Vec3 {
    out.x = this.player.position.x;
    out.z = this.player.position.z;
    out.y = this.player.position.y + WORLD.eyeHeight + Math.sin(this.player.bobPhase * 2) * 0.045 * this.player.bobAmount;
    return out;
  }

  /** For tests: forces the wave into the active phase. */
  debugSkipIntro(): void {
    if (this.wavePhase === 'intro') {
      this.waveTimer = 0;
      this.wavePhase = 'active';
      this.spawnInterval = 0;
    }
  }
}

export type { Enemy, EnemyKind, UpgradeDef };
