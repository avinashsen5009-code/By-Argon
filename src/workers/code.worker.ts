import { clamp, ease, lerp, seededNoise, seededRand } from '../core/ease.ts';
import { validateExpression } from '../core/expr.ts';
import { hslToHex } from '../core/palette.ts';

export const FORBIDDEN_CODE_IDENTIFIERS = [
  'Math.random',
  'Date',
  'window',
  'document',
  'fetch',
  'eval',
  'Function',
  'import',
  'XMLHttpRequest',
  'localStorage',
  'setTimeout',
  'requestAnimationFrame',
  'constructor',
  '__proto__',
  'prototype',
  'globalThis',
  'self',
  'postMessage',
  'importScripts',
  'WebSocket',
  'indexedDB',
  'caches',
  'navigator',
  'location',
];

let offscreen: OffscreenCanvas | null = null;
const fnCache = new Map<string, Function>();

function checkForbidden(body: string): string | null {
  for (const ident of FORBIDDEN_CODE_IDENTIFIERS) {
    const re = new RegExp(`\\b${ident.replace('.', '\\.')}\\b`);
    if (re.test(body)) {
      return `Forbidden identifier "${ident}" in code layer`;
    }
  }
  return null;
}

if (typeof self !== 'undefined' && typeof self.onmessage !== 'undefined') {
  self.onmessage = (event: MessageEvent) => {
    const {
      id,
      code,
      expr,
      mode = 'validate',
      tRel = 0,
      p = 0,
      w = 400,
      h = 400,
      numericSeed = 12345,
      tokens = {},
    } = event.data || {};

    if (expr !== undefined) {
      const res = validateExpression(String(expr));
      self.postMessage({ id, ...res });
      return;
    }

    const body = String(code || '').trim();
    const forbiddenErr = checkForbidden(body);
    if (forbiddenErr) {
      self.postMessage({ id, valid: false, ok: false, error: forbiddenErr });
      return;
    }

    let fn = fnCache.get(body);
    if (!fn) {
      try {
        fn = new Function('ctx', 't', 'p', 'w', 'h', 'api', `"use strict";\n${body}`);
        fnCache.set(body, fn);
      } catch (err: any) {
        self.postMessage({
          id,
          valid: false,
          ok: false,
          error: err?.message ?? 'Syntax error in code layer',
        });
        return;
      }
    }

    if (mode === 'validate') {
      self.postMessage({ id, valid: true, ok: true });
      return;
    }

    // Mode === 'execute': draw into OffscreenCanvas inside Worker and transfer ImageBitmap
    try {
      const cw = Math.max(2, Math.round(w));
      const ch = Math.max(2, Math.round(h));
      if (typeof OffscreenCanvas !== 'undefined') {
        if (!offscreen || offscreen.width !== cw || offscreen.height !== ch) {
          offscreen = new OffscreenCanvas(cw, ch);
        }
        const ctx = offscreen.getContext('2d')!;
        ctx.clearRect(0, 0, cw, ch);
        ctx.save();
        ctx.translate(cw * 0.5, ch * 0.5);

        const api = Object.freeze({
          TAU: Math.PI * 2,
          ease: (name: string, u: number) => ease(name, u),
          lerp: (a: number, b: number, u: number) => lerp(a, b, u),
          clamp: (v: number, min = 0, max = 1) => clamp(v, min, max),
          noise: (x: number, seed = 0) => seededNoise(x, numericSeed + seed),
          rand: (seed = 0) => seededRand(numericSeed + seed),
          hsl: (hDeg: number, sPct: number, lPct: number, a = 1) =>
            a >= 0.999 ? hslToHex(hDeg, sPct, lPct) : `hsla(${hDeg}, ${sPct}%, ${lPct}%, ${clamp(a, 0, 1)})`,
          asset: () => null,
          measure: (text: string) => ({ width: String(text).length * 16 }),
          tokens: Object.freeze({ ...tokens }),
        });

        fn(ctx, tRel, p, cw, ch, api);
        ctx.restore();

        const bitmap = offscreen.transferToImageBitmap();
        (self as any).postMessage({ id, ok: true, bitmap }, [bitmap]);
      } else {
        self.postMessage({ id, ok: true });
      }
    } catch (err: any) {
      self.postMessage({
        id,
        ok: false,
        error: err?.message ?? 'Runtime error in code layer worker',
      });
    }
  };
}
