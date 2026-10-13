import { describe, expect, it } from 'vitest';
import { StateMachine } from '../src/core/stateMachine';
import { TRANSITIONS } from '../src/sim/gameSim';
import type { GameStateName } from '../src/sim/types';

describe('state machine', () => {
  const build = (): StateMachine<GameStateName> =>
    new StateMachine<GameStateName>('title', TRANSITIONS);

  it('allows legal transitions only', () => {
    const machine = build();
    expect(machine.canTransition('playing')).toBe(true);
    expect(machine.canTransition('gameover')).toBe(false);
    expect(machine.state).toBe('title');
  });

  it('rejects a self transition', () => {
    const machine = build();
    expect(machine.canTransition('title')).toBe(false);
  });

  it('runs enter and exit hooks in order', () => {
    const machine = build();
    const calls: string[] = [];
    machine.onExitState('title', () => calls.push('exit:title'));
    machine.onEnterState('playing', () => calls.push('enter:playing'));
    machine.transition('playing');
    expect(calls).toEqual(['exit:title', 'enter:playing']);
    expect(machine.previous).toBe('title');
    expect(machine.transitionsTaken).toBe(1);
  });

  it('ignores illegal transitions', () => {
    const machine = build();
    expect(machine.transition('upgrade')).toBe(false);
    expect(machine.state).toBe('title');
    expect(machine.transitionsTaken).toBe(0);
  });

  it('notifies change subscribers', () => {
    const machine = build();
    const seen: Array<{ state: string; previous: string | null }> = [];
    machine.onChange((state, previous) => seen.push({ state, previous }));
    machine.transition('playing');
    machine.transition('paused');
    machine.transition('playing');
    expect(seen).toEqual([
      { state: 'playing', previous: 'title' },
      { state: 'paused', previous: 'playing' },
      { state: 'playing', previous: 'paused' },
    ]);
  });

  it('supports a hard reset that keeps subscribers registered', () => {
    const machine = build();
    let changes = 0;
    machine.onChange(() => changes++);
    machine.transition('playing');
    expect(changes).toBe(1);
    machine.resetTo('title');
    expect(machine.state).toBe('title');
    expect(machine.previous).toBeNull();
    machine.transition('playing');
    expect(changes).toBe(2);
  });

  it('can remove all hooks on teardown', () => {
    const machine = build();
    let changes = 0;
    const handler = (): void => {
      changes += 1;
    };
    machine.onChange(handler);
    machine.reset();
    machine.transition('playing');
    expect(changes).toBe(0);
  });
});
