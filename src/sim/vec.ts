/** Plain-object 3D vector math used by the simulation layer. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export function copy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function addScaled(out: Vec3, a: Vec3, scale: number): Vec3 {
  out.x += a.x * scale;
  out.y += a.y * scale;
  out.z += a.z * scale;
  return out;
}

export function lengthXZ(a: Vec3): number {
  return Math.hypot(a.x, a.z);
}

export function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Squared horizontal distance (cheap range comparisons). */
export function distanceXZSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function normalizeXZ(v: Vec3): Vec3 {
  const len = lengthXZ(v);
  if (len > 1e-6) {
    v.x /= len;
    v.z /= len;
  }
  return v;
}

export const EPSILON = 1e-6;
