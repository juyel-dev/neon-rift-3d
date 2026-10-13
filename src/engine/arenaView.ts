import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  TorusGeometry,
  type Texture,
} from 'three';
import type { ArenaData, ArenaFeature } from '../sim/arena';
import { PALETTE } from './procedural';

const CORE_RADIUS = 1.6;

/** Builds the visible arena from the same feature list the simulation collides with. */
export class ArenaView {
  readonly group = new Group();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly animated: Array<(time: number) => void> = [];
  private coreLight: PointLight | null = null;
  private coreSpinner: Object3D | null = null;

  constructor(
    private readonly arena: ArenaData,
    private readonly textures: { floor: Texture; wall: Texture },
  ) {
    this.build();
  }

  private track<T extends { dispose(): void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private build(): void {
    const features = this.arena.features;

    // ------------------------------------------------------------------ floor
    const floorGeometry = this.track(new BoxGeometry(this.arena.halfExtent * 2, 0.4, this.arena.halfExtent * 2));
    const floorTexture = this.textures.floor;
    floorTexture.wrapS = floorTexture.wrapT = 1000;
    floorTexture.repeat.set(this.arena.halfExtent / 4, this.arena.halfExtent / 4);
    const floorMaterial = this.track(
      new MeshStandardMaterial({
        map: floorTexture,
        color: 0x2a3448,
        metalness: 0.55,
        roughness: 0.5,
        emissive: 0x0a1420,
        emissiveIntensity: 0.35,
        envMapIntensity: 0.5,
      }),
    );
    const floor = new Mesh(floorGeometry, floorMaterial);
    floor.position.y = -0.2;
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.group.add(floor);

    // ------------------------------------------------------------------ walls
    const wallTexture = this.textures.wall;
    wallTexture.repeat.set(8, 2);
    const wallMaterial = this.track(
      new MeshStandardMaterial({
        map: wallTexture,
        color: 0x39445c,
        metalness: 0.55,
        roughness: 0.55,
        emissive: 0x120a2a,
        emissiveIntensity: 0.4,
        envMapIntensity: 0.4,
      }),
    );
    const wallGeometry = this.track(new BoxGeometry(1, 1, 1));
    for (const feature of features) {
      if (feature.type !== 'wall') continue;
      const { min, max } = feature.box;
      const wall = new Mesh(wallGeometry, wallMaterial);
      wall.scale.set(max.x - min.x, max.y - min.y, max.z - min.z);
      wall.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
      wall.receiveShadow = true;
      wall.castShadow = true;
      this.group.add(wall);
    }

    // Light strips along the walls (cheap emissive boxes, no extra lights).
    const stripGeometry = this.track(new BoxGeometry(1, 0.14, 1));
    const stripMaterial = this.track(
      new MeshStandardMaterial({ color: 0x0a1a24, emissive: PALETTE.cyan, emissiveIntensity: 1.0, metalness: 0.2, roughness: 0.4 }),
    );
    const strip = new Mesh(stripGeometry, stripMaterial);
    strip.scale.set(this.arena.halfExtent * 2 - 2, 1, 0.16);
    strip.position.set(0, 5.4, -this.arena.halfExtent + 0.2);
    this.group.add(strip.clone());
    strip.position.z = this.arena.halfExtent - 0.2;
    this.group.add(strip.clone());
    strip.scale.set(0.16, 1, this.arena.halfExtent * 2 - 2);
    strip.position.set(-this.arena.halfExtent + 0.2, 5.4, 0);
    this.group.add(strip.clone());
    strip.position.x = this.arena.halfExtent - 0.2;
    this.group.add(strip.clone());

    // ------------------------------------------------------------------ dais
    const daisOuter = this.featureBox(features, 'outer');
    this.addOctagon(daisOuter, 0.62, PALETTE.cyan, 1.5);
    const daisInner = this.featureBox(features, 'inner');
    this.addOctagon(daisInner, 0.62, PALETTE.violet, 1.3);

    // Glowing rim around the outer dais.
    const rimGeometry = this.track(new TorusGeometry(daisRadius(this.features('outer')), 0.06, 8, 64));
    const rimMaterial = this.track(
      new MeshStandardMaterial({ color: 0x081820, emissive: PALETTE.cyan, emissiveIntensity: 3, metalness: 0.4, roughness: 0.3 }),
    );
    const rim = new Mesh(rimGeometry, rimMaterial);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.56;
    this.group.add(rim);

    // ------------------------------------------------------------------- core
    this.buildCore(daisInner);

    // -------------------------------------------------------------- platforms
    const platformGeometry = this.track(new BoxGeometry(1, 1, 1));
    const platformMaterial = this.track(
      new MeshStandardMaterial({ color: 0x27324a, metalness: 0.9, roughness: 0.36, emissive: 0x0b1626, emissiveIntensity: 0.5 }),
    );
    const platformTrimMaterial = this.track(
      new MeshStandardMaterial({ color: 0x07141c, emissive: PALETTE.magenta, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.5 }),
    );
    for (const feature of features) {
      if (feature.type !== 'platform') continue;
      const { min, max } = feature.box;
      const platform = new Mesh(platformGeometry, platformMaterial);
      platform.scale.set(max.x - min.x, max.y - min.y, max.z - min.z);
      platform.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
      platform.castShadow = true;
      platform.receiveShadow = true;
      this.group.add(platform);

      // Emissive skirt around the platform edge.
      const width = max.x - min.x;
      const depth = max.z - min.z;
      const trim = new Mesh(platformGeometry, platformTrimMaterial);
      trim.scale.set(width + 0.12, 0.12, depth + 0.12);
      trim.position.set(platform.position.x, max.y + 0.02, platform.position.z);
      this.group.add(trim);

      // Simple railings on the two outer faces.
      const railMaterial = this.track(
        new MeshStandardMaterial({ color: 0x1a2436, metalness: 0.9, roughness: 0.3, emissive: 0x0a2230, emissiveIntensity: 0.8 }),
      );
      const rail = new Mesh(platformGeometry, railMaterial);
      const outerX = Math.sign(platform.position.x);
      const outerZ = Math.sign(platform.position.z);
      rail.scale.set(outerX === 0 ? width : 0.16, 0.9, outerX === 0 ? 0.16 : depth);
      rail.position.set(
        outerX === 0 ? platform.position.x : platform.position.x + outerX * (width / 2 - 0.1),
        max.y + 0.5,
        outerX === 0 ? platform.position.z + outerZ * (depth / 2 - 0.1) : platform.position.z,
      );
      this.group.add(rail);
    }

    // ----------------------------------------------------------------- stairs
    const stairs = features.filter((feature) => feature.type === 'stair');
    if (stairs.length > 0) {
      const stairGeometry = this.track(new BoxGeometry(1, 1, 1));
      const stairMaterial = this.track(
        new MeshStandardMaterial({ color: 0x232d42, metalness: 0.88, roughness: 0.38, emissive: 0x081322, emissiveIntensity: 0.45 }),
      );
      const stairMesh = new InstancedMesh(stairGeometry, stairMaterial, stairs.length);
      stairMesh.castShadow = true;
      stairMesh.receiveShadow = true;
      const edgeMaterial = this.track(
        new MeshStandardMaterial({ color: 0x061218, emissive: PALETTE.cyan, emissiveIntensity: 1.5, metalness: 0.3, roughness: 0.4 }),
      );
      const edgeGeometry = this.track(new BoxGeometry(1, 0.07, 1));
      const edgeMesh = new InstancedMesh(edgeGeometry, edgeMaterial, stairs.length);
      const matrix = new Matrix4();
      stairs.forEach((feature, index) => {
        const { min, max } = feature.box;
        matrix.makeScale(max.x - min.x, max.y - min.y, max.z - min.z);
        matrix.setPosition((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
        stairMesh.setMatrixAt(index, matrix);

        const glow = new Matrix4();
        const width = max.x - min.x;
        const depth = max.z - min.z;
        glow.makeScale(Math.max(width, 0.1) * 1.01, 1, Math.max(depth, 0.1) * 1.01);
        glow.setPosition((min.x + max.x) / 2, max.y + 0.02, (min.z + max.z) / 2);
        edgeMesh.setMatrixAt(index, glow);
      });
      stairMesh.instanceMatrix.needsUpdate = true;
      edgeMesh.instanceMatrix.needsUpdate = true;
      this.group.add(stairMesh, edgeMesh);
    }

    // ---------------------------------------------------------------- pillars
    const pillars = features.filter((feature) => feature.type === 'pillar');
    if (pillars.length > 0) {
      const pillarGeometry = this.track(new CylinderGeometry(CORE_RADIUS, CORE_RADIUS, 1, 8, 1, false));
      const pillarMaterial = this.track(
        new MeshStandardMaterial({ color: 0x1e2838, metalness: 0.9, roughness: 0.35, emissive: 0x081428, emissiveIntensity: 0.6 }),
      );
      const pillarMesh = new InstancedMesh(pillarGeometry, pillarMaterial, pillars.length);
      pillarMesh.castShadow = true;
      pillarMesh.receiveShadow = true;
      const bandMaterial = this.track(
        new MeshStandardMaterial({ color: 0x061018, emissive: PALETTE.violet, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.4 }),
      );
      const bandGeometry = this.track(new CylinderGeometry(CORE_RADIUS * 1.02, CORE_RADIUS * 1.02, 0.1, 8));
      const bandMesh = new InstancedMesh(bandGeometry, bandMaterial, pillars.length * 2);
      const matrix = new Matrix4();
      pillars.forEach((feature, index) => {
        const { min, max } = feature.box;
        const cx = (min.x + max.x) / 2;
        const cz = (min.z + max.z) / 2;
        const height = max.y - min.y;
        matrix.makeScale(1, height, 1);
        matrix.setPosition(cx, height / 2, cz);
        pillarMesh.setMatrixAt(index, matrix);
        for (let band = 0; band < 2; band++) {
          const y = height * (band === 0 ? 0.4 : 0.75);
          const bandMatrix = new Matrix4();
          bandMatrix.makeScale(1, 1, 1);
          bandMatrix.setPosition(cx, y, cz);
          bandMesh.setMatrixAt(index * 2 + band, bandMatrix);
        }
      });
      pillarMesh.instanceMatrix.needsUpdate = true;
      bandMesh.instanceMatrix.needsUpdate = true;
      this.group.add(pillarMesh, bandMesh);
    }

    // ----------------------------------------------------------------- pylons
    const pylons = features.filter((feature) => feature.type === 'pylon');
    if (pylons.length > 0) {
      const pylonGeometry = this.track(new CylinderGeometry(0.7, 1.6, 1, 8, 1, false));
      const pylonMaterial = this.track(
        new MeshStandardMaterial({ color: 0x101826, metalness: 0.92, roughness: 0.3, emissive: 0x0d1c30, emissiveIntensity: 0.8 }),
      );
      const pylonMesh = new InstancedMesh(pylonGeometry, pylonMaterial, pylons.length);
      pylonMesh.castShadow = true;
      const crystalMaterial = this.track(
        new MeshStandardMaterial({
          color: 0x0a1626,
          emissive: PALETTE.magenta,
          emissiveIntensity: 1.1,
          metalness: 0.2,
          roughness: 0.15,
          transparent: true,
          opacity: 0.94,
        }),
      );
      const crystalGeometry = this.track(new IcosahedronGeometry(0.85, 0));
      const crystalMesh = new InstancedMesh(crystalGeometry, crystalMaterial, pylons.length);
      const matrix = new Matrix4();
      pylons.forEach((feature, index) => {
        const { min, max } = feature.box;
        const cx = (min.x + max.x) / 2;
        const cz = (min.z + max.z) / 2;
        const height = max.y - min.y;
        matrix.makeScale(1, height, 1);
        matrix.setPosition(cx, height / 2, cz);
        pylonMesh.setMatrixAt(index, matrix);

        const crystal = new Matrix4();
        crystal.makeScale(1, 1, 1);
        crystal.setPosition(cx, height + 0.9, cz);
        crystalMesh.setMatrixAt(index, crystal);
      });
      pylonMesh.instanceMatrix.needsUpdate = true;
      crystalMesh.instanceMatrix.needsUpdate = true;
      this.group.add(pylonMesh, crystalMesh);
      this.animated.push((time) => {
        crystalMaterial.emissiveIntensity = 2 + Math.sin(time * 2.2) * 0.9;
      });
    }

    // ------------------------------------------------------------------ cover
    const cover = features.filter((feature) => feature.type === 'cover');
    if (cover.length > 0) {
      const coverGeometry = this.track(new BoxGeometry(1, 1, 1));
      const coverMaterial = this.track(
        new MeshStandardMaterial({ color: 0x1b2436, metalness: 0.88, roughness: 0.42, emissive: 0x070f1c, emissiveIntensity: 0.5 }),
      );
      const coverMesh = new InstancedMesh(coverGeometry, coverMaterial, cover.length);
      coverMesh.castShadow = true;
      coverMesh.receiveShadow = true;
      const capGeometry = this.track(new BoxGeometry(1, 0.06, 1));
      const capMaterial = this.track(
        new MeshStandardMaterial({ color: 0x06121a, emissive: PALETTE.amber, emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.5 }),
      );
      const capMesh = new InstancedMesh(capGeometry, capMaterial, cover.length);
      const matrix = new Matrix4();
      cover.forEach((feature, index) => {
        const { min, max } = feature.box;
        matrix.makeScale(max.x - min.x, max.y - min.y, max.z - min.z);
        matrix.setPosition((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
        coverMesh.setMatrixAt(index, matrix);
        const cap = new Matrix4();
        cap.makeScale(max.x - min.x + 0.08, 1, max.z - min.z + 0.08);
        cap.setPosition((min.x + max.x) / 2, max.y + 0.03, (min.z + max.z) / 2);
        capMesh.setMatrixAt(index, cap);
      });
      coverMesh.instanceMatrix.needsUpdate = true;
      capMesh.instanceMatrix.needsUpdate = true;
      this.group.add(coverMesh, capMesh);
    }
  }

  private features(variant: string): ArenaFeature[] {
    return this.arena.features.filter((feature) => feature.variant === variant);
  }

  private featureBox(features: ArenaFeature[], variant: string): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
    const feature = features.find((candidate) => candidate.variant === variant);
    if (!feature) throw new Error(`missing arena feature: ${variant}`);
    return feature.box;
  }

  /** Octagonal platform (cylinder with 8 segments) for the dais tiers. */
  private addOctagon(
    box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
    height: number,
    emissive: number,
    emissiveIntensity: number,
  ): void {
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const radiusX = (box.max.x - box.min.x) / 2;
    const radiusZ = (box.max.z - box.min.z) / 2;
    const radius = Math.min(radiusX, radiusZ);

    const geometry = this.track(new CylinderGeometry(radius * 1.082, radius * 1.082, height, 8, 1, false));
    const material = this.track(
      new MeshStandardMaterial({
        color: 0x27324a,
        metalness: 0.9,
        roughness: 0.36,
        emissive,
        emissiveIntensity,
      }),
    );
    const mesh = new Mesh(geometry, material);
    mesh.position.set(cx, box.max.y - height / 2, cz);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.group.add(mesh);

    // Glowing channel ring on the rim.
    const ringGeometry = this.track(new RingGeometry(radius * 0.94, radius * 1.0, 8));
    const ringMaterial = this.track(new MeshBasicMaterial({ color: emissive, transparent: true, opacity: 0.55, blending: AdditiveBlending }));
    const ring = new Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.rotation.z = Math.PI / 8;
    ring.position.set(cx, box.max.y + 0.01, cz);
    this.group.add(ring);
  }

  private buildCore(innerBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }): void {
    const cx = (innerBox.min.x + innerBox.max.x) / 2;
    const cz = (innerBox.min.z + innerBox.max.z) / 2;
    const baseY = innerBox.max.y;

    // Structural cage.
    const cageGeometry = this.track(new CylinderGeometry(CORE_RADIUS * 1.05, CORE_RADIUS * 1.05, 3.4, 8, 1, true));
    const cageMaterial = this.track(
      new MeshStandardMaterial({
        color: 0x1a2436,
        metalness: 0.9,
        roughness: 0.35,
        emissive: 0x0c2030,
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 0.92,
      }),
    );
    const cage = new Mesh(cageGeometry, cageMaterial);
    cage.position.set(cx, baseY + 1.7, cz);
    cage.castShadow = true;
    this.group.add(cage);

    // Vertical pylons inside the cage.
    const pylonGeometry = this.track(new BoxGeometry(0.14, 3.4, 0.14));
    const pylonMaterial = this.track(
      new MeshStandardMaterial({ color: 0x0b1420, emissive: PALETTE.cyan, emissiveIntensity: 1.8, metalness: 0.5, roughness: 0.4 }),
    );
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const post = new Mesh(pylonGeometry, pylonMaterial);
      post.position.set(cx + Math.cos(angle) * CORE_RADIUS * 0.95, baseY + 1.7, cz + Math.sin(angle) * CORE_RADIUS * 0.95);
      this.group.add(post);
    }

    // Floating reactive core.
    const spinner = new Group();
    spinner.position.set(cx, baseY + 1.9, cz);
    const coreGeometry = this.track(new IcosahedronGeometry(0.72, 1));
    const coreMaterial = this.track(
      new MeshStandardMaterial({
        color: 0x0a1c2c,
        emissive: PALETTE.cyan,
        emissiveIntensity: 1.0,
        metalness: 0.4,
        roughness: 0.25,
        transparent: true,
        opacity: 0.95,
      }),
    );
    const core = new Mesh(coreGeometry, coreMaterial);
    spinner.add(core);

    const haloGeometry = this.track(new PlaneGeometry(3.2, 3.2));
    const haloMaterial = this.track(
      new MeshBasicMaterial({
        map: this.textures.floor,
        color: PALETTE.cyan,
        transparent: true,
        opacity: 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    haloMaterial.opacity = 0.18;
    const halo = new Mesh(haloGeometry, haloMaterial);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -1.55;
    spinner.add(halo);

    this.group.add(spinner);
    this.coreSpinner = spinner;
    this.coreLight = new PointLight(PALETTE.cyan, 12, 26, 2);
    this.coreLight.position.set(cx, baseY + 2.1, cz);
    this.group.add(this.coreLight);

    this.animated.push((time) => {
      if (this.coreSpinner) {
        this.coreSpinner.rotation.y = time * 0.5;
        this.coreSpinner.position.y = baseY + 1.9 + Math.sin(time * 1.3) * 0.14;
      }
      coreMaterial.emissiveIntensity = 1.0 + Math.sin(time * 2.6) * 0.25;
      if (this.coreLight) this.coreLight.intensity = 8 + Math.sin(time * 2.6) * 2.5;
    });
  }

  update(time: number): void {
    for (const animate of this.animated) animate(time);
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    for (const item of this.disposables) item.dispose();
    this.group.clear();
  }
}

function daisRadius(features: ArenaFeature[]): number {
  const feature = features[0];
  if (!feature) return 5;
  return (feature.box.max.x - feature.box.min.x) / 2;
}
