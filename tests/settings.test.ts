import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, FOV_RANGE, SENSITIVITY_RANGE, sanitizeSettings } from '../src/engine/settings';

describe('sanitizeSettings', () => {
  it('returns the defaults for an empty object', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps numeric ranges', () => {
    const low = sanitizeSettings({ volume: -4, fov: 10, sensitivity: 0 });
    expect(low.volume).toBe(0);
    expect(low.fov).toBe(FOV_RANGE.min);
    expect(low.sensitivity).toBe(SENSITIVITY_RANGE.min);

    const high = sanitizeSettings({ volume: 9, fov: 500, sensitivity: 1 });
    expect(high.volume).toBe(1);
    expect(high.fov).toBe(FOV_RANGE.max);
    expect(high.sensitivity).toBe(SENSITIVITY_RANGE.max);
  });

  it('falls back to defaults for non-numeric garbage', () => {
    const result = sanitizeSettings({
      volume: Number.NaN,
      fov: 'wide' as unknown as number,
      bestScore: 'lots' as unknown as number,
      runsPlayed: -7,
    });
    expect(result.volume).toBe(DEFAULT_SETTINGS.volume);
    expect(result.fov).toBe(DEFAULT_SETTINGS.fov);
    expect(result.bestScore).toBe(0);
    expect(result.runsPlayed).toBe(0);
  });

  it('rejects unknown quality presets and keeps valid ones', () => {
    expect(sanitizeSettings({ quality: 'ultra' as unknown as 'low' }).quality).toBe('medium');
    expect(sanitizeSettings({ quality: 'low' }).quality).toBe('low');
    expect(sanitizeSettings({ quality: 'high' }).quality).toBe('high');
  });

  it('floors score counters and keeps the sound flag a boolean', () => {
    const result = sanitizeSettings({ bestScore: 1234.9, runsPlayed: 3.2, soundEnabled: false });
    expect(result.bestScore).toBe(1234);
    expect(result.runsPlayed).toBe(3);
    expect(result.soundEnabled).toBe(false);
  });
});
