import { clamp, ease, lerp, seededWiggle } from './ease.ts';
import { type MacroDelta, macroRegistry, registerMacro } from './registry.ts';
import type { CompiledLayer, KeyframeItem, MotionMacroCall } from './types.ts';

export const ENTRANCE_MACROS = new Set(['pop', 'slam', 'drop', 'slide', 'rise']);

/**
 * Pure function that expands a single MotionMacroCall into plain KeyframeItem tracks
 * where applicable (used by unit tests and inspector).
 */
export function expandMacroToKeyframes(
  macro: MotionMacroCall,
  layerStart = 0,
  canvasW = 1920,
  canvasH = 1080,
  restW = 200,
  restH = 100
): Record<string, KeyframeItem[]> {
  const at = typeof macro.at === 'number' ? macro.at - layerStart : 0;
  const m = macro.m;

  switch (m) {
    case 'pop': {
      const from = macro.from ?? 0.5;
      const over = macro.over ?? 1.12;
      const dur = macro.dur ?? 0.3;
      return {
        scale: [
          { t: at, v: from, e: 'linear' },
          { t: at + 0.63 * dur, v: over, e: 'outBack' },
          { t: at + dur, v: 1, e: 'outCubic' },
        ],
        opacity: [
          { t: at, v: 0, e: 'linear' },
          { t: at + 0.33 * dur, v: 1, e: 'outQuad' },
        ],
      };
    }
    case 'slam': {
      const from = macro.from ?? 1.7;
      const dur = macro.dur ?? 0.28;
      return {
        scale: [
          { t: at, v: from, e: 'linear' },
          { t: at + 0.6 * dur, v: 0.94, e: 'outExpo' },
          { t: at + dur, v: 1, e: 'outCubic' },
        ],
        opacity: [
          { t: at, v: 0, e: 'linear' },
          { t: at + 0.08, v: 1, e: 'outQuad' },
        ],
      };
    }
    case 'drop': {
      const dist = macro.dist ?? 260;
      const dur = macro.dur ?? 0.4;
      return {
        dy: [
          { t: at, v: -dist / canvasH, e: 'linear' },
          { t: at + 0.7 * dur, v: 0.009, e: 'inQuad' },
          { t: at + dur, v: 0, e: 'outCubic' },
        ],
        opacity: [
          { t: at, v: 0, e: 'linear' },
          { t: at + 0.08, v: 1, e: 'linear' },
        ],
      };
    }
    case 'slide': {
      const dist = macro.dist ?? 80;
      const dur = macro.dur ?? 0.35;
      const side = macro.from ?? 'L';
      const dx0 = side === 'L' ? -dist / canvasW : side === 'R' ? dist / canvasW : 0;
      const dy0 = side === 'U' ? -dist / canvasH : side === 'D' ? dist / canvasH : 0;
      return {
        dx: [
          { t: at, v: dx0, e: 'linear' },
          { t: at + dur, v: 0, e: 'outExpo' },
        ],
        dy: [
          { t: at, v: dy0, e: 'linear' },
          { t: at + dur, v: 0, e: 'outExpo' },
        ],
        opacity: [
          { t: at, v: 0, e: 'linear' },
          { t: at + 0.15, v: 1, e: 'outQuad' },
        ],
      };
    }
    case 'bump': {
      const amt = macro.amt ?? 1.1;
      const dur = macro.dur ?? 0.3;
      return {
        scale: [
          { t: at, v: 1, e: 'linear' },
          { t: at + 0.4 * dur, v: amt, e: 'outQuad' },
          { t: at + dur, v: 1, e: 'inOutSine' },
        ],
      };
    }
    case 'grow': {
      const axis = macro.axis ?? 'w';
      const from = typeof macro.from === 'number' ? macro.from : 0;
      const to = typeof macro.to === 'number' ? macro.to : axis === 'h' ? restH : restW;
      const dur = macro.dur ?? 0.4;
      return {
        [axis]: [
          { t: at, v: from, e: 'linear' },
          { t: at + dur, v: to, e: 'outCubic' },
        ],
      };
    }
    case 'press': {
      const dur = macro.dur ?? 0.25;
      return {
        scale: [
          { t: at, v: 1, e: 'linear' },
          { t: at + 0.45 * dur, v: 0.9, e: 'outQuad' },
          { t: at + dur, v: 1, e: 'outBack' },
        ],
      };
    }
    default:
      return {};
  }
}

export function registerBuiltInMacros(): void {
  // 1. pop: scale from -> over at 0.63*dur -> 1 at dur; opacity 0 -> 1 over first 0.33*dur
  registerMacro('pop', (m, _layer, dt) => {
    const from = typeof m.from === 'number' ? m.from : 0.5;
    const over = typeof m.over === 'number' ? m.over : 1.12;
    const dur = m.dur ?? 0.3;
    if (dt < 0) return { scaleMult: from, opacityMult: 0 };
    if (dt >= dur) return {};
    const op = clamp(dt / (0.33 * dur), 0, 1);
    const pivot = 0.63 * dur;
    const sc =
      dt <= pivot
        ? lerp(from, over, ease('outCubic', dt / Math.max(1e-6, pivot)))
        : lerp(over, 1, ease('inOutSine', (dt - pivot) / Math.max(1e-6, dur - pivot)));
    return { scaleMult: sc, opacityMult: op };
  });

  // 2. slam: scale 1.7 -> 0.94 at 0.6*dur -> 1 at dur (0.28s); opacity 0 -> 1 in 0.08s; burst at +0.1s
  registerMacro('slam', (m, layer, dt) => {
    const from = typeof m.from === 'number' ? m.from : 1.7;
    const dur = m.dur ?? 0.28;
    const withBurst = m.burst !== false;
    const out: MacroDelta = {};

    if (dt < 0) {
      return { scaleMult: from, opacityMult: 0 };
    }
    if (dt < dur) {
      out.opacityMult = clamp(dt / 0.08, 0, 1);
      const pivot = 0.6 * dur;
      out.scaleMult =
        dt <= pivot
          ? lerp(from, 0.94, ease('outExpo', dt / Math.max(1e-6, pivot)))
          : lerp(0.94, 1, ease('outCubic', (dt - pivot) / Math.max(1e-6, dur - pivot)));
    }
    if (withBurst && dt >= 0.1 && dt <= 0.85) {
      const bp = clamp((dt - 0.1) / 0.75, 0, 1);
      const baseR = typeof layer.w === 'number' ? layer.w * 0.5 : 140;
      out.burstRing = {
        progress: bp,
        rStart: baseR,
        rEnd: baseR * 1.8,
        color: m.color || (typeof layer.color === 'string' ? layer.color : '@acc'),
        opacity: 0.8 * (1 - ease('outQuad', bp)),
      };
    }
    return out;
  });

  // 3. drop: y offset -dist -> +0.009*H at 0.7*dur -> 0 at dur; opacity 0 -> 1 in 0.08s
  registerMacro('drop', (m, _layer, dt, _W, H) => {
    const dist = m.dist ?? 260;
    const dur = m.dur ?? 0.4;
    if (dt < 0) return { dy: -dist / H, opacityMult: 0 };
    if (dt >= dur) return {};
    const op = clamp(dt / 0.08, 0, 1);
    const pivot = 0.7 * dur;
    const dy =
      dt <= pivot
        ? lerp(-dist / H, 0.009, ease('inQuad', dt / Math.max(1e-6, pivot)))
        : lerp(0.009, 0, ease('outCubic', (dt - pivot) / Math.max(1e-6, dur - pivot)));
    return { dy, opacityMult: op };
  });

  // 4. slide: offset from chosen side (dist px) to 0 at dur (outExpo); opacity 0 -> 1 in 0.15s
  registerMacro('slide', (m, layer, dt, W, H) => {
    const dist = m.dist ?? 80;
    const dur = m.dur ?? 0.35;
    let side = m.from;
    if (!side) {
      const restX = typeof layer.x === 'number' ? layer.x : 0.5;
      side = restX < 0.25 ? 'R' : restX > 0.75 ? 'L' : 'L';
    }
    const dx0 = side === 'L' ? -dist / W : side === 'R' ? dist / W : 0;
    const dy0 = side === 'U' ? -dist / H : side === 'D' ? dist / H : 0;
    if (dt < 0) return { dx: dx0, dy: dy0, opacityMult: 0 };
    if (dt >= dur) return {};
    const f = ease('outExpo', clamp(dt / dur, 0, 1));
    return {
      dx: dx0 * (1 - f),
      dy: dy0 * (1 - f),
      opacityMult: clamp(dt / 0.15, 0, 1),
    };
  });

  // 5. rise: position from `from` to rest at dur; scale 0.72 -> 1.04 at 0.65*dur -> 1; opacity 0 -> 1 in 0.12s
  registerMacro('rise', (m, layer, dt) => {
    const dur = m.dur ?? 0.32;
    const restX = typeof layer.x === 'number' ? layer.x : 0.5;
    const restY = typeof layer.y === 'number' ? layer.y : 0.5;
    const fromX = m.from && typeof m.from.x === 'number' ? m.from.x : restX;
    const fromY = m.from && typeof m.from.y === 'number' ? m.from.y : restY + 0.12;
    if (dt < 0) {
      return { dx: fromX - restX, dy: fromY - restY, scaleMult: 0.72, opacityMult: 0 };
    }
    if (dt >= dur) return {};
    const f = ease('outCubic', clamp(dt / dur, 0, 1));
    const pivot = 0.65 * dur;
    const sc =
      dt <= pivot
        ? lerp(0.72, 1.04, ease('outCubic', dt / Math.max(1e-6, pivot)))
        : lerp(1.04, 1, ease('inOutSine', (dt - pivot) / Math.max(1e-6, dur - pivot)));
    return {
      dx: (fromX - restX) * (1 - f),
      dy: (fromY - restY) * (1 - f),
      scaleMult: sc,
      opacityMult: clamp(dt / 0.12, 0, 1),
    };
  });

  // 6. bump: scale s -> s*amt at 0.4*dur -> s at dur
  registerMacro('bump', (m, _layer, dt) => {
    const amt = m.amt ?? 1.1;
    const dur = m.dur ?? 0.3;
    if (dt < 0 || dt >= dur) return {};
    const pivot = 0.4 * dur;
    const sc =
      dt <= pivot
        ? lerp(1, amt, ease('outQuad', dt / Math.max(1e-6, pivot)))
        : lerp(amt, 1, ease('inOutSine', (dt - pivot) / Math.max(1e-6, dur - pivot)));
    return { scaleMult: sc };
  });

  // 7. shake: x offsets 0, +amp, -amp, +0.8 amp, -0.6 amp, 0 at dur/5 steps; optional y sink
  registerMacro('shake', (m, _layer, dt, W, H) => {
    const amp = (m.amp ?? 10) / W;
    const sink = (m.sink ?? 0) / H;
    const dur = m.dur ?? 0.35;
    if (dt < 0) return {};
    if (dt >= dur) return sink ? { dy: sink } : {};
    const steps = [0, amp, -amp, 0.8 * amp, -0.6 * amp, 0];
    const p = clamp(dt / dur, 0, 1) * 5;
    const idx = Math.min(4, Math.floor(p));
    const frac = p - idx;
    return {
      dx: lerp(steps[idx], steps[idx + 1], frac),
      dy: sink * clamp(dt / dur, 0, 1),
    };
  });

  // 8. grow: animates w (or h) from `from` to declared value over dur (outCubic)
  registerMacro('grow', (m, layer, dt, W, H) => {
    const axis = m.axis === 'h' ? 'h' : 'w';
    const dur = m.dur ?? 0.4;
    const fromVal = typeof m.from === 'number' ? m.from : 0;
    const restVal =
      typeof m.to === 'number'
        ? m.to
        : axis === 'h'
        ? typeof layer.h === 'number'
          ? layer.h
          : 100
        : typeof layer.w === 'number'
        ? layer.w
        : 200;
    void W;
    void H;
    if (dt < 0) {
      return axis === 'h' ? { hOverride: fromVal } : { wOverride: fromVal };
    }
    if (dt >= dur) {
      return axis === 'h' ? { hOverride: restVal } : { wOverride: restVal };
    }
    const f = ease('outCubic', clamp(dt / dur, 0, 1));
    const cur = lerp(fromVal, restVal, f);
    return axis === 'h' ? { hOverride: cur } : { wOverride: cur };
  });

  // 9. to: handled in sequence by evaluateLayerMotions so overlapping `to` macros chain cleanly
  registerMacro('to', () => ({}));

  // 10. orbit: position = center + r*(cos, sin)(phase + 360*t/period)
  registerMacro('orbit', (m, _layer, dt, W, H) => {
    const dur = m.dur ?? 10;
    if (dt < 0 || dt > dur) return {};
    const cx = m.cx ?? 0.5;
    const cy = m.cy ?? 0.5;
    const r = m.r ?? 200;
    const period = Math.max(0.05, m.period ?? 0.8);
    const phase = m.phase ?? 0;
    const angleDeg = phase + (360 * dt) / period;
    const rad = (angleDeg * Math.PI) / 180;
    const refW = _layer.groupBox ? _layer.groupBox.w : W;
    const refH = _layer.groupBox ? _layer.groupBox.h : H;
    return {
      absX: cx + (r * Math.cos(rad)) / Math.max(1, refW),
      absY: cy + (r * Math.sin(rad)) / Math.max(1, refH),
    };
  });

  // 11. arc: flies A to B on an arc, scaling down
  registerMacro('arc', (m, layer, dt, _W, H) => {
    const dur = m.dur ?? 0.6;
    const restX = typeof layer.x === 'number' ? layer.x : 0.5;
    const restY = typeof layer.y === 'number' ? layer.y : 0.5;
    const from = m.from ?? { x: restX, y: restY };
    const to = m.to ?? { x: restX, y: restY };
    const arcH = (m.h ?? 120) / H;
    const scaleTo = m.scaleTo ?? 0.45;
    if (dt < 0) return { absX: from.x, absY: from.y };
    const f = ease(m.ease || 'inOutSine', clamp(dt / dur, 0, 1));
    const parabola = 1 - Math.pow(2 * f - 1, 2);
    return {
      absX: lerp(from.x, to.x, f),
      absY: lerp(from.y, to.y, f) - arcH * parabola,
      scaleMult: lerp(1, scaleTo, f),
    };
  });

  // 12. hop: visits a list of points: move seconds, hold seconds
  registerMacro('hop', (m, layer, dt) => {
    const pts = Array.isArray(m.pts) ? m.pts : [];
    if (!pts.length || dt < 0) return {};
    const moveDur = m.move ?? 0.1;
    const holdDur = m.hold ?? 0.12;
    const stepDur = moveDur + holdDur;
    const startPt = {
      x: typeof layer.x === 'number' ? layer.x : pts[0].x,
      y: typeof layer.y === 'number' ? layer.y : pts[0].y,
    };
    const allPts = [startPt, ...pts];
    const segIdx = Math.floor(dt / Math.max(1e-4, stepDur));
    if (segIdx >= pts.length) {
      const last = pts[pts.length - 1];
      return { absX: last.x, absY: last.y };
    }
    const localT = dt - segIdx * stepDur;
    const p0 = allPts[segIdx];
    const p1 = allPts[segIdx + 1];
    if (localT >= moveDur) {
      return { absX: p1.x, absY: p1.y };
    }
    const f = ease('outCubic', clamp(localT / Math.max(1e-4, moveDur), 0, 1));
    return {
      absX: lerp(p0.x, p1.x, f),
      absY: lerp(p0.y, p1.y, f),
    };
  });

  // 13. merge: scales into a point and fades, with ring burst
  registerMacro('merge', (m, layer, dt) => {
    const dur = m.dur ?? 0.4;
    if (dt < 0) return {};
    const cx = m.cx ?? 0.5;
    const cy = m.cy ?? 0.5;
    const targetScale = m.scale ?? 0.18;
    const restX = typeof layer.x === 'number' ? layer.x : 0.5;
    const restY = typeof layer.y === 'number' ? layer.y : 0.5;
    const f = ease('inCubic', clamp(dt / dur, 0, 1));
    const out: MacroDelta = {
      dx: (cx - restX) * f,
      dy: (cy - restY) * f,
      scaleMult: lerp(1, targetScale, f),
      opacityMult: 1 - f,
    };
    if (dt >= dur * 0.8 && dt <= dur + 0.75) {
      const bp = clamp((dt - dur * 0.8) / 0.75, 0, 1);
      out.burstRing = {
        progress: bp,
        rStart: 80,
        rEnd: 240,
        color: m.color || '@acc',
        opacity: 0.8 * (1 - bp),
      };
    }
    return out;
  });

  // 14. burst: ring burst helper from this layer's centre, auto-clamped to stay inside safe area
  registerMacro('burst', (m, layer, dt) => {
    const dur = m.dur ?? 0.75;
    if (dt < 0 || dt > dur) return {};
    const rStart = m.r ?? (typeof layer.w === 'number' ? layer.w : 160);
    const toMult = typeof m.to === 'number' ? m.to : 1.8;
    const bp = clamp(dt / dur, 0, 1);
    return {
      burstRing: {
        progress: ease('outCubic', bp),
        rStart,
        rEnd: rStart * toMult,
        color: m.color || '@acc',
        opacity: 0.8 * (1 - ease('outQuad', bp)),
      },
    };
  });

  // 15. press: button press 1 -> 0.9 -> 1, 0.25s
  registerMacro('press', (m, _layer, dt) => {
    const dur = m.dur ?? 0.25;
    if (dt < 0 || dt >= dur) return {};
    const pivot = 0.45 * dur;
    const sc =
      dt <= pivot
        ? lerp(1, 0.9, ease('outQuad', dt / Math.max(1e-6, pivot)))
        : lerp(0.9, 1, ease('outBack', (dt - pivot) / Math.max(1e-6, dur - pivot)));
    return { scaleMult: sc };
  });

  // 16-21. Ambient loops: pulse, breathe, float, sway, wiggle, blink
  registerMacro('pulse', (m, _layer, dt) => {
    if (dt < 0) return {};
    const amt = m.amt ?? m.amp ?? 1.06;
    const period = Math.max(0.2, m.period ?? 1.6);
    const wave = 0.5 - 0.5 * Math.cos((dt * Math.PI * 2) / period);
    return { scaleMult: lerp(1, amt, wave) };
  });

  registerMacro('breathe', (m, _layer, dt) => {
    if (dt < 0) return {};
    const amt = m.amt ?? m.amp ?? 1.035;
    const period = Math.max(0.2, m.period ?? 2.4);
    const wave = 0.5 - 0.5 * Math.cos((dt * Math.PI * 2) / period);
    return { scaleMult: lerp(1, amt, wave) };
  });

  registerMacro('float', (m, _layer, dt, _W, H) => {
    if (dt < 0) return {};
    const amp = (m.amp ?? 10) / H;
    const period = Math.max(0.2, m.period ?? 2.2);
    return { dy: Math.sin((dt * Math.PI * 2) / period) * amp };
  });

  registerMacro('sway', (m, _layer, dt) => {
    if (dt < 0) return {};
    const amp = m.amp ?? 4;
    const period = Math.max(0.2, m.period ?? 2.5);
    return { rotDelta: Math.sin((dt * Math.PI * 2) / period) * amp };
  });

  registerMacro('wiggle', (m, layer, dt, W, H) => {
    if (dt < 0) return {};
    const amp = m.amp ?? 6;
    const period = Math.max(0.1, m.period ?? 0.5);
    const freq = 1 / period;
    return {
      dx: seededWiggle(dt, freq, amp, layer.numericSeed) / W,
      dy: seededWiggle(dt + 17.3, freq, amp, layer.numericSeed + 1) / H,
    };
  });

  registerMacro('blink', (m, _layer, dt) => {
    if (dt < 0) return {};
    const period = Math.max(0.2, m.period ?? 1.1);
    const wave = 0.5 - 0.5 * Math.cos((dt * Math.PI * 2) / period);
    return { opacityMult: lerp(1, 0.35, wave) };
  });
}

registerBuiltInMacros();

export interface CombinedMotionResult {
  dx: number;
  dy: number;
  absX?: number;
  absY?: number;
  scaleMult: number;
  rotDelta: number;
  opacityMult: number;
  wOverride?: number;
  hOverride?: number;
  burstRings: NonNullable<MacroDelta['burstRing']>[];
}

/**
 * Evaluates all motion macros on a compiled layer at global time t.
 * Properly chains multiple overlapping `to` macros so later ones start from the state reached so far.
 */
export function evaluateLayerMotions(
  layer: CompiledLayer,
  tGlobal: number,
  canvasW: number,
  canvasH: number
): CombinedMotionResult {
  const result: CombinedMotionResult = {
    dx: 0,
    dy: 0,
    scaleMult: 1,
    rotDelta: 0,
    opacityMult: 1,
    burstRings: [],
  };

  if (!layer.resolvedMotions || layer.resolvedMotions.length === 0) {
    return result;
  }

  const restX = typeof layer.x === 'number' ? layer.x : 0.5;
  const restY = typeof layer.y === 'number' ? layer.y : 0.5;
  const restScale = typeof layer.scale === 'number' ? layer.scale : 1;
  const restRot = typeof layer.rot === 'number' ? layer.rot : 0;
  const restOp = typeof layer.opacity === 'number' ? layer.opacity : 1;

  // Separate `to` macros from other macros
  const toMacros = layer.resolvedMotions
    .filter((m) => m.m === 'to')
    .sort((a, b) => a.atSec - b.atSec);

  if (toMacros.length > 0) {
    let curX = restX;
    let curY = restY;
    let curScale = restScale;
    let curRot = restRot;
    let curOp = restOp;

    for (const tm of toMacros) {
      if (tGlobal <= tm.atSec) break;
      const dur = Math.max(1e-4, tm.dur ?? 0.4);
      const u = clamp((tGlobal - tm.atSec) / dur, 0, 1);
      const f = ease(tm.ease || 'inOutCubic', u);
      if (typeof tm.x === 'number') curX = lerp(curX, tm.x, f);
      if (typeof tm.y === 'number') curY = lerp(curY, tm.y, f);
      if (typeof tm.scale === 'number') curScale = lerp(curScale, tm.scale, f);
      if (typeof tm.rot === 'number') curRot = lerp(curRot, tm.rot, f);
      if (typeof tm.opacity === 'number') curOp = lerp(curOp, tm.opacity, f);
    }

    result.dx += curX - restX;
    result.dy += curY - restY;
    result.scaleMult *= restScale !== 0 ? curScale / restScale : curScale;
    result.rotDelta += curRot - restRot;
    result.opacityMult *= restOp !== 0 ? curOp / restOp : curOp;
  }

  for (const m of layer.resolvedMotions) {
    if (m.m === 'to') continue;
    if (m.untilSec !== undefined && tGlobal > m.untilSec) continue;
    const expander = macroRegistry.get(m.m);
    if (!expander) continue;
    const dt = tGlobal - m.atSec;
    // Entrance macros should apply their pre-start state if they start at layer start,
    // or once their `at` time arrives.
    if (dt < 0 && m.atSec > layer.t0 + 0.02 && ENTRANCE_MACROS.has(m.m)) {
      result.opacityMult = 0;
      continue;
    }
    const delta = expander(m, layer, dt, canvasW, canvasH);
    if (delta.dx !== undefined) result.dx += delta.dx;
    if (delta.dy !== undefined) result.dy += delta.dy;
    if (delta.absX !== undefined) result.absX = delta.absX;
    if (delta.absY !== undefined) result.absY = delta.absY;
    if (delta.scaleMult !== undefined) result.scaleMult *= delta.scaleMult;
    if (delta.rotDelta !== undefined) result.rotDelta += delta.rotDelta;
    if (delta.opacityMult !== undefined) result.opacityMult *= delta.opacityMult;
    if (delta.wOverride !== undefined) result.wOverride = delta.wOverride;
    if (delta.hOverride !== undefined) result.hOverride = delta.hOverride;
    if (delta.burstRing) result.burstRings.push(delta.burstRing);
  }

  return result;
}
