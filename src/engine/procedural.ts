import {
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  MeshStandardMaterial,
  NearestFilter,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/** Palette shared by the environment, the UI and the effects. */
export const PALETTE = {
  cyan: 0x2ff0ff,
  violet: 0x8b5cff,
  magenta: 0xff3ea5,
  amber: 0xffb347,
  deep: 0x05070f,
  steel: 0x1b2233,
} as const;

/** Deterministic value noise so every run builds the same textures. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function createCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

function finishCanvas(canvas: HTMLCanvasElement, repeat = 1): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Brushed metal floor plate with a glowing grid. */
export function createFloorTexture(): CanvasTexture {
  const size = 512;
  const { canvas, ctx } = createCanvas(size);
  const random = makeRandom(7);

  ctx.fillStyle = '#0a0e18';
  ctx.fillRect(0, 0, size, size);

  // Brushed metal speckle.
  for (let i = 0; i < 12000; i++) {
    const x = random() * size;
    const y = random() * size;
    const alpha = 0.02 + random() * 0.06;
    ctx.fillStyle = `rgba(${140 + random() * 60},${170 + random() * 60},210,${alpha})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  // Panel seams.
  ctx.strokeStyle = 'rgba(90,120,160,0.45)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, size, size);
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Glowing conduit grid.
  ctx.strokeStyle = 'rgba(47,240,255,0.75)';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(47,240,255,0.9)';
  ctx.shadowBlur = 12;
  ctx.strokeRect(10, 10, size - 20, size - 20);
  ctx.shadowBlur = 0;

  // Corner rivets.
  for (const [x, y] of [[24, 24], [size - 24, 24], [24, size - 24], [size - 24, size - 24]] as const) {
    ctx.fillStyle = 'rgba(150,190,230,0.5)';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  return finishCanvas(canvas, 1);
}

/** Wall panelling with vertical light strips and hazard markings. */
export function createWallTexture(): CanvasTexture {
  const size = 512;
  const { canvas, ctx } = createCanvas(size);
  const random = makeRandom(19);

  ctx.fillStyle = '#0b1120';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 60; i++) {
    const x = Math.floor(random() * size);
    const w = 2 + Math.floor(random() * 26);
    const shade = 18 + random() * 26;
    ctx.fillStyle = `rgba(${shade},${shade * 1.4},${shade * 2},0.85)`;
    ctx.fillRect(x, 0, w, size);
  }

  // Horizontal trim lines.
  ctx.strokeStyle = 'rgba(120,160,210,0.25)';
  ctx.lineWidth = 2;
  for (let y = 48; y < size; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // Neon strip with glow.
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, 'rgba(139,92,255,0)');
  gradient.addColorStop(0.5, 'rgba(139,92,255,0.95)');
  gradient.addColorStop(1, 'rgba(139,92,255,0)');
  ctx.fillStyle = gradient;
  ctx.shadowColor = 'rgba(139,92,255,0.9)';
  ctx.shadowBlur = 18;
  ctx.fillRect(size * 0.5 - 5, 0, 10, size);

  // Hazard chevrons near the bottom.
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, size - 70, size, 70);
  ctx.clip();
  for (let x = -70; x < size + 70; x += 28) {
    ctx.fillStyle = 'rgba(255,177,71,0.35)';
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.lineTo(x + 14, size - 70);
    ctx.lineTo(x + 28, size);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  return finishCanvas(canvas, 1);
}

/** Soft radial sprite used for glow quads, pickups and muzzle flashes. */
export function createGlowTexture(): CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return finishCanvas(canvas, 1);
}

/** Ring sprite used for shockwaves and telegraph indicators. */
export function createRingTexture(): CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.5);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.72, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.86, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return finishCanvas(canvas, 1);
}

/** Small square particle texture (crisper than a soft blob for sparks). */
export function createSparkTexture(): CanvasTexture {
  const size = 64;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = finishCanvas(canvas, 1);
  texture.minFilter = LinearFilter;
  return texture;
}

/** Extra smooth normals for the metal floor, generated as a plain texture. */
export function createNoiseTexture(size = 64, seed = 3): DataTexture {
  const random = makeRandom(seed);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const value = 128 + (random() - 0.5) * 40;
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createMetalMaterial(color: number, emissive: number, emissiveIntensity: number): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color,
    metalness: 0.92,
    roughness: 0.34,
    emissive: new Color(emissive),
    emissiveIntensity,
  });
  return material;
}

export function disposeTexture(texture: Texture | null | undefined): void {
  if (!texture) return;
  texture.dispose();
}

export const WRAP = ClampToEdgeWrapping;
