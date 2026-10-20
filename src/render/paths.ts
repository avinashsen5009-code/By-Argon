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

const pathLengthCache = new Map<string, number>();

/**
 * Precomputes and caches the geometric length of an SVG path `d` in 0..100 space (M8).
 */
export function measureSvgPathLength(d: string): number {
  const cached = pathLengthCache.get(d);
  if (cached !== undefined) return cached;

  const cmds = parseSvgPathCommands(d);
  let total = 0;
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  for (const c of cmds) {
    const u = c.cmd.toUpperCase();
    const isRel = c.cmd !== u;
    const n = c.nums;

    if (u === 'M' && n.length >= 2) {
      curX = isRel ? curX + n[0] : n[0];
      curY = isRel ? curY + n[1] : n[1];
      startX = curX;
      startY = curY;
    } else if (u === 'L' && n.length >= 2) {
      const nx = isRel ? curX + n[0] : n[0];
      const ny = isRel ? curY + n[1] : n[1];
      total += Math.hypot(nx - curX, ny - curY);
      curX = nx;
      curY = ny;
    } else if (u === 'H' && n.length >= 1) {
      const nx = isRel ? curX + n[0] : n[0];
      total += Math.abs(nx - curX);
      curX = nx;
    } else if (u === 'V' && n.length >= 1) {
      const ny = isRel ? curY + n[0] : n[0];
      total += Math.abs(ny - curY);
      curY = ny;
    } else if (u === 'Q' && n.length >= 4) {
      const x1 = isRel ? curX + n[0] : n[0];
      const y1 = isRel ? curY + n[1] : n[1];
      const x2 = isRel ? curX + n[2] : n[2];
      const y2 = isRel ? curY + n[3] : n[3];
      // Chord + control polygon average approximation
      const chord = Math.hypot(x2 - curX, y2 - curY);
      const net = Math.hypot(x1 - curX, y1 - curY) + Math.hypot(x2 - x1, y2 - y1);
      total += (chord + net) * 0.5;
      curX = x2;
      curY = y2;
    } else if (u === 'C' && n.length >= 6) {
      const x1 = isRel ? curX + n[0] : n[0];
      const y1 = isRel ? curY + n[1] : n[1];
      const x2 = isRel ? curX + n[2] : n[2];
      const y2 = isRel ? curY + n[3] : n[3];
      const x3 = isRel ? curX + n[4] : n[4];
      const y3 = isRel ? curY + n[5] : n[5];
      const chord = Math.hypot(x3 - curX, y3 - curY);
      const net =
        Math.hypot(x1 - curX, y1 - curY) +
        Math.hypot(x2 - x1, y2 - y1) +
        Math.hypot(x3 - x2, y3 - y2);
      total += (chord + net) * 0.5;
      curX = x3;
      curY = y3;
    } else if (u === 'Z') {
      total += Math.hypot(startX - curX, startY - curY);
      curX = startX;
      curY = startY;
    }
  }

  const finalLen = Math.max(20, total || 280);
  pathLengthCache.set(d, finalLen);
  return finalLen;
}

/**
 * Interpolates two SVG path strings `dA` and `dB` when they have matching command structures.
 */
export function morphSvgPathStrings(
  dA: string,
  dB: string,
  t: number
): { d: string; compatible: boolean; error?: string } {
  const cmdsA = parseSvgPathCommands(dA);
  const cmdsB = parseSvgPathCommands(dB);
  if (cmdsA.length !== cmdsB.length) {
    return {
      d: t < 0.5 ? dA : dB,
      compatible: false,
      error: `Path command count mismatch (${cmdsA.length} vs ${cmdsB.length})`,
    };
  }
  const parts: string[] = [];
  for (let i = 0; i < cmdsA.length; i++) {
    if (
      cmdsA[i].cmd !== cmdsB[i].cmd ||
      cmdsA[i].nums.length !== cmdsB[i].nums.length
    ) {
      return {
        d: t < 0.5 ? dA : dB,
        compatible: false,
        error: `Path command #${i} mismatch (${cmdsA[i].cmd} vs ${cmdsB[i].cmd})`,
      };
    }
    const interpNums = cmdsA[i].nums.map((na, idx) =>
      Math.round(lerp(na, cmdsB[i].nums[idx], t) * 100) / 100
    );
    parts.push(`${cmdsA[i].cmd}${interpNums.join(' ')}`);
  }
  return { d: parts.join(' '), compatible: true };
}

export interface SafeSvgItem {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  transform?: { tx: number; ty: number; scale: number; rot: number };
}

const safeSvgCache = new Map<string, { valid: boolean; error?: string; items: SafeSvgItem[] }>();

/**
 * M8 Safe SVG Subset Parser:
 * Parses `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`, `<g>`, `<defs>/<linearGradient>`
 * into normalized path `d` strings. Explicitly rejects `<script>`, `<image>`, `on*` event handlers, and external URLs.
 */
export function parseSafeSvgMarkup(markup: string): {
  valid: boolean;
  error?: string;
  items: SafeSvgItem[];
} {
  const cached = safeSvgCache.get(markup);
  if (cached) return cached;

  // Reject unsafe tags and external references
  if (/<script\b/i.test(markup)) {
    return { valid: false, error: 'Rejected unsafe <script> tag in SVG markup', items: [] };
  }
  if (/<image\b/i.test(markup)) {
    return { valid: false, error: 'Rejected <image> tag in SVG markup (use an image layer instead)', items: [] };
  }
  if (/\bon[a-z]+\s*=/i.test(markup)) {
    return { valid: false, error: 'Rejected inline event handler in SVG markup', items: [] };
  }
  if (/(?:href|src|url)\s*\(\s*['"]?https?:/i.test(markup) || /\bhref\s*=\s*['"]https?:/i.test(markup)) {
    return { valid: false, error: 'Rejected external network reference in SVG markup', items: [] };
  }

  const items: SafeSvgItem[] = [];
  const tagRegex = /<(path|rect|circle|ellipse|line|polyline|polygon)\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;

  const getAttr = (attrs: string, name: string): string | undefined => {
    const r = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i');
    return r.exec(attrs)?.[1];
  };

  while ((m = tagRegex.exec(markup)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    let d = '';

    if (tag === 'path') {
      d = getAttr(attrs, 'd') || '';
    } else if (tag === 'rect') {
      const x = parseFloat(getAttr(attrs, 'x') || '0');
      const y = parseFloat(getAttr(attrs, 'y') || '0');
      const w = parseFloat(getAttr(attrs, 'width') || '100');
      const h = parseFloat(getAttr(attrs, 'height') || '100');
      d = `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
    } else if (tag === 'circle' || tag === 'ellipse') {
      const cx = parseFloat(getAttr(attrs, 'cx') || '50');
      const cy = parseFloat(getAttr(attrs, 'cy') || '50');
      const rx = parseFloat(getAttr(attrs, tag === 'circle' ? 'r' : 'rx') || '40');
      const ry = parseFloat(getAttr(attrs, tag === 'circle' ? 'r' : 'ry') || String(rx));
      const k = 0.55228475;
      d = [
        `M ${cx - rx} ${cy}`,
        `C ${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry}`,
        `C ${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy}`,
        `C ${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry}`,
        `C ${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy} Z`,
      ].join(' ');
    } else if (tag === 'line') {
      const x1 = parseFloat(getAttr(attrs, 'x1') || '0');
      const y1 = parseFloat(getAttr(attrs, 'y1') || '0');
      const x2 = parseFloat(getAttr(attrs, 'x2') || '100');
      const y2 = parseFloat(getAttr(attrs, 'y2') || '100');
      d = `M ${x1} ${y1} L ${x2} ${y2}`;
    } else if (tag === 'polyline' || tag === 'polygon') {
      const ptsRaw = (getAttr(attrs, 'points') || '').trim();
      const nums = ptsRaw
        .split(/[\s,]+/)
        .map(parseFloat)
        .filter((n) => !Number.isNaN(n));
      if (nums.length >= 4) {
        const segs: string[] = [`M ${nums[0]} ${nums[1]}`];
        for (let i = 2; i + 1 < nums.length; i += 2) {
          segs.push(`L ${nums[i]} ${nums[i + 1]}`);
        }
        if (tag === 'polygon') segs.push('Z');
        d = segs.join(' ');
      }
    }

    if (d) {
      items.push({
        d,
        fill: getAttr(attrs, 'fill'),
        stroke: getAttr(attrs, 'stroke'),
        strokeWidth: getAttr(attrs, 'stroke-width') ? parseFloat(getAttr(attrs, 'stroke-width')!) : undefined,
      });
    }
  }

  const res = { valid: true, items };
  safeSvgCache.set(markup, res);
  return res;
}

/**
 * Renders a `path` layer (SVG path data in a 0..100 box scaled to w, h, with trimStart / trimEnd)
 * or a safe-subset `svg` layer.
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

  let itemsToDraw: SafeSvgItem[] = [];
  if (layer.type === 'svg' && layer.markup) {
    const parsed = parseSafeSvgMarkup(layer.markup);
    if (parsed.valid && parsed.items.length > 0) {
      itemsToDraw = parsed.items;
    }
  } else if (dString) {
    itemsToDraw = [{ d: dString }];
  }

  if (typeof Path2D !== 'undefined' && itemsToDraw.length > 0) {
    for (const item of itemsToDraw) {
      const p2d = new Path2D(item.d);
      const fillResolved = resolveFillValue(item.fill ?? layer.fill ?? 'none', tokens);
      if (fillResolved.kind !== 'none') {
        ctx.fillStyle = createCanvasFillStyle(ctx, fillResolved, 100, 100);
        ctx.fill(p2d);
      }

      const strokeCol = resolveColorToken(
        item.stroke ?? (typeof layer.stroke === 'string' ? layer.stroke : layer.color || '@acc'),
        tokens
      );
      if (strokeCol !== 'transparent') {
        const avgScale = (scaleX + scaleY) * 0.5;
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = Math.max(1, (item.strokeWidth ?? strokeWidth ?? 6) / Math.max(0.1, avgScale));
        ctx.lineCap = layer.cap || 'round';
        ctx.lineJoin = layer.join || 'round';

        const t0 = clamp(trimStart, 0, 1);
        const t1 = clamp(trimEnd, 0, 1);
        if (t0 > 0 || t1 < 1) {
          const totalLen = measureSvgPathLength(item.d);
          const visibleLen = Math.max(0, (t1 - t0) * totalLen);
          ctx.setLineDash([visibleLen, totalLen * 2]);
          ctx.lineDashOffset = -t0 * totalLen;
        }
        ctx.stroke(p2d);
      }
    }
  }
  ctx.restore();
}
