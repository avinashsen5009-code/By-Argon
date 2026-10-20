import { clamp, ease, lerp } from '../core/ease.ts';
import { resolveColorToken } from '../core/palette.ts';
import type { CompiledLayer, ThemeTokens } from '../core/types.ts';
import type { Any2DContext } from './background.ts';
import { traceRoundedRect } from './shapes.ts';
import { resolveFontFamily } from './text.ts';

/**
 * Renders all 9 SPEC chart kinds centered at (0,0) in local layer space:
 * bar | hbar | line | pie | donut | progress | gauge | counter | timeline
 */
export function drawChartLayer(
  ctx: Any2DContext,
  layer: CompiledLayer,
  w: number,
  h: number,
  tGlobal: number,
  tRel: number,
  tokens: ThemeTokens
): void {
  const kind = layer.kind || 'bar';
  const data = Array.isArray(layer.data) && layer.data.length > 0 ? layer.data : [35, 65, 90];
  const labels = Array.isArray(layer.labels) ? layer.labels : [];
  const rawColors = Array.isArray(layer.colors) && layer.colors.length > 0
    ? layer.colors
    : ['@second', '@second', '@acc'];
  const colors = rawColors.map((c) => resolveColorToken(c, tokens));
  const animDur = layer.animate?.dur ?? 0.65;
  const animStagger = layer.animate?.stagger ?? 0.1;
  const animEase = layer.animate?.ease ?? 'outCubic';

  const hw = w * 0.5;
  const hh = h * 0.5;

  switch (kind) {
    case 'counter': {
      const fromVal = typeof layer.from === 'number' ? layer.from : 0;
      const toVal = typeof layer.to === 'number' ? layer.to : 100;
      const c0 = layer.resolvedCount ? layer.resolvedCount[0] : layer.t0;
      const c1 = layer.resolvedCount ? layer.resolvedCount[1] : layer.t1;
      const u = clamp((tGlobal - c0) / Math.max(1e-4, c1 - c0), 0, 1);
      const f = ease(layer.ease || 'outCubic', u);
      const val = lerp(fromVal, toVal, f);
      const decimals = layer.decimals ?? 0;
      const formattedNum = val.toFixed(decimals);
      const fmt = layer.format || '{v}';
      const displayStr = fmt.includes('{v}') ? fmt.replace('{v}', formattedNum) : formattedNum;

      const fontSize = typeof layer.size === 'number' ? layer.size : 96;
      const col = resolveColorToken(layer.color || '@acc', tokens);
      ctx.save();
      ctx.font = `800 ${fontSize}px ${resolveFontFamily('display')}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = col;
      ctx.fillText(displayStr, 0, 0);
      ctx.restore();
      break;
    }

    case 'bar': {
      const maxVal = Math.max(1, ...data);
      const n = data.length;
      const gap = Math.min(32, (w * 0.25) / Math.max(1, n));
      const barW = (w - gap * (n - 1)) / n;
      const chartH = h * 0.82;
      const bottomY = hh - h * 0.12;

      data.forEach((v, idx) => {
        const u = clamp((tRel - idx * animStagger) / Math.max(1e-4, animDur), 0, 1);
        const f = ease(animEase, u);
        const bh = Math.max(8, (v / maxVal) * chartH * f);
        const bx = -hw + idx * (barW + gap);
        const by = bottomY - bh;

        ctx.fillStyle = colors[idx % colors.length];
        traceRoundedRect(ctx, bx, by, barW, bh, Math.min(16, barW * 0.25));
        ctx.fill();

        if (labels[idx]) {
          ctx.font = `700 24px ${resolveFontFamily('sans')}`;
          ctx.fillStyle = tokens.muted;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(String(labels[idx]), bx + barW * 0.5, bottomY + 14);
        }
      });
      break;
    }

    case 'hbar': {
      const maxVal = Math.max(1, ...data);
      const n = data.length;
      const gap = 22;
      const barH = Math.min(54, (h - gap * (n - 1)) / n);
      data.forEach((v, idx) => {
        const u = clamp((tRel - idx * animStagger) / Math.max(1e-4, animDur), 0, 1);
        const f = ease(animEase, u);
        const bw = Math.max(12, (v / maxVal) * w * f);
        const by = -hh + idx * (barH + gap);

        ctx.fillStyle = tokens.track;
        traceRoundedRect(ctx, -hw, by, w, barH, barH * 0.5);
        ctx.fill();

        ctx.fillStyle = colors[idx % colors.length];
        traceRoundedRect(ctx, -hw, by, bw, barH, barH * 0.5);
        ctx.fill();
      });
      break;
    }

    case 'line': {
      const maxVal = Math.max(1, ...data);
      const minVal = Math.min(0, ...data);
      const span = Math.max(1, maxVal - minVal);
      const p = ease(animEase, clamp(tRel / Math.max(1e-4, animDur), 0, 1));
      ctx.save();
      ctx.strokeStyle = colors[0] || tokens.acc;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      data.forEach((v, idx) => {
        const px = -hw + (idx / Math.max(1, data.length - 1)) * w;
        const py = hh - ((v - minVal) / span) * h * p;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
      break;
    }

    case 'pie':
    case 'donut': {
      const total = Math.max(1, data.reduce((a, b) => a + b, 0));
      const r = Math.min(hw, hh) * 0.9;
      const p = ease(animEase, clamp(tRel / Math.max(1e-4, animDur), 0, 1));
      let angle = -Math.PI / 2;

      data.forEach((v, idx) => {
        const sliceAngle = (v / total) * Math.PI * 2 * p;
        ctx.beginPath();
        if (kind === 'donut') {
          ctx.arc(0, 0, r, angle, angle + sliceAngle);
          ctx.arc(0, 0, r * 0.58, angle + sliceAngle, angle, true);
        } else {
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, r, angle, angle + sliceAngle);
        }
        ctx.closePath();
        ctx.fillStyle = colors[idx % colors.length];
        ctx.fill();
        angle += sliceAngle;
      });
      break;
    }

    case 'progress': {
      const targetVal = clamp((data[0] ?? 75) / 100, 0, 1);
      const p = ease(animEase, clamp(tRel / Math.max(1e-4, animDur), 0, 1)) * targetVal;
      ctx.fillStyle = tokens.track;
      traceRoundedRect(ctx, -hw, -hh, w, h, h * 0.5);
      ctx.fill();

      ctx.fillStyle = colors[0] || tokens.acc;
      traceRoundedRect(ctx, -hw, -hh, Math.max(h, w * p), h, h * 0.5);
      ctx.fill();
      break;
    }

    case 'gauge': {
      const targetVal = clamp((data[0] ?? 80) / 100, 0, 1);
      const p = ease(animEase, clamp(tRel / Math.max(1e-4, animDur), 0, 1)) * targetVal;
      const r = Math.min(hw, hh) * 0.85;
      const startAngle = Math.PI * 0.8;
      const endAngle = Math.PI * 2.2;

      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(14, r * 0.16);
      ctx.strokeStyle = tokens.track;
      ctx.beginPath();
      ctx.arc(0, 0, r, startAngle, endAngle);
      ctx.stroke();

      ctx.strokeStyle = colors[0] || tokens.acc;
      ctx.beginPath();
      ctx.arc(0, 0, r, startAngle, lerp(startAngle, endAngle, p));
      ctx.stroke();
      break;
    }

    case 'timeline': {
      const nodes = labels.length > 0 ? labels : data.map(String);
      const p = ease(animEase, clamp(tRel / Math.max(1e-4, animDur), 0, 1));
      ctx.fillStyle = tokens.track;
      traceRoundedRect(ctx, -hw, -4, w, 8, 4);
      ctx.fill();

      ctx.fillStyle = tokens.acc;
      traceRoundedRect(ctx, -hw, -4, w * p, 8, 4);
      ctx.fill();

      nodes.forEach((lbl, idx) => {
        const frac = nodes.length === 1 ? 0.5 : idx / (nodes.length - 1);
        const nx = -hw + w * frac;
        const active = p >= frac;
        ctx.beginPath();
        ctx.arc(nx, 0, active ? 16 : 12, 0, Math.PI * 2);
        ctx.fillStyle = active ? tokens.acc : tokens.surf;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = tokens.acc;
        ctx.stroke();

        ctx.font = `700 22px ${resolveFontFamily('sans')}`;
        ctx.fillStyle = active ? tokens.ink : tokens.muted;
        ctx.textAlign = 'center';
        ctx.fillText(String(lbl), nx, 36);
      });
      break;
    }
  }
}
