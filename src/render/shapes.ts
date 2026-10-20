import { clamp, seededNoise } from '../core/ease.ts';
import { type ResolvedFill, resolveColorToken, resolveFillValue } from '../core/palette.ts';
import type { MacroDelta } from '../core/registry.ts';
import type { CompiledLayer, ThemeTokens } from '../core/types.ts';
import type { Any2DContext } from './background.ts';

export function createCanvasFillStyle(
  ctx: Any2DContext,
  resolved: ResolvedFill,
  w: number,
  h: number
): string | CanvasGradient {
  if (resolved.kind === 'none') return 'transparent';
  if (resolved.kind === 'solid') return resolved.color || '#FFFFFF';

  const stops: [number, string][] =
    resolved.stops && resolved.stops.length > 0
      ? resolved.stops
      : [
          [0, '#FFFFFF'],
          [1, '#000000'],
        ];
  if (resolved.kind === 'radial') {
    const r = Math.max(w, h) * 0.55;
    const grad = ctx.createRadialGradient(-w * 0.08, -h * 0.12, r * 0.05, 0, 0, r);
    for (const [offset, col] of stops) {
      grad.addColorStop(clamp(offset, 0, 1), col);
    }
    return grad;
  }

  const angleRad = (((resolved.angle ?? 90) - 90) * Math.PI) / 180;
  const dx = Math.cos(angleRad) * w * 0.5;
  const dy = Math.sin(angleRad) * h * 0.5;
  const grad = ctx.createLinearGradient(-dx, -dy, dx, dy);
  for (const [offset, col] of stops) {
    grad.addColorStop(clamp(offset, 0, 1), col);
  }
  return grad;
}

export function traceRoundedRect(
  ctx: Any2DContext,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function traceRegularPolygon(ctx: Any2DContext, sides: number, rx: number, ry: number, rotOffset = -Math.PI / 2): void {
  const n = Math.max(3, Math.round(sides));
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rotOffset + (i * Math.PI * 2) / n;
    const px = Math.cos(a) * rx;
    const py = Math.sin(a) * ry;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function traceStarOrBurst(
  ctx: Any2DContext,
  points: number,
  outerRx: number,
  outerRy: number,
  innerRatio: number
): void {
  const n = Math.max(3, Math.round(points));
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const rFactor = i % 2 === 0 ? 1 : innerRatio;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const px = Math.cos(a) * outerRx * rFactor;
    const py = Math.sin(a) * outerRy * rFactor;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * Renders all 22 SPEC shape kinds centered at (0,0) in local layer space (-w/2 .. +w/2, -h/2 .. +h/2):
 * rect | roundRect | pill | ellipse | ring | triangle | diamond | pentagon | hexagon | octagon |
 * star | burst | arrow | chevron | plus | check | heart | bubble | line | polygon | blob | card
 */
export function drawShapeLayer(
  ctx: Any2DContext,
  layer: CompiledLayer,
  w: number,
  h: number,
  radius: number,
  strokeWidth: number,
  tokens: ThemeTokens,
  tRel: number
): void {
  const kind = layer.kind || 'rect';
  const fillResolved = resolveFillValue(
    layer.fill ?? (kind === 'line' || kind === 'ring' || kind === 'check' || kind === 'chevron' ? 'none' : '@surf'),
    tokens
  );
  const strokeColor = layer.stroke
    ? resolveColorToken(typeof layer.stroke === 'string' ? layer.stroke : layer.stroke.color, tokens)
    : 'transparent';
  const thickness = typeof layer.thickness === 'number' ? layer.thickness : strokeWidth || 8;

  if (Array.isArray(layer.dash) && layer.dash.length === 2) {
    ctx.setLineDash([Number(layer.dash[0]) || 8, Number(layer.dash[1]) || 8]);
  }

  const fillStyle = createCanvasFillStyle(ctx, fillResolved, w, h);
  const hasFill = fillResolved.kind !== 'none';
  const hasStroke = strokeColor !== 'transparent' && (strokeWidth > 0 || !hasFill);

  const applyFillAndStroke = () => {
    if (hasFill) {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    if (hasStroke) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = Math.max(1, strokeWidth || thickness);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  };

  const hw = w * 0.5;
  const hh = h * 0.5;

  switch (kind) {
    case 'rect': {
      if (radius > 0) {
        traceRoundedRect(ctx, -hw, -hh, w, h, radius);
      } else {
        ctx.beginPath();
        ctx.rect(-hw, -hh, w, h);
      }
      applyFillAndStroke();
      break;
    }
    case 'roundRect': {
      traceRoundedRect(ctx, -hw, -hh, w, h, radius || 28);
      applyFillAndStroke();
      break;
    }
    case 'pill': {
      traceRoundedRect(ctx, -hw, -hh, w, h, Math.min(w, h) * 0.5);
      applyFillAndStroke();
      break;
    }
    case 'card': {
      // SPEC Section 5: card = rounded panel with bevel, cast shadow and a light sweep
      const cardRad = radius || 40;
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 32;
      ctx.shadowOffsetY = 14;
      traceRoundedRect(ctx, -hw, -hh, w, h, cardRad);
      if (hasFill) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
      ctx.restore();

      // Subtle light sweep across the card
      ctx.save();
      traceRoundedRect(ctx, -hw, -hh, w, h, cardRad);
      ctx.clip();
      const sweepPos = -hw + ((tRel * 0.45) % 1.6) * w * 1.4;
      const sweepGrad = ctx.createLinearGradient(sweepPos - w * 0.25, -hh, sweepPos + w * 0.25, hh);
      sweepGrad.addColorStop(0, 'rgba(255,255,255,0)');
      sweepGrad.addColorStop(0.5, 'rgba(255,255,255,0.06)');
      sweepGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sweepGrad;
      ctx.fillRect(-hw, -hh, w, h);
      ctx.restore();

      traceRoundedRect(ctx, -hw, -hh, w, h, cardRad);
      if (hasStroke) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = Math.max(2, strokeWidth);
        ctx.stroke();
      }
      break;
    }
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      applyFillAndStroke();
      break;
    }
    case 'ring': {
      ctx.beginPath();
      ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      ctx.strokeStyle = strokeColor !== 'transparent' ? strokeColor : (fillStyle as string);
      ctx.lineWidth = Math.max(4, thickness);
      ctx.stroke();
      break;
    }
    case 'triangle': {
      // SPEC Section 5: arrow / chevron / triangle point right: aim with rot
      ctx.beginPath();
      ctx.moveTo(hw, 0);
      ctx.lineTo(-hw, -hh);
      ctx.lineTo(-hw, hh);
      ctx.closePath();
      applyFillAndStroke();
      break;
    }
    case 'diamond': {
      traceRegularPolygon(ctx, 4, hw, hh, 0);
      applyFillAndStroke();
      break;
    }
    case 'pentagon': {
      traceRegularPolygon(ctx, 5, hw, hh);
      applyFillAndStroke();
      break;
    }
    case 'hexagon': {
      traceRegularPolygon(ctx, 6, hw, hh);
      applyFillAndStroke();
      break;
    }
    case 'octagon': {
      traceRegularPolygon(ctx, 8, hw, hh, Math.PI / 8);
      applyFillAndStroke();
      break;
    }
    case 'polygon': {
      traceRegularPolygon(ctx, layer.sides ?? 6, hw, hh);
      applyFillAndStroke();
      break;
    }
    case 'star': {
      traceStarOrBurst(ctx, layer.points ?? 5, hw, hh, layer.inner ?? 0.45);
      applyFillAndStroke();
      break;
    }
    case 'burst': {
      traceStarOrBurst(ctx, layer.points ?? 12, hw, hh, layer.inner ?? 0.72);
      applyFillAndStroke();
      break;
    }
    case 'arrow': {
      // Points right
      ctx.beginPath();
      ctx.moveTo(-hw, 0);
      ctx.lineTo(hw * 0.65, 0);
      ctx.moveTo(hw * 0.25, -hh * 0.65);
      ctx.lineTo(hw, 0);
      ctx.lineTo(hw * 0.25, hh * 0.65);
      ctx.strokeStyle = strokeColor !== 'transparent' ? strokeColor : (fillStyle as string);
      ctx.lineWidth = Math.max(6, thickness);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      break;
    }
    case 'chevron': {
      // Points right
      ctx.beginPath();
      ctx.moveTo(-hw * 0.45, -hh * 0.75);
      ctx.lineTo(hw * 0.45, 0);
      ctx.lineTo(-hw * 0.45, hh * 0.75);
      ctx.strokeStyle = strokeColor !== 'transparent' ? strokeColor : (fillStyle as string);
      ctx.lineWidth = Math.max(6, thickness);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      break;
    }
    case 'plus': {
      ctx.beginPath();
      ctx.moveTo(-hw, 0);
      ctx.lineTo(hw, 0);
      ctx.moveTo(0, -hh);
      ctx.lineTo(0, hh);
      ctx.strokeStyle = strokeColor !== 'transparent' ? strokeColor : (fillStyle as string);
      ctx.lineWidth = Math.max(6, thickness);
      ctx.lineCap = 'round';
      ctx.stroke();
      break;
    }
    case 'check': {
      ctx.beginPath();
      ctx.moveTo(-hw * 0.75, 0);
      ctx.lineTo(-hw * 0.15, hh * 0.65);
      ctx.lineTo(hw * 0.8, -hh * 0.65);
      ctx.strokeStyle = strokeColor !== 'transparent' ? strokeColor : (fillStyle as string);
      ctx.lineWidth = Math.max(6, thickness);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      break;
    }
    case 'heart': {
      ctx.beginPath();
      ctx.moveTo(0, hh * 0.85);
      ctx.bezierCurveTo(-hw * 1.2, hh * 0.1, -hw * 0.95, -hh * 0.95, 0, -hh * 0.35);
      ctx.bezierCurveTo(hw * 0.95, -hh * 0.95, hw * 1.2, hh * 0.1, 0, hh * 0.85);
      ctx.closePath();
      applyFillAndStroke();
      break;
    }
    case 'bubble': {
      const r = Math.min(28, hw * 0.3, hh * 0.3);
      const bh = h * 0.84;
      traceRoundedRect(ctx, -hw, -hh, w, bh, r);
      applyFillAndStroke();
      break;
    }
    case 'line': {
      ctx.beginPath();
      ctx.moveTo(-hw, 0);
      ctx.lineTo(hw, 0);
      ctx.strokeStyle = strokeColor !== 'transparent' ? strokeColor : (fillStyle as string);
      ctx.lineWidth = Math.max(6, thickness || h);
      ctx.lineCap = 'round';
      ctx.stroke();
      break;
    }
    case 'blob': {
      const pts = 24;
      const wobble = layer.wobble ?? 0.16;
      ctx.beginPath();
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const n = seededNoise(Math.cos(a) * 2 + Math.sin(a) * 2 + tRel * 0.8, layer.numericSeed);
        const radScale = 1 + n * wobble;
        const px = Math.cos(a) * hw * radScale;
        const py = Math.sin(a) * hh * radScale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      applyFillAndStroke();
      break;
    }
  }
}

/**
 * Draws a ring burst helper (from `slam`, `merge`, or `burst` macro), clamped to safe area.
 */
export function drawBurstRing(
  ctx: Any2DContext,
  burst: NonNullable<MacroDelta['burstRing']>,
  tokens: ThemeTokens,
  maxRadiusPx: number
): void {
  if (burst.opacity <= 0.01) return;
  const r = Math.min(
    maxRadiusPx,
    burst.rStart + (burst.rEnd - burst.rStart) * burst.progress
  );
  if (r <= 1) return;

  ctx.save();
  ctx.globalAlpha *= burst.opacity;
  ctx.strokeStyle = resolveColorToken(burst.color, tokens, tokens.acc);
  ctx.lineWidth = Math.max(3, r * 0.025 * (1 - burst.progress * 0.5));
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
