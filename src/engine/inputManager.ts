import { createInputState, WORLD, type InputState } from '../sim/types';

/**
 * Keyboard + mouse input, translated into the simulation's InputState.
 * Pointer lock is requested from a user gesture and released on Escape.
 */
export class InputManager {
  readonly keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  sensitivity = 0.0022;
  invertY = false;
  pointerLocked = false;
  /** True when the browser focus is lost (tab hidden, window blurred). */
  focusLost = false;
  onPointerLockChange?: (locked: boolean) => void;
  onPauseRequest?: () => void;
  onAnyInput?: () => void;

  private readonly boundKeyDown = (event: KeyboardEvent): void => this.handleKeyDown(event);
  private readonly boundKeyUp = (event: KeyboardEvent): void => this.handleKeyUp(event);
  private readonly boundMouseMove = (event: MouseEvent): void => this.handleMouseMove(event);
  private readonly boundMouseDown = (event: MouseEvent): void => this.handleMouseDown(event);
  private readonly boundMouseUp = (event: MouseEvent): void => this.handleMouseUp(event);
  private readonly boundBlur = (): void => this.handleBlur();
  private readonly boundContextMenu = (event: Event): void => event.preventDefault();
  private firing = false;
  private queuedDash = false;
  private queuedReload = false;
  private queuedOverdrive = false;

  constructor(private readonly element: HTMLElement) {}

  attach(): void {
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('blur', this.boundBlur);
    document.addEventListener('mousemove', this.boundMouseMove);
    document.addEventListener('mousedown', this.boundMouseDown);
    document.addEventListener('mouseup', this.boundMouseUp);
    document.addEventListener('contextmenu', this.boundContextMenu);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
  }

  detach(): void {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('blur', this.boundBlur);
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mousedown', this.boundMouseDown);
    document.removeEventListener('mouseup', this.boundMouseUp);
    document.removeEventListener('contextmenu', this.boundContextMenu);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    this.keys.clear();
  }

  private readonly handlePointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.element;
    this.onPointerLockChange?.(this.pointerLocked);
    if (!this.pointerLocked) {
      this.firing = false;
      this.keys.clear();
    }
  };

  requestPointerLock(): void {
    if (document.pointerLockElement === this.element) return;
    const request = this.element.requestPointerLock?.bind(this.element);
    if (!request) return;
    try {
      const result = request() as unknown as Promise<void> | undefined;
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => {
          /* the browser may reject the request without a gesture */
        });
      }
    } catch {
      /* ignore */
    }
  }

  releasePointerLock(): void {
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.repeat) {
      // Still track the key for movement, but never re-trigger one-shot actions.
      this.keys.add(event.code);
      return;
    }
    this.keys.add(event.code);
    this.onAnyInput?.();

    switch (event.code) {
      case 'Escape':
        this.onPauseRequest?.();
        break;
      case 'KeyR':
        this.queuedReload = true;
        break;
      case 'Space':
        this.queuedDash = true;
        event.preventDefault();
        break;
      case 'KeyQ':
        this.queuedOverdrive = true;
        break;
      case 'Enter':
        this.onPauseRequest?.();
        break;
      default:
        break;
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    this.keys.delete(event.code);
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.pointerLocked) return;
    const scale = this.sensitivity * (event.movementX === 0 && event.movementY === 0 ? 1 : 1);
    this.mouseDX += event.movementX * scale;
    this.mouseDY += event.movementY * scale * (this.invertY ? -1 : 1);
  }

  private handleMouseDown(event: MouseEvent): void {
    if (event.button === 0) this.firing = true;
    if (event.button === 2) this.queuedOverdrive = true;
  }

  private handleMouseUp(event: MouseEvent): void {
    if (event.button === 0) this.firing = false;
  }

  private handleBlur(): void {
    this.keys.clear();
    this.firing = false;
    this.pointerLocked = false;
  }

  /** Builds the InputState for this frame and clears the accumulated deltas. */
  consume(): InputState {
    const input = createInputState();
    const key = (code: string): boolean => this.keys.has(code);

    let forward = 0;
    let right = 0;
    if (key('KeyW') || key('ArrowUp')) forward += 1;
    if (key('KeyS') || key('ArrowDown')) forward -= 1;
    if (key('KeyD') || key('ArrowRight')) right += 1;
    if (key('KeyA') || key('ArrowLeft')) right -= 1;

    input.moveForward = forward;
    input.moveRight = right;
    input.sprint = key('ShiftLeft') || key('ShiftRight');
    // Firing is only possible while the mouse is captured, so a stray click on
    // the page chrome can never keep the trigger held down.
    input.firing = this.firing && this.pointerLocked;
    input.dashQueued = this.queuedDash;
    input.reloadQueued = this.queuedReload;
    input.overdriveQueued = this.queuedOverdrive;
    input.yawDelta = this.mouseDX;
    input.pitchDelta = this.mouseDY;

    this.mouseDX = 0;
    this.mouseDY = 0;
    this.queuedDash = false;
    this.queuedReload = false;
    this.queuedOverdrive = false;
    return input;
  }

  /** True while a movement key is held (used by the pause overlay). */
  get isMoving(): boolean {
    return (
      this.keys.has('KeyW') ||
      this.keys.has('KeyA') ||
      this.keys.has('KeyS') ||
      this.keys.has('KeyD') ||
      this.keys.has('ArrowUp') ||
      this.keys.has('ArrowDown') ||
      this.keys.has('ArrowLeft') ||
      this.keys.has('ArrowRight')
    );
  }
}

export const LOOK_LIMITS = { maxPitch: WORLD.maxPitch };
