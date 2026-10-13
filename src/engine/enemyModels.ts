import {
  AdditiveBlending,
  BoxGeometry,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Object3D,
  RingGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
} from 'three';
import type { EnemyKind } from '../sim/types';
import { PALETTE } from './procedural';

export interface EnemyModelParts {
  group: Group;
  /** Emissive materials that flash on hit and glow during attack windups. */
  emissives: Array<{ material: MeshStandardMaterial; base: number }>;
  /** Called every frame with the animation clock and enemy state. */
  animate: (time: number, state: EnemyAnimationState) => void;
}

export interface EnemyAnimationState {
  /** 0..1 progress through the current attack windup. */
  charge: number;
  state: 'spawn' | 'chase' | 'windup' | 'strike' | 'recover';
  spawnProgress: number;
  /** Recent hit flash, 0..1. */
  flash: number;
}

const KIND_COLOR: Record<EnemyKind, number> = {
  shade: PALETTE.magenta,
  warden: PALETTE.cyan,
  seeker: PALETTE.violet,
  bulwark: PALETTE.amber,
};

const GEOMETRY_CACHE = new Map<string, { dispose(): void }>();

function geometry<T extends { dispose(): void }>(key: string, factory: () => T): T {
  const cached = GEOMETRY_CACHE.get(key) as T | undefined;
  if (cached) return cached;
  const created = factory();
  GEOMETRY_CACHE.set(key, created);
  return created;
}

function emissiveMaterial(color: number, intensity: number, metalness = 0.45, roughness = 0.3): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: 0x0a121d,
    emissive: color,
    emissiveIntensity: intensity,
    metalness,
    roughness,
  });
}

/** Builds a procedural model for one enemy archetype (shared geometry, unique materials). */
export function buildEnemyModel(kind: EnemyKind): EnemyModelParts {
  switch (kind) {
    case 'warden':
      return buildWarden();
    case 'seeker':
      return buildSeeker();
    case 'bulwark':
      return buildBulwark();
    case 'shade':
    default:
      return buildShade();
  }
}

/** Melee pursuer: hulking bipedal sentry with blade arms. */
function buildWarden(): EnemyModelParts {
  const group = new Group();
  const emissives: EnemyModelParts['emissives'] = [];

  const bodyGeometry = geometry('warden:body', () => new OctahedronGeometry(0.62, 1));
  const bodyMaterial = new MeshStandardMaterial({ color: 0x1d2839, metalness: 0.9, roughness: 0.36 });
  const body = new Mesh(bodyGeometry, bodyMaterial);
  body.scale.set(1, 1.15, 0.85);
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);

  const headGeometry = geometry('warden:head', () => new BoxGeometry(0.42, 0.34, 0.5));
  const headMaterial = new MeshStandardMaterial({ color: 0x141d2b, metalness: 0.85, roughness: 0.4 });
  const head = new Mesh(headGeometry, headMaterial);
  head.position.set(0, 1.42, -0.08);
  group.add(head);

  const eyeGeometry = geometry('warden:eye', () => new SphereGeometry(0.12, 10, 8));
  const eyeMaterial = emissiveMaterial(KIND_COLOR.warden, 4);
  emissives.push({ material: eyeMaterial, base: 4 });
  const eye = new Mesh(eyeGeometry, eyeMaterial);
  eye.position.set(0, 1.44, -0.36);
  group.add(eye);

  const bladeGeometry = geometry('warden:blade', () => new ConeGeometry(0.16, 1.15, 6));
  const bladeMaterial = new MeshStandardMaterial({ color: 0x2b3648, metalness: 0.95, roughness: 0.22 });
  const blades = new Group();
  for (const side of [-1, 1]) {
    const blade = new Mesh(bladeGeometry, bladeMaterial);
    blade.position.set(side * 0.52, 0.95, -0.3);
    blade.rotation.set(Math.PI * 0.62, 0, side * 0.25);
    blade.castShadow = true;
    blades.add(blade);
  }
  group.add(blades);

  const legGeometry = geometry('warden:leg', () => new BoxGeometry(0.2, 0.75, 0.24));
  const legMaterial = new MeshStandardMaterial({ color: 0x161f2e, metalness: 0.85, roughness: 0.45 });
  const legs = new Group();
  for (const side of [-1, 1]) {
    const leg = new Mesh(legGeometry, legMaterial);
    leg.position.set(side * 0.26, 0.38, 0);
    leg.castShadow = true;
    legs.add(leg);
  }
  group.add(legs);

  const shoulderGeometry = geometry('warden:shoulder', () => new BoxGeometry(0.34, 0.28, 0.5));
  const shoulderMaterial = new MeshStandardMaterial({ color: 0x223046, metalness: 0.9, roughness: 0.32 });
  for (const side of [-1, 1]) {
    const shoulder = new Mesh(shoulderGeometry, shoulderMaterial);
    shoulder.position.set(side * 0.62, 1.12, 0);
    group.add(shoulder);
  }

  let stride = 0;

  return {
    group,
    emissives,
    animate: (time, state) => {
      const flash = state.flash;
      eyeMaterial.emissiveIntensity = 3 + Math.sin(time * 6) * 0.8 + state.charge * 2.5 + flash * 2.5;
      const walking = Math.sin(time * 9) * 0.16;
      legs.children.forEach((leg, index) => {
        leg.position.y = 0.38 + Math.max(0, walking * (index === 0 ? 1 : -1));
      });
      stride += 0;
      body.position.y = 0.95 + Math.abs(Math.sin(time * 9)) * 0.05;
      blades.rotation.x = -state.charge * 0.9;
      blades.position.z = state.charge * 0.25;
      head.rotation.x = state.charge * 0.25;
      void stride;
    },
  };
}

/** Ranged attacker: floating orrery with an orbiting ring and charge core. */
function buildSeeker(): EnemyModelParts {
  const group = new Group();
  const emissives: EnemyModelParts['emissives'] = [];

  const shellGeometry = geometry('seeker:shell', () => new IcosahedronGeometry(0.72, 1));
  const shellMaterial = new MeshStandardMaterial({
    color: 0x141a2c,
    metalness: 0.9,
    roughness: 0.28,
    transparent: true,
    opacity: 0.96,
  });
  const shell = new Mesh(shellGeometry, shellMaterial);
  shell.position.y = 1.0;
  shell.castShadow = true;
  group.add(shell);

  const coreGeometry = geometry('seeker:core', () => new IcosahedronGeometry(0.34, 0));
  const coreMaterial = emissiveMaterial(KIND_COLOR.seeker, 3.4);
  emissives.push({ material: coreMaterial, base: 3.4 });
  const core = new Mesh(coreGeometry, coreMaterial);
  core.position.y = 1.0;
  group.add(core);

  const ringGeometry = geometry('seeker:ring', () => new TorusGeometry(0.95, 0.05, 6, 32));
  const ringMaterial = emissiveMaterial(KIND_COLOR.seeker, 2.2, 0.6, 0.2);
  emissives.push({ material: ringMaterial, base: 2.2 });
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.position.y = 1.0;
  ring.rotation.x = Math.PI * 0.5;
  group.add(ring);

  const shardGeometry = geometry('seeker:shard', () => new TetrahedronGeometry(0.16, 0));
  const shardMaterial = emissiveMaterial(PALETTE.cyan, 1.6);
  emissives.push({ material: shardMaterial, base: 1.6 });
  const shards: Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const shard = new Mesh(shardGeometry, shardMaterial);
    shards.push(shard);
    group.add(shard);
  }

  const telegraphGeometry = geometry('seeker:telegraph', () => new RingGeometry(0.3, 0.42, 24));
  const telegraphMaterial = new MeshBasicMaterial({
    color: PALETTE.magenta,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const telegraph = new Mesh(telegraphGeometry, telegraphMaterial);
  telegraph.rotation.x = -Math.PI / 2;
  telegraph.position.y = 1.0;
  group.add(telegraph);

  return {
    group,
    emissives,
    animate: (time, state) => {
      const hover = Math.sin(time * 2.2) * 0.12;
      shell.position.y = 1.0 + hover;
      core.position.y = 1.0 + hover;
      ring.position.y = 1.0 + hover;
      ring.rotation.z = time * 1.6;
      ring.rotation.x = Math.PI * 0.5 + Math.sin(time) * 0.2;

      shards.forEach((shard, index) => {
        const angle = time * 2.4 + (index / shards.length) * Math.PI * 2;
        shard.position.set(Math.cos(angle) * 1.05, 1.0 + hover + Math.sin(angle * 1.4) * 0.2, Math.sin(angle) * 1.05);
        shard.rotation.set(angle, angle * 1.3, 0);
      });

      const charge = state.charge;
      coreMaterial.emissiveIntensity = 2.6 + charge * 3.5 + state.flash * 3;
      core.scale.setScalar(1 + charge * 0.7);
      telegraphMaterial.opacity = charge * 0.75;
      telegraph.scale.setScalar(1 + charge * 0.5);
      shellMaterial.opacity = 0.96 - charge * 0.25;
    },
  };
}

/** Heavy unit: armoured mech with a bright chest slit and shoulder plates. */
function buildBulwark(): EnemyModelParts {
  const group = new Group();
  const emissives: EnemyModelParts['emissives'] = [];

  const torsoGeometry = geometry('bulwark:torso', () => new BoxGeometry(1.9, 1.5, 1.35));
  const torsoMaterial = new MeshStandardMaterial({ color: 0x1a2233, metalness: 0.92, roughness: 0.34 });
  const torso = new Mesh(torsoGeometry, torsoMaterial);
  torso.position.y = 1.55;
  torso.castShadow = true;
  group.add(torso);

  const slitGeometry = geometry('bulwark:slit', () => new BoxGeometry(0.9, 0.16, 0.12));
  const slitMaterial = emissiveMaterial(KIND_COLOR.bulwark, 2.6);
  emissives.push({ material: slitMaterial, base: 2.6 });
  const slit = new Mesh(slitGeometry, slitMaterial);
  slit.position.set(0, 1.62, -0.72);
  group.add(slit);

  const headGeometry = geometry('bulwark:head', () => new BoxGeometry(0.7, 0.42, 0.6));
  const headMaterial = new MeshStandardMaterial({ color: 0x111927, metalness: 0.9, roughness: 0.4 });
  const head = new Mesh(headGeometry, headMaterial);
  head.position.set(0, 2.42, -0.1);
  head.castShadow = true;
  group.add(head);

  const visorGeometry = geometry('bulwark:visor', () => new BoxGeometry(0.56, 0.1, 0.06));
  const visorMaterial = emissiveMaterial(PALETTE.magenta, 2.2);
  emissives.push({ material: visorMaterial, base: 2.2 });
  const visor = new Mesh(visorGeometry, visorMaterial);
  visor.position.set(0, 2.44, -0.42);
  group.add(visor);

  const padGeometry = geometry('bulwark:pad', () => new BoxGeometry(0.75, 0.62, 1.2));
  const padMaterial = new MeshStandardMaterial({ color: 0x222d42, metalness: 0.94, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const pad = new Mesh(padGeometry, padMaterial);
    pad.position.set(side * 1.16, 1.6, 0);
    pad.castShadow = true;
    group.add(pad);
  }

  const legGeometry = geometry('bulwark:leg', () => new BoxGeometry(0.62, 1.0, 0.72));
  const legMaterial = new MeshStandardMaterial({ color: 0x151d2c, metalness: 0.9, roughness: 0.42 });
  for (const side of [-1, 1]) {
    const leg = new Mesh(legGeometry, legMaterial);
    leg.position.set(side * 0.55, 0.5, 0);
    leg.castShadow = true;
    group.add(leg);
  }

  const telegraphGeometry = geometry('bulwark:telegraph', () => new RingGeometry(1.6, 2.5, 28));
  const telegraphMaterial = new MeshBasicMaterial({
    color: PALETTE.amber,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const telegraph = new Mesh(telegraphGeometry, telegraphMaterial);
  telegraph.rotation.x = -Math.PI / 2;
  telegraph.position.y = 0.08;
  group.add(telegraph);

  return {
    group,
    emissives,
    animate: (time, state) => {
      const charge = state.charge;
      const stomp = Math.max(0, Math.sin(time * 4.2));
      torso.position.y = 1.55 + stomp * 0.06 - charge * 0.16;
      head.position.y = 2.42 + stomp * 0.06 - charge * 0.3;
      slit.position.y = torso.position.y + 0.07;
      slitMaterial.emissiveIntensity = 2.2 + charge * 4 + state.flash * 3;
      visorMaterial.emissiveIntensity = 1.8 + charge * 2 + state.flash * 2.5;
      telegraphMaterial.opacity = charge * 0.8;
      telegraph.scale.setScalar(1 + charge * 0.35);
      group.rotation.z = Math.sin(time * 2) * 0.02;
    },
  };
}

/** Swarm unit: fast tetrahedral drone with orbiting shards. */
function buildShade(): EnemyModelParts {
  const group = new Group();
  const emissives: EnemyModelParts['emissives'] = [];

  const bodyGeometry = geometry('shade:body', () => new TetrahedronGeometry(0.42, 0));
  const bodyMaterial = new MeshStandardMaterial({ color: 0x1a1428, metalness: 0.8, roughness: 0.3 });
  const body = new Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);

  const coreGeometry = geometry('shade:core', () => new OctahedronGeometry(0.2, 0));
  const coreMaterial = emissiveMaterial(KIND_COLOR.shade, 3.6);
  emissives.push({ material: coreMaterial, base: 3.6 });
  const core = new Mesh(coreGeometry, coreMaterial);
  core.position.y = 0.55;
  group.add(core);

  const shardGeometry = geometry('shade:shard', () => new TetrahedronGeometry(0.13, 0));
  const shardMaterial = emissiveMaterial(PALETTE.violet, 2.4);
  emissives.push({ material: shardMaterial, base: 2.4 });
  for (let i = 0; i < 2; i++) {
    const shard = new Mesh(shardGeometry, shardMaterial);
    shard.name = `shade-shard-${i}`;
    group.add(shard);
  }

  return {
    group,
    emissives,
    animate: (time, state) => {
      body.rotation.x = time * 3.4;
      body.rotation.y = time * 2.2;
      core.rotation.y = -time * 5;
      coreMaterial.emissiveIntensity = 2.8 + state.charge * 3 + state.flash * 3;
      const children = group.children.filter((child) => child.name.startsWith('shade-shard'));
      children.forEach((shard, index) => {
        const angle = time * 4.5 + (index / children.length) * Math.PI * 2;
        shard.position.set(Math.cos(angle) * 0.6, 0.55 + Math.sin(angle * 1.5) * 0.3, Math.sin(angle) * 0.6);
        shard.rotation.set(angle, angle * 1.2, 0);
      });
    },
  };
}

/** Disposes the shared geometry cache (only used when tearing the engine down). */
export function disposeEnemyGeometryCache(): void {
  for (const item of GEOMETRY_CACHE.values()) item.dispose();
  GEOMETRY_CACHE.clear();
}

export const ENEMY_COLORS = KIND_COLOR;
