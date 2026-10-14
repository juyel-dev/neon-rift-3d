import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/sim/gameSim';
import type { SimEvent } from '../src/sim/events';
import { createInputState } from '../src/sim/types';

const DT = 1 / 60;

function killPlayer(sim: GameSim): SimEvent[] {
  sim['damagePlayer'](1_000_000, 0);
  const events: SimEvent[] = [];
  for (let i = 0; i < 5; i++) {
    sim.update(DT, createInputState());
    events.push(...sim.drainEvents());
  }
  return events;
}

const gameOverEvents = (events: SimEvent[]): SimEvent[] =>
  events.filter((event) => event.type === 'state' && event.state === 'gameover');

describe('consecutive runs', () => {
  it('emits exactly one gameover transition for every run, not just the first', () => {
    const sim = new GameSim(undefined, 99);
    for (let run = 1; run <= 4; run++) {
      sim.startRun(99 + run);
      sim.debugSkipIntro();
      sim.clearEvents();
      const events = killPlayer(sim);
      expect(sim.state, `run ${run}`).toBe('gameover');
      expect(gameOverEvents(events), `run ${run}`).toHaveLength(1);
      expect(events.filter((event) => event.type === 'playerDied'), `run ${run}`).toHaveLength(1);
    }
  });

  it('starts every run from a clean slate after a previous death', () => {
    const sim = new GameSim(undefined, 7);
    sim.startRun(7);
    sim.debugSkipIntro();
    killPlayer(sim);

    sim.startRun(8);
    expect(sim.state).toBe('playing');
    expect(sim.wave.wave).toBe(1);
    expect(sim.player.alive).toBe(true);
    expect(sim.score.score).toBe(0);
    expect(sim.enemies.aliveCount).toBe(0);
  });
});
