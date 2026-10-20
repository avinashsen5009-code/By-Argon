import { clamp, ease } from '../core/ease.ts';
import { resolveColorToken } from '../core/palette.ts';
import { poseRegistry } from '../core/registry.ts';
import type { CompiledLayer, FigureJoints, ThemeTokens } from '../core/types.ts';
import type { Any2DContext } from './background.ts';
import { getLoadedImageAsset } from './sprites.ts';

/**
 * Shortest-arc degree interpolation in [-180, 180] (M8).
 */
export function lerpAngleShortestArc(aDeg: number, bDeg: number, f: number): number {
  let diff = ((bDeg - aDeg + 180) % 360 + 360) % 360 - 180;
  if (diff < -180) diff += 360;
  return aDeg + diff * f;
}

function resolvePoseJoints(pose: string | { joints: FigureJoints } | undefined): Required<FigureJoints> {
  const def: Required<FigureJoints> = {
    armR: 15,
    armL: -15,
    elbowR: 12,
    elbowL: -12,
    legR: 8,
    legL: -8,
    kneeR: 4,
    kneeL: -4,
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
    armR: lerpAngleShortestArc(a.armR, b.armR, f),
    armL: lerpAngleShortestArc(a.armL, b.armL, f),
    elbowR: lerpAngleShortestArc(a.elbowR, b.elbowR, f),
    elbowL: lerpAngleShortestArc(a.elbowL, b.elbowL, f),
    legR: lerpAngleShortestArc(a.legR, b.legR, f),
    legL: lerpAngleShortestArc(a.legL, b.legL, f),
    kneeR: lerpAngleShortestArc(a.kneeR, b.kneeR, f),
    kneeL: lerpAngleShortestArc(a.kneeL, b.kneeL, f),
    torso: lerpAngleShortestArc(a.torso, b.torso, f),
    head: lerpAngleShortestArc(a.head, b.head, f),
  };
}

/**
 * Renders the SPEC 2D articulated skeleton `figure` layer (`pelvis`, `torso`, `head`,
 * `upper/lower arm L/R`, `upper/lower leg L/R`), shortest-arc `poseKeys` interpolation,
 * `walk`/`run` phase loops, custom `joints` override, and hand `props` attachment (M8).
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

  // Phase loops for walk / run poses
  const activePoseName = typeof layer.pose === 'string' ? layer.pose : undefined;
  if (activePoseName === 'walk' || activePoseName === 'run') {
    const phase = tRel * (activePoseName === 'run' ? 14 : 8);
    const swing = Math.sin(phase);
    const kneeFlex = Math.max(0, Math.cos(phase)) * (activePoseName === 'run' ? 38 : 22);
    joints = {
      ...joints,
      armR: joints.armR * swing,
      armL: joints.armL * swing,
      elbowR: -Math.abs(joints.armR) * 0.35,
      elbowL: -Math.abs(joints.armL) * 0.35,
      legR: joints.legR * swing,
      legL: joints.legL * swing,
      kneeR: kneeFlex,
      kneeL: Math.max(0, -Math.cos(phase)) * (activePoseName === 'run' ? 38 : 22),
    };
  }

  // Custom joints override
  if (layer.joints && typeof layer.joints === 'object') {
    joints = { ...joints, ...(layer.joints as Partial<FigureJoints>) };
  }

  const color = resolveColorToken(layer.color || '@ink', tokens);
  const thickness = typeof layer.thickness === 'number' ? layer.thickness : Math.max(6, Math.min(w, h) * 0.035);
  const scale = h / 320;

  const hipY = 28 * scale;
  const torsoLen = 96 * scale;
  const upperArmLen = 42 * scale;
  const lowerArmLen = 38 * scale;
  const upperLegLen = 54 * scale;
  const lowerLegLen = 52 * scale;
  const headR = 27 * scale;

  const torsoRad = ((joints.torso - 90) * Math.PI) / 180;
  const shoulderX = Math.cos(torsoRad) * torsoLen;
  const shoulderY = hipY + Math.sin(torsoRad) * torsoLen;

  const headRad = ((joints.torso + joints.head - 90) * Math.PI) / 180;
  const headX = shoulderX + Math.cos(headRad) * (headR + 10 * scale);
  const headY = shoulderY + Math.sin(headRad) * (headR + 10 * scale);

  const shoulderOffset = 14 * scale;
  const hipOffset = 10 * scale;

  const shoulderRX = shoulderX + shoulderOffset;
  const shoulderRY = shoulderY;
  const shoulderLX = shoulderX - shoulderOffset;
  const shoulderLY = shoulderY;

  // Upper + Lower Arm R
  const upperArmRRad = ((joints.armR + 90) * Math.PI) / 180;
  const elbowRX = shoulderRX + Math.cos(upperArmRRad) * upperArmLen;
  const elbowRY = shoulderRY + Math.sin(upperArmRRad) * upperArmLen;
  const lowerArmRRad = ((joints.armR + joints.elbowR + 90) * Math.PI) / 180;
  const handRX = elbowRX + Math.cos(lowerArmRRad) * lowerArmLen;
  const handRY = elbowRY + Math.sin(lowerArmRRad) * lowerArmLen;

  // Upper + Lower Arm L
  const upperArmLRad = ((joints.armL + 90) * Math.PI) / 180;
  const elbowLX = shoulderLX + Math.cos(upperArmLRad) * upperArmLen;
  const elbowLY = shoulderLY + Math.sin(upperArmLRad) * upperArmLen;
  const lowerArmLRad = ((joints.armL + joints.elbowL + 90) * Math.PI) / 180;
  const handLX = elbowLX + Math.cos(lowerArmLRad) * lowerArmLen;
  const handLY = elbowLY + Math.sin(lowerArmLRad) * lowerArmLen;

  // Upper + Lower Leg R
  const upperLegRRad = ((joints.legR + 90) * Math.PI) / 180;
  const kneeRX = hipOffset + Math.cos(upperLegRRad) * upperLegLen;
  const kneeRY = hipY + Math.sin(upperLegRRad) * upperLegLen;
  const lowerLegRRad = ((joints.legR + joints.kneeR + 90) * Math.PI) / 180;
  const footRX = kneeRX + Math.cos(lowerLegRRad) * lowerLegLen;
  const footRY = kneeRY + Math.sin(lowerLegRRad) * lowerLegLen;

  // Upper + Lower Leg L
  const upperLegLRad = ((joints.legL + 90) * Math.PI) / 180;
  const kneeLX = -hipOffset + Math.cos(upperLegLRad) * upperLegLen;
  const kneeLY = hipY + Math.sin(upperLegLRad) * upperLegLen;
  const lowerLegLRad = ((joints.legL + joints.kneeL + 90) * Math.PI) / 180;
  const footLX = kneeLX + Math.cos(lowerLegLRad) * lowerLegLen;
  const footLY = kneeLY + Math.sin(lowerLegLRad) * lowerLegLen;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Head
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.stroke();

  // Pelvis, Torso, Collarbone, Upper/Lower Arms, Upper/Lower Legs
  ctx.beginPath();
  ctx.moveTo(0, hipY);
  ctx.lineTo(shoulderX, shoulderY);
  ctx.moveTo(shoulderLX, shoulderLY);
  ctx.lineTo(shoulderRX, shoulderRY);
  // Right arm (upper -> elbow -> hand)
  ctx.moveTo(shoulderRX, shoulderRY);
  ctx.lineTo(elbowRX, elbowRY);
  ctx.lineTo(handRX, handRY);
  // Left arm (upper -> elbow -> hand)
  ctx.moveTo(shoulderLX, shoulderLY);
  ctx.lineTo(elbowLX, elbowLY);
  ctx.lineTo(handLX, handLY);
  // Pelvis bar
  ctx.moveTo(-hipOffset, hipY);
  ctx.lineTo(hipOffset, hipY);
  // Right leg (hip -> knee -> foot)
  ctx.moveTo(hipOffset, hipY);
  ctx.lineTo(kneeRX, kneeRY);
  ctx.lineTo(footRX, footRY);
  // Left leg (hip -> knee -> foot)
  ctx.moveTo(-hipOffset, hipY);
  ctx.lineTo(kneeLX, kneeLY);
  ctx.lineTo(footLX, footLY);
  ctx.stroke();

  // Hand props attachment (M8)
  const propsList = Array.isArray(layer.props)
    ? layer.props
    : layer.prop && typeof layer.prop === 'object'
    ? [layer.prop]
    : [];

  for (const propItem of propsList) {
    const hand = propItem.hand === 'L' ? 'L' : 'R';
    const hx = hand === 'L' ? handLX : handRX;
    const hy = hand === 'L' ? handLY : handRY;
    const propAssetId = propItem.hold || propItem.asset;
    const img = propAssetId ? getLoadedImageAsset(propAssetId) : undefined;
    const pSize = 36 * scale;
    ctx.save();
    ctx.translate(hx, hy);
    if (img) {
      ctx.drawImage(img, -pSize * 0.5, -pSize * 0.5, pSize, pSize);
    } else if (propAssetId) {
      ctx.fillStyle = tokens.acc;
      ctx.beginPath();
      ctx.arc(0, 0, pSize * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.restore();
}
