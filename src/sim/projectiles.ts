import { ObjectPool } from '../core/objectPool';
import type { Vec3 } from './vec';
import { WORLD } from './types';
import type { World } from './world';

export interface ProjectileEntity {
  active: boolean;
  id: number;
  position: Vec3;
  velocity: Vec3;
  life: number;
  damage: number;
  radius: number;
}

export interface ProjectileHooks {
  onPlayerHit(damage: number, fromYaw: number): void;
  onWorldHit(point: Vec3, normal: Vec3, projectile: ProjectileEntity): void;
}

let nextProjectileId = 1;

/** Pooled enemy projectiles. One pool is reused for the whole session. */
export class ProjectileSystem {
  readonly pool: ObjectPool<ProjectileEntity>;

  constructor(private readonly world: World) {
    this.pool = new ObjectPool<ProjectileEntity>({
      factory: () => ({
        active: false,
        id: 0,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        life: 0,
        damage: 0,
        radius: 0.18,
      }),
      reset: (item) => {
        item.life = 0;
        item.damage = 0;
        item.position.x = 0;
        item.position.y = 0;
        item.position.z = 0;
        item.velocity.x = 0;
        item.velocity.y = 0;
        item.velocity.z = 0;
      },
      max: 256,
    });
  }

  get activeCount(): number {
    return this.pool.activeCount;
  }

  spawn(origin: Vec3, direction: Vec3, speed: number, damage: number): ProjectileEntity | null {
    const item = this.pool.acquire();
    if (!item) return null;
    item.id = nextProjectileId++;
    item.position.x = origin.x;
    item.position.y = origin.y;
    item.position.z = origin.z;
    item.velocity.x = direction.x * speed;
    item.velocity.y = direction.y * speed;
    item.velocity.z = direction.z * speed;
    item.life = 4.5;
    item.damage = damage;
    item.radius = 0.18;
    item.active = true;
    return item;
  }

  update(
    dt: number,
    playerX: number,
    playerY: number,
    playerZ: number,
    playerAlive: boolean,
    hooks: ProjectileHooks,
  ): void {
    for (const projectile of this.pool.items) {
      if (!projectile.active) continue;

      const prevX = projectile.position.x;
      const prevY = projectile.position.y;
      const prevZ = projectile.position.z;

      projectile.position.x += projectile.velocity.x * dt;
      projectile.position.y += projectile.velocity.y * dt;
      projectile.position.z += projectile.velocity.z * dt;
      projectile.life -= dt;

      let dead = projectile.life <= 0;

      if (!dead) {
        const dx = projectile.position.x - prevX;
        const dy = projectile.position.y - prevY;
        const dz = projectile.position.z - prevZ;
        const length = Math.hypot(dx, dy, dz);
        if (length > 1e-6) {
          const dir = { x: dx / length, y: dy / length, z: dz / length };
          const worldHit = this.world.raycast({ x: prevX, y: prevY, z: prevZ }, dir, length);
          if (worldHit) {
            projectile.position.x = worldHit.point.x;
            projectile.position.y = worldHit.point.y;
            projectile.position.z = worldHit.point.z;
            hooks.onWorldHit(worldHit.point, worldHit.normal, projectile);
            dead = true;
          }
        }
      }

      if (!dead && !this.world.isInsideArena(projectile.position.x, projectile.position.z, 0.2)) {
        dead = true;
      }

      if (!dead && playerAlive) {
        const eyeY = playerY + WORLD.eyeHeight * 0.65;
        const dx = projectile.position.x - playerX;
        const dy = projectile.position.y - eyeY;
        const dz = projectile.position.z - playerZ;
        const hitRange = projectile.radius + 0.5;
        if (dx * dx + dy * dy + dz * dz <= hitRange * hitRange) {
          const fromYaw = Math.atan2(-(playerX - prevX), -(playerZ - prevZ));
          hooks.onPlayerHit(projectile.damage, fromYaw);
          dead = true;
        }
      }

      if (dead) this.pool.release(projectile);
    }
  }

  clear(): void {
    this.pool.releaseAll();
  }
}
