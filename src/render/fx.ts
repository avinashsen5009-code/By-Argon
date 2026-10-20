import { clamp, mulberry32, seededWiggle } from '../core/ease.ts';
import { resolveColorToken } from '../core/palette.ts';
import type { CompiledLayer, GlobalFxSpec, ThemeTokens } from '../core/types.ts';
import type { Any2DContext } from './background.ts';
import { getCachedGlowSprite } from './sprites.ts';

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
  fastMode = false,
  w = 200,
  h = 100
): void {
  if (fastMode) return;

  // Apply blur filter (capped on mobile for performance per SPEC Part D 6)
  let totalBlur = blurPx;
  if (Array.isArray(layer.fx)) {
    for (const fx of layer.fx) {
      if ((fx.type || Object.keys(fx)[0]) === 'blur') {
        totalBlur += Number(fx.blur?.radius ?? fx.radius ?? fx.blur ?? 8);
      }
    }
  }
  const cappedBlur = Math.min(20, Math.max(0, totalBlur));
  if (cappedBlur > 0.5 && 'filter' in ctx) {
    ctx.filter = `blur(${cappedBlur.toFixed(1)}px)`;
  }

  const isBigShape =
    layer.type === 'shape' &&
    w * h > 36000 &&
    (layer.kind === 'rect' ||
      layer.kind === 'roundRect' ||
      layer.kind === 'pill' ||
      layer.kind === 'card' ||
      layer.kind === 'ellipse' ||
      layer.kind === 'ring');

  // M8 Performance Rule: never call shadowBlur on big shapes every frame.
  // Composite a cached pre-blurred glow/shadow sprite from sprites.ts with alpha modulated by strength.
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
    if (isBigShape) {
      const sprite = getCachedGlowSprite(
        layer.kind || 'roundRect',
        w,
        h,
        Number(layer.radius ?? 28),
        glowColor,
        24
      );
      if (sprite) {
        ctx.save();
        ctx.globalAlpha *= clamp(glowVal, 0, 1);
        ctx.drawImage(
          sprite.canvas as any,
          -w * 0.5 - sprite.pad,
          -h * 0.5 - sprite.pad,
          w + sprite.pad * 2,
          h + sprite.pad * 2
        );
        ctx.restore();
      }
    } else {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = Math.min(36, glowVal * 22);
    }
  } else if (shadowVal > 0.05) {
    if (isBigShape) {
      const sprite = getCachedGlowSprite(
        layer.kind || 'roundRect',
        w,
        h,
        Number(layer.radius ?? 28),
        '#000000',
        26
      );
      if (sprite) {
        ctx.save();
        ctx.globalAlpha *= clamp(shadowVal * 0.65, 0, 1);
        ctx.drawImage(
          sprite.canvas as any,
          -w * 0.5 - sprite.pad,
          -h * 0.5 - sprite.pad + Math.round(shadowVal * 12),
          w + sprite.pad * 2,
          h + sprite.pad * 2
        );
        ctx.restore();
      }
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = Math.min(32, shadowVal * 28);
      ctx.shadowOffsetY = Math.round(shadowVal * 12);
    }
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
    } else if (type === 'glitch') {
      const cfg = fx.glitch || fx;
      const amt = Number(cfg.amount ?? 12);
      const jitter = seededWiggle(Math.floor(tRel * 16), 3, amt, layer.numericSeed);
      ctx.translate(jitter, 0);
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
    } else if (type === 'duotone') {
      const cfg = fx.duotone || fx;
      const colA = resolveColorToken(cfg.a || '@bg', tokens);
      const colB = resolveColorToken(cfg.b || '@acc', tokens);
      ctx.save();
      ctx.globalAlpha *= clamp(Number(cfg.amount ?? 0.35), 0, 1);
      const grad = ctx.createLinearGradient(-hw, -hh, hw, hh);
      grad.addColorStop(0, colA);
      grad.addColorStop(1, colB);
      ctx.fillStyle = grad;
      ctx.fillRect(-hw, -hh, w, h);
      ctx.restore();
    } else if (type === 'outline') {
      const cfg = fx.outline || fx;
      ctx.save();
      ctx.strokeStyle = resolveColorToken(cfg.color || '@acc', tokens);
      ctx.lineWidth = Number(cfg.width ?? 3);
      ctx.strokeRect(-hw, -hh, w, h);
      ctx.restore();
    } else if (type === 'chroma') {
      const cfg = fx.chroma || fx;
      const shift = Number(cfg.amount ?? 4);
      ctx.save();
      ctx.globalAlpha *= 0.28;
      ctx.strokeStyle = '#FF2A6D';
      ctx.lineWidth = 2;
      ctx.strokeRect(-hw - shift, -hh, w, h);
      ctx.strokeStyle = '#05D9E8';
      ctx.strokeRect(-hw + shift, -hh, w, h);
      ctx.restore();
    } else if (type === 'pixelate') {
      const cfg = fx.pixelate || fx;
      const block = Math.max(4, Number(cfg.size ?? 12));
      ctx.save();
      ctx.globalAlpha *= 0.18;
      ctx.strokeStyle = tokens.bg;
      ctx.lineWidth = 1;
      for (let x = -hw; x < hw; x += block) {
        ctx.beginPath();
        ctx.moveTo(x, -hh);
        ctx.lineTo(x, hh);
        ctx.stroke();
      }
      ctx.restore();
    } else if (type === 'trail') {
      const cfg = fx.trail || fx;
      const count = Math.min(5, Math.max(1, Number(cfg.count ?? 3)));
      const decay = clamp(Number(cfg.decay ?? 0.45), 0.1, 0.9);
      ctx.save();
      for (let i = 1; i <= count; i++) {
        ctx.globalAlpha *= decay;
        ctx.strokeStyle = tokens.acc;
        ctx.lineWidth = 2;
        ctx.strokeRect(-hw - i * 8, -hh, w, h);
      }
      ctx.restore();
    }
  }
}

/**
 * Draws global post-processing overlays (`global.vignette`, `global.grain`, `global.bloom`, `global.chroma`)
 */
export function drawGlobalFx(
  ctx: Any2DContext,
  globalSpec: GlobalFxSpec | undefined,
  w: number,
  h: number,
  t = 0
): void {
  if (!globalSpec) return;

  // 1. Vignette
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

  // 2. Bloom soft highlight
  const bloom = clamp(globalSpec.bloom ?? 0, 0, 1);
  if (bloom > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = bloom * 0.18;
    const bGrad = ctx.createRadialGradient(w * 0.5, h * 0.45, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.55);
    bGrad.addColorStop(0, '#FFFFFF');
    bGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = bGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // 3. Deterministic film grain
  const grain = clamp(globalSpec.grain ?? 0, 0, 1);
  if (grain > 0.01) {
    ctx.save();
    const prng = mulberry32(Math.floor(t * 24) + 9001);
    ctx.fillStyle = '#FFFFFF';
    ctx.globalAlpha = grain * 0.08;
    for (let i = 0; i < 60; i++) {
      const gx = prng() * w;
      const gy = prng() * h;
      ctx.fillRect(gx, gy, 2, 2);
    }
    ctx.restore();
  }

  // 4. Chromatic fringe at edges
  const chroma = clamp(globalSpec.chroma ?? 0, 0, 1);
  if (chroma > 0.01) {
    ctx.save();
    ctx.globalAlpha = chroma * 0.22;
    ctx.strokeStyle = '#FF2A6D';
    ctx.lineWidth = chroma * 6;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.restore();
  }
}
