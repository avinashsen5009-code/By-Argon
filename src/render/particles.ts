import { clamp, lerp, mulberry32 } from '../core/ease.ts';
import { resolveColorToken } from '../core/palette.ts';
import type { CompiledLayer, ThemeTokens } from '../core/types.ts';
import type { Any2DContext } from './background.ts';

function pickRange(val: [number, number] | number | undefined, rand: number, defMin: number, defMax: number): number {
  if (typeof val === 'number') return val;
  if (Array.isArray(val) && val.length === 2) {
    return lerp(Number(val[0]) || defMin, Number(val[1]) || defMax, rand);
  }
  return lerp(defMin, defMax, rand);
}

/**
 * Pure, stateless particle evaluator at relative time `tRel` from `layer.numericSeed`.
 * Supports burst and continuous emitters with analytic kinematics `p(t) = p0 + v*t + 0.5*g*t^2`.
 */
export function drawParticlesLayer(
  ctx: Any2DContext,
  layer: CompiledLayer,
  w: number,
  h: number,
  tRel: number,
  tokens: ThemeTokens
): void {
  if (tRel < 0) return;
  const em = layer.emitter || {};
  const count = Math.min(180, Math.max(1, em.count ?? 36));
  const isBurst = layer.burst !== false;
  const gravity = em.gravity ?? 240;
  const rawColors = Array.isArray(em.colors) && em.colors.length > 0 ? em.colors : ['@acc', '@ink', '@second'];
  const colors = rawColors.map((c) => resolveColorToken(c, tokens));
  const shape = em.shape || 'circle';
  const prng = mulberry32(layer.numericSeed);

  ctx.save();
  for (let i = 0; i < count; i++) {
    const rLife = prng();
    const rSpeed = prng();
    const rAngle = prng();
    const rSize = prng();
    const rOffset = prng();
    const rCol = Math.floor(prng() * colors.length);

    const life = Math.max(0.2, pickRange(em.life, rLife, 0.7, 1.5));
    const speed = pickRange(em.speed, rSpeed, 140, 420);
    const angleDeg = pickRange(em.angle, rAngle, 0, 360);
    const angleRad = (angleDeg * Math.PI) / 180;
    const sizeStart = pickRange(em.size, rSize, 8, 20);
    const sizeEnd = em.sizeEnd ?? sizeStart * 0.25;
    const opEnd = em.opacityEnd ?? 0;

    const pAge = isBurst ? tRel : (tRel + rOffset * life) % life;
    if (pAge < 0 || pAge > life) continue;

    const progress = clamp(pAge / life, 0, 1);
    const vx = Math.cos(angleRad) * speed;
    const vy = Math.sin(angleRad) * speed;

    const px = vx * pAge;
    const py = vy * pAge + 0.5 * gravity * pAge * pAge;
    const curSize = Math.max(1, lerp(sizeStart, sizeEnd, progress));
    const curOp = lerp(1, opEnd, progress);

    if (curOp <= 0.01) continue;

    ctx.save();
    ctx.globalAlpha *= curOp;
    ctx.translate(px, py);
    if (em.spin) {
      ctx.rotate(((em.spin * pAge) * Math.PI) / 180);
    }
    ctx.fillStyle = colors[rCol] || tokens.acc;

    if (shape === 'rect') {
      ctx.fillRect(-curSize * 0.5, -curSize * 0.5, curSize, curSize);
    } else if (shape === 'ring') {
      ctx.strokeStyle = colors[rCol] || tokens.acc;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, curSize * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, curSize * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  void w;
  void h;
  ctx.restore();
}
