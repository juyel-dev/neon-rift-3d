/**
 * Small, dependency-free math helpers shared by the game logic and the renderer.
 */
export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Linear interpolation that is independent of frame rate. */
export function damp(a: number, b: number, halfLife: number, dt: number): number {
  if (halfLife <= 0 || dt <= 0) return b;
  return lerp(a, b, 1 - Math.pow(2, -dt / halfLife));
}

/** Smooth Hermite interpolation between two scalars. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 === edge0) return 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Shortest signed angular difference (result in [-PI, PI]). */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

export function lerpAngle(from: number, to: number, t: number): number {
  return from + angleDelta(from, to) * t;
}

/** Remaps `value` from one range to another without clamping. */
export function remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return outMin;
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return target;
}

export function randomRange(min: number, max: number, rng: () => number = Math.random): number {
  return min + rng() * (max - min);
}

export function pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number, rng: () => number = Math.random): T {
  let total = 0;
  for (const item of items) total += Math.max(0, weightOf(item));
  if (total <= 0) return items[0];
  let roll = rng() * total;
  for (const item of items) {
    roll -= Math.max(0, weightOf(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

/** Formats a number with digit grouping used by the HUD. */
export function formatScore(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString('en-US');
}

/** Formats seconds as M:SS. */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
