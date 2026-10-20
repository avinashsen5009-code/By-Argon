import { clamp, ease, lerp } from './ease.ts';
import { interpolateHexColor } from './palette.ts';
import {
  enterPresetRegistry,
  exitPresetRegistry,
  registerEnterPreset,
  registerExitPreset,
} from './registry.ts';
import type { AnimTrackValue, EnterExitPreset, KeyframeItem, ThemeTokens } from './types.ts';

export function registerBuiltInPresets(): void {
  const generalEnters = [
    'fade',
    'fadeUp',
    'slideL',
    'slideR',
    'slideU',
    'slideD',
    'riseIn',
    'dropIn',
    'flyIn',
    'scaleIn',
    'popIn',
    'zoomIn',
    'blurIn',
    'spinIn',
    'swingIn',
    'none',
  ];
  for (const name of generalEnters) {
    registerEnterPreset(name, false);
  }
  const textEnters = [
    'typeOn',
    'charIn',
    'charFade',
    'charPop',
    'wordIn',
    'wordFade',
    'wordPop',
    'lineIn',
  ];
  for (const name of textEnters) {
    registerEnterPreset(name, true);
  }

  const exits = [
    'fadeOut',
    'slideOut',
    'slideLOut',
    'slideUOut',
    'slideDOut',
    'dropOut',
    'flyOut',
    'scaleDown',
    'popOut',
    'zoomOut',
    'blurOut',
    'spinOut',
    'none',
  ];
  for (const name of exits) {
    registerExitPreset(name);
  }
}

registerBuiltInPresets();

function parseSingleCompactToken(tok: string): KeyframeItem | null {
  const atIdx = tok.indexOf('@');
  if (atIdx === -1) return null;
  const rawVal = tok.slice(0, atIdx);
  const rest = tok.slice(atIdx + 1);
  const colonIdx = rest.indexOf(':');
  const timeStr = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
  const easeStr = colonIdx === -1 ? 'outCubic' : rest.slice(colonIdx + 1);
  const t = parseFloat(timeStr);
  if (!Number.isFinite(t)) return null;
  const numVal = Number(rawVal);
  const v = !Number.isNaN(numVal) && rawVal.trim() !== '' ? numVal : rawVal;
  return { t, v, e: easeStr || 'outCubic' };
}

/**
 * Parses compact string keyframes ("0.5@0 1.12@0.19:outBack 1@0.3") or array keyframes
 * (either `{t, v, e}` objects or compact strings) into sorted KeyframeItem[].
 */
export function parseKeyframeTrack(track: AnimTrackValue | string[]): KeyframeItem[] {
  if (Array.isArray(track)) {
    const items: KeyframeItem[] = [];
    for (const k of track) {
      if (typeof k === 'string') {
        const parsed = parseSingleCompactToken(k.trim());
        if (parsed) items.push(parsed);
      } else if (k && typeof k === 'object') {
        items.push({
          t: Number(k.t) || 0,
          v: k.v,
          e: k.e || 'linear',
        });
      }
    }
    return items.sort((a, b) => a.t - b.t);
  }
  if (typeof track !== 'string') return [];

  const tokens = track.trim().split(/\s+/).filter(Boolean);
  const items: KeyframeItem[] = [];
  for (const tok of tokens) {
    const parsed = parseSingleCompactToken(tok);
    if (parsed) items.push(parsed);
  }
  return items.sort((a, b) => a.t - b.t);
}

export function evaluateNumericTrack(keys: KeyframeItem[], tRel: number, fallback: number): number {
  if (!keys.length) return fallback;
  if (tRel <= keys[0].t) return Number(keys[0].v);
  const last = keys[keys.length - 1];
  if (tRel >= last.t) return Number(last.v);

  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i];
    const k1 = keys[i + 1];
    if (tRel >= k0.t && tRel <= k1.t) {
      const span = Math.max(1e-6, k1.t - k0.t);
      const u = clamp((tRel - k0.t) / span, 0, 1);
      const f = ease(k1.e || 'outCubic', u);
      return lerp(Number(k0.v), Number(k1.v), f);
    }
  }
  return Number(last.v);
}

export function evaluateColorTrack(
  keys: KeyframeItem[],
  tRel: number,
  tokens: ThemeTokens,
  fallback: string
): string {
  if (!keys.length) return fallback;
  const resolveCol = (c: any) => {
    const s = String(c);
    return s.startsWith('@') ? tokens[s.slice(1)] || fallback : s;
  };
  if (tRel <= keys[0].t) return resolveCol(keys[0].v);
  const last = keys[keys.length - 1];
  if (tRel >= last.t) return resolveCol(last.v);

  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i];
    const k1 = keys[i + 1];
    if (tRel >= k0.t && tRel <= k1.t) {
      const span = Math.max(1e-6, k1.t - k0.t);
      const u = clamp((tRel - k0.t) / span, 0, 1);
      const f = ease(k1.e || 'outCubic', u);
      return interpolateHexColor(resolveCol(k0.v), resolveCol(k1.v), f);
    }
  }
  return resolveCol(last.v);
}

export interface PresetDelta {
  dx: number;
  dy: number;
  scaleMult: number;
  rotDelta: number;
  opacityMult: number;
  blurAdd: number;
  textProgress?: number;
  textPresetType?: string;
}

export function normalizeEnterExit(
  preset: EnterExitPreset | undefined,
  defaultType: string,
  defaultDur = 0.2,
  defaultEase = 'outCubic'
): { type: string; dur: number; ease: string } {
  if (!preset) {
    return { type: defaultType, dur: defaultDur, ease: defaultEase };
  }
  if (typeof preset === 'string') {
    return {
      type: preset,
      dur: preset === 'none' ? 0 : defaultDur,
      ease: defaultEase,
    };
  }
  return {
    type: preset.type || defaultType,
    dur: preset.type === 'none' ? 0 : preset.dur ?? defaultDur,
    ease: preset.ease || defaultEase,
  };
}

export function evaluateEnterPreset(
  enter: EnterExitPreset | undefined,
  hasEntranceMacro: boolean,
  tRel: number,
  canvasW: number,
  canvasH: number
): PresetDelta {
  const delta: PresetDelta = {
    dx: 0,
    dy: 0,
    scaleMult: 1,
    rotDelta: 0,
    opacityMult: 1,
    blurAdd: 0,
  };

  if (hasEntranceMacro && !enter) {
    return delta;
  }

  const spec = normalizeEnterExit(
    enter,
    'fade',
    typeof enter === 'string' && enterPresetRegistry.get(enter)?.textOnly ? 0.45 : 0.25,
    'outExpo'
  );
  if (spec.type === 'none' || spec.dur <= 0) return delta;

  if (enterPresetRegistry.get(spec.type)?.textOnly) {
    delta.textPresetType = spec.type;
    delta.textProgress = clamp(tRel / spec.dur, 0, 1);
    return delta;
  }

  if (tRel >= spec.dur) return delta;
  const u = clamp(tRel / spec.dur, 0, 1);
  const f = ease(spec.ease, u);
  const inv = 1 - f;

  switch (spec.type) {
    case 'fade':
      delta.opacityMult = f;
      break;
    case 'fadeUp':
      delta.opacityMult = f;
      delta.dy = (40 / canvasH) * inv;
      break;
    case 'slideL':
      delta.opacityMult = clamp(u * 2, 0, 1);
      delta.dx = -(90 / canvasW) * inv;
      break;
    case 'slideR':
      delta.opacityMult = clamp(u * 2, 0, 1);
      delta.dx = (90 / canvasW) * inv;
      break;
    case 'slideU':
      delta.opacityMult = clamp(u * 2, 0, 1);
      delta.dy = (90 / canvasH) * inv;
      break;
    case 'slideD':
      delta.opacityMult = clamp(u * 2, 0, 1);
      delta.dy = -(90 / canvasH) * inv;
      break;
    case 'riseIn':
      delta.opacityMult = clamp(u * 2, 0, 1);
      delta.dy = (120 / canvasH) * inv;
      delta.scaleMult = lerp(0.85, 1, f);
      break;
    case 'dropIn':
      delta.opacityMult = clamp(u * 2.5, 0, 1);
      delta.dy = -(180 / canvasH) * (1 - ease('outBounce', u));
      break;
    case 'flyIn':
      delta.opacityMult = clamp(u * 2, 0, 1);
      delta.dx = -(160 / canvasW) * inv;
      delta.scaleMult = lerp(0.8, 1, f);
      break;
    case 'scaleIn':
      delta.opacityMult = f;
      delta.scaleMult = lerp(0.6, 1, f);
      break;
    case 'popIn':
      delta.opacityMult = clamp(u * 2.5, 0, 1);
      delta.scaleMult = lerp(0.4, 1, ease('outBack', u));
      break;
    case 'zoomIn':
      delta.opacityMult = f;
      delta.scaleMult = lerp(1.5, 1, f);
      break;
    case 'blurIn':
      delta.opacityMult = f;
      delta.blurAdd = 16 * inv;
      break;
    case 'spinIn':
      delta.opacityMult = f;
      delta.scaleMult = lerp(0.5, 1, f);
      delta.rotDelta = -90 * inv;
      break;
    case 'swingIn':
      delta.opacityMult = f;
      delta.rotDelta = -25 * (1 - ease('outBack', u));
      break;
  }

  return delta;
}

export function evaluateExitPreset(
  exit: EnterExitPreset | undefined,
  tRemaining: number,
  canvasW: number,
  canvasH: number
): PresetDelta {
  const delta: PresetDelta = {
    dx: 0,
    dy: 0,
    scaleMult: 1,
    rotDelta: 0,
    opacityMult: 1,
    blurAdd: 0,
  };

  const spec = normalizeEnterExit(exit, 'fadeOut', 0.2, 'inCubic');
  if (spec.type === 'none' || spec.dur <= 0 || tRemaining >= spec.dur) return delta;

  const u = clamp(1 - tRemaining / spec.dur, 0, 1);
  const f = ease(spec.ease, u);
  const rem = 1 - f;

  switch (spec.type) {
    case 'fade':
    case 'fadeOut':
      delta.opacityMult = rem;
      break;
    case 'slideOut':
    case 'slideLOut':
      delta.opacityMult = rem;
      delta.dx = -(90 / canvasW) * f;
      break;
    case 'slideUOut':
      delta.opacityMult = rem;
      delta.dy = -(90 / canvasH) * f;
      break;
    case 'slideDOut':
      delta.opacityMult = rem;
      delta.dy = (90 / canvasH) * f;
      break;
    case 'dropOut':
      delta.opacityMult = rem;
      delta.dy = (160 / canvasH) * f;
      break;
    case 'flyOut':
      delta.opacityMult = rem;
      delta.dx = (160 / canvasW) * f;
      delta.scaleMult = lerp(1, 0.8, f);
      break;
    case 'scaleDown':
      delta.opacityMult = rem;
      delta.scaleMult = lerp(1, 0.65, f);
      break;
    case 'popOut':
      delta.opacityMult = rem;
      delta.scaleMult = u < 0.35 ? lerp(1, 1.1, u / 0.35) : lerp(1.1, 0.3, (u - 0.35) / 0.65);
      break;
    case 'zoomOut':
      delta.opacityMult = rem;
      delta.scaleMult = lerp(1, 1.5, f);
      break;
    case 'blurOut':
      delta.opacityMult = rem;
      delta.blurAdd = 14 * f;
      break;
    case 'spinOut':
      delta.opacityMult = rem;
      delta.scaleMult = lerp(1, 0.4, f);
      delta.rotDelta = 90 * f;
      break;
  }

  return delta;
}

export function evaluateEmphasisLoop(
  emph: string | undefined,
  tRel: number,
  canvasW: number,
  canvasH: number
): PresetDelta {
  const delta: PresetDelta = {
    dx: 0,
    dy: 0,
    scaleMult: 1,
    rotDelta: 0,
    opacityMult: 1,
    blurAdd: 0,
  };
  if (!emph) return delta;
  switch (emph) {
    case 'pulse':
      delta.scaleMult = 1 + 0.05 * Math.sin((tRel * Math.PI * 2) / 1.4);
      break;
    case 'shake':
      delta.dx = (Math.sin(tRel * 35) * 6) / canvasW;
      break;
    case 'float':
      delta.dy = (Math.sin((tRel * Math.PI * 2) / 2.4) * 10) / canvasH;
      break;
    case 'sway':
      delta.rotDelta = Math.sin((tRel * Math.PI * 2) / 2.8) * 3.5;
      break;
    case 'breathe':
      delta.scaleMult = 1 + 0.03 * Math.sin((tRel * Math.PI * 2) / 2.6);
      break;
  }
  return delta;
}
