import { clamp } from '../core/math';

export interface ScoreTracker {
  score: number;
  kills: number;
  shotsFired: number;
  shotsHit: number;
  headshots: number;
  combo: number;
  comboTimer: number;
  comboWindow: number;
  bestCombo: number;
  wave: number;
  energyCollected: number;
}

export function createScoreTracker(): ScoreTracker {
  return {
    score: 0,
    kills: 0,
    shotsFired: 0,
    shotsHit: 0,
    headshots: 0,
    combo: 0,
    comboTimer: 0,
    comboWindow: 3,
    bestCombo: 0,
    wave: 1,
    energyCollected: 0,
  };
}

/**
 * Combo multiplier. The first kill of a streak is worth the base value, every
 * additional kill adds 5% and the streak is capped at 3x.
 */
export function comboMultiplier(tracker: ScoreTracker): number {
  return 1 + Math.min(Math.max(0, tracker.combo - 1), 40) * 0.05;
}

/**
 * Registers a kill and returns the amount actually awarded (including the combo
 * multiplier). Kills stack the combo window, which is what rewards aggressive
 * play.
 */
export function registerKill(tracker: ScoreTracker, basePoints: number): number {
  tracker.kills += 1;
  tracker.combo += 1;
  tracker.comboTimer = tracker.comboWindow;
  if (tracker.combo > tracker.bestCombo) tracker.bestCombo = tracker.combo;
  const awarded = Math.round(basePoints * comboMultiplier(tracker));
  tracker.score += awarded;
  return awarded;
}

/** Player damage breaks the combo, adding risk to aggressive play. */
export function registerPlayerDamage(tracker: ScoreTracker): void {
  tracker.combo = 0;
  tracker.comboTimer = 0;
}

export function tickCombo(tracker: ScoreTracker, dt: number): void {
  if (tracker.comboTimer <= 0) return;
  tracker.comboTimer -= dt;
  if (tracker.comboTimer <= 0) {
    tracker.comboTimer = 0;
    tracker.combo = 0;
  }
}

export function registerShot(tracker: ScoreTracker, hit: boolean, headshot: boolean): void {
  tracker.shotsFired += 1;
  if (hit) tracker.shotsHit += 1;
  if (hit && headshot) tracker.headshots += 1;
}

export function accuracy(tracker: ScoreTracker): number {
  if (tracker.shotsFired === 0) return 0;
  return clamp(tracker.shotsHit / tracker.shotsFired, 0, 1);
}

export function addScore(tracker: ScoreTracker, points: number): void {
  tracker.score += Math.max(0, Math.round(points));
}

export function applyWaveBonus(tracker: ScoreTracker, wave: number, bonus: number): number {
  const awarded = Math.round(bonus);
  addScore(tracker, awarded);
  tracker.wave = wave;
  return awarded;
}

export function registerPickup(tracker: ScoreTracker, energyValue: number, points: number): void {
  tracker.energyCollected += energyValue;
  tracker.score += Math.max(0, Math.round(points));
}

/** Best-score persistence is computed here and stored by the UI layer. */
export function isNewBest(tracker: ScoreTracker, bestScore: number): boolean {
  return tracker.score > bestScore && tracker.kills > 0;
}
