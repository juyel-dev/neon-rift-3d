import { describe, expect, it } from 'vitest';
import { buildArena } from '../src/sim/arena';
import { groundHeightAt, makeBox, moveWithCollision, segmentIntersectsBoxXZ } from '../src/sim/collision';
import { rayBox, raySphere } from '../src/sim/ray';

describe('collision primitives', () => {
  const floorBoxes = [makeBox({ x: 0, z: 0, halfWidth: 1, halfDepth: 1, y: 0, height: 1 })];

  it('keeps the entity out of a tall box when moving into it', () => {
    const result = moveWithCollision(0, 0, 5, 0, -6, 0.5, 0.7, floorBoxes);
    expect(result.z).toBeCloseTo(1.5, 3);
    expect(result.x).toBe(0);
  });

  it('ignores geometry that is far away from the movement path', () => {
    const result = moveWithCollision(5, 0, 5, 1, 1, 0.5, 0.7, floorBoxes);
    expect(result.x).toBeCloseTo(6, 3);
    expect(result.z).toBeCloseTo(6, 3);
  });

  it('resolves each axis independently so sliding works', () => {
    // Move diagonally into the box: at least one axis must keep moving.
    const result = moveWithCollision(5, 0, 5, 1, 1, 0.4, 0.62, floorBoxes);
    expect(result.x === 6 || result.z === 6).toBe(true);
  });

  it('allows stepping up small ledges', () => {
    const boxes = [makeBox({ x: 10, z: 0, halfWidth: 1, halfDepth: 2, y: 0, height: 0.4 })];
    const result = moveWithCollision(7.5, 0, 0, 1.5, 0, 0.4, 0.7, boxes);
    expect(result.y).toBeCloseTo(0.4, 5);
    expect(result.grounded).toBe(true);
  });

  it('blocks tall geometry that cannot be stepped on', () => {
    const boxes = [makeBox({ x: 10, z: 0, halfWidth: 1, halfDepth: 2, y: 0, height: 3 })];
    const result = moveWithCollision(7.5, 0, 0, 3, 0, 0.4, 0.7, boxes);
    expect(result.x).toBeLessThan(9);
    expect(result.y).toBe(0);
  });

  it('reports the highest walkable surface under a point', () => {
    const boxes = [makeBox({ x: 0, z: 0, halfWidth: 2, halfDepth: 2, y: 0, height: 1.2 })];
    expect(groundHeightAt(0, 0, 0.5, 1.2, 0.7, boxes)).toBe(1.2);
  });

  it('ignores surfaces that are too high to step on to', () => {
    const boxes = [makeBox({ x: 0, z: 0, halfWidth: 2, halfDepth: 2, y: 0, height: 3 })];
    expect(groundHeightAt(0, 0, 0.5, 0, 0.7, boxes)).toBe(0);
  });

  it('returns no ground when nothing is below', () => {
    expect(groundHeightAt(50, 50, 0.5, 0, 0.7, [])).toBe(0);
  });

  it('reports the surface an entity already stands on', () => {
    const boxes = [makeBox({ x: 0, z: 0, halfWidth: 2, halfDepth: 2, y: 0, height: 1.2 })];
    expect(groundHeightAt(0, 0, 0.5, 1.2 + 0.5, 0.7, boxes)).toBe(1.2);
  });

  it('clips a segment against a box footprint', () => {
    const box = makeBox({ x: 0, z: 0, halfWidth: 1, halfDepth: 1, y: 0, height: 5 });
    expect(segmentIntersectsBoxXZ(box, -5, 0, 5, 0)).toBe(true);
    expect(segmentIntersectsBoxXZ(box, -5, 5, 5, 5)).toBe(false);
    expect(segmentIntersectsBoxXZ(box, -5, 0, -2, 0)).toBe(false);
  });
});

describe('ray intersection', () => {
  it('hits a box in front of the ray', () => {
    const box = makeBox({ x: 0, z: -5, halfWidth: 1, halfDepth: 1, y: 0, height: 3 });
    const hit = rayBox({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, box, 100);
    expect(hit).not.toBeNull();
    expect(hit?.distance).toBeCloseTo(4, 5);
    expect(hit?.normal.z).toBe(1);
  });

  it('misses a box that is behind the ray', () => {
    const box = makeBox({ x: 0, z: 5, halfWidth: 1, halfDepth: 1, y: 0, height: 3 });
    const hit = rayBox({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, box, 100);
    expect(hit).toBeNull();
  });

  it('hits a sphere head on', () => {
    const t = raySphere({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: -10 }, 1);
    expect(t).toBeCloseTo(9, 5);
  });

  it('misses a sphere that is off axis', () => {
    const t = raySphere({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 5, y: 0, z: -10 }, 1);
    expect(t).toBeNull();
  });
});

describe('arena layout', () => {
  const arena = buildArena();

  it('produces solid geometry around the perimeter', () => {
    expect(arena.boxes.length).toBeGreaterThan(20);
  });

  it('gives the player a walkable spawn platform at the centre', () => {
    expect(arena.groundY).toBeGreaterThan(0);
    expect(arena.groundY).toBeLessThan(0.8);
    const height = groundHeightAt(0, 0, 0.5, arena.groundY, 0.7, arena.groundBoxes);
    expect(height).toBeCloseTo(1.1, 5);
  });

  it('lets the player walk up the central dais from the floor', () => {
    const height = groundHeightAt(4.8, 0, 0.5, 0, 0.7, arena.groundBoxes);
    expect(height).toBeCloseTo(0.55, 5);
  });

  it('never reports a wall or the core as a standable surface', () => {
    expect(arena.groundBoxes.length).toBeGreaterThan(arena.features.filter((f) => f.type === 'wall').length);
    for (const box of arena.groundBoxes) expect(box.max.y).toBeLessThanOrEqual(4);
  });

  it('keeps every collider inside a sane bound', () => {
    for (const box of arena.boxes) {
      expect(box.max.x).toBeLessThanOrEqual(arena.halfExtent + 2);
      expect(box.min.x).toBeGreaterThanOrEqual(-arena.halfExtent - 2);
      expect(box.max.y).toBeLessThanOrEqual(14);
    }
  });

  it('includes stairs that can be climbed step by step', () => {
    const stairs = arena.features.filter((feature) => feature.type === 'stair');
    expect(stairs.length).toBeGreaterThanOrEqual(20);
    for (const stair of stairs) {
      const height = stair.box.max.y;
      expect(height).toBeGreaterThan(0);
      expect(height).toBeLessThan(4);
    }
  });

  it('walls enclose the arena on all four sides', () => {
    const walls = arena.features.filter((feature) => feature.type === 'wall');
    expect(walls).toHaveLength(4);
  });
});
