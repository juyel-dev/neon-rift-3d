import { readStore, removeStore, writeStore } from '../core/storage';

export type QualityLevel = 'low' | 'medium' | 'high';

export interface Settings {
  soundEnabled: boolean;
  /** Master volume, 0..1. */
  volume: number;
  /** Vertical field of view of the main camera, in degrees. */
  fov: number;
  quality: QualityLevel;
  sensitivity: number;
  bestScore: number;
  runsPlayed: number;
}

export const SENSITIVITY_RANGE = { min: 0.0006, max: 0.005 } as const;
export const FOV_RANGE = { min: 60, max: 100 } as const;

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  volume: 0.8,
  fov: 76,
  quality: 'medium',
  sensitivity: 0.0022,
  bestScore: 0,
  runsPlayed: 0,
};

const KEY = 'settings';

/** Coerces any stored or incoming value into a valid, in-range Settings object. */
export function sanitizeSettings(input: Partial<Settings>): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...input };
  const quality: QualityLevel = merged.quality === 'low' || merged.quality === 'high' ? merged.quality : 'medium';
  return {
    soundEnabled: merged.soundEnabled !== false,
    volume: clampNumber(merged.volume, 0, 1, DEFAULT_SETTINGS.volume),
    fov: clampNumber(merged.fov, FOV_RANGE.min, FOV_RANGE.max, DEFAULT_SETTINGS.fov),
    quality,
    sensitivity: clampNumber(merged.sensitivity, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max, DEFAULT_SETTINGS.sensitivity),
    bestScore: Math.max(0, Math.floor(Number(merged.bestScore)) || 0),
    runsPlayed: Math.max(0, Math.floor(Number(merged.runsPlayed)) || 0),
  };
}

/** Persisted player preferences (sound, quality, sensitivity, best score). */
export class SettingsStore {
  private settings: Settings;

  constructor() {
    const stored = readStore<unknown>(KEY, {});
    this.settings = sanitizeSettings(stored && typeof stored === 'object' ? (stored as Partial<Settings>) : {});
  }

  get(): Settings {
    return { ...this.settings };
  }

  update(patch: Partial<Settings>): Settings {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
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
