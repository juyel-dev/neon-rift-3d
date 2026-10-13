import './ui/ui.css';
import { Game } from './engine/game';
import { SettingsStore } from './engine/settings';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found as T;
}

function describeTouchFallback(): void {
  const note = element<HTMLElement>('desktop-note');
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) {
    note.textContent =
      'Desktop build: keyboard and mouse required. Press ESC at any time to release the mouse and pause.';
    return;
  }
  note.textContent =
    'Touch device detected: aiming needs a mouse, so this build shows the arena read-only. There are no fake touch controls yet.';
}

function wireSettings(game: Game, settings: SettingsStore): void {
  const start = element<HTMLButtonElement>('btn-start');
  const howTo = element<HTMLButtonElement>('btn-how-to');
  const controls = element<HTMLElement>('controls-grid');
  const soundTitle = element<HTMLButtonElement>('toggle-sound-title');
  const soundPause = element<HTMLButtonElement>('toggle-sound-pause');
  const quality = element<HTMLSelectElement>('select-quality');
  const sensitivity = element<HTMLInputElement>('range-sensitivity');
  const sensitivityPause = element<HTMLInputElement>('range-sensitivity-pause');
  const resume = element<HTMLButtonElement>('btn-resume');
  const restartPause = element<HTMLButtonElement>('btn-restart-pause');
  const quit = element<HTMLButtonElement>('btn-quit');
  const restart = element<HTMLButtonElement>('btn-restart');
  const toTitle = element<HTMLButtonElement>('btn-title');
  const relock = element<HTMLButtonElement>('btn-relock');
  const skipUpgrade = element<HTMLButtonElement>('btn-skip-upgrade');

  let controlsVisible = false;
  controls.hidden = true;

  start.addEventListener('click', () => {
    settings.update({ soundEnabled: settings.get().soundEnabled });
    game.applySettings();
    game.startRun();
  });

  howTo.addEventListener('click', () => {
    controlsVisible = !controlsVisible;
    controls.hidden = !controlsVisible;
    howTo.textContent = controlsVisible ? 'HIDE CONTROLS' : 'CONTROLS';
  });

  const toggleSound = (): void => {
    const current = settings.get().soundEnabled;
    const next = settings.update({ soundEnabled: !current }).soundEnabled;
    if (game) game.applySettings();
    void next;
  };
  soundTitle.addEventListener('click', toggleSound);
  soundPause.addEventListener('click', toggleSound);

  quality.addEventListener('change', () => {
    settings.update({ quality: quality.value as 'low' | 'medium' | 'high' });
    game.applySettings();
  });

  const onSensitivity = (value: string): void => {
    settings.update({ sensitivity: Number.parseFloat(value) });
    game.applySettings();
  };
  sensitivity.addEventListener('input', () => onSensitivity(sensitivity.value));
  sensitivityPause.addEventListener('input', () => onSensitivity(sensitivityPause.value));

  resume.addEventListener('click', () => game.resume());
  restartPause.addEventListener('click', () => game.restart());
  quit.addEventListener('click', () => game.returnToTitle());
  restart.addEventListener('click', () => game.restart());
  toTitle.addEventListener('click', () => game.returnToTitle());
  relock.addEventListener('click', () => game.requestPointerLock());
  skipUpgrade.addEventListener('click', () => {
    // Skipping advances the wave through the simulation.
    (game as unknown as { sim: { skipUpgrade(): boolean } }).sim.skipUpgrade();
    game.applySettings();
  });

  // Keyboard access for the upgrade screen and menus.
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit3') {
      const cards = document.querySelectorAll<HTMLElement>('#upgrade-cards .card');
      const index = Number(event.code.slice(5)) - 1;
      if (cards[index]) cards[index].click();
    }
    if (event.code === 'Enter' && !document.getElementById('title-screen')?.hidden) start.click();
  });
}

function boot(): void {
  const canvas = element<HTMLCanvasElement>('scene');
  const container = element<HTMLElement>('app');
  const settings = new SettingsStore();
  describeTouchFallback();

  let game: Game | null = null;
  try {
    game = new Game(canvas, container, settings);
  } catch (error) {
    document.getElementById('error-screen')?.removeAttribute('hidden');
    const message = element<HTMLElement>('error-message');
    message.textContent = `The 3D engine could not start: ${(error as Error).message}`;
    console.error(error);
    return;
  }

  void game
    .init()
    .then(() => {
      wireSettings(game as Game, settings);
      (game as Game).applySettings();
      document.getElementById('loading-screen')?.setAttribute('hidden', '');
      document.getElementById('title-screen')?.removeAttribute('hidden');
    })
    .catch((error: unknown) => {
      console.error(error);
      document.getElementById('error-screen')?.removeAttribute('hidden');
      element<HTMLElement>('error-message').textContent = `Initialisation failed: ${(error as Error).message}`;
    });

  // Expose a tiny handle for automated smoke tests.
  (window as unknown as { neonRift?: unknown }).neonRift = {
    get game() {
      return game;
    },
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
