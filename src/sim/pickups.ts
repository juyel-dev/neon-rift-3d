import { ObjectPool } from '../core/objectPool';
import { WORLD } from './types';
import type { Vec3 } from './vec';
import type { World } from './world';

export type PickupKind = 'energy' | 'health';

export interface PickupEntity {
  active: boolean;
  id: number;
  kind: PickupKind;
  position: Vec3;
  velocity: Vec3;
  life: number;
  maxLife: number;
  value: number;
  bobPhase: number;
}

export interface CollectedPickup {
  kind: PickupKind;
  value: number;
  position: Vec3;
}

let nextPickupId = 1;

const MAGNET_RANGE = 4.2;
const COLLECT_RANGE = 1.15;
const PICKUP_LIFE = 24;
const LIFETIME_GRAVITY = 16;

/** Pooled energy/health drops with magnetism, scatter physics and expiry. */
export class PickupSystem {
  readonly pool: ObjectPool<PickupEntity>;

  constructor(private readonly world: World) {
    this.pool = new ObjectPool<PickupEntity>({
      factory: () => ({
        active: false,
        id: 0,
        kind: 'energy',
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        life: 0,
        maxLife: PICKUP_LIFE,
        value: 1,
        bobPhase: 0,
      }),
      reset: (item) => {
        item.life = 0;
        item.value = 1;
        item.velocity.x = 0;
        item.velocity.y = 0;
        item.velocity.z = 0;
      },
      max: 512,
    });
  }

  get activeCount(): number {
    return this.pool.activeCount;
  }

  spawn(kind: PickupKind, position: Vec3, value: number, scatterAngle: number, scatterSpeed: number): void {
    const item = this.pool.acquire();
    if (!item) return;
    item.id = nextPickupId++;
    item.kind = kind;
    item.active = true;
    item.position.x = position.x;
    item.position.y = position.y + 0.6;
    item.position.z = position.z;
    item.velocity.x = Math.cos(scatterAngle) * scatterSpeed;
    item.velocity.z = Math.sin(scatterAngle) * scatterSpeed;
    item.velocity.y = 3.2;
    item.life = PICKUP_LIFE;
    item.maxLife = PICKUP_LIFE;
    item.value = value;
    item.bobPhase = Math.random() * Math.PI * 2;
  }

  /** Advances the pickups and returns everything collected this frame. */
  update(dt: number, playerX: number, playerY: number, playerZ: number, collected: CollectedPickup[]): void {
    collected.length = 0;
    for (const pickup of this.pool.items) {
      if (!pickup.active) continue;
      pickup.life -= dt;
      if (pickup.life <= 0) {
        this.pool.release(pickup);
        continue;
      }

      // Magnetism towards the player.
      const dx = playerX - pickup.position.x;
      const dy = playerY + 0.8 - pickup.position.y;
      const dz = playerZ - pickup.position.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance < MAGNET_RANGE) {
        const pull = (1 - distance / MAGNET_RANGE) * 26;
        pickup.velocity.x += (dx / Math.max(0.001, distance)) * pull * dt;
        pickup.velocity.z += (dz / Math.max(0.001, distance)) * pull * dt;
        pickup.velocity.y += (dy / Math.max(0.001, distance)) * pull * dt;
      }

      pickup.velocity.y -= LIFETIME_GRAVITY * dt;
      const drag = Math.max(0, 1 - 1.6 * dt);
      pickup.velocity.x *= drag;
      pickup.velocity.z *= drag;

      pickup.position.x += pickup.velocity.x * dt;
      pickup.position.y += pickup.velocity.y * dt;
      pickup.position.z += pickup.velocity.z * dt;

      const groundY = this.world.groundHeightAt(pickup.position.x, pickup.position.z, pickup.position.y) + 0.35;
      if (pickup.position.y <= groundY) {
        pickup.position.y = groundY;
        pickup.velocity.y = Math.abs(pickup.velocity.y) > 1.2 ? Math.abs(pickup.velocity.y) * 0.32 : 0;
        pickup.velocity.x *= 0.7;
        pickup.velocity.z *= 0.7;
      }

      const verticalDistance = Math.hypot(
        playerX - pickup.position.x,
        playerY + 0.9 - pickup.position.y,
        playerZ - pickup.position.z,
      );
      if (verticalDistance <= COLLECT_RANGE) {
        collected.push({ kind: pickup.kind, value: pickup.value, position: { ...pickup.position } });
        this.pool.release(pickup);
      }
    }
  }

  clear(): void {
    this.pool.releaseAll();
  }
}

export const PICKUP_CONSTANTS = {
  MAGNET_RANGE,
  COLLECT_RANGE,
  PICKUP_LIFE,
  EYE_OFFSET: WORLD.eyeHeight,
};
