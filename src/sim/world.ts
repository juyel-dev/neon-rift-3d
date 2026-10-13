import { buildArena, type ArenaData } from './arena';
import {
  boxOverlapsCircleXZ,
  groundHeightAt,
  moveWithCollision,
  segmentBlockedByBoxes,
  type Box,
  type CollisionResult,
} from './collision';
import { rayBoxes, type RayHit } from './ray';
import type { Vec3 } from './vec';
import { WORLD } from './types';

/** Static world access: collision, ground queries and visibility tests. */
export class World {
  readonly arena: ArenaData;
  readonly stepHeight = WORLD.stepHeight;

  constructor(arena: ArenaData = buildArena()) {
    this.arena = arena;
  }

  get halfExtent(): number {
    return this.arena.halfExtent;
  }

  get boxes(): readonly Box[] {
    return this.arena.boxes;
  }

  groundHeightAt(x: number, z: number, feetY: number): number {
    return groundHeightAt(x, z, WORLD.playerRadius, feetY, WORLD.stepHeight, this.arena.groundBoxes);
  }

  /**
   * Highest walkable surface directly under a point, ignoring the step-up rule.
   * Used to place entities on the floor (never on walls, cores or pylons).
   */
  surfaceHeightAt(x: number, z: number): number {
    let best = 0;
    for (const box of this.arena.groundBoxes) {
      if (
        x >= box.min.x - WORLD.playerRadius &&
        x <= box.max.x + WORLD.playerRadius &&
        z >= box.min.z - WORLD.playerRadius &&
        z <= box.max.z + WORLD.playerRadius &&
        box.max.y > best
      ) {
        best = box.max.y;
      }
    }
    return best;
  }

  moveEntity(x: number, y: number, z: number, dx: number, dz: number, radius: number): CollisionResult {
    return moveWithCollision(x, y, z, dx, dz, radius, WORLD.stepHeight, this.arena.boxes);
  }

  raycast(origin: Vec3, dir: Vec3, maxDistance: number): RayHit | null {
    return rayBoxes(origin, dir, maxDistance, this.arena.boxes);
  }

  /** True when a straight horizontal path is blocked by tall geometry. */
  /** True when a vertical circle at (x,z) is free of un-climbable geometry. */
  isFreePosition(x: number, z: number, radius: number): boolean {
    for (const box of this.arena.boxes) {
      if (box.max.y <= this.stepHeight) continue;
      if (boxOverlapsCircleXZ(box, x, z, radius)) return false;
    }
    return true;
  }

  /**
   * Finds a free spot on one of the arena border anchors, choosing the anchor
   * that is furthest away from the player.
   */
  findFreeAnchor(playerX: number, playerZ: number, radius: number): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestDistance = -1;
    for (const anchor of this.arena.spawnAnchors) {
      if (!this.isFreePosition(anchor.x, anchor.z, radius)) continue;
      const distance = Math.hypot(anchor.x - playerX, anchor.z - playerZ);
      if (distance > bestDistance) {
        bestDistance = distance;
        best = { x: anchor.x, z: anchor.z };
      }
    }
    return best;
  }

  /** True when a straight horizontal path is blocked by un-climbable geometry. */
  isPathBlocked(fromX: number, fromZ: number, toX: number, toZ: number, feetY: number): boolean {
    return segmentBlockedByBoxes(fromX, fromZ, toX, toZ, feetY, WORLD.stepHeight, this.arena.boxes);
  }

  isInsideArena(x: number, z: number, padding = 0): boolean {
    const limit = this.arena.halfExtent - padding;
    return x >= -limit && x <= limit && z >= -limit && z <= limit;
  }
}
