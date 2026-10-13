/**
 * Generic finite state machine used for the game flow (title -> playing ->
 * paused -> upgrade -> gameover). The transition table is explicit so illegal
 * transitions are impossible, which keeps restart behaviour predictable.
 */
export type TransitionTable<S extends string> = Partial<Record<S, readonly S[]>>;

export class StateMachine<S extends string> {
  private currentState: S;
  private previousState: S | null = null;
  private readonly transitions: TransitionTable<S>;
  private readonly onEnter = new Map<S, Array<(previous: S | null) => void>>();
  private readonly onExit = new Map<S, Array<(next: S) => void>>();
  private readonly onChangeCallbacks = new Set<(state: S, previous: S | null) => void>();
  /** Monotonic counter, incremented on every transition (handy for tests). */
  public transitionsTaken = 0;

  constructor(initial: S, transitions: TransitionTable<S> = {}) {
    this.currentState = initial;
    this.transitions = transitions;
  }

  get state(): S {
    return this.currentState;
  }

  get previous(): S | null {
    return this.previousState;
  }

  canTransition(to: S): boolean {
    if (to === this.currentState) return false;
    const allowed = this.transitions[this.currentState];
    return allowed ? allowed.includes(to) : true;
  }

  /**
   * Hard reset used when a run restarts: jumps to `state` without running
   * enter/exit hooks. Subscriptions registered with onChange() stay alive so
   * listeners never have to be re-attached (which is what would cause duplicate
   * handlers after a restart).
   */
  resetTo(state: S): void {
    this.currentState = state;
    this.previousState = null;
    this.transitionsTaken = 0;
  }

  /** Runs `to` transition. Returns false (and does nothing) when illegal. */
  transition(to: S): boolean {
    if (!this.canTransition(to)) return false;
    const from = this.currentState;
    for (const handler of this.onExit.get(from) ?? []) handler(to);
    this.currentState = to;
    this.previousState = from;
    this.transitionsTaken += 1;
    for (const handler of this.onEnter.get(to) ?? []) handler(from);
    for (const handler of [...this.onChangeCallbacks]) handler(to, from);
    return true;
  }

  onEnterState(state: S, handler: (previous: S | null) => void): void {
    const list = this.onEnter.get(state) ?? [];
    list.push(handler);
    this.onEnter.set(state, list);
  }

  onExitState(state: S, handler: (next: S) => void): void {
    const list = this.onExit.get(state) ?? [];
    list.push(handler);
    this.onExit.set(state, list);
  }

  onChange(handler: (state: S, previous: S | null) => void): void {
    this.onChangeCallbacks.add(handler);
  }

  /** Removes hooks registered so far (used when the engine is torn down). */
  reset(): void {
    this.onEnter.clear();
    this.onExit.clear();
    this.onChangeCallbacks.clear();
  }
}
