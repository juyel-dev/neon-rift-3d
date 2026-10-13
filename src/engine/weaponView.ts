import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
} from 'three';

/** Procedural first-person pulse rifle, rendered in its own scene (no clipping). */
export class WeaponViewModel {
  readonly scene = new Group();
  readonly camera = new PerspectiveCamera(50, 1, 0.01, 10);
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly muzzleFlash: Mesh;
  private readonly muzzleLight: PointLight;
  private readonly parts = new Group();
  private swayTargetX = 0;
  private swayTargetY = 0;
  private swayX = 0;
  private swayY = 0;
  private recoil = 0;
  private recoilVelocity = 0;
  private bobPhase = 0;
  private reloadTimer = 0;
  private reloadDuration = 1.15;
  private flashTimer = 0;
  private adsBlend = 0;
  private kick = 0;

  constructor() {
    this.camera.position.set(0, 0, 0);

    // The view model lives in its own scene, so it needs its own lighting
    // plus the shared reflections (metals without an environment are black).
    const hemisphere = new HemisphereLight(0x8fb8dd, 0x131a26, 1.1);
    this.scene.add(hemisphere);
    const key = new DirectionalLight(0xd8f4ff, 1.6);
    key.position.set(1.4, 1.8, 0.6);
    this.scene.add(key);
    const rim = new DirectionalLight(0x8b5cff, 0.7);
    rim.position.set(-1.2, 0.6, 0.8);
    this.scene.add(rim);

    const bodyGeometry = new BoxGeometry(0.12, 0.14, 0.62);
    const metalMaterial = new MeshStandardMaterial({ color: 0x2c3a52, metalness: 0.6, roughness: 0.35 });
    this.disposables.push(bodyGeometry, metalMaterial);
    const body = new Mesh(bodyGeometry, metalMaterial);
    body.position.set(0, 0, -0.12);
    this.parts.add(body);

    const barrelGeometry = new CylinderGeometry(0.032, 0.038, 0.5, 12);
    const barrelMaterial = new MeshStandardMaterial({ color: 0x0d1420, metalness: 0.98, roughness: 0.18 });
    this.disposables.push(barrelGeometry, barrelMaterial);
    const barrel = new Mesh(barrelGeometry, barrelMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.015, -0.52);
    this.parts.add(barrel);

    const shroudGeometry = new BoxGeometry(0.09, 0.09, 0.34);
    const shroudMaterial = new MeshStandardMaterial({ color: 0x141c29, metalness: 0.9, roughness: 0.3 });
    this.disposables.push(shroudGeometry, shroudMaterial);
    const shroud = new Mesh(shroudGeometry, shroudMaterial);
    shroud.position.set(0, 0.01, -0.36);
    this.parts.add(shroud);

    // Glowing coil along the barrel: the signature neon element.
    const coilGeometry = new CylinderGeometry(0.046, 0.046, 0.2, 10, 1, true);
    const coilMaterial = new MeshStandardMaterial({
      color: 0x061820,
      emissive: 0x2ff0ff,
      emissiveIntensity: 3.2,
      metalness: 0.4,
      roughness: 0.2,
      transparent: true,
      opacity: 0.95,
    });
    this.disposables.push(coilGeometry, coilMaterial);
    const coil = new Mesh(coilGeometry, coilMaterial);
    coil.rotation.x = Math.PI / 2;
    coil.position.set(0, 0.015, -0.42);
    this.parts.add(coil);

    const sightGeometry = new BoxGeometry(0.05, 0.06, 0.1);
    const sightMaterial = new MeshStandardMaterial({ color: 0x101826, metalness: 0.9, roughness: 0.25 });
    this.disposables.push(sightGeometry, sightMaterial);
    const sight = new Mesh(sightGeometry, sightMaterial);
    sight.position.set(0, 0.1, -0.3);
    this.parts.add(sight);

    const lensGeometry = new SphereGeometry(0.018, 8, 6);
    const lensMaterial = new MeshBasicMaterial({ color: 0x8b5cff });
    this.disposables.push(lensGeometry, lensMaterial);
    const lens = new Mesh(lensGeometry, lensMaterial);
    lens.position.set(0, 0.1, -0.35);
    this.parts.add(lens);

    const gripGeometry = new BoxGeometry(0.07, 0.2, 0.1);
    const gripMaterial = new MeshStandardMaterial({ color: 0x131a27, metalness: 0.8, roughness: 0.4 });
    this.disposables.push(gripGeometry, gripMaterial);
    const grip = new Mesh(gripGeometry, gripMaterial);
    grip.position.set(0, -0.14, 0.08);
    grip.rotation.x = -0.22;
    this.parts.add(grip);

    const magGeometry = new BoxGeometry(0.06, 0.16, 0.14);
    this.disposables.push(magGeometry);
    const mag = new Mesh(magGeometry, metalMaterial);
    mag.position.set(0, -0.14, -0.14);
    this.parts.add(mag);

    // Muzzle flash: additive quad + a tiny light.
    const flashGeometry = new PlaneGeometry(0.5, 0.5);
    const flashMaterial = new MeshBasicMaterial({
      color: 0xbff6ff,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(flashGeometry, flashMaterial);
    this.muzzleFlash = new Mesh(flashGeometry, flashMaterial);
    this.muzzleFlash.position.set(0, 0.015, -0.78);
    this.parts.add(this.muzzleFlash);

    this.muzzleLight = new PointLight(0x9ff0ff, 0, 2.4, 2);
    this.muzzleLight.position.set(0, 0.02, -0.7);
    this.parts.add(this.muzzleLight);

    this.parts.position.set(0.27, -0.28, -0.72);
    this.parts.scale.setScalar(0.85);
    this.scene.add(this.parts);
  }

  /** Normalised look deltas (-1..1) drive the weapon sway. */
  setLookDelta(deltaX: number, deltaY: number): void {
    this.swayTargetX = Math.max(-1, Math.min(1, this.swayTargetX + deltaX));
    this.swayTargetY = Math.max(-1, Math.min(1, this.swayTargetY + deltaY));
  }

  fire(recoilScale = 1): void {
    this.recoilVelocity += 4.4 * recoilScale;
    this.flashTimer = 0.055;
    this.muzzleLight.intensity = 6;
    (this.muzzleFlash.material as MeshBasicMaterial).opacity = 1;
    this.muzzleFlash.rotation.z = Math.random() * Math.PI;
  }

  beginReload(duration: number): void {
    this.reloadTimer = duration;
    this.reloadDuration = duration;
  }

  update(dt: number, options: { speed: number; grounded: boolean; moveForward: number }): void {
    // Sway easing.
    this.swayX += (this.swayTargetX - this.swayX) * Math.min(1, dt * 8);
    this.swayY += (this.swayTargetY - this.swayY) * Math.min(1, dt * 8);
    this.swayTargetX *= Math.pow(0.02, dt);
    this.swayTargetY *= Math.pow(0.02, dt);

    // Recoil spring.
    this.recoilVelocity += -this.recoil * 90 * dt;
    this.recoilVelocity *= Math.pow(0.001, dt);
    this.recoil += this.recoilVelocity * dt;
    this.recoil = Math.max(-0.06, Math.min(0.16, this.recoil));
    this.kick = Math.max(0, this.kick - dt * 3.5);

    // Walking bob.
    this.bobPhase += dt * (6 + options.speed * 0.9);
    const bobAmount = options.grounded ? Math.min(1, options.speed / 7) : 0;
    const bobX = Math.sin(this.bobPhase) * 0.012 * bobAmount;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.014 * bobAmount;

    // Reload animation.
    if (this.reloadTimer > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      const progress = 1 - this.reloadTimer / Math.max(0.001, this.reloadDuration);
      const swing = Math.sin(progress * Math.PI);
      this.parts.position.set(0.27 + swing * 0.05, -0.28 - swing * 0.14, -0.72 + swing * 0.04);
      this.parts.rotation.set(swing * 0.7, swing * 0.5, swing * -0.4);
    } else {
      this.parts.position.set(
        0.27 + this.swayX * 0.02 + bobX - this.recoil * 0.02,
        -0.28 - this.swayY * 0.02 + bobY + this.recoil * 0.05,
        -0.72 + this.recoil * 0.09,
      );
      this.parts.rotation.set(this.recoil * 0.6 + this.swayY * 0.04, -this.swayX * 0.05, Math.sin(this.bobPhase) * 0.008 * bobAmount);
    }

    this.adsBlend += (0 - this.adsBlend) * Math.min(1, dt * 6);

    // Muzzle flash decay.
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      const material = this.muzzleFlash.material as MeshBasicMaterial;
      material.opacity = Math.max(0, this.flashTimer / 0.055);
      this.muzzleLight.intensity = Math.max(0, (this.flashTimer / 0.055) * 6);
      const scale = 0.7 + Math.random() * 0.5;
      this.muzzleFlash.scale.setScalar(scale);
    } else if ((this.muzzleFlash.material as MeshBasicMaterial).opacity !== 0) {
      (this.muzzleFlash.material as MeshBasicMaterial).opacity = 0;
      this.muzzleLight.intensity = 0;
    }
  }

  /** Current muzzle position in view-model space (for FX anchoring). */
  muzzlePosition(target: Object3D): Object3D {
    target.position.set(0, 0.015, -0.78);
    return target;
  }

  dispose(): void {
    this.parts.traverse((object) => {
      const mesh = object as Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as { dispose?: () => void } | undefined;
      material?.dispose?.();
    });
    for (const item of this.disposables) item.dispose();
  }
}
