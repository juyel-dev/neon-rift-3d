/**
 * Generic object pool. Used for projectiles, particles, tracers and enemy views
 * so that long play sessions do not create garbage every frame.
 */
export interface Poolable {
  active: boolean;
}

export interface PoolOptions<T extends Poolable> {
  factory: () => T;
  reset: (item: T) => void;
  /** Optional growth strategy. Defaults to doubling. */
  grow?: (currentSize: number) => number;
  /** Hard ceiling to avoid runaway allocation. */
  max?: number;
}

export class ObjectPool<T extends Poolable> {
  private readonly pool: T[] = [];
  private readonly options: PoolOptions<T>;
  private readonly maxSize: number;

  constructor(options: PoolOptions<T>) {
    this.options = options;
    this.maxSize = options.max ?? 4096;
  }

  get size(): number {
    return this.pool.length;
  }

  /** Direct access to the backing store (read-only; iteration is allocation free). */
  get items(): readonly T[] {
    return this.pool;
  }

  /** Number of currently active items. */
  get activeCount(): number {
    let count = 0;
    for (const item of this.pool) if (item.active) count++;
    return count;
  }

  /** Acquires an item, growing the pool when needed. Returns null when full. */
  acquire(): T | null {
    for (const item of this.pool) {
      if (!item.active) return item;
    }
    if (this.pool.length >= this.maxSize) return null;
    const growBy = this.options.grow ? this.options.grow(this.pool.length) : Math.max(1, this.pool.length);
    for (let i = 0; i < growBy && this.pool.length < this.maxSize; i++) {
      this.pool.push(this.options.factory());
    }
    const item = this.pool.find((candidate) => !candidate.active);
    return item ?? null;
  }

  /** Iterates over active items. */
  forEachActive(callback: (item: T) => void): void {
    for (const item of this.items) if (item.active) callback(item);
  }

  findActive(predicate: (item: T) => boolean): T | null {
    for (const item of this.items) if (item.active && predicate(item)) return item;
    return null;
  }

  /** Releases a single item. */
  release(item: T): void {
    if (!item.active) return;
    this.options.reset(item);
    item.active = false;
  }

  /** Releases every item that matches the predicate (or all of them). */
  releaseWhere(predicate?: (item: T) => boolean): void {
    for (const item of this.pool) {
      if (item.active && (!predicate || predicate(item))) this.release(item);
    }
  }

  releaseAll(): void {
    this.releaseWhere();
  }

  /** Drops every pooled item. GPU resources are owned by the caller. */
  clear(): void {
    this.pool.length = 0;
  }
}
