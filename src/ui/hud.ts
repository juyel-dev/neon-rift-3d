import { formatScore, formatTime } from '../core/math';
import type { HudSnapshot } from '../sim/gameSim';

interface HudElements {
  root: HTMLElement;
  wave: HTMLElement;
  waveValue: HTMLElement;
  enemies: HTMLElement;
  score: HTMLElement;
  best: HTMLElement;
  multiplier: HTMLElement;
  accuracy: HTMLElement;
  objective: HTMLElement;
  objectiveText: HTMLElement;
  objectiveTimer: HTMLElement;
  banner: HTMLElement;
  bannerText: HTMLElement;
  killfeed: HTMLElement;
  healthValue: HTMLElement;
  healthBar: HTMLElement;
  ammo: HTMLElement;
  ammoBar: HTMLElement;
  reload: HTMLElement;
  dashBar: HTMLElement;
  overdriveBar: HTMLElement;
  crosshair: HTMLElement;
  hitmarker: HTMLElement;
  damageVignette: HTMLElement;
  lowHealth: HTMLElement;
}

/** Owns every HUD DOM node and updates it from the simulation snapshot. */
export class Hud {
  private readonly elements: HudElements;
  private killfeedTimers: number[] = [];
  private hitmarkerTimer = 0;
  private damageTimer = 0;
  private bannerTimer = 0;

  constructor(root: HTMLElement) {
    const query = <T extends HTMLElement>(id: string): T => {
      const element = root.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`missing HUD element #${id}`);
      return element;
    };

    this.elements = {
      root: query('hud'),
      wave: query('hud-wave'),
      waveValue: query('hud-wave-value'),
      enemies: query('hud-enemies'),
      score: query('hud-score'),
      best: query('hud-best'),
      multiplier: query('hud-multiplier'),
      accuracy: query('hud-accuracy'),
      objective: query('objective'),
      objectiveText: query('objective-text'),
      objectiveTimer: query('objective-timer'),
      banner: query('banner'),
      bannerText: query('banner-text'),
      killfeed: query('killfeed'),
      healthValue: query('hud-health-value'),
      healthBar: query('hud-health-bar'),
      ammo: query('hud-ammo'),
      ammoBar: query('hud-ammo-bar'),
      reload: query('hud-reload'),
      dashBar: query('hud-dash-bar'),
      overdriveBar: query('hud-overdrive-bar'),
      crosshair: query('crosshair'),
      hitmarker: query('hitmarker'),
      damageVignette: query('damage-vignette'),
      lowHealth: query('low-health'),
    };
  }

  show(): void {
    this.elements.root.hidden = false;
  }

  hide(): void {
    this.elements.root.hidden = true;
    this.clearKillfeed();
  }

  update(snapshot: HudSnapshot, waveIntroRemaining: number, waveTotal: number): void {
    const el = this.elements;
    el.waveValue.textContent = String(snapshot.wave);
    el.enemies.textContent = snapshot.enemiesRemaining > 0 ? `${snapshot.enemiesRemaining} HOSTILES` : 'SECTOR CLEAR';
    el.score.textContent = formatScore(snapshot.score);
    el.best.textContent = formatScore(snapshot.bestScore);
    el.multiplier.textContent = `x${snapshot.multiplier.toFixed(1)}`;
    el.accuracy.textContent = `ACC ${Math.round(snapshot.accuracy * 100)}%`;

    el.healthValue.textContent = String(snapshot.health);
    el.healthBar.style.transform = `scaleX(${Math.max(0, snapshot.healthFraction)})`;
    el.healthBar.classList.toggle('low', snapshot.lowHealth);
    el.lowHealth.classList.toggle('active', snapshot.lowHealth);

    const weapon = snapshot.weapon;
    el.ammo.textContent = `${weapon.ammo} / ${weapon.reserve}`;
    el.ammoBar.style.transform = `scaleX(${weapon.reloading ? weapon.reloadProgress : weapon.ammo / Math.max(1, weapon.magSize)})`;
    el.reload.hidden = !weapon.reloading;

    el.dashBar.style.transform = `scaleX(${snapshot.dashProgress})`;
    el.overdriveBar.style.transform = `scaleX(${weapon.overdriveActive ? weapon.overdriveProgress : weapon.overdriveEnergy / 100})`;

    if (waveIntroRemaining > 0) {
      el.objective.classList.add('countdown');
      el.objectiveText.textContent = `WAVE ${snapshot.wave} INBOUND`;
      el.objectiveTimer.textContent = waveIntroRemaining.toFixed(1);
    } else if (snapshot.enemiesRemaining === 0 && waveTotal === 0) {
      el.objective.classList.remove('countdown');
      el.objectiveText.textContent = 'AREA SECURE';
      el.objectiveTimer.textContent = '';
    } else {
      el.objective.classList.remove('countdown');
      el.objectiveText.textContent = 'ELIMINATE ALL HOSTILES';
      el.objectiveTimer.textContent = '';
    }
  }

  /** Crosshair gap grows with the weapon cone. */
  setSpread(spreadPixels: number): void {
    this.elements.crosshair.style.setProperty('--spread', `${spreadPixels.toFixed(1)}px`);
  }

  hitmarker(headshot: boolean, crit: boolean): void {
    const element = this.elements.hitmarker;
    element.classList.toggle('headshot', headshot || crit);
    element.classList.remove('show');
    // Force a reflow so the animation restarts on rapid hits.
    void element.offsetWidth;
    element.classList.add('show');
    window.clearTimeout(this.hitmarkerTimer);
    this.hitmarkerTimer = window.setTimeout(() => element.classList.remove('show'), 240);
  }

  damageFlash(): void {
    const element = this.elements.damageVignette;
    element.classList.add('active');
    window.clearTimeout(this.damageTimer);
    this.damageTimer = window.setTimeout(() => element.classList.remove('active'), 190);
  }

  banner(text: string, duration = 2400): void {
    const element = this.elements.banner;
    this.elements.bannerText.textContent = text;
    element.classList.remove('show');
    void element.offsetWidth;
    element.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => element.classList.remove('show'), duration);
  }

  pushKill(label: string, combo: number): void {
    const item = document.createElement('li');
    item.textContent = combo > 1 ? `${label}  x${combo}` : label;
    if (combo >= 3) item.classList.add('combo');
    this.elements.killfeed.append(item);
    while (this.elements.killfeed.childElementCount > 5) {
      this.elements.killfeed.firstElementChild?.remove();
    }
    const timer = window.setTimeout(() => item.remove(), 3200);
    this.killfeedTimers.push(timer);
  }

  private clearKillfeed(): void {
    this.elements.killfeed.textContent = '';
    for (const timer of this.killfeedTimers) window.clearTimeout(timer);
    this.killfeedTimers = [];
  }

  reset(): void {
    this.clearKillfeed();
    this.elements.banner.classList.remove('show');
    this.elements.damageVignette.classList.remove('active');
    this.elements.lowHealth.classList.remove('active');
    this.elements.hitmarker.classList.remove('show');
  }

  formatTime(seconds: number): string {
    return formatTime(seconds);
  }
}
