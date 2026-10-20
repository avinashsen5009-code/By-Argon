import { clamp, lerp } from '../core/ease.ts';
import { resolveColorToken, resolveFillValue } from '../core/palette.ts';
import type { CompiledLayer, ThemeTokens } from '../core/types.ts';
import type { Any2DContext } from './background.ts';
import { createCanvasFillStyle } from './shapes.ts';

export interface ParsedPathCommand {
  cmd: string;
  nums: number[];
}

export function parseSvgPathCommands(d: string): ParsedPathCommand[] {
  const cmds: ParsedPathCommand[] = [];
  const regex = /([a-zA-Z])([^a-zA-Z]*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(d)) !== null) {
    const cmd = match[1];
    const numMatches = match[2].match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi);
    const nums = numMatches ? numMatches.map((n) => parseFloat(n)) : [];
    cmds.push({ cmd, nums });
  }
  return cmds;
}

/**
 * Interpolates two SVG path strings `dA` and `dB` when they have matching command structures.
 */
export function morphSvgPathStrings(
  dA: string,
  dB: string,
  t: number
): { d: string; compatible: boolean } {
  const cmdsA = parseSvgPathCommands(dA);
  const cmdsB = parseSvgPathCommands(dB);
  if (cmdsA.length !== cmdsB.length) {
    return { d: t < 0.5 ? dA : dB, compatible: false };
  }
  const parts: string[] = [];
  for (let i = 0; i < cmdsA.length; i++) {
    if (
      cmdsA[i].cmd !== cmdsB[i].cmd ||
      cmdsA[i].nums.length !== cmdsB[i].nums.length
    ) {
      return { d: t < 0.5 ? dA : dB, compatible: false };
    }
    const interpNums = cmdsA[i].nums.map((na, idx) =>
      Math.round(lerp(na, cmdsB[i].nums[idx], t) * 100) / 100
    );
    parts.push(`${cmdsA[i].cmd}${interpNums.join(' ')}`);
  }
  return { d: parts.join(' '), compatible: true };
}

/**
 * Renders a `path` layer (SVG path data in a 0..100 box scaled to w, h, with trimStart / trimEnd)
 * or an `svg` layer.
 */
export function drawPathOrSvgLayer(
  ctx: Any2DContext,
  layer: CompiledLayer,
  dString: string,
  w: number,
  h: number,
  strokeWidth: number,
  trimStart: number,
  trimEnd: number,
  tokens: ThemeTokens
): void {
  ctx.save();
  ctx.translate(-w * 0.5, -h * 0.5);
  const scaleX = w / 100;
  const scaleY = h / 100;
  ctx.scale(scaleX, scaleY);

  let pathToDraw = dString;
  if (layer.type === 'svg' && layer.markup) {
    const dMatch = /\bd=["']([^"']+)["']/i.exec(layer.markup);
    if (dMatch) pathToDraw = dMatch[1];
  }

  if (typeof Path2D !== 'undefined' && pathToDraw) {
    const p2d = new Path2D(pathToDraw);
    const fillResolved = resolveFillValue(layer.fill ?? 'none', tokens);
    if (fillResolved.kind !== 'none') {
      ctx.fillStyle = createCanvasFillStyle(ctx, fillResolved, 100, 100);
      ctx.fill(p2d);
    }

    const strokeCol = resolveColorToken(
      typeof layer.stroke === 'string' ? layer.stroke : layer.color || '@acc',
      tokens
    );
    if (strokeCol !== 'transparent') {
      const avgScale = (scaleX + scaleY) * 0.5;
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = Math.max(1, (strokeWidth || 6) / Math.max(0.1, avgScale));
      ctx.lineCap = layer.cap || 'round';
      ctx.lineJoin = layer.join || 'round';

      const t0 = clamp(trimStart, 0, 1);
      const t1 = clamp(trimEnd, 0, 1);
      if (t0 > 0 || t1 < 1) {
        const approxLen = 320;
        const visibleLen = Math.max(0, (t1 - t0) * approxLen);
        ctx.setLineDash([visibleLen, approxLen * 2]);
        ctx.lineDashOffset = -t0 * approxLen;
      }
      ctx.stroke(p2d);
    }
  }
  ctx.restore();
}
