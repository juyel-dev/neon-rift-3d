import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PerspectiveCamera,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PMREMGenerator } from 'three';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Vector2 } from 'three';
import { clamp, damp } from '../core/math';
import { GameSim, type HudSnapshot } from '../sim/gameSim';
import type { SimEvent } from '../sim/events';
import { ENEMY_DEFS } from '../sim/enemyDefs';
import type { EnemyKind, GameStateName } from '../sim/types';
import { WORLD } from '../sim/types';
import { createPlayerStats } from '../sim/progression';
import type { Vec3 } from '../sim/vec';
import { PALETTE, createFloorTexture, createWallTexture } from './procedural';
import { ArenaView } from './arenaView';
import { AudioManager } from './audioManager';
import { EnemyViewSystem } from './enemyViews';
import { FxSystem } from './fx';
import { InputManager } from './inputManager';
import { WeaponViewModel } from './weaponView';
import { presetFor, type QualityPreset, type SettingsStore } from './settings';
import { Hud } from '../ui/hud';
import { Screens } from '../ui/screens';
import { disposeEnemyGeometryCache } from './enemyModels';

const MAX_DELTA = 1 / 15;
const TRACER_COLOR = 0x9ff6ff;

/** The engine: owns the renderer, the scene and the simulation driver. */
export class Game {
  private renderer: WebGLRenderer | null = null;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(76, 1, 0.06, 240);
  private readonly viewScene = new Scene();
  private readonly sim: GameSim;
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly audio = new AudioManager();
  private readonly input: InputManager;
  private readonly settings: SettingsStore;
  private fx: FxSystem | null = null;
  private enemyViews: EnemyViewSystem | null = null;
  private arenaView: ArenaView | null = null;
  private weaponView: WeaponViewModel | null = null;
  private muzzleLight: PointLight | null = null;

  private preset: QualityPreset;
  private running = false;
  private disposed = false;
  private frameHandle = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private shake = 0;
  private shakeTime = 0;
  private fovKick = 0;
  private ready = false;
  private pointerLockWasPlaying = false;
  private readonly lookScratch = new Vector3();
  private readonly forwardScratch = new Vector3();
  private readonly crosshairScratch = new Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
    settings: SettingsStore,
    sim: GameSim = new GameSim(),
  ) {
    this.settings = settings;
    this.sim = sim;
    this.hud = new Hud(container);
    this.screens = new Screens(container);
    this.input = new InputManager(canvas);
    this.preset = presetFor(settings.get().quality);
    this.input.sensitivity = settings.get().sensitivity;
  }

  /** Builds the renderer, the world and every subsystem. Throws on WebGL failure. */
  async init(): Promise<void> {
    if (this.ready) return;

    const renderer = this.createRenderer();
    this.renderer = renderer;
    this.preset = presetFor(this.settings.get().quality);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio));
    renderer.setSize(this.width, this.height, false);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.shadowMap.enabled = this.preset.shadows;
    renderer.info.autoReset = true;

    this.scene.background = new Color(PALETTE.deep);
    this.scene.fog = new FogExp2(PALETTE.deep, 0.021);
    // Image-based lighting so metals have something to reflect (a scene with
    // no environment renders metals near-black regardless of direct lights).
    const pmrem = new PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();

    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, WORLD.eyeHeight + 1.25, 8);

    // ---------------------------------------------------------------- lights
    const hemisphere = new HemisphereLight(0x3a5f8f, 0x0a0f18, 0.55);
    this.scene.add(hemisphere);
    const ambient = new AmbientLight(0x2a3f63, 0.35);
    this.scene.add(ambient);

    const key = new DirectionalLight(0xbfe4ff, 1.15);
    key.position.set(24, 34, 16);
    key.castShadow = this.preset.shadows;
    key.shadow.mapSize.set(this.preset.shadowMapSize, this.preset.shadowMapSize);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 120;
    key.shadow.camera.left = -44;
    key.shadow.camera.right = 44;
    key.shadow.camera.top = 44;
    key.shadow.camera.bottom = -44;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    const coreLight = new PointLight(PALETTE.cyan, 9, 36, 2);
    coreLight.position.set(0, 4.5, 0);
    this.scene.add(coreLight);

    this.muzzleLight = new PointLight(PALETTE.cyan, 0, 8, 2);
    this.scene.add(this.muzzleLight);

    // ---------------------------------------------------------------- world
    const floorTexture = createFloorTexture();
    const wallTexture = createWallTexture();
    this.arenaView = new ArenaView(this.sim.world.arena, { floor: floorTexture, wall: wallTexture });
    this.scene.add(this.arenaView.group);

    this.fx = new FxSystem();
    this.scene.add(this.fx.group);

    this.enemyViews = new EnemyViewSystem();
    this.scene.add(this.enemyViews.group);

    // ----------------------------------------------------------- view model
    this.weaponView = new WeaponViewModel();
    this.viewScene.add(this.weaponView.scene);
    this.viewScene.environment = this.scene.environment;

    this.setupComposer();
    this.bindEvents();
    this.resize();
    this.ready = true;
    this.screens.hideLoading();
  }

  private createRenderer(): WebGLRenderer {
    try {
      return new WebGLRenderer({
        canvas: this.canvas,
        antialias: this.preset.antialias,
        powerPreference: 'high-performance',
        alpha: false,
        stencil: false,
      });
    } catch (error) {
      throw new Error(`WebGL renderer unavailable: ${(error as Error).message}`);
    }
  }

  private setupComposer(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    this.composer?.dispose();
    this.composer = null;
    this.bloomPass = null;
    if (!this.preset.bloom) return;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new Vector2(this.width, this.height), this.preset.bloomStrength, 0.4, 0.75);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.setSize(this.width, this.height);
    this.composer = composer;
    this.bloomPass = bloom;
  }

  private bindEvents(): void {
    this.input.attach();
    this.input.onPointerLockChange = (locked) => this.handlePointerLock(locked);
    this.input.onPauseRequest = () => this.togglePause();
    this.input.onAnyInput = () => void this.audio.resume();

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('orientationchange', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('beforeunload', this.handleUnload);

    this.screens.setUpgradeHandler((id) => {
      this.sim.chooseUpgrade(id);
      this.audio.play('upgrade');
      this.requestPointerLock();
    });
  }

  // ------------------------------------------------------------------ flow

  /** Starts a run from the title screen. */
  startRun(seed = Math.floor(Math.random() * 0xffffffff)): void {
    if (!this.ready) return;
    this.audio.init();
    void this.audio.resume();
    this.sim.startRun(seed);
    this.resetRunState();
    this.hud.show();
    this.screens.hideAll();
    this.sim.resume();
    this.requestPointerLock();
    this.start();
  }

  /** Resets every piece of transient state so a restart can never leak. */
  private resetRunState(): void {
    this.hud.reset();
    this.fx?.clear();
    this.enemyViews?.clear();
    this.weaponView?.beginReload(0.001);
    this.shake = 0;
    this.fovKick = 0;
    this.elapsed = 0;
    this.sim.clearEvents();
    this.sim.setBestScore(this.settings.get().bestScore);
  }

  private start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  private stop(): void {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.frame);

    const rawDelta = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    // Clamp deltas after tab suspension so physics never explodes.
    const dt = clamp(rawDelta, 0, MAX_DELTA);
    this.frameTimes.push(rawDelta);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    if (this.frameTimes.length >= 30) {
      const sum = this.frameTimes.reduce((total, value) => total + value, 0);
      this.measuredFps = Math.round(this.frameTimes.length / Math.max(1e-3, sum));
    }
    this.elapsed += dt;
    this.update(dt);
    this.render();
  };

  /** One simulation + rendering step (exposed for browser automation). */
  update(dt: number): void {
    const input = this.input.consume();
    const sensitivity = this.settings.get().sensitivity;
    input.yawDelta *= sensitivity / 0.0022;
    input.pitchDelta *= sensitivity / 0.0022;

    this.sim.update(dt, input);
    this.handleEvents(this.sim.drainEvents());

    const state = this.sim.state;
    if (state === 'title') {
      this.updateAttractCamera(dt);
    } else {
      this.updateCamera(dt);
      this.hud.update(this.sim.getHudSnapshot(), this.sim.waveIntroRemaining, this.sim.wave.totalEnemies);
      this.enemyViews?.sync(this.sim.enemySnapshots(), dt);
      this.updateWeaponView(dt, input);
      this.fx?.update(dt);
      this.arenaView?.update(this.elapsed);
    }

    if (this.sim.state === 'gameover') this.handleGameOver();
  }

  private updateAttractCamera(dt: number): void {
    const player = this.sim.player;
    const target = this.sim.cameraPosition(this.lookScratch as unknown as Vec3);
    this.camera.position.set(target.x, target.y + 2.4, target.z);
    const yaw = this.sim.player.yaw + Math.PI;
    const pitch = -0.16;
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    void player;
    void dt;
  }

  private updateCamera(dt: number): void {
    const player = this.sim.player;
    const target = this.sim.cameraPosition(this.lookScratch as unknown as Vec3);

    // Head bob is already baked into cameraPosition(); shake is additive.
    this.shake = damp(this.shake, 0, 0.09, dt);
    this.shakeTime += dt * 46;
    const shakeAmount = this.shake * 0.06;

    this.camera.position.set(
      target.x + Math.sin(this.shakeTime * 1.7) * shakeAmount,
      target.y + Math.sin(this.shakeTime * 2.3) * shakeAmount,
      target.z + Math.cos(this.shakeTime * 1.3) * shakeAmount,
    );

    this.fovKick = damp(this.fovKick, 0, 0.12, dt);
    const overdrive = this.sim.weapon.overdriveActive ? 4 : 0;
    this.camera.fov = 76 + this.fovKick + overdrive;
    this.camera.updateProjectionMatrix();

    this.camera.rotation.set(player.aimPitch(), player.aimYaw(), 0, 'YXZ');
  }

  private updateWeaponView(dt: number, input: { moveForward: number }): void {
    const weaponView = this.weaponView;
    const weapon = this.sim.weapon;
    if (!weaponView) return;
    weaponView.setLookDelta(this.input.mouseDX * 6, this.input.mouseDY * 6);
    weaponView.update(dt, {
      speed: this.sim.player.planarSpeed,
      grounded: this.sim.player.grounded,
      moveForward: input.moveForward,
    });

    // Anchor the world-space muzzle light in front of the camera.
    if (this.muzzleLight) {
      this.camera.getWorldDirection(this.crosshairScratch);
      this.muzzleLight.position.copy(this.camera.position).addScaledVector(this.crosshairScratch, 0.9);
      this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 90);
    }

    const spreadPixels = 6 + weapon.currentSpread() * 900;
    this.hud.setSpread(clamp(spreadPixels, 4, 34));
  }

  private render(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    if (this.composer && this.bloomPass) {
      const overdrive = this.sim.weapon.overdriveActive ? 0.25 : 0;
      this.bloomPass.strength = this.preset.bloomStrength + overdrive;
      this.composer.render();
    } else {
      renderer.render(this.scene, this.camera);
    }

    const weaponView = this.weaponView;
    if (weaponView) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(this.viewScene, weaponView.camera);
      renderer.autoClear = true;
    }
  }

  // ----------------------------------------------------------------- events

  private handleEvents(events: readonly SimEvent[]): void {
    const cameraForward = this.camera.getWorldDirection(this.forwardScratch);
    const cameraPosition = this.camera.position;

    for (const event of events) {
      switch (event.type) {
        case 'shot': {
          this.weaponView?.fire(this.sim.weapon.overdriveActive ? 1.15 : 1);
          if (this.muzzleLight) {
            this.camera.getWorldDirection(this.crosshairScratch);
            this.muzzleLight.position.copy(cameraPosition).addScaledVector(this.crosshairScratch, 0.9);
            this.muzzleLight.intensity = 7;
          }
          const endpoint = {
            x: event.origin.x + event.direction.x * 90,
            y: event.origin.y + event.direction.y * 90,
            z: event.origin.z + event.direction.z * 90,
          };
          this.fx?.muzzleFlash(
            { x: cameraPosition.x, y: cameraPosition.y - 0.15, z: cameraPosition.z },
            cameraForward,
            TRACER_COLOR,
          );
          this.fx?.tracer(
            { x: cameraPosition.x, y: cameraPosition.y - 0.15, z: cameraPosition.z },
            endpoint,
            TRACER_COLOR,
          );
          this.audio.play('shot', this.sim.weapon.overdriveActive ? 0.9 : 1);
          this.fovKick += 1.6;
          this.shake = Math.max(this.shake, 0.18);
          const player = this.sim.player;
          player.addRecoil(0.006, 0);
          break;
        }
        case 'impact': {
          if (event.surface === 'enemy') {
            this.fx?.impact(event.point, event.normal, PALETTE.cyan, event.headshot ? 1.3 : 1);
            this.fx?.sparkBurst(event.point, event.crit ? 18 : 10, event.headshot ? PALETTE.amber : PALETTE.cyan, 7, 1, 0.08, 0.4);
            this.enemyViews?.flash(this.findEnemyId(event.point));
            this.hud.hitmarker(event.headshot, event.crit);
            this.audio.play('enemyHit', event.headshot ? 1.3 : 1);
            this.audio.play('impact', 0.5);
          } else {
            this.fx?.impact(event.point, event.normal, PALETTE.violet, 0.8);
            this.audio.play('impact', 0.6);
          }
          break;
        }
        case 'enemyDamaged': {
          this.enemyViews?.flash(event.id);
          break;
        }
        case 'enemyKilled': {
          const color = this.enemyViews?.colorOf(event.id) ?? PALETTE.cyan;
          this.fx?.sparkBurst(event.position, 26, color, 9, 1.15, 0.1, 0.6);
          this.fx?.ring({ x: event.position.x, y: event.position.y + 0.2, z: event.position.z }, color, 2.4, 0.4);
          this.hud.pushKill(ENEMY_DEFS[event.kind].name, event.combo);
          this.audio.play('enemyDeath');
          this.shake = Math.max(this.shake, event.kind === 'bulwark' ? 0.55 : 0.2);
          break;
        }
        case 'enemyAttack': {
          if (event.phase === 'windup') this.audio.play('enemyWindup', 0.8);
          if (event.phase === 'fire') {
            this.audio.play('enemyFire');
            this.fx?.sparkBurst(
              { x: event.position.x, y: event.position.y + 1.4, z: event.position.z },
              8,
              PALETTE.magenta,
              4,
              1,
              0.08,
              0.3,
            );
          }
          if (event.phase === 'strike') {
            this.fx?.ring({ x: event.position.x, y: event.position.y + 0.15, z: event.position.z }, PALETTE.amber, 3.4, 0.35);
          }
          break;
        }
        case 'playerDamaged': {
          this.hud.damageFlash();
          this.audio.play('playerHurt');
          this.shake = Math.max(this.shake, 0.5);
          this.fovKick -= 1.2;
          this.directionDamage(event.relativeYaw);
          break;
        }
        case 'playerHealed': {
          this.fx?.sparkBurst(this.sim.player.position, 8, PALETTE.cyan, 2.4, 0.8, 0.07, 0.35, 0.5);
          break;
        }
        case 'pickupCollected': {
          this.fx?.pickupGlow(event.position, event.kind === 'health' ? PALETTE.magenta : PALETTE.cyan);
          this.audio.play('pickup');
          break;
        }
        case 'projectileFired': {
          break;
        }
        case 'projectileImpact': {
          this.fx?.impact(event.point, event.normal, PALETTE.magenta, 0.7);
          break;
        }
        case 'reload': {
          this.weaponView?.beginReload(this.sim.stats.reloadTime);
          this.audio.play('reload');
          break;
        }
        case 'dryFire': {
          this.audio.play('dryFire');
          break;
        }
        case 'dash': {
          this.audio.play('dash');
          const origin: Vec3 = event.position ?? {
            x: this.sim.player.position.x,
            y: this.sim.player.position.y,
            z: this.sim.player.position.z,
          };
          this.fx?.sparkBurst(origin, 14, PALETTE.cyan, 5, 0.9, 0.08, 0.35, 2);
          this.fovKick += 3.5;
          break;
        }
        case 'shockwave': {
          this.audio.play('shockwave');
          const origin: Vec3 = event.position ?? { x: this.sim.player.position.x, y: this.sim.player.position.y, z: this.sim.player.position.z };
          this.fx?.ring(origin, PALETTE.amber, event.radius ?? 6, 0.5);
          this.shake = Math.max(this.shake, 0.6);
          break;
        }
        case 'overdriveStart': {
          this.audio.play('overdrive');
          this.hud.banner('OVERDRIVE', 1600);
          break;
        }
        case 'waveStart': {
          this.hud.banner(`WAVE ${event.wave}`, 2400);
          this.audio.play('waveStart');
          break;
        }
        case 'waveCleared': {
          this.hud.banner('SECTOR CLEAR', 2200);
          this.audio.play('waveClear');
          break;
        }
        case 'upgradeOffer': {
          this.screens.showUpgrade(event.wave, event.offers);
          this.input.releasePointerLock();
          break;
        }
        case 'state': {
          this.handleStateChange(event.state, event.previous);
          break;
        }
        case 'playerDied': {
          this.audio.play('gameOver');
          break;
        }
        default:
          break;
      }
    }
  }

  /** Nearest enemy view id for an impact point (cheap linear scan). */
  private findEnemyId(point: Vec3): number {
    let bestId = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const snapshot of this.sim.enemySnapshots()) {
      const distance = Math.hypot(
        snapshot.position.x - point.x,
        snapshot.position.y + snapshot.position.y * 0.5 - point.y,
        snapshot.position.z - point.z,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = snapshot.id;
      }
    }
    return bestDistance < 4 ? bestId : -1;
  }

  /** Rotates the damage vignette towards the attacker. */
  private directionDamage(relativeYaw: number): void {
    const element = this.container.querySelector<HTMLElement>('#damage-vignette');
    if (!element) return;
    const x = 50 + Math.sin(relativeYaw) * 68;
    const y = 50 - Math.cos(relativeYaw) * 68;
    element.style.background = `radial-gradient(circle at ${x.toFixed(1)}% ${y.toFixed(1)}%, rgba(255,70,70,0.55), rgba(255,40,60,0.05) 45%, transparent 65%)`;
  }

  private handleStateChange(state: GameStateName, previous: GameStateName | null): void {
    if (state === 'playing' && previous !== 'playing') {
      this.screens.hideAll();
      this.hud.show();
      if (previous === 'paused' || previous === 'upgrade') this.requestPointerLock();
    }
    if (state === 'paused') {
      this.screens.show('pause');
      this.input.releasePointerLock();
    }
    if (state === 'title') {
      this.screens.showTitle(this.settings.get().bestScore);
      this.hud.hide();
      this.stop();
    }
    if (state === 'gameover') {
      this.input.releasePointerLock();
    }
  }

  private handleGameOver(): void {
    const snapshot = this.sim.getHudSnapshot();
    const score = this.sim.score.score;
    const newBest = this.settings.recordScore(score);
    this.sim.setBestScore(this.settings.get().bestScore);
    this.screens.showGameOver({
      score,
      best: newBest ? score : this.settings.get().bestScore,
      wave: snapshot.wave,
      kills: snapshot.kills,
      accuracy: snapshot.accuracy,
      time: snapshot.elapsed,
      newBest,
    });
    this.handleGameOver = this.handleGameOverOnce;
  }

  private handleGameOverOnce(): void {
    /* the game over UI is only built once per run */
  }

  // ------------------------------------------------------------- user input

  pause(): void {
    if (this.sim.state === 'playing') {
      this.sim.pause();
      this.input.releasePointerLock();
    }
  }

  resume(): void {
    if (this.sim.state === 'paused') {
      this.sim.resume();
      this.requestPointerLock();
    }
  }

  togglePause(): void {
    if (this.sim.state === 'playing') this.pause();
    else if (this.sim.state === 'paused') this.resume();
    else if (this.sim.state === 'gameover') this.startRun();
    else if (this.sim.state === 'title') this.startRun();
  }

  returnToTitle(): void {
    this.sim.returnToTitle();
    this.hud.hide();
    this.input.releasePointerLock();
    this.stop();
  }

  restart(): void {
    this.startRun();
  }

  requestPointerLock(): void {
    if (this.sim.state !== 'playing') return;
    if (document.pointerLockElement === this.canvas) return;
    this.input.requestPointerLock();
  }

  private handlePointerLock(locked: boolean): void {
    if (!locked && this.sim.state === 'playing' && this.pointerLockWasPlaying) {
      // The browser released the mouse (usually Escape): pause so the run is fair.
      this.sim.pause();
      this.pointerLockWasPlaying = false;
      return;
    }
    if (locked && this.sim.state === 'playing') {
      this.pointerLockWasPlaying = true;
      this.screens.hideAll();
      this.hud.show();
      void this.audio.resume();
    }
  }

  // ---------------------------------------------------------------- options

  applySettings(): void {
    const settings = this.settings.get();
    this.input.sensitivity = settings.sensitivity;
    const preset = presetFor(settings.quality);
    if (preset !== this.preset) {
      this.preset = preset;
      if (this.renderer) {
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
        this.renderer.shadowMap.enabled = preset.shadows;
        this.scene.traverse((object) => {
          const mesh = object as { material?: unknown };
          void mesh;
        });
      }
      this.setupComposer();
      this.resize();
    }
    this.audio.setEnabled(settings.soundEnabled);
    this.syncSettingsUi();
  }

  private syncSettingsUi(): void {
    const settings = this.settings.get();
    for (const id of ['toggle-sound-title', 'toggle-sound-pause']) {
      const button = this.container.querySelector<HTMLButtonElement>(`#${id}`);
      if (button) {
        button.textContent = settings.soundEnabled ? 'ON' : 'OFF';
        button.setAttribute('aria-checked', String(settings.soundEnabled));
      }
    }
    const quality = this.container.querySelector<HTMLSelectElement>('#select-quality');
    if (quality) quality.value = settings.quality;
    for (const id of ['range-sensitivity', 'range-sensitivity-pause']) {
      const range = this.container.querySelector<HTMLInputElement>(`#${id}`);
      if (range) range.value = String(settings.sensitivity);
    }
    const best = this.container.querySelector<HTMLElement>('#title-best');
    if (best) best.textContent = String(settings.bestScore);
  }

  // ---------------------------------------------------------------- lifecycle

  private get width(): number {
    return Math.max(1, this.container.clientWidth || window.innerWidth);
  }

  private get height(): number {
    return Math.max(1, this.container.clientHeight || window.innerHeight);
  }

  private readonly handleResize = (): void => {
    this.resize();
  };

  private resize(): void {
    const width = this.width;
    const height = this.height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.weaponView) this.weaponView.camera.aspect = width / height;
    this.renderer?.setSize(width, height, false);
    this.composer?.setSize(width, height);
    this.bloomPass?.resolution.set(width, height);
  }

  private readonly handleVisibility = (): void => {
    if (document.hidden && this.sim.state === 'playing') this.pause();
  };

  private readonly handleUnload = (): void => {
    this.dispose();
  };

  private frameTimes: number[] = [];

  /** Diagnostics used by the browser smoke test. */
  get telemetry(): {
    state: GameStateName;
    enemies: number;
    drawCalls: number;
    frames: number;
    fps: number;
  } {
    return {
      state: this.sim.state,
      enemies: this.enemyViews?.liveCount ?? 0,
      drawCalls: this.renderer?.info.render.calls ?? 0,
      frames: this.renderer?.info.render.frame ?? 0,
      fps: this.measuredFps,
    };
  }

  private measuredFps = 0;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.input.detach();
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('orientationchange', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    window.removeEventListener('beforeunload', this.handleUnload);
    this.audio.dispose();
    this.fx?.dispose();
    this.enemyViews?.dispose();
    this.arenaView?.dispose();
    this.weaponView?.dispose();
    disposeEnemyGeometryCache();
    this.composer?.dispose();
    this.scene.traverse((object) => {
      const mesh = object as { geometry?: { dispose(): void }; material?: { dispose(): void } | Array<{ dispose(): void }> };
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
    this.renderer?.dispose();
    this.renderer = null;
  }

  /** Test hook: exposes internals for automated browser verification. */
  debugSnapshot(): { hud: HudSnapshot; waveTotal: number; stats: ReturnType<typeof createPlayerStats> } {
    return {
      hud: this.sim.getHudSnapshot(),
      waveTotal: this.sim.wave.totalEnemies,
      stats: createPlayerStats(),
    };
  }

  /** Test hook: diagnostics for the view model and postFX state. */
  debugView(): {
    weaponLights: number;
    weaponMeshes: number;
    weaponAspect: number;
    weaponCameraFov: number;
    composerActive: boolean;
    bloomStrength: number;
    drawCalls: number;
    triangles: number;
    cameraPosition: { x: number; y: number; z: number };
  } {
    let weaponLights = 0;
    let weaponMeshes = 0;
    this.weaponView?.scene.traverse((object) => {
      if ((object as { isLight?: boolean }).isLight) weaponLights += 1;
      if ((object as { isMesh?: boolean }).isMesh) weaponMeshes += 1;
    });
    return {
      weaponLights,
      weaponMeshes,
      weaponAspect: this.weaponView?.camera.aspect ?? 0,
      weaponCameraFov: this.weaponView?.camera.fov ?? 0,
      composerActive: this.composer !== null && this.composer !== undefined,
      bloomStrength: this.bloomPass?.strength ?? 0,
      drawCalls: this.renderer?.info.render.calls ?? 0,
      triangles: this.renderer?.info.render.triangles ?? 0,
      cameraPosition: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
    };
  }
}

export type { EnemyKind };
