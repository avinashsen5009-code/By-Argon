import { clamp, ease, lerp, seededNoise, seededRand } from '../core/ease.ts';
import { hslToHex } from '../core/palette.ts';
import type { CompiledLayer, CompiledRecipe, ThemeTokens } from '../core/types.ts';
import { FORBIDDEN_CODE_IDENTIFIERS } from '../core/validate.ts';
import type { Any2DContext } from './background.ts';
import { getLoadedImageAsset } from './sprites.ts';
import { resolveFontFamily } from './text.ts';

const compiledCodeCache = new Map<string, Function>();
const workerBitmapCache = new Map<string, ImageBitmap>();

export function scanCodeLayerForForbiddenIdentifiers(body: string): {
  valid: boolean;
  forbidden?: string;
} {
  for (const ident of FORBIDDEN_CODE_IDENTIFIERS) {
    const esc = ident.replace('.', '\\.');
    const re = new RegExp(`\\b${esc}\\b`);
    if (re.test(body)) {
      return { valid: false, forbidden: ident };
    }
  }
  return { valid: true };
}

let activeCodeWorker: Worker | null = null;
let workerMsgSeq = 1;

function getOrSpawnCodeWorker(): Worker | null {
  if (activeCodeWorker) return activeCodeWorker;
  if (typeof Worker !== 'undefined') {
    try {
      activeCodeWorker = new Worker(new URL('../workers/code.worker.ts', import.meta.url), {
        type: 'module',
      });
      return activeCodeWorker;
    } catch {
      return null;
    }
  }
  return null;
}

export function restartCodeWorker(): void {
  if (activeCodeWorker) {
    try {
      activeCodeWorker.terminate();
    } catch {
      // ignore
    }
    activeCodeWorker = null;
  }
}

/**
 * M9 Dedicated Worker Sandbox Execution with strict frame time budget (default 40 ms).
 * On overrun (e.g. infinite loop `while(true){}`) or exception, terminates and restarts the Worker,
 * skips the layer with a clear warning, and keeps the app 100% responsive.
 */
export async function executeCodeLayerWithTimeout(
  layer: CompiledLayer,
  tRel: number,
  p: number,
  w: number,
  h: number,
  tokens: ThemeTokens,
  timeoutMs = 40
): Promise<{ ok: boolean; timedOut?: boolean; warning?: string; bitmap?: ImageBitmap }> {
  const body = String(layer.draw ?? '').trim();
  if (!body) return { ok: true };

  const scan = scanCodeLayerForForbiddenIdentifiers(body);
  if (!scan.valid) {
    return {
      ok: false,
      warning: `Code layer "${layer.id}" skipped: contains forbidden identifier "${scan.forbidden}"`,
    };
  }

  const worker = getOrSpawnCodeWorker();
  if (worker) {
    const reqId = workerMsgSeq++;
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        restartCodeWorker();
        resolve({
          ok: false,
          timedOut: true,
          warning: `Code layer "${layer.id}" exceeded ${timeoutMs}ms frame budget; worker terminated and restarted`,
        });
      }, timeoutMs);

      const onMsg = (ev: MessageEvent) => {
        if (ev.data?.id !== reqId) return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.removeEventListener('message', onMsg);
        if (ev.data.ok) {
          if (ev.data.bitmap) {
            const cacheKey = `${layer.id}:${tRel.toFixed(3)}`;
            const old = workerBitmapCache.get(cacheKey);
            old?.close?.();
            workerBitmapCache.set(cacheKey, ev.data.bitmap);
          }
          resolve({ ok: true, bitmap: ev.data.bitmap });
        } else {
          resolve({ ok: false, warning: ev.data.error || 'Code layer worker error' });
        }
      };

      worker.addEventListener('message', onMsg);
      worker.postMessage({
        id: reqId,
        mode: 'execute',
        code: body,
        tRel,
        p,
        w,
        h,
        numericSeed: layer.numericSeed,
        tokens,
      });
    });
  }

  // Fallback for Node.js unit-test environment (where browser `Worker` with `import.meta.url` isn't used):
  // Use Node `vm.runInNewContext` with `{ timeout: timeoutMs }` so infinite loops are deterministically terminated!
  try {
    const vmSpec = 'node:' + 'vm';
    const nodeVm = await import(/* @vite-ignore */ vmSpec);
    const recordedOps: string[] = [];
    const mockCtx = {
      save: () => recordedOps.push('save'),
      restore: () => recordedOps.push('restore'),
      beginPath: () => recordedOps.push('beginPath'),
      moveTo: () => recordedOps.push('moveTo'),
      lineTo: () => recordedOps.push('lineTo'),
      arc: () => recordedOps.push('arc'),
      fill: () => recordedOps.push('fill'),
      stroke: () => recordedOps.push('stroke'),
      fillRect: () => recordedOps.push('fillRect'),
      strokeRect: () => recordedOps.push('strokeRect'),
      clearRect: () => recordedOps.push('clearRect'),
      translate: () => recordedOps.push('translate'),
      rotate: () => recordedOps.push('rotate'),
      scale: () => recordedOps.push('scale'),
      fillText: () => recordedOps.push('fillText'),
      measureText: (txt: string) => ({ width: String(txt).length * 16 }),
      fillStyle: '#FFFFFF',
      strokeStyle: '#FFFFFF',
      lineWidth: 2,
      globalAlpha: 1,
    };

    const api = Object.freeze({
      TAU: Math.PI * 2,
      ease: (name: string, u: number) => ease(name, u),
      lerp: (a: number, b: number, u: number) => lerp(a, b, u),
      clamp: (v: number, min = 0, max = 1) => clamp(v, min, max),
      noise: (x: number, seed = 0) => seededNoise(x, layer.numericSeed + seed),
      rand: (seed = 0) => seededRand(layer.numericSeed + seed),
      hsl: (hDeg: number, sPct: number, lPct: number, a = 1) =>
        a >= 0.999 ? hslToHex(hDeg, sPct, lPct) : `hsla(${hDeg}, ${sPct}%, ${lPct}%, ${clamp(a, 0, 1)})`,
      asset: () => null,
      measure: (text: string) => ({ width: String(text).length * 16 }),
      tokens: Object.freeze({ ...tokens }),
    });

    const sandbox = Object.create(null);
    sandbox.ctx = mockCtx;
    sandbox.t = tRel;
    sandbox.p = p;
    sandbox.w = w;
    sandbox.h = h;
    sandbox.api = api;
    sandbox.Math = Object.freeze({
      PI: Math.PI,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      abs: Math.abs,
      min: Math.min,
      max: Math.max,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      sqrt: Math.sqrt,
      pow: Math.pow,
      hypot: Math.hypot,
      atan2: Math.atan2,
    });

    nodeVm.runInNewContext(`"use strict";\n${body}`, sandbox, { timeout: timeoutMs });
    return { ok: true };
  } catch (err: any) {
    const msg = String(err?.message ?? 'Code execution failed');
    const timedOut = /timed out/i.test(msg);
    return {
      ok: false,
      timedOut,
      warning: timedOut
        ? `Code layer "${layer.id}" exceeded ${timeoutMs}ms frame budget and was terminated`
        : `Code layer "${layer.id}" runtime error: ${msg}`,
    };
  }
}

/**
 * In export, awaits Worker evaluation for all active `code` layers at timestamp `t` (M9).
 */
export async function prewarmCodeLayersForFrame(
  compiled: CompiledRecipe,
  t: number,
  timeoutMs = 40
): Promise<string[]> {
  const warnings: string[] = [];
  const activeCodeLayers = compiled.layers.filter(
    (l) => l.type === 'code' && t >= l.t0 && t <= l.t1
  );
  for (const layer of activeCodeLayers) {
    const tRel = Math.max(0, t - layer.t0);
    const dur = Math.max(1e-4, layer.t1 - layer.t0);
    const p = clamp(tRel / dur, 0, 1);
    const w = typeof layer.w === 'number' ? layer.w : compiled.w;
    const h = typeof layer.h === 'number' ? layer.h : compiled.h;
    const res = await executeCodeLayerWithTimeout(layer, tRel, p, w, h, compiled.tokens, timeoutMs);
    if (!res.ok && res.warning) {
      warnings.push(res.warning);
    }
  }
  return warnings;
}

/**
 * Renders a validated `code` layer (`draw(ctx, t, p, w, h, api)`).
 * Uses a pre-rendered Worker `ImageBitmap` if available, or executes inside the pure deterministic API sandbox.
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

  const scan = scanCodeLayerForForbiddenIdentifiers(body);
  if (!scan.valid) {
    return {
      ok: false,
      warning: `Code layer "${layer.id}" skipped: contains forbidden identifier "${scan.forbidden}"`,
    };
  }

  const cacheKey = `${layer.id}:${tRel.toFixed(3)}`;
  const cachedBmp = workerBitmapCache.get(cacheKey);
  if (cachedBmp) {
    ctx.drawImage(cachedBmp, -w * 0.5, -h * 0.5, w, h);
    return { ok: true };
  }

  let fn = compiledCodeCache.get(body);
  if (!fn) {
    try {
      fn = new Function('ctx', 't', 'p', 'w', 'h', 'api', `"use strict";\n${body}`);
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
