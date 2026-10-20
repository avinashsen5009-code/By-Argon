import { clamp, ease, lerp } from '../core/ease.ts';
import type { CompiledScene, ThemeTokens } from '../core/types.ts';
import type { Any2DContext } from './background.ts';

/**
 * Applies scene entrance transitions (`cut`, `fade`, `dissolve`, `slideL`, `slideR`, `slideU`, `slideD`,
 * `push`, `zoomThrough`, `whip`, `wipe`, `iris`, `glitch`, `flash`, `blurThrough`) when `t` is within
 * `[scene.t0, scene.t0 + transition.dur]`.
 */
export function applySceneTransitionTransform(
  ctx: Any2DContext,
  scene: CompiledScene | undefined,
  t: number,
  w: number,
  h: number
): { flashAlpha: number; fadeOverlayAlpha: number } {
  if (!scene || !scene.transition || scene.transition.type === 'cut') {
    return { flashAlpha: 0, fadeOverlayAlpha: 0 };
  }

  const dur = scene.transition.dur ?? 0.3;
  const elapsed = t - scene.t0;
  if (elapsed < 0 || elapsed >= dur || dur <= 0) {
    return { flashAlpha: 0, fadeOverlayAlpha: 0 };
  }

  const u = clamp(elapsed / dur, 0, 1);
  const f = ease('outCubic', u);
  const inv = 1 - f;
  let flashAlpha = 0;
  let fadeOverlayAlpha = 0;

  switch (scene.transition.type) {
    case 'fade':
    case 'dissolve':
      fadeOverlayAlpha = inv;
      break;
    case 'slideL':
    case 'push':
      ctx.translate(w * inv, 0);
      break;
    case 'slideR':
      ctx.translate(-w * inv, 0);
      break;
    case 'slideU':
      ctx.translate(0, h * inv);
      break;
    case 'slideD':
      ctx.translate(0, -h * inv);
      break;
    case 'zoomThrough': {
      const sc = lerp(0.82, 1, f);
      ctx.translate(w * 0.5, h * 0.5);
      ctx.scale(sc, sc);
      ctx.translate(-w * 0.5, -h * 0.5);
      fadeOverlayAlpha = inv * 0.5;
      break;
    }
    case 'whip':
      ctx.translate(w * 0.35 * inv, 0);
      break;
    case 'wipe': {
      ctx.beginPath();
      ctx.rect(0, 0, w * f, h);
      ctx.clip();
      break;
    }
    case 'iris': {
      const ix = (scene.transition.x ?? 0.5) * w;
      const iy = (scene.transition.y ?? 0.5) * h;
      const maxR = Math.hypot(w, h);
      ctx.beginPath();
      ctx.arc(ix, iy, Math.max(4, maxR * f), 0, Math.PI * 2);
      ctx.clip();
      break;
    }
    case 'flash':
      flashAlpha = inv;
      break;
    case 'glitch':
      ctx.translate((u < 0.5 ? 18 : -12) * inv, 0);
      break;
    case 'blurThrough':
      fadeOverlayAlpha = inv * 0.65;
      break;
  }

  return { flashAlpha, fadeOverlayAlpha };
}

export function drawTransitionOverlays(
  ctx: Any2DContext,
  overlays: { flashAlpha: number; fadeOverlayAlpha: number },
  tokens: ThemeTokens,
  w: number,
  h: number
): void {
  if (overlays.fadeOverlayAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = overlays.fadeOverlayAlpha;
    ctx.fillStyle = tokens.bg || '#0C0612';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  if (overlays.flashAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = overlays.flashAlpha * 0.75;
    ctx.fillStyle = tokens.acc || '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
