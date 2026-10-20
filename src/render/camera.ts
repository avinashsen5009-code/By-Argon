import { clamp, ease, lerp, seededWiggle } from '../core/ease.ts';
import type { CompiledCameraKey, CompiledRecipe } from '../core/types.ts';

export interface EvaluatedCamera {
  x: number;
  y: number;
  zoom: number;
  rot: number;
}

/**
 * Pure evaluation of camera state at global time t.
 * Supports keyframe interpolation (`x`, `y`, `zoom`, `rot`, `shake`, `e`) and `follow` layer tracking.
 */
export function evaluateCamera(compiled: CompiledRecipe, t: number): EvaluatedCamera {
  const keys: CompiledCameraKey[] = compiled.camera;
  if (!keys || keys.length === 0) {
    return { x: 0.5, y: 0.5, zoom: 1.0, rot: 0 };
  }

  let x = keys[0].x;
  let y = keys[0].y;
  let zoom = keys[0].zoom;
  let rot = keys[0].rot;
  let shake = keys[0].shake;
  let followId = keys[0].follow;
  let lag = keys[0].lag ?? 0.2;

  if (t <= keys[0].t) {
    // Before or at first key
  } else if (t >= keys[keys.length - 1].t) {
    const last = keys[keys.length - 1];
    x = last.x;
    y = last.y;
    zoom = last.zoom;
    rot = last.rot;
    shake = last.shake;
    followId = last.follow;
    lag = last.lag ?? 0.2;
  } else {
    for (let i = 0; i < keys.length - 1; i++) {
      const k0 = keys[i];
      const k1 = keys[i + 1];
      if (t >= k0.t && t <= k1.t) {
        const span = Math.max(1e-6, k1.t - k0.t);
        const u = clamp((t - k0.t) / span, 0, 1);
        const f = ease(k1.e || 'inOutSine', u);
        x = lerp(k0.x, k1.x, f);
        y = lerp(k0.y, k1.y, f);
        zoom = lerp(k0.zoom, k1.zoom, f);
        rot = lerp(k0.rot, k1.rot, f);
        shake = lerp(k0.shake, k1.shake, f);
        followId = k1.follow ?? k0.follow;
        lag = k1.lag ?? k0.lag ?? 0.2;
        break;
      }
    }
  }

  if (followId) {
    const target = compiled.layersById.get(followId);
    if (target) {
      const tx = typeof target.x === 'number' ? target.x : 0.5;
      const ty = typeof target.y === 'number' ? target.y : 0.5;
      const alpha = clamp(1 / (1 + lag * 5), 0.1, 1);
      x = lerp(0.5, tx, alpha);
      y = lerp(0.5, ty, alpha);
    }
  }

  if (shake > 0) {
    x += seededWiggle(t, 18, shake * 0.015, 777);
    y += seededWiggle(t + 9.3, 18, shake * 0.015, 888);
  }

  return { x, y, zoom, rot };
}

/**
 * Applies camera transform scaled by layer `depth` (0-1, default 1) to a 2D canvas context.
 * SPEC Section 9: a point at x lands at 0.5 + (x - cam_x) * zoom (for depth = 1).
 */
export function applyCameraToContext(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cam: EvaluatedCamera,
  depth: number,
  canvasW: number,
  canvasH: number
): void {
  const d = clamp(depth ?? 1, 0, 1);
  const effZoom = lerp(1, cam.zoom, d);
  const effCamX = lerp(0.5, cam.x, d) * canvasW;
  const effCamY = lerp(0.5, cam.y, d) * canvasH;
  const effRot = ((cam.rot * d) * Math.PI) / 180;

  ctx.translate(canvasW * 0.5, canvasH * 0.5);
  if (Math.abs(effRot) > 1e-5) {
    ctx.rotate(effRot);
  }
  ctx.scale(effZoom, effZoom);
  ctx.translate(-effCamX, -effCamY);
}
