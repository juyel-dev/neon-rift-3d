import type { Vec3 } from './vec';

/** Axis aligned bounding box used for every collider in the arena. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

export interface BoxSpec {
  /** Horizontal center. */
  x: number;
  z: number;
  /** Half extents on X/Z. */
  halfWidth: number;
  halfDepth: number;
  /** Bottom of the box. */
  y: number;
  height: number;
}

export function makeBox(spec: BoxSpec): Box {
  return {
    min: { x: spec.x - spec.halfWidth, y: spec.y, z: spec.z - spec.halfDepth },
    max: { x: spec.x + spec.halfWidth, y: spec.y + spec.height, z: spec.z + spec.halfDepth },
  };
}

export function boxContainsXZ(box: Box, x: number, z: number, padding = 0): boolean {
  return (
    x >= box.min.x - padding &&
    x <= box.max.x + padding &&
    z >= box.min.z - padding &&
    z <= box.max.z + padding
  );
}

/** True when a vertical circle at (x,z) overlaps the box footprint. */
export function boxOverlapsCircleXZ(box: Box, x: number, z: number, radius: number): boolean {
  const nearestX = Math.max(box.min.x, Math.min(x, box.max.x));
  const nearestZ = Math.min(box.max.z, Math.max(z, box.min.z));
  const dx = x - nearestX;
  const dz = z - nearestZ;
  return dx * dx + dz * dz < radius * radius;
}

export interface CollisionResult {
  x: number;
  z: number;
  y: number;
  grounded: boolean;
  groundY: number;
}

/**
 * Highest walkable surface below `feetY + stepHeight` under a vertical circle.
 * Returns `defaultGround` when nothing is found.
 */
export function groundHeightAt(
  x: number,
  z: number,
  radius: number,
  feetY: number,
  stepHeight: number,
  boxes: readonly Box[],
  defaultGround = 0,
): number {
  let best = defaultGround;
  for (const box of boxes) {
    if (box.max.y <= feetY + stepHeight && boxOverlapsCircleXZ(box, x, z, radius)) {
      if (box.max.y > best) best = box.max.y;
    }
  }
  return best;
}

/**
 * Axis-separated circle vs AABB movement resolution.
 *
 * Each axis is resolved independently (X first, then Z) which is stable for the
 * axis-aligned geometry used by the arena and avoids tunnelling and corner
 * snagging. Boxes whose top is within `stepHeight` of the feet are ignored so
 * the player can walk up stairs and small ledges.
 */
export function moveWithCollision(
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
  stepHeight: number,
  boxes: readonly Box[],
): CollisionResult {
  const feetY = y;
  const collided = (px: number, pz: number): boolean => {
    for (const box of boxes) {
      if (box.max.y > feetY + stepHeight && boxOverlapsCircleXZ(box, px, pz, radius - 0.001)) return true;
    }
    return false;
  };

  let newX = x + dx;
  if (collided(newX, z)) {
    // Try to slide the remaining distance along X in small steps for a nicer feel.
    let stepped = x;
    const steps = Math.ceil(Math.max(Math.abs(dx), 1e-4) / (radius * 0.5));
    const stepSize = dx / steps;
    for (let i = 0; i < steps; i++) {
      const candidate = stepped + stepSize;
      if (!collided(candidate, z)) stepped = candidate;
      else break;
    }
    newX = stepped;
  }

  let newZ = z + dz;
  if (collided(newX, newZ)) {
    let stepped = z;
    const steps = Math.ceil(Math.max(Math.abs(dz), 1e-4) / (radius * 0.5));
    const stepSize = dz / steps;
    for (let i = 0; i < steps; i++) {
      const candidate = stepped + stepSize;
      if (!collided(newX, candidate)) stepped = candidate;
      else break;
    }
    newZ = stepped;
  }

  const groundY = groundHeightAt(newX, newZ, radius, feetY, stepHeight, boxes);
  let newY = y;
  let grounded = false;
  if (newY <= groundY + 1e-3) {
    newY = groundY;
    grounded = true;
  }

  return { x: newX, y: newY, z: newZ, grounded, groundY };
}

/**
 * True when a horizontal segment is blocked by un-climbable geometry.
 * Uses the same step-height rule as the movement code so steering and collision agree.
 */
export function segmentBlockedByBoxes(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  feetY: number,
  stepHeight: number,
  boxes: readonly Box[],
): boolean {
  for (const box of boxes) {
    if (box.max.y <= feetY + stepHeight) continue;
    if (segmentIntersectsBoxXZ(box, fromX, fromZ, toX, toZ)) return true;
  }
  return false;
}

export function segmentIntersectsBoxXZ(
  box: Box,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): boolean {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const minX = Math.min(fromX, toX);
  const maxX = Math.max(fromX, toX);
  const minZ = Math.min(fromZ, toZ);
  const maxZ = Math.max(fromZ, toZ);

  // Cheap AABB overlap test first.
  if (maxX < box.min.x || minX > box.max.x || maxZ < box.min.z || minZ > box.max.z) return false;

  // Liang-Barsky clipping against the box in the XZ plane.
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dz, dz];
  const q = [fromX - box.min.x, box.max.x - fromX, fromZ - box.min.z, box.max.z - fromZ];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}
