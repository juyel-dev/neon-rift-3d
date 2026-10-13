import { clamp, damp } from '../core/math';
import { PLAYER_SPAWN } from './progression';
import { WORLD, type InputState, type PlayerStats } from './types';
import { applyDamage, applyHealing, type HealthResult } from './damage';
import { set, type Vec3 } from './vec';
import type { World } from './world';

const GROUND_ACCELERATION = 14;
const AIR_ACCELERATION = 3.5;
const RECOIL_HALF_LIFE = 0.07;
const DASH_VERTICAL_SPEED = 4.6;

/**
 * The player: locomotion, collision response, dash, look angles and health.
 * Rendering reads `position`, `yaw`, `pitch` and the camera feedback values.
 */
export class PlayerState {
  readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  health = 100;
  maxHealth = 100;
  yaw = 0;
  pitch = 0;
  grounded = true;
  alive = true;

  dashTimer = 0;
  dashCooldownTimer = 0;
  readonly dashDirection: Vec3 = { x: 0, y: 0, z: -1 };

  recoilPitch = 0;
  recoilYaw = 0;
  bobPhase = 0;
  bobAmount = 0;
  /** Horizontal speed in m/s, used for the view-model sway. */
  planarSpeed = 0;
  timeSinceDamage = 999;
  lastDamageYaw = 0;

  constructor(
    private readonly world: World,
    public stats: PlayerStats,
  ) {
    this.reset();
  }

  reset(): void {
    set(this.position, PLAYER_SPAWN.x, this.world.surfaceHeightAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z) + 0.02, PLAYER_SPAWN.z);
    set(this.velocity, 0, 0, 0);
    this.health = this.stats.maxHealth;
    this.maxHealth = this.stats.maxHealth;
    // Start looking diagonally across the arena so the scene reads with depth.
    this.yaw = -Math.PI / 4;
    this.pitch = -0.04;
    this.grounded = true;
    this.alive = true;
    this.dashTimer = 0;
    this.dashCooldownTimer = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.planarSpeed = 0;
    this.timeSinceDamage = 999;
    set(this.dashDirection, 0, 0, -1);
  }

  /** Eye position used as the origin of every shot. */
  eyePosition(out: Vec3): Vec3 {
    return set(out, this.position.x, this.position.y + WORLD.eyeHeight + this.bobAmount * 0.5, this.position.z);
  }

  /** Unit forward vector for the current yaw. */
  forward(out: Vec3): Vec3 {
    return set(out, -Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Unit right vector for the current yaw. */
  right(out: Vec3): Vec3 {
    return set(out, Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  get dashReady(): boolean {
    return this.dashCooldownTimer <= 0 && this.dashTimer <= 0;
  }

  get dashProgress(): number {
    return this.stats.dashCooldown > 0 ? 1 - clamp(this.dashCooldownTimer / this.stats.dashCooldown, 0, 1) : 1;
  }

  requestDash(): boolean {
    if (!this.dashReady) return false;
    this.dashTimer = this.stats.dashDuration;
    this.dashCooldownTimer = this.stats.dashCooldown;
    this.velocity.y = DASH_VERTICAL_SPEED;
    if (Math.abs(this.dashDirection.x) + Math.abs(this.dashDirection.z) < 0.01) set(this.dashDirection, 0, 0, -1);
    return true;
  }

  addRecoil(pitch: number, yaw: number): void {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
  }

  /** Applies damage; returns true when the player died. */
  takeDamage(amount: number, fromYaw: number): HealthResult {
    if (!this.alive) return { health: this.health, died: false };
    const result = applyDamage(this.health, amount);
    this.health = Math.max(0, result.health);
    this.lastDamageYaw = fromYaw;
    this.timeSinceDamage = 0;
    if (result.died) this.alive = false;
    return result;
  }

  heal(amount: number): number {
    const before = this.health;
    this.health = applyHealing(this.health, this.maxHealth, amount);
    return this.health - before;
  }

  /** Refreshes max health after an upgrade purchase. */
  refreshMaxHealth(): number {
    const increase = this.stats.maxHealth - this.maxHealth;
    this.maxHealth = this.stats.maxHealth;
    if (increase > 0) this.health = Math.min(this.maxHealth, this.health + increase);
    return increase;
  }

  update(dt: number, input: InputState, speedMultiplier = 1): void {
    if (!this.alive) {
      // Let the death animation settle but stop simulating control.
      this.updateCameraFeedback(dt, 0);
      return;
    }

    // Look.
    this.yaw += input.yawDelta;
    this.pitch = clamp(this.pitch + input.pitchDelta, -WORLD.maxPitch, WORLD.maxPitch);

    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.dashCooldownTimer = Math.max(0, this.dashCooldownTimer - dt);

    const forward = this.forward({ x: 0, y: 0, z: 0 });
    const right = this.right({ x: 0, y: 0, z: 0 });

    let inputX = input.moveRight;
    let inputZ = input.moveForward;
    const inputLength = Math.hypot(inputX, inputZ);
    if (inputLength > 1) {
      inputX /= inputLength;
      inputZ /= inputLength;
    }

    let wishX = forward.x * inputZ + right.x * inputX;
    let wishZ = forward.z * inputZ + right.z * inputX;
    const wishLength = Math.hypot(wishX, wishZ);
    if (wishLength > 1e-5) {
      if (wishLength > 1) {
        wishX /= wishLength;
        wishZ /= wishLength;
      }
      set(this.dashDirection, wishX, 0, wishZ);
    }

    const sprint = input.sprint && wishLength > 0.01;
    const targetSpeed = this.stats.moveSpeed * speedMultiplier * (sprint ? this.stats.sprintMultiplier : 1);
    const dashing = this.dashTimer > 0;

    let targetVX = wishX * targetSpeed;
    let targetVZ = wishZ * targetSpeed;

    if (dashing) {
      targetVX = this.dashDirection.x * this.stats.dashSpeed;
      targetVZ = this.dashDirection.z * this.stats.dashSpeed;
    }

    const accel = dashing ? 1 : this.grounded ? GROUND_ACCELERATION : AIR_ACCELERATION;
    const blend = 1 - Math.exp(-accel * dt);
    this.velocity.x += (targetVX - this.velocity.x) * blend;
    this.velocity.z += (targetVZ - this.velocity.z) * blend;

    if (dashing) {
      this.velocity.y = Math.max(this.velocity.y, 2.4);
    } else {
      this.velocity.y -= WORLD.gravity * dt;
    }

    // Horizontal movement with collision.
    const moved = this.world.moveEntity(
      this.position.x,
      this.position.y,
      this.position.z,
      this.velocity.x * dt,
      this.velocity.z * dt,
      WORLD.playerRadius,
    );
    this.position.x = moved.x;
    this.position.z = moved.z;

    if (moved.grounded) {
      this.position.y = moved.y;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
      this.position.y += this.velocity.y * dt;
      const groundY = this.world.groundHeightAt(this.position.x, this.position.z, this.position.y);
      if (this.position.y <= groundY + 1e-3) {
        this.position.y = groundY;
        this.velocity.y = 0;
        this.grounded = true;
      }
    }

    this.planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);

    // Regeneration outside of combat.
    this.timeSinceDamage += dt;
    if (this.timeSinceDamage > this.stats.regenDelay && this.health < this.maxHealth) {
      this.health = applyHealing(this.health, this.maxHealth, this.stats.regenRate * dt);
    }

    // Camera feedback: head bob and recoil recovery.
    const bobTarget = this.grounded ? Math.min(1, this.planarSpeed / (this.stats.moveSpeed * 0.8)) : 0;
    this.bobAmount = damp(this.bobAmount, bobTarget, 0.18, dt);
    if (this.grounded) this.bobPhase += this.planarSpeed * dt * 1.35;
    this.recoilPitch = damp(this.recoilPitch, 0, RECOIL_HALF_LIFE, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, RECOIL_HALF_LIFE, dt);
  }

  private updateCameraFeedback(dt: number, speed: number): void {
    this.bobAmount = damp(this.bobAmount, 0, 0.2, dt);
    this.recoilPitch = damp(this.recoilPitch, 0, RECOIL_HALF_LIFE, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, RECOIL_HALF_LIFE, dt);
    this.planarSpeed = speed;
    this.bobPhase += speed * dt * 1.35;
  }

  /** Total aim pitch including recoil, consumed by the weapon. */
  aimPitch(): number {
    return clamp(this.pitch + this.recoilPitch, -WORLD.maxPitch, WORLD.maxPitch);
  }

  /** Total aim yaw including recoil. */
  aimYaw(): number {
    return this.yaw + this.recoilYaw;
  }

  /** Health as a 0..1 fraction for the HUD. */
  healthFraction(): number {
    return clamp(this.health / Math.max(1, this.maxHealth), 0, 1);
  }
}
