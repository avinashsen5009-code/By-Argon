import { clamp, lerp } from '../core/ease.ts';
import type { AssetDef, CompiledLayer, ThemeTokens } from '../core/types.ts';
import type { Any2DContext } from './background.ts';
import { traceRoundedRect } from './shapes.ts';
import { resolveFontFamily } from './text.ts';

const loadedImagesCache = new Map<string, HTMLImageElement | ImageBitmap>();

export function registerLoadedImageAsset(assetId: string, img: HTMLImageElement | ImageBitmap): void {
  loadedImagesCache.set(assetId, img);
}

export function getLoadedImageAsset(assetId: string): HTMLImageElement | ImageBitmap | undefined {
  return loadedImagesCache.get(assetId);
}

/**
 * Renders an `image` or `video` layer with `fit` ("contain"|"cover"), `kenburns` zoom/pan,
 * and a stylized vector fallback card when the external asset file has not been uploaded yet.
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

  const loaded = layer.asset ? loadedImagesCache.get(layer.asset) : undefined;
  if (loaded) {
    const iw = 'naturalWidth' in loaded ? loaded.naturalWidth || w : loaded.width || w;
    const ih = 'naturalHeight' in loaded ? loaded.naturalHeight || h : loaded.height || h;
    const fit = layer.fit || 'cover';
    const scale = fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(loaded, -dw * 0.5, -dh * 0.5, dw, dh);
  } else {
    // High-contrast vector fallback card (Zero-Broken-Image Policy)
    const grad = ctx.createLinearGradient(-hw, -hh, hw, hh);
    grad.addColorStop(0, tokens.heroHi);
    grad.addColorStop(1, tokens.cardLo);
    ctx.fillStyle = grad;
    ctx.fillRect(-hw, -hh, w, h);

    ctx.strokeStyle = tokens.acc;
    ctx.lineWidth = 3;
    traceRoundedRect(ctx, -hw + 2, -hh + 2, w - 4, h - 4, 22);
    ctx.stroke();

    ctx.fillStyle = tokens.ink;
    ctx.font = `700 ${Math.max(18, Math.min(32, w * 0.09))}px ${resolveFontFamily('sans')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(assetDef?.file || String(layer.asset || 'ASSET'), 0, 0);
  }

  ctx.restore();
}
