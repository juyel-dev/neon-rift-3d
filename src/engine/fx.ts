import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
} from 'three';
import { ObjectPool } from '../core/objectPool';
import { createGlowTexture, createRingTexture, createSparkTexture } from './procedural';

interface Particle {
  active: boolean;
  position: [number, number, number];
  velocity: [number, number, number];
  life: number;
  maxLife: number;
  size: number;
  color: Color;
  gravity: number;
  drag: number;
}

interface Tracer {
  active: boolean;
  life: number;
  points: [number, number, number, number, number, number];
  color: Color;
}

interface Decal {
  active: boolean;
  mesh: Mesh;
  life: number;
  maxLife: number;
  growth: number;
}

export interface ShockwaveRequest {
  position: { x: number; y: number; z: number };
  radius: number;
  color: number;
  duration: number;
}

const MAX_PARTICLES = 2200;
const MAX_TRACERS = 48;
const MAX_DECALS = 24;

/**
 * All GPU-side feedback: sparks, muzzle flashes, tracers, impact sprites and
 * shockwave rings. Everything is pooled and driven by a handful of draw calls.
 */
export class FxSystem {
  readonly group = new Group();
  private readonly particles = new ObjectPool<Particle>({
    factory: () => ({
      active: false,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      life: 0,
      maxLife: 1,
      size: 0.1,
      color: new Color(),
      gravity: 0,
      drag: 1,
    }),
    reset: (particle) => {
      particle.life = 0;
      particle.gravity = 0;
      particle.drag = 1;
    },
    max: MAX_PARTICLES,
  });

  private readonly tracerPool = new ObjectPool<Tracer>({
    factory: () => ({ active: false, life: 0, points: [0, 0, 0, 0, 0, 0], color: new Color() }),
    reset: (tracer) => {
      tracer.life = 0;
    },
    max: MAX_TRACERS,
  });

  private readonly decals: Decal[] = [];
  private readonly sparksTexture = createSparkTexture();
  private readonly glowTexture = createGlowTexture();
  private readonly ringTexture = createRingTexture();

  private readonly pointsGeometry: BufferGeometry;
  private readonly pointsMaterial: PointsMaterial;
  private readonly points: Points;
  private positionAttribute: BufferAttribute;
  private colorAttribute: BufferAttribute;
  private sizeAttribute: BufferAttribute;

  private readonly tracerGeometry: BufferGeometry;
  private readonly tracerMaterial: LineBasicMaterial;
  private readonly tracers: LineSegments;
  private tracerPositionAttribute: BufferAttribute;

  constructor() {
    // Sprites.
    this.pointsGeometry = new BufferGeometry();
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colors = new Float32Array(MAX_PARTICLES * 3);
    const sizes = new Float32Array(MAX_PARTICLES);
    this.positionAttribute = new BufferAttribute(positions, 3);
    this.colorAttribute = new BufferAttribute(colors, 3);
    this.sizeAttribute = new BufferAttribute(sizes, 1);
    this.positionAttribute.setUsage(35048 /* DynamicDrawUsage */);
    this.colorAttribute.setUsage(35048);
    this.sizeAttribute.setUsage(35048);
    this.pointsGeometry.setAttribute('position', this.positionAttribute);
    this.pointsGeometry.setAttribute('color', this.colorAttribute);
    this.pointsGeometry.setAttribute('size', this.sizeAttribute);

    this.pointsMaterial = new PointsMaterial({
      size: 0.22,
      map: this.sparksTexture,
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new Points(this.pointsGeometry, this.pointsMaterial);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    // Tracers.
    this.tracerGeometry = new BufferGeometry();
    const tracerPositions = new Float32Array(MAX_TRACERS * 6);
    this.tracerPositionAttribute = new BufferAttribute(tracerPositions, 3);
    this.tracerPositionAttribute.setUsage(35048);
    this.tracerGeometry.setAttribute('position', this.tracerPositionAttribute);
    this.tracerMaterial = new LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.tracers = new LineSegments(this.tracerGeometry, this.tracerMaterial);
    this.tracers.frustumCulled = false;
    this.group.add(this.tracers);

    // Decal / impact quads.
    const decalGeometry = new PlaneGeometry(1, 1);
    const ringGeometry = new RingGeometry(0.6, 1, 24);
    for (let i = 0; i < MAX_DECALS; i++) {
      const material = new MeshBasicMaterial({
        map: i % 2 === 0 ? this.ringTexture : this.glowTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new Mesh(i % 3 === 0 ? ringGeometry : decalGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.decals.push({ active: false, mesh, life: 0, maxLife: 1, growth: 1 });
      this.group.add(mesh);
    }
  }

  // ------------------------------------------------------------------ spawns

  sparkBurst(
    origin: { x: number; y: number; z: number },
    count: number,
    color: number,
    speed = 6,
    spread = 1,
    size = 0.09,
    life = 0.45,
    gravity = 9,
  ): void {
    const base = new Color(color);
    for (let i = 0; i < count; i++) {
      const particle = this.particles.acquire();
      if (!particle) return;
      particle.active = true;
      particle.position[0] = origin.x;
      particle.position[1] = origin.y;
      particle.position[2] = origin.z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1) * spread;
      const velocity = speed * (0.35 + Math.random() * 0.65);
      particle.velocity[0] = Math.sin(phi) * Math.cos(theta) * velocity;
      particle.velocity[1] = Math.cos(phi) * velocity * 0.8;
      particle.velocity[2] = Math.sin(phi) * Math.sin(theta) * velocity;
      particle.maxLife = life * (0.6 + Math.random() * 0.8);
      particle.life = particle.maxLife;
      particle.size = size * (0.6 + Math.random() * 0.9);
      particle.color.copy(base).offsetHSL((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.25);
      particle.gravity = gravity;
      particle.drag = 0.96;
    }
  }

  muzzleFlash(position: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }, color: number): void {
    this.sparkBurst(position, 10, color, 9, 0.8, 0.14, 0.09, 0);
    const decal = this.acquireDecal();
    if (!decal) return;
    const material = decal.mesh.material as MeshBasicMaterial;
    material.color.setHex(color);
    material.opacity = 0.95;
    material.map = this.glowTexture;
    decal.mesh.geometry = this.decalGeometry();
    decal.mesh.position.set(
      position.x + direction.x * 0.1,
      position.y + direction.y * 0.1,
      position.z + direction.z * 0.1,
    );
    decal.mesh.lookAt(
      position.x + direction.x * 2,
      position.y + direction.y * 2,
      position.z + direction.z * 2,
    );
    decal.mesh.scale.setScalar(0.5);
    decal.life = 0.07;
    decal.maxLife = 0.07;
    decal.growth = 3.4;
    decal.active = true;
    decal.mesh.visible = true;
  }

  impact(point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }, color: number, scale = 1): void {
    const decal = this.acquireDecal();
    if (decal) {
      const material = decal.mesh.material as MeshBasicMaterial;
      material.color.setHex(color);
      material.opacity = 0.85;
      material.map = this.ringTexture;
      decal.mesh.geometry = this.ringGeometry();
      decal.mesh.position.set(point.x + normal.x * 0.02, point.y + normal.y * 0.02, point.z + normal.z * 0.02);
      decal.mesh.lookAt(point.x + normal.x, point.y + normal.y, point.z + normal.z);
      decal.mesh.scale.setScalar(0.6 * scale);
      decal.life = 0.32;
      decal.maxLife = 0.32;
      decal.growth = 4.5 * scale;
      decal.active = true;
      decal.mesh.visible = true;
    }
    this.sparkBurst(point, 12, color, 7, 1.1, 0.075, 0.38);
  }

  tracer(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, color: number): void {
    const tracer = this.tracerPool.acquire();
    if (!tracer) return;
    tracer.active = true;
    tracer.life = 0.06;
    tracer.points[0] = from.x;
    tracer.points[1] = from.y;
    tracer.points[2] = from.z;
    tracer.points[3] = to.x;
    tracer.points[4] = to.y;
    tracer.points[5] = to.z;
    tracer.color.setHex(color);
    this.tracerMaterial.color.copy(tracer.color);
  }

  ring(position: { x: number; y: number; z: number }, color: number, maxRadius: number, duration: number): void {
    const decal = this.acquireDecal();
    if (!decal) return;
    const material = decal.mesh.material as MeshBasicMaterial;
    material.color.setHex(color);
    material.opacity = 0.8;
    material.map = this.ringTexture;
    decal.mesh.geometry = this.ringGeometry();
    decal.mesh.rotation.set(-Math.PI / 2, 0, 0);
    decal.mesh.position.set(position.x, position.y + 0.06, position.z);
    decal.mesh.scale.setScalar(0.4);
    decal.life = duration;
    decal.maxLife = duration;
    decal.growth = maxRadius;
    decal.active = true;
    decal.mesh.visible = true;
  }

  pickupGlow(position: { x: number; y: number; z: number }, color: number): void {
    this.sparkBurst(position, 8, color, 3.5, 0.9, 0.07, 0.4, 1.5);
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    this.updateParticles(dt);
    this.updateTracers(dt);
    this.updateDecals(dt);
  }

  private updateParticles(dt: number): void {
    const positions = this.positionAttribute.array as Float32Array;
    const colors = this.colorAttribute.array as Float32Array;
    const sizes = this.sizeAttribute.array as Float32Array;
    let index = 0;

    this.particles.forEachActive((particle) => {
      particle.life -= dt;
      if (particle.life <= 0) {
        this.particles.release(particle);
        return;
      }
      particle.velocity[1] -= particle.gravity * dt;
      const drag = Math.pow(particle.drag, dt * 60);
      particle.velocity[0] *= drag;
      particle.velocity[2] *= drag;
      particle.position[0] += particle.velocity[0] * dt;
      particle.position[1] += particle.velocity[1] * dt;
      particle.position[2] += particle.velocity[2] * dt;

      const fade = Math.max(0, particle.life / particle.maxLife);
      positions[index * 3] = particle.position[0];
      positions[index * 3 + 1] = particle.position[1];
      positions[index * 3 + 2] = particle.position[2];
      colors[index * 3] = particle.color.r * fade;
      colors[index * 3 + 1] = particle.color.g * fade;
      colors[index * 3 + 2] = particle.color.b * fade;
      sizes[index] = particle.size * fade;
      index += 1;
    });

    // Park unused slots far away with zero size.
    for (let i = index; i < MAX_PARTICLES; i++) {
      sizes[i] = 0;
      positions[i * 3 + 1] = -1000;
    }
    this.pointsGeometry.setDrawRange(0, MAX_PARTICLES);
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.sizeAttribute.needsUpdate = true;
  }

  private updateTracers(dt: number): void {
    const positions = this.tracerPositionAttribute.array as Float32Array;
    let index = 0;
    this.tracerPool.forEachActive((tracer) => {
      tracer.life -= dt;
      if (tracer.life <= 0) {
        this.tracerPool.release(tracer);
        return;
      }
      positions[index * 6] = tracer.points[0];
      positions[index * 6 + 1] = tracer.points[1];
      positions[index * 6 + 2] = tracer.points[2];
      positions[index * 6 + 3] = tracer.points[3];
      positions[index * 6 + 4] = tracer.points[4];
      positions[index * 6 + 5] = tracer.points[5];
      index += 1;
    });
    this.tracerMaterial.opacity = 0.75;
    this.tracerGeometry.setDrawRange(0, index * 2);
    this.tracerPositionAttribute.needsUpdate = true;
    this.tracers.visible = index > 0;
  }

  private updateDecals(dt: number): void {
    for (const decal of this.decals) {
      if (!decal.active) continue;
      decal.life -= dt;
      const progress = 1 - Math.max(0, decal.life) / decal.maxLife;
      const material = decal.mesh.material as MeshBasicMaterial;
      material.opacity = Math.max(0, 0.9 * (1 - progress));
      decal.mesh.scale.setScalar(Math.max(0.05, decal.mesh.scale.x + dt * decal.growth));
      if (decal.life <= 0) {
        decal.active = false;
        decal.mesh.visible = false;
      }
    }
  }

  private acquireDecal(): Decal | null {
    return this.decals.find((decal) => !decal.active) ?? null;
  }

  private decalGeometry(): PlaneGeometry {
    return this.planeGeometry;
  }

  private ringGeometry(): RingGeometry {
    return this.ringGeometryInstance;
  }

  private planeGeometry = new PlaneGeometry(1, 1);
  private ringGeometryInstance = new RingGeometry(0.55, 1, 28);

  clear(): void {
    this.particles.releaseAll();
    this.tracerPool.releaseAll();
    for (const decal of this.decals) {
      decal.active = false;
      decal.mesh.visible = false;
    }
  }

  dispose(): void {
    this.clear();
    this.pointsGeometry.dispose();
    this.pointsMaterial.dispose();
    this.tracerGeometry.dispose();
    this.tracerMaterial.dispose();
    this.planeGeometry.dispose();
    this.ringGeometryInstance.dispose();
    this.sparksTexture.dispose();
    this.glowTexture.dispose();
    this.ringTexture.dispose();
    for (const decal of this.decals) (decal.mesh.material as MeshBasicMaterial).dispose();
    this.group.clear();
  }
}
