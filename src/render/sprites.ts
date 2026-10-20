import { clamp, lerp } from '../core/ease.ts';
import { getAnchorOffsetFactors } from '../core/layout.ts';
import type { AssetDef, CompiledLayer, ThemeTokens } from '../core/types.ts';
import type { Any2DContext } from './background.ts';
import { traceRoundedRect } from './shapes.ts';
import { resolveFontFamily } from './text.ts';

const loadedImagesCache = new Map<string, HTMLImageElement | ImageBitmap>();
const loadedVideosCache = new Map<string, HTMLVideoElement>();

export function registerLoadedImageAsset(assetId: string, img: HTMLImageElement | ImageBitmap): void {
  loadedImagesCache.set(assetId, img);
}

export function getLoadedImageAsset(assetId: string): HTMLImageElement | ImageBitmap | undefined {
  return loadedImagesCache.get(assetId);
}

export function registerLoadedVideoAsset(assetId: string, video: HTMLVideoElement): void {
  loadedVideosCache.set(assetId, video);
}

export function getLoadedVideoAsset(assetId: string): HTMLVideoElement | undefined {
  return loadedVideosCache.get(assetId);
}

// ============================================================================
// M8 LRU Glow / Shadow / Blur Sprite Cache (Memory-Capped)
// ============================================================================

interface CachedGlowSpriteEntry {
  key: string;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  pad: number;
  byteEstimate: number;
}

const MAX_SPRITE_CACHE_ENTRIES = 48;
const MAX_SPRITE_CACHE_BYTES = 24 * 1024 * 1024; // 24 MB cap
const glowSpriteLru = new Map<string, CachedGlowSpriteEntry>();
let currentSpriteCacheBytes = 0;

function createOffscreenOrDomCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement | null {
  const cw = Math.max(2, Math.ceil(w));
  const ch = Math.max(2, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(cw, ch);
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    return c;
  }
  return null;
}

/**
 * Returns (or builds and caches) a pre-blurred glow/shadow sprite for `(kind, w, h, radius, color, blurPx)`.
 * Animated glow strength modulates `globalAlpha` when compositing the cached sprite, avoiding per-frame `shadowBlur` on big shapes.
 */
export function getCachedGlowSprite(
  kind: string,
  w: number,
  h: number,
  radius: number,
  color: string,
  blurPx: number
): CachedGlowSpriteEntry | null {
  // Quantize dimensions to 4px buckets so scale animations don't thrash cache
  const qw = Math.max(8, Math.round(w / 4) * 4);
  const qh = Math.max(8, Math.round(h / 4) * 4);
  const qr = Math.round(radius / 2) * 2;
  const qb = Math.max(4, Math.min(40, Math.round(blurPx / 2) * 2));
  const key = `${kind}:${qw}x${qh}:r${qr}:${color}:b${qb}`;

  const existing = glowSpriteLru.get(key);
  if (existing) {
    // Refresh LRU order
    glowSpriteLru.delete(key);
    glowSpriteLru.set(key, existing);
    return existing;
  }

  const pad = qb * 2 + 8;
  const sw = qw + pad * 2;
  const sh = qh + pad * 2;
  const spriteCanvas = createOffscreenOrDomCanvas(sw, sh);
  if (!spriteCanvas) return null;

  const sctx = spriteCanvas.getContext('2d') as Any2DContext | null;
  if (!sctx) return null;

  sctx.save();
  sctx.translate(sw * 0.5, sh * 0.5);
  sctx.shadowColor = color;
  sctx.shadowBlur = qb;
  sctx.fillStyle = color;

  const hw = qw * 0.5;
  const hh = qh * 0.5;
  if (kind === 'ellipse' || kind === 'ring') {
    sctx.beginPath();
    sctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
    sctx.fill();
  } else {
    const rad = kind === 'pill' ? Math.min(qw, qh) * 0.5 : qr || 24;
    traceRoundedRect(sctx, -hw, -hh, qw, qh, rad);
    sctx.fill();
  }
  sctx.restore();

  const byteEstimate = sw * sh * 4;
  while (
    glowSpriteLru.size >= MAX_SPRITE_CACHE_ENTRIES ||
    (currentSpriteCacheBytes + byteEstimate > MAX_SPRITE_CACHE_BYTES && glowSpriteLru.size > 0)
  ) {
    const oldestKey = glowSpriteLru.keys().next().value;
    if (!oldestKey) break;
    const evicted = glowSpriteLru.get(oldestKey);
    if (evicted) currentSpriteCacheBytes -= evicted.byteEstimate;
    glowSpriteLru.delete(oldestKey);
  }

  const entry: CachedGlowSpriteEntry = { key, canvas: spriteCanvas, pad, byteEstimate };
  glowSpriteLru.set(key, entry);
  currentSpriteCacheBytes += byteEstimate;
  return entry;
}

export function getGlowSpriteCacheStats(): { entries: number; bytes: number } {
  return { entries: glowSpriteLru.size, bytes: currentSpriteCacheBytes };
}

export function clearGlowSpriteCache(): void {
  glowSpriteLru.clear();
  currentSpriteCacheBytes = 0;
}

/**
 * Renders an `image` or `video` layer with `fit` ("contain"|"cover"), `anchor`, `crop`, `kenburns` zoom/pan,
 * and a clear dashed placeholder with the asset id when the asset file is missing (never a crash).
 */
export function drawImageOrVideoLayer(
  ctx: Any2DContext,
  layer: CompiledLayer,
  assetDef: AssetDef | undefined,
  w: number,
  h: number,
  p: number,
  tokens: ThemeTokens
): void {
  const hw = w * 0.5;
  const hh = h * 0.5;

  ctx.save();
  traceRoundedRect(ctx, -hw, -hh, w, h, layer.radius ? Number(layer.radius) : 24);
  ctx.clip();

  if (layer.kenburns) {
    const kbFrom = layer.kenburns.from || { zoom: 1, x: 0.5, y: 0.5 };
    const kbTo = layer.kenburns.to || { zoom: 1.1, x: 0.5, y: 0.5 };
    const z = lerp(kbFrom.zoom ?? 1, kbTo.zoom ?? 1.1, clamp(p, 0, 1));
    const ox = (lerp(kbFrom.x ?? 0.5, kbTo.x ?? 0.5, clamp(p, 0, 1)) - 0.5) * w;
    const oy = (lerp(kbFrom.y ?? 0.5, kbTo.y ?? 0.5, clamp(p, 0, 1)) - 0.5) * h;
    ctx.translate(-ox, -oy);
    ctx.scale(z, z);
  }

  const loadedImg = layer.asset ? loadedImagesCache.get(layer.asset) : undefined;
  const loadedVid = layer.asset ? loadedVideosCache.get(layer.asset) : undefined;
  const source: HTMLImageElement | ImageBitmap | HTMLVideoElement | undefined = loadedVid || loadedImg;

  if (source) {
    const rawW =
      'videoWidth' in source
        ? source.videoWidth || w
        : 'naturalWidth' in source
        ? source.naturalWidth || w
        : source.width || w;
    const rawH =
      'videoHeight' in source
        ? source.videoHeight || h
        : 'naturalHeight' in source
        ? source.naturalHeight || h
        : source.height || h;

    // Optional normalized crop rect { x, y, w, h }
    const crop = layer.crop;
    const sx = crop ? clamp(crop.x ?? 0, 0, 1) * rawW : 0;
    const sy = crop ? clamp(crop.y ?? 0, 0, 1) * rawH : 0;
    const sw = crop ? Math.max(1, clamp(crop.w ?? 1, 0.01, 1) * rawW) : rawW;
    const sh = crop ? Math.max(1, clamp(crop.h ?? 1, 0.01, 1) * rawH) : rawH;

    const fit = layer.fit || 'cover';
    const scale = fit === 'contain' ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh);
    const dw = sw * scale;
    const dh = sh * scale;

    const [ax, ay] = getAnchorOffsetFactors(layer.anchor || 'center');
    const dx = -hw + (w - dw) * ax;
    const dy = -hh + (h - dh) * ay;

    ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
  } else {
    // M8 Clear dashed placeholder with the asset id (never a crash)
    const grad = ctx.createLinearGradient(-hw, -hh, hw, hh);
    grad.addColorStop(0, tokens.heroHi);
    grad.addColorStop(1, tokens.cardLo);
    ctx.fillStyle = grad;
    ctx.fillRect(-hw, -hh, w, h);

    ctx.save();
    ctx.setLineDash([12, 8]);
    ctx.strokeStyle = tokens.acc;
    ctx.lineWidth = 3;
    traceRoundedRect(ctx, -hw + 4, -hh + 4, w - 8, h - 8, 20);
    ctx.stroke();
    ctx.restore();

    const assetLabel = String(layer.asset || assetDef?.id || assetDef?.file || 'MISSING_ASSET');
    ctx.fillStyle = tokens.ink;
    ctx.font = `700 ${Math.max(18, Math.min(32, w * 0.085))}px ${resolveFontFamily('sans')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`[${assetLabel}]`, 0, -8);

    ctx.fillStyle = tokens.muted;
    ctx.font = `600 ${Math.max(13, Math.min(20, w * 0.05))}px ${resolveFontFamily('sans')}`;
    ctx.fillText(assetDef?.file || 'Attach in Assets panel', 0, 20);
  }

  ctx.restore();
}
