import { clamp, seededWiggle } from '../core/ease.ts';
import { resolveColorToken } from '../core/palette.ts';
import type { CompiledLayer, GlobalFxSpec, ThemeTokens } from '../core/types.ts';
import type { Any2DContext } from './background.ts';

export function isHeadlessSoftwareRenderer(): boolean {
  if (typeof navigator === 'undefined') return true;
  return Boolean(navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent));
}

export function applyPreDrawLayerFx(
  ctx: Any2DContext,
  layer: CompiledLayer,
  glowVal: number,
  shadowVal: number,
  blurPx: number,
  tRel: number,
  tokens: ThemeTokens,
  fastMode = false
): void {
  if (fastMode) return;

  // Apply blur filter (capped on mobile for performance per SPEC Part D 6)
  const cappedBlur = Math.min(20, Math.max(0, blurPx));
  if (cappedBlur > 0.5 && 'filter' in ctx) {
    ctx.filter = `blur(${cappedBlur.toFixed(1)}px)`;
  }

  // Apply glow or shadow
  if (glowVal > 0.05) {
    const glowColor = resolveColorToken(
      typeof layer.fill === 'string' && layer.fill !== 'none' && !layer.fill.startsWith('grad')
        ? layer.fill
        : typeof layer.color === 'string'
        ? layer.color
        : '@acc',
      tokens,
      tokens.acc
    );
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = Math.min(36, glowVal * 22);
  } else if (shadowVal > 0.05) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = Math.min(32, shadowVal * 28);
    ctx.shadowOffsetY = Math.round(shadowVal * 12);
  }

  if (!Array.isArray(layer.fx)) return;
  for (const fx of layer.fx) {
    const type = fx.type || Object.keys(fx)[0];
    if (type === 'glow') {
      const cfg = fx.glow || fx;
      ctx.shadowColor = resolveColorToken(cfg.color || '@acc', tokens);
      ctx.shadowBlur = Math.min(40, Number(cfg.radius ?? 20) * Number(cfg.strength ?? 1));
    } else if (type === 'shadow') {
      const cfg = fx.shadow || fx;
      ctx.shadowColor = resolveColorToken(cfg.color || '#000000', tokens);
      ctx.shadowBlur = Math.min(36, Number(cfg.blur ?? 16));
      ctx.shadowOffsetX = Number(cfg.x ?? 0);
      ctx.shadowOffsetY = Number(cfg.y ?? 10);
    } else if (type === 'wiggle') {
      const cfg = fx.wiggle || fx;
      const amp = Number(cfg.amp ?? 6);
      const freq = Number(cfg.freq ?? 4);
      const seed = Number(cfg.seed ?? layer.numericSeed);
      ctx.translate(seededWiggle(tRel, freq, amp, seed), seededWiggle(tRel + 7.1, freq, amp, seed + 1));
    } else if (type === 'mirror') {
      const cfg = fx.mirror || fx;
      if (cfg.axis === 'y') ctx.scale(1, -1);
      else ctx.scale(-1, 1);
    }
  }
}

export function applyPostDrawLayerFx(
  ctx: Any2DContext,
  layer: CompiledLayer,
  w: number,
  h: number,
  tokens: ThemeTokens
): void {
  if (!Array.isArray(layer.fx)) return;
  const hw = w * 0.5;
  const hh = h * 0.5;

  for (const fx of layer.fx) {
    const type = fx.type || Object.keys(fx)[0];
    if (type === 'scanlines') {
      const cfg = fx.scanlines || fx;
      const gap = Math.max(4, Number(cfg.gap ?? 6));
      const op = clamp(Number(cfg.opacity ?? 0.25), 0, 1);
      ctx.save();
      ctx.globalAlpha *= op;
      ctx.fillStyle = '#000000';
      for (let y = -hh; y < hh; y += gap) {
        ctx.fillRect(-hw, y, w, 2);
      }
      ctx.restore();
    } else if (type === 'tint') {
      const cfg = fx.tint || fx;
      const col = resolveColorToken(cfg.color || '@acc', tokens);
      const amt = clamp(Number(cfg.amount ?? 0.3), 0, 1);
      ctx.save();
      ctx.globalAlpha *= amt;
      ctx.fillStyle = col;
      ctx.fillRect(-hw, -hh, w, h);
      ctx.restore();
    } else if (type === 'outline') {
      const cfg = fx.outline || fx;
      ctx.save();
      ctx.strokeStyle = resolveColorToken(cfg.color || '@acc', tokens);
      ctx.lineWidth = Number(cfg.width ?? 3);
      ctx.strokeRect(-hw, -hh, w, h);
      ctx.restore();
    }
  }
}

/**
 * Draws global post-processing overlays (`global.vignette`, `global.grain`, etc.)
 */
export function drawGlobalFx(
  ctx: Any2DContext,
  globalSpec: GlobalFxSpec | undefined,
  w: number,
  h: number
): void {
  if (!globalSpec) return;
  const vig = clamp(globalSpec.vignette ?? 0.6, 0, 1);
  if (vig > 0.02) {
    ctx.save();
    const rOuter = Math.hypot(w * 0.5, h * 0.5) * 1.05;
    const rInner = Math.min(w, h) * 0.34;
    const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, rInner, w * 0.5, h * 0.5, rOuter);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${(vig * 0.72).toFixed(2)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
