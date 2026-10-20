import type { FillValue, Layer, StyleToken } from './types.ts';

export interface ExpandedStyleProps {
  fill: FillValue;
  stroke: string;
  strokeWidth: number;
  radius?: number;
  shadow?: number;
  glow?: number;
}

export const STYLE_TOKEN_NAMES: StyleToken[] = ['card', 'hero', 'disc', 'hdisc', 'warnp'];

/**
 * Expands SPEC Section 7 style tokens:
 * - "card"  = grad(@cardHi,@cardLo) + 2 px @cardS stroke + radius 40
 * - "hero"  = grad(@heroHi,@heroLo) + 3 px @acc stroke + radius 40
 * - "disc"  = gradr(@discHi,@discLo) + 3 px @acc stroke
 * - "hdisc" = gradr(@hdiscHi,@hdiscLo) + 3 px @ink stroke + glow 1
 * - "warnp" = grad(@warnpHi,@warnpLo) + 3 px @warn stroke + radius 40
 */
export function expandStyleToken(style: string | undefined): ExpandedStyleProps | undefined {
  switch (style) {
    case 'card':
      return {
        fill: 'grad(@cardHi,@cardLo)',
        stroke: '@cardS',
        strokeWidth: 2,
        radius: 40,
        shadow: 0.45,
      };
    case 'hero':
      return {
        fill: 'grad(@heroHi,@heroLo)',
        stroke: '@acc',
        strokeWidth: 3,
        radius: 40,
        shadow: 0.6,
      };
    case 'disc':
      return {
        fill: 'gradr(@discHi,@discLo)',
        stroke: '@acc',
        strokeWidth: 3,
        shadow: 0.35,
      };
    case 'hdisc':
      return {
        fill: 'gradr(@hdiscHi,@hdiscLo)',
        stroke: '@ink',
        strokeWidth: 3,
        glow: 1,
        shadow: 0.5,
      };
    case 'warnp':
      return {
        fill: 'grad(@warnpHi,@warnpLo)',
        stroke: '@warn',
        strokeWidth: 3,
        radius: 40,
        shadow: 0.45,
      };
    default:
      return undefined;
  }
}

export function applyStyleToLayer(layer: Layer): Layer {
  if (!layer.style) return layer;
  const expanded = expandStyleToken(layer.style);
  if (!expanded) return layer;
  return {
    ...layer,
    fill: layer.fill ?? expanded.fill,
    stroke: layer.stroke ?? expanded.stroke,
    strokeWidth: layer.strokeWidth ?? expanded.strokeWidth,
    radius: layer.radius ?? expanded.radius,
    shadow: layer.shadow ?? expanded.shadow,
    glow: layer.glow ?? expanded.glow,
  };
}
