import { mulberry32, seededNoise } from '../core/ease.ts';
import { resolveColorToken } from '../core/palette.ts';
import type { CompiledLayer, ThemeTokens } from '../core/types.ts';

export type Any2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Draws the default scene background from theme tokens (@bg base + @scn subtle radial glow).
 */
export function drawBaseSceneBackground(
  ctx: Any2DContext,
  tokens: ThemeTokens,
  w: number,
  h: number
): void {
  ctx.save();
  ctx.fillStyle = tokens.bg || '#0C0612';
  ctx.fillRect(0, 0, w, h);

  const grad = ctx.createRadialGradient(w * 0.5, h * 0.48, w * 0.05, w * 0.5, h * 0.5, w * 0.72);
  grad.addColorStop(0, tokens.scn || '#3A0F35');
  grad.addColorStop(1, tokens.bg || '#0C0612');
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * Renders any of the 11 SPEC background layer kinds:
 * solid | gradient | mesh | grid | dots | noise | waves | rays | stars | aurora | lines
 */
export function drawBackgroundLayer(
  ctx: Any2DContext,
  layer: CompiledLayer,
  t: number,
  tokens: ThemeTokens,
  w: number,
  h: number,
  opacity: number
): void {
  const kind = layer.kind || 'solid';
  const rawColors = Array.isArray(layer.colors) && layer.colors.length > 0
    ? layer.colors
    : ['@scn', '@bg', '@acc'];
  const colors = rawColors.map((c) => resolveColorToken(c, tokens));
  const speed = typeof layer.speed === 'number' ? layer.speed : 1;
  const scale = typeof layer.scale === 'number' ? layer.scale : 1;
  const prng = mulberry32(layer.numericSeed);

  ctx.save();
  ctx.globalAlpha = opacity;

  switch (kind) {
    case 'solid': {
      ctx.fillStyle = colors[0] || tokens.bg;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'gradient': {
      const g = ctx.createLinearGradient(0, 0, w, h);
      colors.forEach((col, idx) => {
        g.addColorStop(colors.length === 1 ? 0 : idx / (colors.length - 1), col);
      });
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'mesh':
    case 'aurora': {
      ctx.fillStyle = tokens.bg;
      ctx.fillRect(0, 0, w, h);
      const count = kind === 'aurora' ? 4 : 3;
      for (let i = 0; i < count; i++) {
        const cx = w * (0.25 + 0.5 * ((i + 0.5) / count) + 0.12 * Math.sin(t * speed * 0.6 + i * 2));
        const cy = h * (0.35 + 0.3 * Math.cos(t * speed * 0.5 + i * 1.7));
        const rad = Math.max(w, h) * (kind === 'aurora' ? 0.48 : 0.42) * scale;
        const rg = ctx.createRadialGradient(cx, cy, rad * 0.05, cx, cy, rad);
        rg.addColorStop(0, colors[i % colors.length]);
        rg.addColorStop(1, 'transparent');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, w, h);
      }
      break;
    }
    case 'grid': {
      const step = Math.max(32, Math.round(80 * scale));
      ctx.strokeStyle = colors[0] || tokens.track;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x <= w; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = 0; y <= h; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      break;
    }
    case 'dots': {
      const step = Math.max(36, Math.round(72 * scale));
      ctx.fillStyle = colors[0] || tokens.track;
      for (let x = step * 0.5; x < w; x += step) {
        for (let y = step * 0.5; y < h; y += step) {
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'noise': {
      const cell = 48;
      for (let x = 0; x < w; x += cell) {
        for (let y = 0; y < h; y += cell) {
          const n = seededNoise(x * 0.03 + y * 0.07 + Math.floor(t * 8), layer.numericSeed);
          ctx.fillStyle = colors[0] || tokens.ink;
          ctx.globalAlpha = opacity * Math.max(0, n * 0.08);
          ctx.fillRect(x, y, cell, cell);
        }
      }
      break;
    }
    case 'waves': {
      ctx.strokeStyle = colors[0] || tokens.acc;
      ctx.lineWidth = 3;
      for (let row = 0; row < 5; row++) {
        const baseY = h * (0.2 + row * 0.15);
        ctx.beginPath();
        for (let x = 0; x <= w; x += 24) {
          const y = baseY + Math.sin(x * 0.006 + t * speed * 1.5 + row) * 28 * scale;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case 'rays': {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const numRays = 12;
      const maxR = Math.hypot(w, h);
      ctx.fillStyle = colors[0] || tokens.scn;
      for (let i = 0; i < numRays; i++) {
        const a0 = (i / numRays) * Math.PI * 2 + t * speed * 0.15;
        const a1 = a0 + Math.PI / (numRays * 1.6);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a0) * maxR, cy + Math.sin(a0) * maxR);
        ctx.lineTo(cx + Math.cos(a1) * maxR, cy + Math.sin(a1) * maxR);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'stars': {
      ctx.fillStyle = colors[0] || tokens.ink;
      for (let i = 0; i < 65; i++) {
        const sx = prng() * w;
        const sy = prng() * h;
        const sr = (1.5 + prng() * 2.5) * scale;
        const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * speed * 2.5 + i));
        ctx.globalAlpha = opacity * twinkle;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'lines': {
      const count = 10;
      ctx.strokeStyle = colors[0] || tokens.track;
      ctx.lineWidth = 2;
      for (let i = 0; i < count; i++) {
        const y = ((i / count) * h + t * speed * 30) % h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      break;
    }
  }

  ctx.restore();
}
