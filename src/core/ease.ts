import { easingRegistry, registerEasing } from './registry.ts';

export function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (Math.abs(edge1 - edge0) < 1e-9) return x >= edge1 ? 1 : 0;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Deterministic string/number hash to uint32 seed
 */
export function hashString(str: string, extraSeed = 0): number {
  let h = (2166136261 ^ extraSeed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Mulberry32 deterministic PRNG returning float in [0, 1)
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic single-shot random float in [0, 1) from numeric seed
 */
export function seededRand(seed: number): number {
  const n = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return n - Math.floor(n);
}

/**
 * Deterministic 1D value noise in [-1, 1]
 */
export function seededNoise(x: number, seed = 0): number {
  const xi = Math.floor(x);
  const xf = x - xi;
  const u = xf * xf * (3 - 2 * xf);
  const a = seededRand(xi + seed * 131.7) * 2 - 1;
  const b = seededRand(xi + 1 + seed * 131.7) * 2 - 1;
  return lerp(a, b, u);
}

/**
 * Deterministic wiggle(freq, amp, seed) at time t
 */
export function seededWiggle(t: number, freq = 2, amp = 1, seed = 0): number {
  return seededNoise(t * freq, seed) * amp;
}

// Standard SPEC Easings
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;

function outBounceFn(x: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  let u = clamp(x, 0, 1);
  if (u < 1 / d1) {
    return n1 * u * u;
  } else if (u < 2 / d1) {
    return n1 * (u -= 1.5 / d1) * u + 0.75;
  } else if (u < 2.5 / d1) {
    return n1 * (u -= 2.25 / d1) * u + 0.9375;
  } else {
    return n1 * (u -= 2.625 / d1) * u + 0.984375;
  }
}

export function registerBuiltInEasings(): void {
  registerEasing('linear', (u) => clamp(u, 0, 1));
  registerEasing('inQuad', (u) => u * u);
  registerEasing('outQuad', (u) => 1 - (1 - u) * (1 - u));
  registerEasing('inOutQuad', (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2));
  registerEasing('inCubic', (u) => u * u * u);
  registerEasing('outCubic', (u) => 1 - Math.pow(1 - u, 3));
  registerEasing('inOutCubic', (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2));
  registerEasing('inExpo', (u) => (u <= 0 ? 0 : Math.pow(2, 10 * u - 10)));
  registerEasing('outExpo', (u) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)));
  registerEasing('inOutExpo', (u) =>
    u <= 0
      ? 0
      : u >= 1
      ? 1
      : u < 0.5
      ? Math.pow(2, 20 * u - 10) / 2
      : (2 - Math.pow(2, -20 * u + 10)) / 2
  );
  registerEasing('inSine', (u) => 1 - Math.cos((u * Math.PI) / 2));
  registerEasing('outSine', (u) => Math.sin((u * Math.PI) / 2));
  registerEasing('inOutSine', (u) => -(Math.cos(Math.PI * u) - 1) / 2);
  registerEasing('inBack', (u) => c3 * u * u * u - c1 * u * u);
  registerEasing('outBack', (u) => 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2));
  registerEasing('inOutBack', (u) =>
    u < 0.5
      ? (Math.pow(2 * u, 2) * ((c2 + 1) * 2 * u - c2)) / 2
      : (Math.pow(2 * u - 2, 2) * ((c2 + 1) * (u * 2 - 2) + c2) + 2) / 2
  );
  registerEasing('outBounce', outBounceFn);
  registerEasing('outElastic', (u) =>
    u <= 0 ? 0 : u >= 1 ? 1 : Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * c4) + 1
  );
  registerEasing('step', (u) => (u >= 1 ? 1 : 0));
  // Parametric easing templates registered for vocabulary completeness
  registerEasing('bezier', (u) => clamp(u, 0, 1));
  registerEasing('spring', (u) => clamp(u, 0, 1));
}

registerBuiltInEasings();

function evaluateCubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Newton-Raphson solver for t given x
  let t = x;
  for (let i = 0; i < 8; i++) {
    const inv = 1 - t;
    const cx = 3 * inv * inv * t * x1 + 3 * inv * t * t * x2 + t * t * t - x;
    if (Math.abs(cx) < 1e-5) break;
    const dx = 3 * inv * inv * x1 + 6 * inv * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (Math.abs(dx) < 1e-6) break;
    t -= cx / dx;
    t = clamp(t, 0, 1);
  }
  const inv = 1 - t;
  return 3 * inv * inv * t * y1 + 3 * inv * t * t * y2 + t * t * t;
}

function evaluateSpring(stiffness = 180, damping = 12, mass = 1, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const w0 = Math.sqrt(Math.max(1, stiffness) / Math.max(0.01, mass));
  const zeta = Math.max(0.1, damping) / (2 * Math.sqrt(Math.max(1, stiffness) * Math.max(0.01, mass)));
  const t = u;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - (1 + w0 * t) * Math.exp(-w0 * t);
}

export function isValidEasingName(name: string | undefined): boolean {
  if (!name) return true;
  if (easingRegistry.has(name)) return true;
  if (/^bezier\(\s*[-+]?\d*\.?\d+\s*(,\s*[-+]?\d*\.?\d+\s*){3}\)$/.test(name)) return true;
  if (/^spring\(\s*[-+]?\d*\.?\d+\s*(,\s*[-+]?\d*\.?\d+\s*){0,2}\)$/.test(name)) return true;
  return false;
}

export function ease(name: string | undefined, u: number): number {
  const clamped = clamp(u, 0, 1);
  if (!name || name === 'linear') return clamped;
  const fn = easingRegistry.get(name);
  if (fn && name !== 'bezier' && name !== 'spring') {
    return fn(clamped);
  }
  if (name.startsWith('bezier(') && name.endsWith(')')) {
    const parts = name
      .slice(7, -1)
      .split(',')
      .map((s) => parseFloat(s.trim()));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return evaluateCubicBezier(parts[0], parts[1], parts[2], parts[3], clamped);
    }
  }
  if (name.startsWith('spring(') && name.endsWith(')')) {
    const parts = name
      .slice(7, -1)
      .split(',')
      .map((s) => parseFloat(s.trim()));
    if (parts.every((n) => Number.isFinite(n))) {
      return evaluateSpring(parts[0] ?? 180, parts[1] ?? 12, parts[2] ?? 1, clamped);
    }
  }
  return clamped;
}
