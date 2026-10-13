import { readStore, removeStore, writeStore } from '../core/storage';

export type QualityLevel = 'low' | 'medium' | 'high';

export interface Settings {
  soundEnabled: boolean;
  quality: QualityLevel;
  sensitivity: number;
  bestScore: number;
  runsPlayed: number;
}

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  quality: 'medium',
  sensitivity: 0.0022,
  bestScore: 0,
  runsPlayed: 0,
};

const KEY = 'settings';

/** Persisted player preferences (sound, quality, sensitivity, best score). */
export class SettingsStore {
  private settings: Settings;

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS, ...readStore<Partial<Settings>>(KEY, {}) };
    this.settings.sensitivity = clampNumber(this.settings.sensitivity, 0.0006, 0.005, DEFAULT_SETTINGS.sensitivity);
    this.settings.bestScore = Math.max(0, Math.floor(this.settings.bestScore) || 0);
    this.settings.runsPlayed = Math.max(0, Math.floor(this.settings.runsPlayed) || 0);
    if (this.settings.quality !== 'low' && this.settings.quality !== 'high') this.settings.quality = 'medium';
    this.settings.soundEnabled = this.settings.soundEnabled !== false;
  }

  get(): Settings {
    return { ...this.settings };
  }

  update(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch };
    this.settings.sensitivity = clampNumber(this.settings.sensitivity, 0.0006, 0.005, DEFAULT_SETTINGS.sensitivity);
    this.settings.bestScore = Math.max(0, Math.floor(this.settings.bestScore));
    this.settings.runsPlayed = Math.max(0, Math.floor(this.settings.runsPlayed));
    writeStore(KEY, this.settings);
    return this.get();
  }

  /** Stores a new best score when it beats the stored one. Returns true when it did. */
  recordScore(score: number): boolean {
    const value = Math.max(0, Math.floor(score));
    const improved = value > this.settings.bestScore;
    this.update({
      bestScore: improved ? value : this.settings.bestScore,
      runsPlayed: this.settings.runsPlayed + 1,
    });
    return improved;
  }

  reset(): void {
    removeStore(KEY);
    this.settings = { ...DEFAULT_SETTINGS };
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numeric));
}

/** Graphics preset derived from the persisted quality level. */
export interface QualityPreset {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  bloomStrength: number;
  maxParticles: number;
  antialias: boolean;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    pixelRatio: 1,
    shadows: false,
    shadowMapSize: 512,
    bloom: false,
    bloomStrength: 0,
    maxParticles: 600,
    antialias: false,
  },
  medium: {
    pixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    bloom: true,
    bloomStrength: 0.42,
    maxParticles: 1400,
    antialias: true,
  },
  high: {
    pixelRatio: 2,
    shadows: true,
    shadowMapSize: 2048,
    bloom: true,
    bloomStrength: 0.55,
    maxParticles: 2200,
    antialias: true,
  },
};

export function presetFor(quality: QualityLevel): QualityPreset {
  return QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.medium;
}
