import { clamp, ease, lerp } from '../core/ease.ts';
import { resolveColorToken } from '../core/palette.ts';
import { poseRegistry } from '../core/registry.ts';
import type { CompiledLayer, FigureJoints, ThemeTokens } from '../core/types.ts';
import type { Any2DContext } from './background.ts';

function resolvePoseJoints(pose: string | { joints: FigureJoints } | undefined): Required<FigureJoints> {
  const def: Required<FigureJoints> = {
    armR: 15,
    armL: -15,
    legR: 8,
    legL: -8,
    torso: 0,
    head: 0,
  };
  if (!pose) return def;
  if (typeof pose === 'string') {
    const reg = poseRegistry.get(pose);
    return reg ? { ...def, ...reg } : def;
  }
  if (pose && typeof pose === 'object' && 'joints' in pose) {
    return { ...def, ...pose.joints };
  }
  return def;
}

function interpolateJoints(a: Required<FigureJoints>, b: Required<FigureJoints>, f: number): Required<FigureJoints> {
  return {
    armR: lerp(a.armR, b.armR, f),
    armL: lerp(a.armL, b.armL, f),
    legR: lerp(a.legR, b.legR, f),
    legL: lerp(a.legL, b.legL, f),
    torso: lerp(a.torso, b.torso, f),
    head: lerp(a.head, b.head, f),
  };
}

/**
 * Renders the SPEC stick-man `figure` layer with all 17 poses, custom joints, and poseKeys interpolation.
 */
export function drawFigureLayer(
  ctx: Any2DContext,
  layer: CompiledLayer,
  w: number,
  h: number,
  tRel: number,
  tokens: ThemeTokens
): void {
  let joints = resolvePoseJoints(layer.pose);

  if (layer.resolvedPoseKeys && layer.resolvedPoseKeys.length > 0) {
    const keys = layer.resolvedPoseKeys;
    if (tRel <= keys[0].t) {
      joints = resolvePoseJoints(keys[0].pose);
    } else if (tRel >= keys[keys.length - 1].t) {
      joints = resolvePoseJoints(keys[keys.length - 1].pose);
    } else {
      for (let i = 0; i < keys.length - 1; i++) {
        const k0 = keys[i];
        const k1 = keys[i + 1];
        if (tRel >= k0.t && tRel <= k1.t) {
          const span = Math.max(1e-4, k1.t - k0.t);
          const u = clamp((tRel - k0.t) / span, 0, 1);
          const f = ease(k1.e || 'outBack', u);
          joints = interpolateJoints(resolvePoseJoints(k0.pose), resolvePoseJoints(k1.pose), f);
          break;
        }
      }
    }
  }

  // Add subtle procedural cyclic motion for walk / run poses
  const activePoseName = typeof layer.pose === 'string' ? layer.pose : undefined;
  if (activePoseName === 'walk' || activePoseName === 'run') {
    const swing = Math.sin(tRel * (activePoseName === 'run' ? 14 : 8));
    joints = {
      ...joints,
      armR: joints.armR * swing,
      armL: joints.armL * swing,
      legR: joints.legR * swing,
      legL: joints.legL * swing,
    };
  }

  const color = resolveColorToken(layer.color || '@ink', tokens);
  const thickness = typeof layer.thickness === 'number' ? layer.thickness : Math.max(6, Math.min(w, h) * 0.035);
  const scale = h / 320;

  const hipY = 30 * scale;
  const torsoLen = 100 * scale;
  const armLen = 78 * scale;
  const legLen = 105 * scale;
  const headR = 28 * scale;

  const torsoRad = ((joints.torso - 90) * Math.PI) / 180;
  const shoulderX = Math.cos(torsoRad) * torsoLen;
  const shoulderY = hipY + Math.sin(torsoRad) * torsoLen;

  const headRad = ((joints.torso + joints.head - 90) * Math.PI) / 180;
  const headX = shoulderX + Math.cos(headRad) * (headR + 10 * scale);
  const headY = shoulderY + Math.sin(headRad) * (headR + 10 * scale);

  const shoulderOffset = 14 * scale;
  const hipOffset = 9 * scale;

  const shoulderRX = shoulderX + shoulderOffset;
  const shoulderRY = shoulderY;
  const shoulderLX = shoulderX - shoulderOffset;
  const shoulderLY = shoulderY;

  const armRRad = ((joints.armR + 90) * Math.PI) / 180;
  const handRX = shoulderRX + Math.cos(armRRad) * armLen;
  const handRY = shoulderRY + Math.sin(armRRad) * armLen;

  const armLRad = ((joints.armL + 90) * Math.PI) / 180;
  const handLX = shoulderLX + Math.cos(armLRad) * armLen;
  const handLY = shoulderLY + Math.sin(armLRad) * armLen;

  const legRRad = ((joints.legR + 90) * Math.PI) / 180;
  const footRX = hipOffset + Math.cos(legRRad) * legLen;
  const footRY = hipY + Math.sin(legRRad) * legLen;

  const legLRad = ((joints.legL + 90) * Math.PI) / 180;
  const footLX = -hipOffset + Math.cos(legLRad) * legLen;
  const footLY = hipY + Math.sin(legLRad) * legLen;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Head
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.stroke();

  // Torso, collarbone, pelvis, arms, legs
  ctx.beginPath();
  ctx.moveTo(0, hipY);
  ctx.lineTo(shoulderX, shoulderY);
  ctx.moveTo(shoulderLX, shoulderLY);
  ctx.lineTo(shoulderRX, shoulderRY);
  ctx.moveTo(shoulderRX, shoulderRY);
  ctx.lineTo(handRX, handRY);
  ctx.moveTo(shoulderLX, shoulderLY);
  ctx.lineTo(handLX, handLY);
  ctx.moveTo(-hipOffset, hipY);
  ctx.lineTo(hipOffset, hipY);
  ctx.moveTo(hipOffset, hipY);
  ctx.lineTo(footRX, footRY);
  ctx.moveTo(-hipOffset, hipY);
  ctx.lineTo(footLX, footLY);
  ctx.stroke();

  ctx.restore();
}
