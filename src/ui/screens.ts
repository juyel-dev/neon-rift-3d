import { formatScore, formatTime } from '../core/math';
import type { UpgradeId, UpgradeRarity } from '../sim/upgradeDefs';

export interface UpgradeCardData {
  id: UpgradeId;
  name: string;
  short: string;
  rarity: UpgradeRarity;
  stacks: number;
  maxStacks: number;
}

export interface GameOverStats {
  score: number;
  best: number;
  wave: number;
  kills: number;
  accuracy: number;
  time: number;
  newBest: boolean;
}

type ScreenId = 'title' | 'pause' | 'upgrade' | 'gameover' | 'pointerlock' | 'loading' | 'error';

/** Controls which modal screen is visible and populates their content. */
export class Screens {
  private readonly screens: Record<ScreenId, HTMLElement>;
  private readonly upgradeCards: HTMLElement;
  private onUpgradeChosen: ((id: UpgradeId) => void) | null = null;
  private cardElements: HTMLElement[] = [];

  constructor(private readonly root: HTMLElement) {
    const query = <T extends HTMLElement>(id: string): T => {
      const element = root.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`missing screen element #${id}`);
      return element;
    };
    this.screens = {
      title: query('title-screen'),
      pause: query('pause-screen'),
      upgrade: query('upgrade-screen'),
      gameover: query('gameover-screen'),
      pointerlock: query('pointerlock-screen'),
      loading: query('loading-screen'),
      error: query('error-screen'),
    };
    this.upgradeCards = query('upgrade-cards');
  }

  hideAll(): void {
    for (const screen of Object.values(this.screens)) screen.hidden = true;
  }

  show(id: ScreenId): void {
    this.hideAll();
    this.screens[id].hidden = false;
  }

  showTitle(bestScore: number): void {
    this.show('title');
    rootText(this.root, 'title-best', formatScore(bestScore));
  }

  showUpgrade(wave: number, offers: UpgradeCardData[]): void {
    this.show('upgrade');
    rootText(this.root, 'upgrade-kicker', `WAVE ${wave} CLEARED`);
    this.renderCards(offers);
  }

  showGameOver(stats: GameOverStats): void {
    this.show('gameover');
    rootText(this.root, 'gameover-kicker', stats.newBest ? 'NEW RECORD' : 'SIGNAL LOST');
    rootText(this.root, 'final-score', formatScore(stats.score));
    rootText(this.root, 'final-best', formatScore(stats.best));
    rootText(this.root, 'final-wave', String(stats.wave));
    rootText(this.root, 'final-kills', String(stats.kills));
    rootText(this.root, 'final-accuracy', `${Math.round(stats.accuracy * 100)}%`);
    rootText(this.root, 'final-time', formatTime(stats.time));
    const newBest = this.root.querySelector<HTMLElement>('#new-best');
    if (newBest) newBest.hidden = !stats.newBest;
  }

  showError(message: string): void {
    this.show('error');
    const element = this.root.querySelector<HTMLElement>('#error-message');
    if (element) element.textContent = message;
  }

  hideLoading(): void {
    this.screens.loading.hidden = true;
  }

  setLoadingNote(note: string): void {
    rootText(this.root, 'loading-note', note);
  }

  private renderCards(offers: UpgradeCardData[]): void {
    this.upgradeCards.textContent = '';
    this.cardElements = [];
    offers.forEach((offer, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `card rarity-${offer.rarity}`;
      card.dataset.upgradeId = offer.id;

      const index_ = document.createElement('span');
      index_.className = 'card-index';
      index_.textContent = String(index + 1);

      const name = document.createElement('span');
      name.className = 'card-name';
      name.textContent = offer.name;

      const short = document.createElement('span');
      short.className = 'card-short';
      short.textContent = offer.short;

      const stacks = document.createElement('span');
      stacks.className = 'card-stacks';
      stacks.textContent = `RANK ${offer.stacks}/${offer.maxStacks}`;

      card.append(index_, name, short, stacks);
      card.addEventListener('click', () => this.onUpgradeChosen?.(offer.id));
      this.upgradeCards.append(card);
      this.cardElements.push(card);
    });
  }

  setUpgradeHandler(handler: (id: UpgradeId) => void): void {
    this.onUpgradeChosen = handler;
  }

  /** Highlights the card matching `index` (keyboard navigation feedback). */
  highlightCard(index: number): void {
    this.cardElements.forEach((card, cardIndex) => {
      card.style.boxShadow = cardIndex === index ? '0 0 30px rgba(47,240,255,0.45)' : '';
    });
  }
}

function rootText(root: HTMLElement, id: string, value: string): void {
  const element = root.querySelector<HTMLElement>(`#${id}`);
  if (element) element.textContent = value;
}
