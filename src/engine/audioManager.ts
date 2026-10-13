/**
 * Fully synthesised audio: no asset files, no external requests. Every sound is
 * built from oscillators and noise buffers through a small node graph, and every
 * transient node is stopped and disconnected when it finishes.
 */
export type SoundName =
  | 'shot'
  | 'dryFire'
  | 'reload'
  | 'impact'
  | 'enemyHit'
  | 'enemyDeath'
  | 'playerHurt'
  | 'pickup'
  | 'dash'
  | 'shockwave'
  | 'waveStart'
  | 'waveClear'
  | 'upgrade'
  | 'gameOver'
  | 'enemyWindup'
  | 'enemyFire'
  | 'overdrive'
  | 'uiClick';

const MASTER_CEILING = 0.9;

export class AudioManager {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientNodes: AudioNode[] = [];
  private ambientSources: AudioScheduledSourceNode[] = [];
  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  private soundEnabled = true;
  private started = false;
  private lastPlayed = new Map<SoundName, number>();
  /** Guards against dozens of identical sounds firing on the same frame. */
  private readonly throttle: Partial<Record<SoundName, number>> = {
    impact: 0.035,
    enemyHit: 0.04,
    pickup: 0.05,
    enemyWindup: 0.12,
    shot: 0.03,
  };

  get enabled(): boolean {
    return this.soundEnabled;
  }

  get contextState(): string {
    return this.context?.state ?? 'uninitialised';
  }

  /** Lazily creates the audio graph (must be called from a user gesture). */
  init(): void {
    if (this.started) {
      void this.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.soundEnabled = false;
      return;
    }
    try {
      this.context = new Ctor();
    } catch {
      this.soundEnabled = false;
      return;
    }
    this.started = true;

    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.soundEnabled ? MASTER_CEILING : 0;
    this.masterGain.connect(this.context.destination);

    this.sfxGain = this.context.createGain();
    this.sfxGain.gain.value = 0.85;
    this.sfxGain.connect(this.masterGain);

    this.musicGain = this.context.createGain();
    this.musicGain.gain.value = 0.32;
    this.musicGain.connect(this.masterGain);

    // Shared white-noise buffer for percussive sounds.
    const length = Math.floor(this.context.sampleRate * 1.2);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;

    this.buildAmbient();
  }

  setEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    if (this.masterGain && this.context) {
      this.masterGain.gain.setTargetAtTime(enabled ? MASTER_CEILING : 0, this.context.currentTime, 0.05);
    }
    if (enabled) void this.resume();
  }

  async resume(): Promise<void> {
    if (this.context && this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch {
        /* ignore */
      }
    }
  }

  /** Slow evolving pad plus a subtle pulse, played through a low-pass filter. */
  private buildAmbient(): void {
    const context = this.context;
    const musicGain = this.musicGain;
    if (!context || !musicGain) return;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.9;
    filter.connect(musicGain);

    const drones: Array<[number, number, OscillatorType]> = [
      [55, 0.16, 'sine'],
      [82.4, 0.11, 'sine'],
      [110.5, 0.07, 'triangle'],
    ];
    for (const [frequency, gainValue, type] of drones) {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.value = gainValue;

      // Slow detune LFO keeps the pad alive.
      const lfo = context.createOscillator();
      lfo.frequency.value = 0.07 + Math.random() * 0.1;
      const lfoGain = context.createGain();
      lfoGain.gain.value = 1.6;
      lfo.connect(lfoGain);
      lfoGain.connect(oscillator.detune);

      oscillator.connect(gain);
      gain.connect(filter);
      oscillator.start();
      lfo.start();
      this.ambientNodes.push(lfo, lfoGain, gain, filter);
      this.ambientSources.push(oscillator, lfo);
    }

    // Rhythmic sub pulses driven by a lookahead scheduler.
    this.nextNoteTime = context.currentTime + 0.1;
    const schedule = (): void => {
      if (!this.context) return;
      while (this.nextNoteTime < this.context.currentTime + 0.4) {
        this.schedulePulse(this.nextNoteTime);
        this.nextNoteTime += 0.6;
      }
      this.musicTimer = window.setTimeout(schedule, 120);
    };
    schedule();
  }

  private schedulePulse(time: number): void {
    const context = this.context;
    if (!context || !this.musicGain) return;
    const oscillator = context.createOscillator();
    oscillator.type = 'sawtooth';
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 220;
    filter.Q.value = 4;

    const pattern = [110, 110, 146.8, 110, 98, 98, 130.8, 110];
    oscillator.frequency.value = pattern[this.musicStep % pattern.length];
    this.musicStep += 1;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.22, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.5);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    oscillator.start(time);
    oscillator.stop(time + 0.55);
  }

  /** Plays a named effect, honouring the per-sound throttle. */
  play(name: SoundName, intensity = 1): void {
    if (!this.soundEnabled) return;
    this.init();
    const context = this.context;
    const output = this.sfxGain;
    if (!context || !output) return;

    const now = context.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    const minimum = this.throttle[name] ?? 0;
    if (now - last < minimum) return;
    this.lastPlayed.set(name, now);

    const level = Math.max(0, Math.min(1.6, intensity));
    switch (name) {
      case 'shot':
        this.pulse('shot', level);
        break;
      case 'dryFire':
        this.click(now, output, 1400, 0.05, 0.18);
        break;
      case 'reload':
        this.click(now, output, 380, 0.08, 0.3);
        this.click(now + 0.18, output, 900, 0.06, 0.22);
        this.click(now + 0.62, output, 620, 0.07, 0.3);
        break;
      case 'impact':
        this.noise(now, output, 0.09, 2400, 0.32 * level, 'bandpass');
        break;
      case 'enemyHit':
        this.tone(now, output, 220, 90, 0.09, 'square', 0.14 * level);
        break;
      case 'enemyDeath':
        this.noise(now, output, 0.36, 900, 0.42 * level, 'lowpass');
        this.tone(now, output, 180, 40, 0.34, 'sawtooth', 0.22 * level);
        break;
      case 'playerHurt':
        this.tone(now, output, 150, 50, 0.24, 'sine', 0.4 * level);
        this.noise(now, output, 0.16, 500, 0.24 * level, 'lowpass');
        break;
      case 'pickup':
        this.tone(now, output, 660, 990, 0.12, 'triangle', 0.16 * level);
        this.tone(now + 0.06, output, 990, 1320, 0.1, 'sine', 0.12 * level);
        break;
      case 'dash':
        this.noise(now, output, 0.22, 1600, 0.22 * level, 'highpass');
        break;
      case 'shockwave':
        this.tone(now, output, 90, 30, 0.5, 'sine', 0.4 * level);
        this.noise(now, output, 0.4, 400, 0.3 * level, 'lowpass');
        break;
      case 'waveStart':
        [523.25, 659.25, 783.99].forEach((frequency, index) => {
          this.tone(now + index * 0.11, output, frequency, frequency, 0.3, 'triangle', 0.16);
        });
        break;
      case 'waveClear':
        [659.25, 830.6, 987.77, 1318.5].forEach((frequency, index) => {
          this.tone(now + index * 0.09, output, frequency, frequency, 0.26, 'sine', 0.14);
        });
        break;
      case 'upgrade':
        this.tone(now, output, 440, 880, 0.24, 'square', 0.13);
        this.tone(now + 0.12, output, 880, 1320, 0.2, 'triangle', 0.12);
        break;
      case 'gameOver':
        this.tone(now, output, 320, 60, 1.1, 'sawtooth', 0.24);
        this.tone(now + 0.1, output, 210, 40, 1.2, 'sine', 0.2);
        break;
      case 'enemyWindup':
        this.tone(now, output, 120, 240, 0.22, 'sawtooth', 0.1 * level);
        break;
      case 'enemyFire':
        this.tone(now, output, 520, 160, 0.16, 'square', 0.12 * level);
        break;
      case 'overdrive':
        this.tone(now, output, 180, 720, 0.5, 'sawtooth', 0.2);
        break;
      case 'uiClick':
        this.click(now, output, 760, 0.05, 0.2);
        break;
      default:
        break;
    }
  }

  private pulse(kind: 'shot', level: number): void {
    const context = this.context;
    const output = this.sfxGain;
    if (!context || !output) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.exponentialRampToValueAtTime(140, now + 0.09);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3 * level, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2600;
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    oscillator.start(now);
    oscillator.stop(now + 0.16);
    this.noise(now, output, 0.07, 3000, 0.2 * level, 'highpass');
    void kind;
  }

  private tone(
    time: number,
    output: AudioNode,
    fromFrequency: number,
    toFrequency: number,
    duration: number,
    type: OscillatorType,
    peak: number,
  ): void {
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, fromFrequency), time);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, toFrequency), time + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + duration * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain);
    gain.connect(output);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
  }

  private noise(
    time: number,
    output: AudioNode,
    duration: number,
    frequency: number,
    peak: number,
    filterType: BiquadFilterType,
  ): void {
    const context = this.context;
    if (!context || !this.noiseBuffer) return;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = 1.2;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    source.start(time);
    source.stop(time + duration + 0.02);
  }

  private click(time: number, output: AudioNode, frequency: number, duration: number, peak: number): void {
    const context = this.context;
    if (!context || !this.noiseBuffer) return;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 6;
    const gain = context.createGain();
    gain.gain.setValueAtTime(peak, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    source.start(time);
    source.stop(time + duration + 0.02);
  }

  /** Frees every node; the manager cannot be reused afterwards. */
  dispose(): void {
    if (this.musicTimer !== null) {
      window.clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    for (const source of this.ambientSources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.ambientSources.length = 0;
    for (const node of this.ambientNodes) node.disconnect();
    this.ambientNodes.length = 0;
    this.masterGain?.disconnect();
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.noiseBuffer = null;
    this.started = false;
  }
}
