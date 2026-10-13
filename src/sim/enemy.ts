import { clamp, damp } from '../core/math';
import { ENEMY_DEFS, type EnemyDef } from './enemyDefs';
import type { EnemyKind } from './types';
import { computeDamage, yawToFace, type DamageOutcome } from './damage';
import { raySphere } from './ray';
import { WORLD, type EnemyAiState } from './types';
import type { Vec3 } from './vec';
import type { World } from './world';

export interface EnemyUpdateContext {
  dt: number;
  playerX: number;
  playerY: number;
  playerZ: number;
  playerVX: number;
  playerVZ: number;
  playerAlive: boolean;
  wave: number;
  healthScale: number;
  damageScale: number;
  speedScale: number;
  world: World;
  /** Neighbouring enemies used for separation (owned by the enemy manager). */
  separation: readonly Enemy[];
  spawnProjectile(origin: Vec3, direction: Vec3, speed: number, damage: number): void;
  damagePlayer(amount: number, fromYaw: number): void;
  /** Called on attack telegraphs so the engine can play audio and VFX. */
  onAttackPhase(enemy: Enemy, phase: 'windup' | 'strike' | 'fire'): void;
}

export interface EnemyHitSphere {
  center: Vec3;
  radius: number;
}

export interface EnemyRaycastHit {
  distance: number;
  headshot: boolean;
}

let nextEnemyId = 1;

/** A single hostile unit with behaviour, hit volumes and movement. */
export class Enemy {
  readonly id: number = nextEnemyId++;
  readonly def: EnemyDef;
  readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  health: number;
  readonly maxHealth: number;
  facing = 0;
  state: EnemyAiState = 'spawn';
  stateTime = 0;
  attackCooldown = 0;
  hitFlash = 0;
  spawnProgress = 0;
  strafeSign = 1;
  strafeTimer = 0;
  /** Negative while executing a "break out of the corner" move. */
  stuckTimer = 0;
  /** Distance to the player at the previous progress check. */
  distanceAtCheck = Number.POSITIVE_INFINITY;
  progressTimer = 0;
  bobPhase: number;
  /** True once the current strike has been resolved, cleared on state change. */
  strikeResolved = false;

  constructor(kind: EnemyKind, spawnX: number, spawnZ: number, spawnY: number, wave: number) {
    this.def = ENEMY_DEFS[kind];
    this.maxHealth = Math.max(1, Math.round(this.def.health * (1 + Math.max(0, wave - 1) * 0.13)));
    this.health = this.maxHealth;
    this.position.x = spawnX;
    this.position.y = spawnY;
    this.position.z = spawnZ;
    this.bobPhase = (this.id * 2.399963) % (Math.PI * 2);
  }

  get kind(): EnemyKind {
    return this.def.kind;
  }

  get isMelee(): boolean {
    return this.def.projectileSpeed === 0;
  }

  get contactRange(): number {
    return this.def.attackRange;
  }

  bodySphere(): EnemyHitSphere {
    return {
      center: { x: this.position.x, y: this.position.y + this.def.bodyHeight, z: this.position.z },
      radius: this.def.bodyRadius,
    };
  }

  headSphere(): EnemyHitSphere {
    return {
      center: { x: this.position.x, y: this.position.y + this.def.headHeight, z: this.position.z },
      radius: this.def.headRadius,
    };
  }

  /** 0..1 progress through the current attack windup (telegraph value). */
  get chargeProgress(): number {
    if (this.state !== 'windup' || this.def.windupTime <= 0) return 0;
    return clamp(this.stateTime / this.def.windupTime, 0, 1);
  }

  /**
   * Applies damage, honouring front armour, flanking and crits. Returns the
   * outcome so callers can spawn hit markers and audio cues.
   */
  applyDamage(
    base: number,
    roll: number,
    attackerX: number,
    attackerZ: number,
    critChance: number,
    critMultiplier: number,
  ): DamageOutcome {
    const outcome = computeDamage({
      kind: 'bullet',
      base,
      targetX: this.position.x,
      targetZ: this.position.z,
      targetFacing: this.facing,
      attackerX,
      attackerZ,
      frontArmor: this.def.frontArmor,
      critChance,
      critMultiplier,
      roll,
    });
    this.health = Math.max(0, this.health - outcome.amount);
    this.hitFlash = 1;
    return outcome;
  }

  /** Ray test against the body and head volumes. */
  raycast(origin: Vec3, direction: Vec3, maxDistance: number): EnemyRaycastHit | null {
    const body = raySphere(origin, direction, this.bodySphere().center, this.def.bodyRadius);
    const head = raySphere(origin, direction, this.headSphere().center, this.def.headRadius);
    let best: EnemyRaycastHit | null = null;
    if (body !== null && body <= maxDistance) best = { distance: body, headshot: false };
    if (head !== null && head <= maxDistance && (!best || head < best.distance)) {
      best = { distance: head, headshot: true };
    }
    return best;
  }

  private enterState(state: EnemyAiState, ctx: EnemyUpdateContext): void {
    this.state = state;
    this.stateTime = 0;
    this.strikeResolved = false;
    if (state === 'windup') ctx.onAttackPhase(this, 'windup');
  }

  update(ctx: EnemyUpdateContext): void {
    const dt = ctx.dt;
    const def = this.def;
    this.hitFlash = damp(this.hitFlash, 0, 0.12, dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    const toPlayerX = ctx.playerX - this.position.x;
    const toPlayerZ = ctx.playerZ - this.position.z;
    const distance = Math.hypot(toPlayerX, toPlayerZ);
    this.facing = turnToward(this.facing, Math.atan2(-toPlayerX, -toPlayerZ), def.turnRate * dt);

    switch (this.state) {
      case 'spawn':
        this.spawnProgress = clamp(this.spawnProgress + dt / 0.45, 0, 1);
        this.velocity.x = 0;
        this.velocity.z = 0;
        if (this.spawnProgress >= 1) this.enterState('chase', ctx);
        break;
      case 'chase':
        this.updateChase(ctx, distance, toPlayerX, toPlayerZ);
        break;
      case 'windup':
        this.stateTime += dt;
        // Enemies slow while charging so attacks stay dodgeable.
        this.velocity.x *= 1 - Math.min(1, dt * 8);
        this.velocity.z *= 1 - Math.min(1, dt * 8);
        if (this.stateTime >= def.windupTime) this.enterState('strike', ctx);
        break;
      case 'strike':
        this.resolveStrike(ctx, distance);
        this.stateTime += dt;
        if (this.stateTime >= 0.06) this.enterState('recover', ctx);
        break;
      case 'recover':
        this.stateTime += dt;
        this.velocity.x *= 1 - Math.min(1, dt * 3);
        this.velocity.z *= 1 - Math.min(1, dt * 3);
        if (this.stateTime >= def.recoverTime) {
          this.enterState('chase', ctx);
          this.attackCooldown = def.attackCooldown;
        }
        break;
      default:
        break;
    }

    this.integrate(ctx, dt);
  }

  private updateChase(ctx: EnemyUpdateContext, distance: number, toPlayerX: number, toPlayerZ: number): void {
    const def = this.def;
    const speed = def.speed * ctx.speedScale;

    let wishX = 0;
    let wishZ = 0;

    if (this.isMelee) {
      if (distance > this.contactRange * 0.85) {
        wishX = toPlayerX;
        wishZ = toPlayerZ;
      }
    } else {
      // Ranged units hold their preferred range and strafe around the player.
      const inRange = distance > def.preferredRange - 2 && distance < def.preferredRange + 2.5;
      if (!inRange) {
        const sign = distance > def.preferredRange ? 1 : -1;
        wishX = toPlayerX * sign;
        wishZ = toPlayerZ * sign;
      }
      this.strafeTimer -= ctx.dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = 1.1 + Math.random() * 1.4;
        this.strafeSign *= -1;
      }
      const len = Math.max(1e-4, Math.hypot(wishX, wishZ));
      if (inRange) {
        wishX = (-toPlayerZ / len) * this.strafeSign;
        wishZ = (toPlayerX / len) * this.strafeSign;
      }
    }

    // Stuck detection: when the distance to the player has not improved for a
    // moment, commit to a sideways move to break out of corners and doorways.
    if (this.isStuck(distance, ctx.dt)) {
      const angle = Math.atan2(wishX, wishZ) + this.strafeSign * 1.25;
      wishX = Math.sin(angle);
      wishZ = Math.cos(angle);
    }

    const wishLength = Math.hypot(wishX, wishZ);
    if (wishLength > 1e-5) {
      wishX /= wishLength;
      wishZ /= wishLength;

      // Cheap obstacle avoidance: probe progressively rotated directions.
      // The step-height rule matches the collision code, so steppable ledges and
      // stairs are never treated as obstacles.
      const fromX = this.position.x;
      const fromZ = this.position.z;
      const feetY = this.position.y;
      if (ctx.world.isPathBlocked(fromX, fromZ, fromX + wishX * 2.5, fromZ + wishZ * 2.5, feetY)) {
        const base = Math.atan2(wishX, wishZ);
        const offsets = [0.6, -0.6, 1.2, -1.2, 1.9, -1.9];
        let resolved = false;
        for (const offset of offsets) {
          const angle = base + offset;
          if (!ctx.world.isPathBlocked(fromX, fromZ, fromX + Math.sin(angle) * 2.5, fromZ + Math.cos(angle) * 2.5, feetY)) {
            wishX = Math.sin(angle);
            wishZ = Math.cos(angle);
            resolved = true;
            break;
          }
        }
        if (!resolved) {
          wishX *= -0.4;
          wishZ *= -0.4;
        }
      }
    }

    // Attack triggers.
    if (ctx.playerAlive && this.attackCooldown <= 0) {
      if (this.isMelee) {
        if (distance <= this.contactRange + def.radius) {
          this.enterState('windup', ctx);
          return;
        }
      } else if (distance <= def.attackRange && distance > 3.2) {
        this.enterState('windup', ctx);
        return;
      }
    }

    const blend = 1 - Math.exp(-7 * ctx.dt);
    this.velocity.x += (wishX * speed - this.velocity.x) * blend;
    this.velocity.z += (wishZ * speed - this.velocity.z) * blend;
  }

  /**
   * Detects a lost enemy: when closing the distance for a while has not worked,
   * the enemy sidesteps for a moment. Returns true when a sidestep is active.
   */
  private isStuck(distance: number, dt: number): boolean {
    if (this.stuckTimer < 0) {
      this.stuckTimer += dt;
      if (this.stuckTimer >= 0) this.stuckTimer = 0;
      return true;
    }
    this.progressTimer += dt;
    if (this.progressTimer < 1) return false;

    const improved = this.distanceAtCheck - distance;
    this.progressTimer = 0;
    this.distanceAtCheck = distance;
    // Only break out when the enemy is genuinely stuck (very little progress).
    if (improved < 0.45) {
      this.stuckTimer = -0.9;
      return true;
    }
    return false;
  }

  private resolveStrike(ctx: EnemyUpdateContext, distance: number): void {
    if (this.strikeResolved) return;
    this.strikeResolved = true;
    const def = this.def;

    if (this.isMelee) {
      const reach = this.contactRange + def.radius + 0.55;
      if (distance <= reach) {
        const yaw = yawToFace(this.position, { x: ctx.playerX, y: ctx.playerY, z: ctx.playerZ });
        ctx.damagePlayer(def.contactDamage * ctx.damageScale, yaw);
      }
    } else if (def.projectileSpeed > 0) {
      // Lead the target slightly so strafing matters but shots stay dodgeable.
      const muzzle = {
        x: this.position.x,
        y: this.position.y + def.headHeight,
        z: this.position.z,
      };
      const travel = distance / def.projectileSpeed;
      const lead = 0.35;
      const targetX = ctx.playerX + ctx.playerVX * travel * lead;
      const targetZ = ctx.playerZ + ctx.playerVZ * travel * lead;
      const dx = targetX - muzzle.x;
      const dy = ctx.playerY + WORLD.eyeHeight * 0.75 - muzzle.y;
      const dz = targetZ - muzzle.z;
      const length = Math.hypot(dx, dy, dz) || 1;
      ctx.spawnProjectile(
        muzzle,
        { x: dx / length, y: dy / length, z: dz / length },
        def.projectileSpeed,
        def.contactDamage * ctx.damageScale,
      );
      ctx.onAttackPhase(this, 'fire');
      return;
    }
    ctx.onAttackPhase(this, 'strike');
  }

  private integrate(ctx: EnemyUpdateContext, dt: number): void {
    // Separation so enemies do not perfectly overlap each other.
    let sx = 0;
    let sz = 0;
    for (const other of ctx.separation) {
      if (other === this) continue;
      const dx = this.position.x - other.position.x;
      const dz = this.position.z - other.position.z;
      const minDist = this.def.radius + other.def.radius + 0.35;
      const distSq = dx * dx + dz * dz;
      if (distSq > 1e-6 && distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq);
        const push = (minDist - dist) / minDist;
        sx += (dx / dist) * push;
        sz += (dz / dist) * push;
      }
    }
    this.velocity.x += sx * 8 * dt;
    this.velocity.z += sz * 8 * dt;

    const moved = ctx.world.moveEntity(
      this.position.x,
      this.position.y,
      this.position.z,
      this.velocity.x * dt,
      this.velocity.z * dt,
      this.def.radius,
    );
    this.position.x = moved.x;
    this.position.z = moved.z;

    if (moved.grounded) {
      this.position.y = moved.y;
      this.velocity.y = 0;
    } else {
      this.velocity.y -= WORLD.gravity * dt;
      this.position.y += this.velocity.y * dt;
      const groundY = ctx.world.groundHeightAt(this.position.x, this.position.z, this.position.y);
      if (this.position.y <= groundY + 1e-3) {
        this.position.y = groundY;
        this.velocity.y = 0;
      }
    }
  }
}

/** Turns `current` towards `target` by at most `maxDelta` radians. */
export function turnToward(current: number, target: number, maxDelta: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}
