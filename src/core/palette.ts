import { clamp, lerp } from './ease.ts';
import type { FillValue, GradientFillObject, ThemeSpec, ThemeTokens } from './types.ts';

export const PALETTE_NAMES: Record<number, string> = {
  1: 'Neon Pink',
  2: 'Electric Cyan',
  3: 'Cyber Purple',
  4: 'Emerald',
  5: 'Sunset Amber',
};

export const PALETTE_TABLE: Record<number, ThemeTokens> = {
  1: {
    bg: '#0C0612',
    dark: '#0C0612',
    scn: '#3A0F35',
    acc: '#FF3DB8',
    ink: '#FFF0FA',
    muted: '#C9A3BD',
    dim: '#A0809A',
    track: '#4E1D45',
    surf: '#230B1F',
    second: '#A0457F',
    cardHi: '#3A1235',
    cardLo: '#170818',
    cardS: '#8A2B72',
    heroHi: '#32102E',
    heroLo: '#12060F',
    discHi: '#A8307F',
    discLo: '#2A0B24',
    hdiscHi: '#FF3DB8',
    hdiscLo: '#B0127A',
    warn: '#FF5A36',
    warnpHi: '#4A1D10',
    warnpLo: '#240C06',
  },
  2: {
    bg: '#06141B',
    dark: '#06141B',
    scn: '#0E2A35',
    acc: '#17A4DB',
    ink: '#EAF6F9',
    muted: '#8FB3BF',
    dim: '#5E8794',
    track: '#1E4A57',
    surf: '#0F2A33',
    second: '#2E6F82',
    cardHi: '#123A47',
    cardLo: '#0A2530',
    cardS: '#1E6273',
    heroHi: '#0F3340',
    heroLo: '#081E27',
    discHi: '#2E7C90',
    discLo: '#0B2B36',
    hdiscHi: '#17A4DB',
    hdiscLo: '#0E6F87',
    warn: '#FF4D5A',
    warnpHi: '#4A1820',
    warnpLo: '#240B10',
  },
  3: {
    bg: '#0B0615',
    dark: '#0B0615',
    scn: '#2A0F4A',
    acc: '#C04BFF',
    ink: '#F7F0FF',
    muted: '#B8A4D8',
    dim: '#8A74A8',
    track: '#3B1E62',
    surf: '#1B0E2B',
    second: '#6B3AA8',
    cardHi: '#2A1248',
    cardLo: '#120822',
    cardS: '#5B2A94',
    heroHi: '#26103F',
    heroLo: '#0E061A',
    discHi: '#7A36C8',
    discLo: '#1B0A33',
    hdiscHi: '#C04BFF',
    hdiscLo: '#6A12C9',
    warn: '#FF3B6B',
    warnpHi: '#4A1028',
    warnpLo: '#240814',
  },
  4: {
    bg: '#04120D',
    dark: '#04120D',
    scn: '#0B2E22',
    acc: '#2EE59D',
    ink: '#EDFBF5',
    muted: '#9CC9B6',
    dim: '#6E9A88',
    track: '#1A4A3A',
    surf: '#0C2A20',
    second: '#2E7A5E',
    cardHi: '#0F3A2C',
    cardLo: '#08221A',
    cardS: '#1E6B50',
    heroHi: '#0D3326',
    heroLo: '#061D15',
    discHi: '#1F8A63',
    discLo: '#0A2B20',
    hdiscHi: '#2EE59D',
    hdiscLo: '#0F8F5F',
    warn: '#FF5A5F',
    warnpHi: '#4A1A1C',
    warnpLo: '#240C0E',
  },
  5: {
    bg: '#120A04',
    dark: '#120A04',
    scn: '#33200A',
    acc: '#FFA62B',
    ink: '#FFF6EA',
    muted: '#D6B894',
    dim: '#A88B6A',
    track: '#4A3218',
    surf: '#2A1A0B',
    second: '#8A5A26',
    cardHi: '#3A2510',
    cardLo: '#1C1108',
    cardS: '#7A4E1E',
    heroHi: '#33200D',
    heroLo: '#160D05',
    discHi: '#B06A1F',
    discLo: '#2E1A08',
    hdiscHi: '#FFA62B',
    hdiscLo: '#C46A0A',
    warn: '#FF4D5A',
    warnpHi: '#4A1820',
    warnpLo: '#240B10',
  },
};

export const THEME_TOKEN_NAMES = Object.keys(PALETTE_TABLE[1]);

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) || 0;
    const g = parseInt(clean[1] + clean[1], 16) || 0;
    const b = parseInt(clean[2] + clean[2], 16) || 0;
    return [r, g, b];
  }
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
  const hn = ((h % 360) + 360) % 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;
  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (hn < 60) [r1, g1, b1] = [c, x, 0];
  else if (hn < 120) [r1, g1, b1] = [x, c, 0];
  else if (hn < 180) [r1, g1, b1] = [0, c, x];
  else if (hn < 240) [r1, g1, b1] = [0, x, c];
  else if (hn < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  return rgbToHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255);
}

export function interpolateHexColor(hexA: string, hexB: string, t: number): string {
  const u = clamp(t, 0, 1);
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  // Interpolate in linear RGB space (gamma 2.2) per M3 specification
  const toLinear = (c: number) => Math.pow(clamp(c / 255, 0, 1), 2.2);
  const toSrgb = (l: number) => Math.pow(clamp(l, 0, 1), 1 / 2.2) * 255;

  const rl = lerp(toLinear(r1), toLinear(r2), u);
  const gl = lerp(toLinear(g1), toLinear(g2), u);
  const bl = lerp(toLinear(b1), toLinear(b2), u);
  return rgbToHex(toSrgb(rl), toSrgb(gl), toSrgb(bl));
}

/**
 * Expands theme.palette (1..5) or theme.hex into the complete ThemeTokens dictionary
 * per SPEC Part D Section 4.
 */
export function expandThemeTokens(theme?: ThemeSpec): ThemeTokens {
  if (!theme) return { ...PALETTE_TABLE[1] };
  if (theme.palette && PALETTE_TABLE[theme.palette]) {
    return { ...PALETTE_TABLE[theme.palette] };
  }
  if (theme.hex && /^#[0-9A-Fa-f]{6}$/.test(theme.hex.trim())) {
    const accHex = theme.hex.trim().toUpperCase();
    const [r, g, b] = hexToRgb(accHex);
    const [h, s] = rgbToHsl(r, g, b);
    const baseSat = Math.max(45, s);
    // SPEC Part D 4: warn = #FF4D5A, or #FFC23D if acc is itself red/orange
    const isRedOrange = h <= 42 || h >= 335;
    const warnHex = isRedOrange ? '#FFC23D' : '#FF4D5A';
    const bgHex = hslToHex(h, Math.min(60, baseSat), 4);
    return {
      bg: bgHex,
      dark: bgHex,
      scn: hslToHex(h, Math.min(65, baseSat), 13),
      acc: accHex,
      ink: hslToHex(h, 30, 97),
      muted: hslToHex(h, 25, 72),
      dim: hslToHex(h, 15, 58),
      track: hslToHex(h, Math.min(55, baseSat), 20),
      surf: hslToHex(h, Math.min(55, baseSat), 9),
      second: hslToHex(h, 45, 45),
      cardHi: hslToHex(h, Math.min(60, baseSat), 15),
      cardLo: hslToHex(h, Math.min(60, baseSat), 7),
      cardS: hslToHex(h, Math.min(65, baseSat), 35),
      heroHi: hslToHex(h, Math.min(65, baseSat), 12),
      heroLo: hslToHex(h, Math.min(65, baseSat), 4),
      discHi: hslToHex(h, Math.min(70, baseSat), 40),
      discLo: hslToHex(h, Math.min(70, baseSat), 10),
      hdiscHi: accHex,
      hdiscLo: hslToHex(h, baseSat, 35),
      warn: warnHex,
      warnpHi: isRedOrange ? '#4A3810' : '#4A1820',
      warnpLo: isRedOrange ? '#241B06' : '#240B10',
    };
  }
  return { ...PALETTE_TABLE[1] };
}

export function resolveColorToken(val: string | undefined, tokens: ThemeTokens, fallback = '#FFFFFF'): string {
  if (!val) return fallback;
  const trimmed = val.trim();
  if (trimmed === 'none' || trimmed === 'transparent') return 'transparent';
  if (trimmed.startsWith('@')) {
    const key = trimmed.slice(1);
    return tokens[key] ?? fallback;
  }
  return trimmed;
}

export interface ResolvedFill {
  kind: 'none' | 'solid' | 'linear' | 'radial';
  color?: string;
  angle?: number;
  stops?: [number, string][];
}

export function resolveFillValue(fill: FillValue | undefined, tokens: ThemeTokens): ResolvedFill {
  if (!fill || fill === 'none') {
    return { kind: 'none' };
  }
  if (typeof fill === 'object' && fill !== null) {
    const obj = fill as GradientFillObject;
    const stops: [number, string][] = (obj.stops || []).map(([pos, col]) => [
      Number(pos) || 0,
      resolveColorToken(col, tokens),
    ]);
    return {
      kind: obj.type === 'radial' ? 'radial' : 'linear',
      angle: obj.angle ?? 90,
      stops,
    };
  }
  const str = String(fill).trim();
  if (str.startsWith('grad(') && str.endsWith(')')) {
    const parts = str
      .slice(5, -1)
      .split(',')
      .map((s) => s.trim());
    return {
      kind: 'linear',
      angle: 90,
      stops: [
        [0, resolveColorToken(parts[0], tokens)],
        [1, resolveColorToken(parts[1] ?? parts[0], tokens)],
      ],
    };
  }
  if (str.startsWith('gradr(') && str.endsWith(')')) {
    const parts = str
      .slice(6, -1)
      .split(',')
      .map((s) => s.trim());
    return {
      kind: 'radial',
      stops: [
        [0, resolveColorToken(parts[0], tokens)],
        [1, resolveColorToken(parts[1] ?? parts[0], tokens)],
      ],
    };
  }
  return {
    kind: 'solid',
    color: resolveColorToken(str, tokens),
  };
}
