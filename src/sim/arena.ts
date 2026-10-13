import { createRng } from '../core/rng';
import { makeBox, type Box } from './collision';

export type ArenaFeatureType = 'floor' | 'wall' | 'dais' | 'platform' | 'stair' | 'pillar' | 'pylon' | 'cover' | 'core';

export interface ArenaFeature {
  type: ArenaFeatureType;
  box: Box;
  /** Renderer hint, e.g. which trim colour to use. */
  variant?: string;
}

export interface ArenaData {
  halfExtent: number;
  wallHeight: number;
  /** Every solid collider, including walls and obstacles. */
  boxes: Box[];
  /** Colliders that can be stood on (floor, dais, platforms, stairs, cover). */
  groundBoxes: Box[];
  features: ArenaFeature[];
  /** Positions where enemies prefer to spawn (border anchors). */
  spawnAnchors: Array<{ x: number; z: number }>;
  /** Elevation the player starts on. */
  groundY: number;
}

export const ARENA_SEED = 1337;

/**
 * Approximates a cylinder with an octagon made of axis aligned boxes.
 *
 * The octagon is the classic "3x3 grid minus the corners": five boxes that
 * together form a regular octagon with the given apothem (`radius`). Using an
 * apothem (and not a circumradius) means the collision hull fully contains the
 * cylinder drawn with the same radius.
 */
function octagonCollider(cx: number, cz: number, radius: number, bottom: number, height: number): Box[] {
  const t = radius / 3;
  const boxes: Box[] = [
    makeBox({ x: cx, z: cz, halfWidth: t, halfDepth: t, y: bottom, height }),
    makeBox({ x: cx + 2 * t, z: cz, halfWidth: t, halfDepth: t, y: bottom, height }),
    makeBox({ x: cx - 2 * t, z: cz, halfWidth: t, halfDepth: t, y: bottom, height }),
    makeBox({ x: cx, z: cz + 2 * t, halfWidth: t, halfDepth: t, y: bottom, height }),
    makeBox({ x: cx, z: cz - 2 * t, halfWidth: t, halfDepth: t, y: bottom, height }),
  ];
  return boxes;
}

const PLATFORM_POSITIONS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 19, z: 19 },
  { x: -19, z: 19 },
  { x: 19, z: -19 },
  { x: -19, z: -19 },
];

const PLATFORM_HALF = 6;
const PLATFORM_HEIGHT = 3.6;
const STEP_HEIGHT = 0.6;
const STEP_DEPTH = 1.2;
const STEP_COUNT = PLATFORM_HEIGHT / STEP_HEIGHT;

const COVER_LAYOUT: ReadonlyArray<{ x: number; z: number; w: number; d: number; h: number }> = [
  { x: 8, z: -8, w: 3.4, d: 2.0, h: 1.4 },
  { x: -8, z: 8, w: 2.0, d: 3.4, h: 1.9 },
  { x: -9, z: -4, w: 2.2, d: 2.2, h: 2.4 },
  { x: 9, z: 4, w: 2.2, d: 2.2, h: 2.4 },
  { x: 0, z: -17, w: 4.0, d: 1.6, h: 1.2 },
  { x: 0, z: 17, w: 1.6, d: 4.0, h: 1.2 },
  { x: -17, z: 0, w: 1.6, d: 4.0, h: 1.2 },
  { x: 26, z: 10, w: 2.6, d: 2.6, h: 2.0 },
  { x: -26, z: -10, w: 2.6, d: 2.6, h: 2.0 },
  { x: 13, z: 27, w: 3.2, d: 2.0, h: 1.6 },
  { x: -13, z: -27, w: 3.2, d: 2.0, h: 1.6 },
  { x: 27, z: -24, w: 2.2, d: 3.0, h: 1.8 },
  { x: -27, z: 24, w: 2.2, d: 3.0, h: 1.8 },
];

/**
 * Builds the deterministic arena layout. The collision boxes produced here are
 * the exact ones used by the simulation, and the renderer builds its meshes from
 * the same feature list, so visuals and physics can never drift apart.
 */
export function buildArena(halfExtent = 36, wallHeight = 9): ArenaData {
  const rng = createRng(ARENA_SEED);
  const features: ArenaFeature[] = [];
  const boxes: Box[] = [];
  const groundBoxes: Box[] = [];

  const add = (type: ArenaFeatureType, box: Box, variant?: string): void => {
    features.push({ type, box, variant });
    boxes.push(box);
    if (STANDABLE_TYPES.has(type)) groundBoxes.push(box);
  };

  add('floor', makeBox({ x: 0, z: 0, halfWidth: halfExtent, halfDepth: halfExtent, y: 0, height: 0 }));

  // Perimeter walls.
  const t = 1;
  add('wall', makeBox({ x: 0, z: -halfExtent - t / 2, halfWidth: halfExtent + t, halfDepth: t / 2, y: 0, height: wallHeight }), 'north');
  add('wall', makeBox({ x: 0, z: halfExtent + t / 2, halfWidth: halfExtent + t, halfDepth: t / 2, y: 0, height: wallHeight }), 'south');
  add('wall', makeBox({ x: -halfExtent - t / 2, z: 0, halfWidth: t / 2, halfDepth: halfExtent + t, y: 0, height: wallHeight }), 'west');
  add('wall', makeBox({ x: halfExtent + t / 2, z: 0, halfWidth: t / 2, halfDepth: halfExtent + t, y: 0, height: wallHeight }), 'east');

  // Central dais: two octagonal tiers so both the player and ground units can
  // walk onto it. The reactive core stands on the inner tier.
  const daisRadius = 5.4;
  for (const box of octagonCollider(0, 0, daisRadius, 0, 0.55)) add('dais', box, 'outer');
  for (const box of octagonCollider(0, 0, 2.9, 0.55, 0.55)) add('dais', box, 'inner');
  for (const box of octagonCollider(0, 0, 1.6, 1.1, 3.4)) add('core', box, 'main');

  // Four corner platforms with ascending stair runs on their inner faces.
  for (const pos of PLATFORM_POSITIONS) {
    add(
      'platform',
      makeBox({ x: pos.x, z: pos.z, halfWidth: PLATFORM_HALF, halfDepth: PLATFORM_HALF, y: 0, height: PLATFORM_HEIGHT }),
    );
    const dirX = pos.x > 0 ? -1 : 1;
    const dirZ = pos.z > 0 ? -1 : 1;
    const alongX = Math.abs(pos.x) >= Math.abs(pos.z);
    for (let i = 0; i < STEP_COUNT; i++) {
      const height = PLATFORM_HEIGHT - i * STEP_HEIGHT;
      const offset = PLATFORM_HALF + STEP_DEPTH * 0.5 + i * STEP_DEPTH;
      if (alongX) {
        add(
          'stair',
          makeBox({
            x: pos.x + dirX * offset,
            z: pos.z,
            halfWidth: STEP_DEPTH / 2,
            halfDepth: 3.2,
            y: 0,
            height,
          }),
        );
      } else {
        add(
          'stair',
          makeBox({
            x: pos.x,
            z: pos.z + dirZ * offset,
            halfWidth: 3.2,
            halfDepth: STEP_DEPTH / 2,
            y: 0,
            height,
          }),
        );
      }
    }
  }

  // Structural pillars around the arena.
  const pillarSpecs: ReadonlyArray<{ x: number; z: number; r: number; h: number }> = [
    { x: 0, z: 12, r: 1.6, h: 7.2 },
    { x: 0, z: -12, r: 1.6, h: 7.2 },
    { x: 12, z: 0, r: 1.6, h: 7.2 },
    { x: -12, z: 0, r: 1.6, h: 7.2 },
    { x: 23, z: 23, r: 1.25, h: 6 },
    { x: -23, z: -23, r: 1.25, h: 6 },
    { x: 23, z: -23, r: 1.25, h: 6 },
    { x: -23, z: 23, r: 1.25, h: 6 },
  ];
  for (const pillar of pillarSpecs) {
    for (const box of octagonCollider(pillar.x, pillar.z, pillar.r, 0, pillar.h)) {
      add('pillar', box, 'column');
    }
  }

  // Tall neon obelisks near the corners of the arena.
  for (const pos of PLATFORM_POSITIONS) {
    const px = pos.x * 1.42;
    const pz = pos.z * 1.42;
    for (const box of octagonCollider(px, pz, 1.7, 0, 13)) add('pylon', box, 'obelisk');
  }

  // Scattered cover with deterministic procedural variation.
  let variant = 0;
  for (const cover of COVER_LAYOUT) {
    const jitterX = rng.range(-0.5, 0.5);
    const jitterZ = rng.range(-0.5, 0.5);
    const scale = rng.range(0.9, 1.15);
    add(
      'cover',
      makeBox({
        x: cover.x + jitterX,
        z: cover.z + jitterZ,
        halfWidth: (cover.w / 2) * scale,
        halfDepth: (cover.d / 2) * scale,
        y: 0,
        height: cover.h * scale,
      }),
      variant % 2 === 0 ? 'a' : 'b',
    );
    variant++;
  }

  const spawnAnchors: Array<{ x: number; z: number }> = [
    { x: halfExtent - 3, z: 0 },
    { x: -(halfExtent - 3), z: 0 },
    { x: 0, z: halfExtent - 3 },
    { x: 0, z: -(halfExtent - 3) },
    { x: halfExtent - 4, z: halfExtent - 4 },
    { x: -(halfExtent - 4), z: -(halfExtent - 4) },
    { x: halfExtent - 4, z: -(halfExtent - 4) },
    { x: -(halfExtent - 4), z: halfExtent - 4 },
  ];

  return { halfExtent, wallHeight, boxes, groundBoxes, features, spawnAnchors, groundY: 0.55 };
}

const STANDABLE_TYPES: ReadonlySet<ArenaFeatureType> = new Set<ArenaFeatureType>([
  'floor',
  'dais',
  'platform',
  'stair',
  'cover',
]);
