import type { Box } from './collision';
import type { Vec3 } from './vec';

export interface RayHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
}

/** Slab-method ray/AABB intersection. `dir` must be normalized. */
export function rayBox(origin: Vec3, dir: Vec3, box: Box, maxDistance = Infinity): RayHit | null {
  let tmin = 0;
  let tmax = maxDistance;
  let hitAxis = 0;
  let hitSign = 1;

  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? origin.x : axis === 1 ? origin.y : origin.z;
    const d = axis === 0 ? dir.x : axis === 1 ? dir.y : dir.z;
    const min = axis === 0 ? box.min.x : axis === 1 ? box.min.y : box.min.z;
    const max = axis === 0 ? box.max.x : axis === 1 ? box.max.y : box.max.z;

    if (Math.abs(d) < 1e-8) {
      if (o < min || o > max) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (min - o) * inv;
    let t2 = (max - o) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      hitAxis = axis;
      hitSign = sign;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  const point = {
    x: origin.x + dir.x * tmin,
    y: origin.y + dir.y * tmin,
    z: origin.z + dir.z * tmin,
  };
  const normal = { x: 0, y: 0, z: 0 };
  if (hitAxis === 0) normal.x = hitSign;
  else if (hitAxis === 1) normal.y = hitSign;
  else normal.z = hitSign;
  return { distance: tmin, point, normal };
}

/** Nearest ray/AABB hit among a list of boxes. */
export function rayBoxes(origin: Vec3, dir: Vec3, maxDistance: number, boxes: readonly Box[]): RayHit | null {
  let best: RayHit | null = null;
  for (const box of boxes) {
    const hit = rayBox(origin, dir, box, best ? best.distance : maxDistance);
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  return best;
}

/** Ray/sphere intersection. Returns the entry distance or null. */
export function raySphere(origin: Vec3, dir: Vec3, center: Vec3, radius: number): number | null {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = -b - sqrtDisc;
  if (t1 >= 0) return t1;
  const t2 = -b + sqrtDisc;
  return t2 >= 0 ? t2 : null;
}
