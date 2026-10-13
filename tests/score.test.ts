import { describe, expect, it } from 'vitest';
import {
  accuracy,
  applyWaveBonus,
  comboMultiplier,
  createScoreTracker,
  isNewBest,
  registerKill,
  registerPickup,
  registerPlayerDamage,
  registerShot,
  tickCombo,
} from '../src/sim/score';

describe('score tracking', () => {
  it('starts at zero with no recorded shots', () => {
    const tracker = createScoreTracker();
    expect(tracker.score).toBe(0);
    expect(accuracy(tracker)).toBe(0);
    expect(comboMultiplier(tracker)).toBe(1);
  });

  it('accumulates kill points with a combo multiplier', () => {
    const tracker = createScoreTracker();
    const first = registerKill(tracker, 100);
    expect(first).toBe(100);
    expect(tracker.combo).toBe(1);
    const second = registerKill(tracker, 100);
    expect(second).toBeGreaterThan(first);
    expect(comboMultiplier(tracker)).toBeCloseTo(1.05, 5);
  });

  it('caps the combo multiplier at 3x', () => {
    const tracker = createScoreTracker();
    for (let i = 0; i < 100; i++) registerKill(tracker, 10);
    expect(comboMultiplier(tracker)).toBeLessThanOrEqual(3);
    expect(tracker.bestCombo).toBe(100);
  });

  it('resets the combo when the player takes damage', () => {
    const tracker = createScoreTracker();
    registerKill(tracker, 50);
    registerKill(tracker, 50);
    registerPlayerDamage(tracker);
    expect(tracker.combo).toBe(0);
    expect(comboMultiplier(tracker)).toBe(1);
  });

  it('expires the combo after the combo window', () => {
    const tracker = createScoreTracker();
    registerKill(tracker, 50);
    tickCombo(tracker, 2.9);
    expect(tracker.combo).toBe(1);
    tickCombo(tracker, 0.2);
    expect(tracker.combo).toBe(0);
  });

  it('keeps the combo alive with rapid kills', () => {
    const tracker = createScoreTracker();
    registerKill(tracker, 50);
    for (let i = 0; i < 10; i++) {
      tickCombo(tracker, 0.5);
      registerKill(tracker, 50);
    }
    expect(tracker.combo).toBe(11);
  });

  it('tracks accuracy including headshots', () => {
    const tracker = createScoreTracker();
    registerShot(tracker, true, false);
    registerShot(tracker, true, true);
    registerShot(tracker, true, true);
    registerShot(tracker, false, false);
    expect(tracker.shotsFired).toBe(4);
    expect(tracker.shotsHit).toBe(3);
    expect(tracker.headshots).toBe(2);
    expect(accuracy(tracker)).toBeCloseTo(0.75, 5);
  });

  it('awards the wave clear bonus and advances the wave counter', () => {
    const tracker = createScoreTracker();
    const awarded = applyWaveBonus(tracker, 3, 425);
    expect(awarded).toBe(425);
    expect(tracker.score).toBe(425);
    expect(tracker.wave).toBe(3);
  });

  it('registers pickups as score and energy', () => {
    const tracker = createScoreTracker();
    registerPickup(tracker, 4, 6);
    expect(tracker.energyCollected).toBe(4);
    expect(tracker.score).toBe(6);
  });

  it('only reports a new best score when the player killed something', () => {
    const tracker = createScoreTracker();
    expect(isNewBest(tracker, 500)).toBe(false);
    registerKill(tracker, 10);
    tracker.score += 1000;
    expect(isNewBest(tracker, 500)).toBe(true);
    expect(isNewBest(tracker, 5000)).toBe(false);
  });
});
