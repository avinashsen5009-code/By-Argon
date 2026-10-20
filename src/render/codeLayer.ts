import { clamp, ease, lerp, seededNoise, seededRand } from '../core/ease.ts';
import { hslToHex } from '../core/palette.ts';
import type { CompiledLayer, ThemeTokens } from '../core/types.ts';
import type { Any2DContext } from './background.ts';
import { getLoadedImageAsset } from './sprites.ts';
import { resolveFontFamily } from './text.ts';

const compiledCodeCache = new Map<string, Function>();

const FORBIDDEN_PATTERN =
  /\b(Math\.random|Date|window|document|fetch|eval|Function|import|XMLHttpRequest|localStorage|setTimeout|requestAnimationFrame)\b/;

/**
 * Executes a validated `code` layer (`draw(ctx, t, p, w, h, api)`) inside a pure, deterministic API sandbox.
 * Skips the layer safely if any forbidden identifier or runtime exception occurs.
 */
export function drawCodeLayer(
  ctx: Any2DContext,
  layer: CompiledLayer,
  tRel: number,
  p: number,
  w: number,
  h: number,
  tokens: ThemeTokens
): { ok: boolean; warning?: string } {
  const body = String(layer.draw ?? '').trim();
  if (!body) return { ok: true };

  if (FORBIDDEN_PATTERN.test(body)) {
    return {
      ok: false,
      warning: `Code layer "${layer.id}" skipped: contains forbidden non-deterministic identifier`,
    };
  }

  let fn = compiledCodeCache.get(body);
  if (!fn) {
    try {
      fn = new Function(
        'ctx',
        't',
        'p',
        'w',
        'h',
        'api',
        `"use strict";\n${body}`
      );
      compiledCodeCache.set(body, fn);
    } catch (err: any) {
      return {
        ok: false,
        warning: `Code layer "${layer.id}" syntax error: ${err?.message ?? 'invalid code'}`,
      };
    }
  }

  const api = Object.freeze({
    TAU: Math.PI * 2,
    ease: (name: string, u: number) => ease(name, u),
    lerp: (a: number, b: number, u: number) => lerp(a, b, u),
    clamp: (v: number, min = 0, max = 1) => clamp(v, min, max),
    noise: (x: number, seed = 0) => seededNoise(x, layer.numericSeed + seed),
    rand: (seed = 0) => seededRand(layer.numericSeed + seed),
    hsl: (hDeg: number, sPct: number, lPct: number, a = 1) => {
      if (a >= 0.999) return hslToHex(hDeg, sPct, lPct);
      return `hsla(${hDeg}, ${sPct}%, ${lPct}%, ${clamp(a, 0, 1)})`;
    },
    asset: (id: string) => getLoadedImageAsset(id) ?? null,
    measure: (text: string, font = 'sans') => {
      ctx.save();
      ctx.font = `700 32px ${resolveFontFamily(font)}`;
      const m = ctx.measureText(String(text));
      ctx.restore();
      return { width: m.width };
    },
    tokens: Object.freeze({ ...tokens }),
  });

  ctx.save();
  try {
    fn(ctx, tRel, p, w, h, api);
  } catch (err: any) {
    ctx.restore();
    return {
      ok: false,
      warning: `Code layer "${layer.id}" runtime error: ${err?.message ?? 'failed'}`,
    };
  }
  ctx.restore();
  return { ok: true };
}
