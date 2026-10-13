import { clamp } from '../core/math';
import type { PlayerStats } from './types';

const SPREAD_GROWTH = 0.35;
const SPREAD_RECOVERY = 2.4;
const OVERDRIVE_DURATION = 7;
const OVERDRIVE_RATE_MULTIPLIER = 1.7;
const OVERDRIVE_DAMAGE_MULTIPLIER = 1.35;
const OVERDRIVE_SPEED_MULTIPLIER = 1.08;

/**
 * Weapon state: magazines, reloading, fire cadence, recoil bloom and the
 * Overdrive buff funded by collected energy. Pure logic, no rendering.
 */
export class WeaponState {
  ammoInMag: number;
  reserve: number;
  reloading = false;
  reloadTimer = 0;
  fireTimer = 0;
  spread = 0;
  bloom = 0;
  overdriveActive = false;
  overdriveTimer = 0;
  energy = 0;
  shotsSinceReload = 0;

  constructor(public stats: PlayerStats) {
    this.ammoInMag = stats.magSize;
    this.reserve = stats.reserveAmmo;
  }

  reset(stats: PlayerStats): void {
    this.stats = stats;
    this.ammoInMag = stats.magSize;
    this.reserve = stats.reserveAmmo;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireTimer = 0;
    this.spread = stats.spread;
    this.bloom = 0;
    this.overdriveActive = false;
    this.overdriveTimer = 0;
    this.energy = 0;
    this.shotsSinceReload = 0;
  }

  addReserve(amount: number): void {
    this.reserve += Math.max(0, Math.round(amount));
  }

  get canReload(): boolean {
    return !this.reloading && this.ammoInMag < this.stats.magSize && this.reserve > 0;
  }

  get rateMultiplier(): number {
    return this.overdriveActive ? OVERDRIVE_RATE_MULTIPLIER : 1;
  }

  get damageMultiplier(): number {
    return this.overdriveActive ? OVERDRIVE_DAMAGE_MULTIPLIER : 1;
  }

  get speedMultiplier(): number {
    return this.overdriveActive ? OVERDRIVE_SPEED_MULTIPLIER : 1;
  }

  get overdriveProgress(): number {
    return clamp(this.overdriveTimer / OVERDRIVE_DURATION, 0, 1);
  }

  get energyFraction(): number {
    return clamp(this.energy / Math.max(1, this.stats.overdriveCost), 0, 1);
  }

  get overdriveReady(): boolean {
    return this.energy >= this.stats.overdriveCost && !this.overdriveActive;
  }

  beginReload(): boolean {
    if (!this.canReload) return false;
    this.reloading = true;
    this.reloadTimer = this.stats.reloadTime;
    this.shotsSinceReload = 0;
    return true;
  }

  cancelReload(): void {
    this.reloading = false;
    this.reloadTimer = 0;
  }

  /** Adds energy from a pickup. Returns the amount accepted. */
  addEnergy(amount: number): number {
    if (this.overdriveActive) return 0;
    const before = this.energy;
    this.energy = Math.min(this.stats.overdriveCost, Math.max(0, this.energy + amount));
    return this.energy - before;
  }

  activateOverdrive(): boolean {
    if (!this.overdriveReady) return false;
    this.energy = 0;
    this.overdriveActive = true;
    this.overdriveTimer = OVERDRIVE_DURATION;
    return true;
  }

  /** Attempts to fire. Returns true when a round left the barrel. */
  tryFire(): boolean {
    if (this.reloading || this.fireTimer > 0) return false;
    if (this.ammoInMag <= 0) return false;
    this.ammoInMag -= 1;
    this.fireTimer = this.stats.fireInterval / this.rateMultiplier;
    this.shotsSinceReload += 1;
    this.bloom = Math.min(1, this.bloom + SPREAD_GROWTH);
    return true;
  }

  /** Current cone half-angle in radians (recoil bloom + base spread). */
  currentSpread(): number {
    return this.stats.spread * (1 + this.bloom * 3.2);
  }

  update(dt: number): void {
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.bloom = clamp(this.bloom - SPREAD_RECOVERY * dt, 0, 1);

    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const needed = this.stats.magSize - this.ammoInMag;
        const taken = Math.min(needed, this.reserve);
        this.ammoInMag += taken;
        this.reserve -= taken;
        this.reloading = false;
        this.reloadTimer = 0;
        this.spread = this.stats.spread;
      }
    }

    if (this.overdriveActive) {
      this.overdriveTimer = Math.max(0, this.overdriveTimer - dt);
      if (this.overdriveTimer === 0) this.overdriveActive = false;
    }

    // Auto-reload on an empty magazine keeps the flow going.
    if (!this.reloading && this.ammoInMag === 0 && this.reserve > 0) {
      this.beginReload();
    }
  }
}

export const OVERDRIVE_DURATION_SECONDS = OVERDRIVE_DURATION;
