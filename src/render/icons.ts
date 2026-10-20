import { resolveColorToken } from '../core/palette.ts';
import { iconRegistry } from '../core/registry.ts';
import type { CompiledLayer, ThemeTokens } from '../core/types.ts';
import type { Any2DContext } from './background.ts';

/**
 * Renders any of the 66 bundled Lucide icons (defined in 0..24 coordinate box)
 * scaled to `sizePx` centered at (0,0).
 */
export function drawIconLayer(
  ctx: Any2DContext,
  layer: CompiledLayer,
  sizePx: number,
  tokens: ThemeTokens
): void {
  const iconName = layer.name || 'check';
  const paths = iconRegistry.get(iconName) || iconRegistry.get('check') || [];
  const color = resolveColorToken(layer.color || layer.stroke || '@ink', tokens);

  ctx.save();
  const scale = sizePx / 24;
  ctx.translate(-sizePx * 0.5, -sizePx * 0.5);
  ctx.scale(scale, scale);

  ctx.strokeStyle = color;
  ctx.lineWidth = layer.strokeWidth ? Number(layer.strokeWidth) / scale : 2.25;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (typeof Path2D !== 'undefined') {
    for (const d of paths) {
      const p2d = new Path2D(d);
      ctx.stroke(p2d);
    }
  }
  ctx.restore();
}
