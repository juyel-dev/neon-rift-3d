import { Group, type Object3D } from 'three';
import type { EnemyKind, EnemySnapshot } from '../sim/types';
import { buildEnemyModel, type EnemyModelParts } from './enemyModels';
import { ENEMY_COLORS } from './enemyModels';

interface EnemyView {
  id: number;
  kind: EnemyKind;
  model: EnemyModelParts;
  /** Visual position, smoothed towards the simulation position. */
  visualY: number;
  dying: boolean;
  deathTime: number;
  flash: number;
}

const DEATH_DURATION = 0.45;

/**
 * Pools one view per live enemy (plus a few spare for the death animation) and
 * keeps it in sync with the simulation. Views are recycled on restart so no
 * GPU resources are created per spawn.
 */
export class EnemyViewSystem {
  readonly group = new Group();
  private readonly views = new Map<number, EnemyView>();
  private readonly free: EnemyView[] = [];
  private readonly active: EnemyView[] = [];
  private clock = 0;

  /** Registers an enemy; reuses a pooled view when one is available. */
  sync(snapshots: readonly EnemySnapshot[], dt: number): void {
    this.clock += dt;

    const seen = new Set<number>();
    for (const snapshot of snapshots) {
      seen.add(snapshot.id);
      let view: EnemyView | undefined = this.views.get(snapshot.id);
      if (!view) {
        view = this.acquire(snapshot.kind, snapshot.id) ?? undefined;
        if (!view) continue;
        this.views.set(snapshot.id, view);
        this.group.add(view.model.group);
      }
      this.updateView(view, snapshot, dt);
    }

    // Anything not in the snapshot list has died this frame.
    for (const [id, view] of [...this.views]) {
      if (seen.has(id)) continue;
      this.views.delete(id);
      this.beginDeath(view);
    }

    this.updateDying(dt);
  }

  private acquire(kind: EnemyKind, id: number): EnemyView | null {
    const reusable = this.free.find((view) => view.kind === kind);
    if (reusable) {
      const index = this.free.indexOf(reusable);
      this.free.splice(index, 1);
      reusable.id = id;
      reusable.dying = false;
      reusable.deathTime = 0;
      reusable.flash = 0;
      reusable.model.group.visible = true;
      reusable.model.group.scale.setScalar(1);
      return reusable;
    }

    const model = buildEnemyModel(kind);
    const view: EnemyView = { id, kind, model, visualY: 0, dying: false, deathTime: 0, flash: 0 };
    return view;
  }

  private updateView(view: EnemyView, snapshot: EnemySnapshot, dt: number): void {
    const { group } = view.model;
    group.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    group.rotation.y = snapshot.facing;

    // Spawn-in: scale up from the floor so materialisation reads clearly.
    const spawnScale = 0.15 + 0.85 * snapshot.spawnProgress;
    group.scale.setScalar(spawnScale);

    // Smooth the vertical position slightly to hide the collision snapping.
    view.visualY += (snapshot.position.y - view.visualY) * Math.min(1, dt * 18);
    group.position.y = view.visualY;

    const flashTarget = 0;
    view.flash += (flashTarget - view.flash) * Math.min(1, dt * 6);
    view.model.animate(this.clock, {
      charge: snapshot.charge,
      state: snapshot.state,
      spawnProgress: snapshot.spawnProgress,
      flash: view.flash,
    });
    view.model.group.visible = snapshot.spawnProgress > 0.02;
  }

  private beginDeath(view: EnemyView): void {
    view.dying = true;
    view.deathTime = 0;
    this.active.push(view);
  }

  private updateDying(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const view = this.active[i];
      view.deathTime += dt;
      const progress = Math.min(1, view.deathTime / DEATH_DURATION);
      view.model.group.scale.setScalar(1 - progress);
      view.model.group.rotation.y += dt * 6;
      view.model.group.position.y += dt * 1.6;
      for (const entry of view.model.emissives) {
        entry.material.emissiveIntensity = entry.base * (1 - progress) * 3;
      }
      if (progress >= 1) {
        view.model.group.visible = false;
        view.dying = false;
        view.deathTime = 0;
        view.model.group.scale.setScalar(1);
        this.free.push(view);
        this.active.splice(i, 1);
      }
    }
  }

  /** Applies a hit flash to a specific enemy. */
  flash(enemyId: number): void {
    const view = this.views.get(enemyId);
    if (view) view.flash = 1;
  }

  /** World position of an enemy view (used to anchor effects). */
  positionOf(enemyId: number): { x: number; y: number; z: number } | null {
    const view = this.views.get(enemyId);
    if (!view) return null;
    const position = view.model.group.position;
    return { x: position.x, y: position.y, z: position.z };
  }

  colorOf(id: number): number {
    const view = this.views.get(id);
    return view ? ENEMY_COLORS[view.kind] : ENEMY_COLORS.warden;
  }

  /** Number of live views (diagnostics/telemetry). */
  get liveCount(): number {
    return this.views.size;
  }

  clear(): void {
    for (const view of this.views.values()) {
      this.group.remove(view.model.group);
      this.free.push(view);
    }
    this.views.clear();
    for (const view of this.active) {
      view.model.group.visible = false;
      view.dying = false;
      this.free.push(view);
    }
    this.active.length = 0;
    this.clock = 0;
  }

  dispose(): void {
    this.clear();
    for (const view of this.free) {
      for (const entry of view.model.emissives) entry.material.dispose();
      view.model.group.traverse((object: Object3D) => {
        const mesh = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
        mesh.material?.dispose();
      });
    }
    this.free.length = 0;
    this.group.clear();
  }
}
