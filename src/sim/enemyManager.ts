import { Enemy, type EnemyUpdateContext } from './enemy';
import type { EnemyKind, EnemySnapshot } from './types';
import type { Vec3 } from './vec';
import type { World } from './world';

export interface EnemyUpdateOverrides {
  dt?: number;
  playerX?: number;
  playerY?: number;
  playerZ?: number;
  playerVX?: number;
  playerVZ?: number;
  playerAlive?: boolean;
  wave?: number;
  healthScale?: number;
  damageScale?: number;
  speedScale?: number;
}

export interface EnemyHitResult {
  enemy: Enemy;
  distance: number;
  headshot: boolean;
}

/** Tracks, updates and removes every live enemy of the current run. */
export class EnemyManager {
  readonly enemies: Enemy[] = [];

  constructor(
    private readonly world: World,
    readonly context: EnemyContext,
  ) {}

  get aliveCount(): number {
    return this.enemies.length;
  }

  get all(): readonly Enemy[] {
    return this.enemies;
  }

  spawn(kind: EnemyKind, x: number, z: number, y: number, wave: number): Enemy {
    const enemy = new Enemy(kind, x, z, y, wave);
    this.enemies.push(enemy);
    return enemy;
  }

  /** Removes an enemy and returns it (used for death effects and drops). */
  remove(enemy: Enemy): Enemy | null {
    const index = this.enemies.indexOf(enemy);
    if (index < 0) return null;
    this.enemies.splice(index, 1);
    return enemy;
  }

  /** Updates every enemy with the shared movement/AI context. */
  update(overrides: EnemyUpdateOverrides): void {
    const ctx: EnemyUpdateContext = {
      ...this.context,
      ...overrides,
      dt: overrides.dt ?? 0,
      world: this.world,
      separation: this.enemies,
    };
    for (let i = 0; i < this.enemies.length; i++) this.enemies[i].update(ctx);
  }

  /** Nearest enemy hit along a ray. */
  raycast(origin: Vec3, direction: Vec3, maxDistance: number): EnemyHitResult | null {
    let best: EnemyHitResult | null = null;
    for (const enemy of this.enemies) {
      if (enemy.state === 'spawn') continue;
      const hit = enemy.raycast(origin, direction, best ? best.distance : maxDistance);
      if (hit && (!best || hit.distance < best.distance)) {
        best = { enemy, distance: hit.distance, headshot: hit.headshot };
      }
    }
    return best;
  }

  /** Enemies inside a radius, used by the dash shockwave. */
  withinRadius(x: number, z: number, radius: number): Enemy[] {
    const out: Enemy[] = [];
    const radiusSq = radius * radius;
    for (const enemy of this.enemies) {
      const dx = enemy.position.x - x;
      const dz = enemy.position.z - z;
      if (dx * dx + dz * dz <= radiusSq) out.push(enemy);
    }
    return out;
  }

  snapshot(): EnemySnapshot[] {
    return this.enemies.map((enemy) => ({
      id: enemy.id,
      kind: enemy.kind,
      position: { ...enemy.position },
      facing: enemy.facing,
      health: enemy.health,
      maxHealth: enemy.maxHealth,
      state: enemy.state,
      charge: enemy.chargeProgress,
      spawnProgress: enemy.spawnProgress,
    }));
  }

  clear(): void {
    this.enemies.length = 0;
  }
}

export interface EnemyContext extends Omit<EnemyUpdateContext, 'dt' | 'world' | 'separation'> {}
