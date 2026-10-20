import { clamp } from '../core/ease.ts';
import { type ExprContext, evaluateExpression } from '../core/expr.ts';
import {
  evaluateColorTrack,
  evaluateEmphasisLoop,
  evaluateEnterPreset,
  evaluateExitPreset,
  evaluateNumericTrack,
  parseKeyframeTrack,
} from '../core/keyframes.ts';
import { getAnchorOffsetFactors, resolveSizePx } from '../core/layout.ts';
import { ENTRANCE_MACROS, evaluateLayerMotions } from '../core/macros.ts';
import { queryActiveLayersAtTime } from '../core/time.ts';
import type { CompiledLayer, CompiledRecipe } from '../core/types.ts';
import { type Any2DContext, drawBackgroundLayer, drawBaseSceneBackground } from './background.ts';
import { applyCameraToContext, evaluateCamera } from './camera.ts';
import { drawChartLayer } from './charts.ts';
import { drawCodeLayer } from './codeLayer.ts';
import { drawFigureLayer } from './figure.ts';
import {
  applyPostDrawLayerFx,
  applyPreDrawLayerFx,
  drawGlobalFx,
  isHeadlessSoftwareRenderer,
} from './fx.ts';
import { drawIconLayer } from './icons.ts';
import { drawParticlesLayer } from './particles.ts';
import { drawPathOrSvgLayer, morphSvgPathStrings } from './paths.ts';
import { drawBurstRing, drawShapeLayer } from './shapes.ts';
import { drawImageOrVideoLayer } from './sprites.ts';
import { drawCaptionsLayer, drawHighlightLayer, drawTextLayer } from './text.ts';
import { applySceneTransitionTransform, drawTransitionOverlays } from './transitions.ts';

export interface RenderFrameOptions {
  showSafeArea?: boolean;
  showLayoutGrid?: boolean;
  fastPreview?: boolean;
}

interface EvaluatedLayerTransform {
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
  scaleX: number;
  scaleY: number;
  rotDeg: number;
  opacity: number;
  blurPx: number;
  glowVal: number;
  shadowVal: number;
  strokeWidthPx: number;
  radiusPx: number;
  sizePx: number;
  trimStart: number;
  trimEnd: number;
  dString: string;
  colorOverride?: string;
  textPresetType?: string;
  textPresetProgress?: number;
  burstRings: ReturnType<typeof evaluateLayerMotions>['burstRings'];
}

function evalNumProp(
  propVal: any,
  animKeys: ReturnType<typeof parseKeyframeTrack> | undefined,
  tRel: number,
  exprCtx: ExprContext,
  fallback: number
): number {
  let base = fallback;
  if (typeof propVal === 'number') {
    base = propVal;
  } else if (propVal && typeof propVal === 'object' && typeof propVal.expr === 'string') {
    base = evaluateExpression(propVal.expr, exprCtx);
  }
  if (animKeys && animKeys.length > 0) {
    return evaluateNumericTrack(animKeys, tRel, base);
  }
  return base;
}

function evaluateLayerAtTime(
  layer: CompiledLayer,
  tGlobal: number,
  canvasW: number,
  canvasH: number,
  tokens: CompiledRecipe['tokens']
): EvaluatedLayerTransform {
  const refW = layer.groupBox ? layer.groupBox.w : canvasW;
  const refH = layer.groupBox ? layer.groupBox.h : canvasH;
  const tRel = Math.max(0, tGlobal - layer.t0);
  const dur = Math.max(1e-4, layer.t1 - layer.t0);
  const p = clamp(tRel / dur, 0, 1);
  const tRemaining = Math.max(0, layer.t1 - tGlobal);

  const exprCtx: ExprContext = {
    t: tRel,
    p,
    T: tGlobal,
    d: dur,
    i: layer.staggerIndex ?? 0,
    n: layer.staggerTotal ?? 1,
    w: refW,
    h: refH,
    seed: layer.numericSeed,
  };

  const anim = layer.anim || {};
  const xKeys = anim.x ? parseKeyframeTrack(anim.x) : undefined;
  const yKeys = anim.y ? parseKeyframeTrack(anim.y) : undefined;
  const scaleKeys = anim.scale ? parseKeyframeTrack(anim.scale) : undefined;
  const scaleXKeys = anim.scaleX ? parseKeyframeTrack(anim.scaleX) : undefined;
  const scaleYKeys = anim.scaleY ? parseKeyframeTrack(anim.scaleY) : undefined;
  const rotKeys = anim.rot ? parseKeyframeTrack(anim.rot) : undefined;
  const opKeys = anim.opacity ? parseKeyframeTrack(anim.opacity) : undefined;
  const blurKeys = anim.blur ? parseKeyframeTrack(anim.blur) : undefined;
  const wKeys = anim.w ? parseKeyframeTrack(anim.w) : undefined;
  const hKeys = anim.h ? parseKeyframeTrack(anim.h) : undefined;
  const radiusKeys = anim.radius ? parseKeyframeTrack(anim.radius) : undefined;
  const swKeys = anim.strokeWidth ? parseKeyframeTrack(anim.strokeWidth) : undefined;
  const glowKeys = anim.glow ? parseKeyframeTrack(anim.glow) : undefined;
  const trimStartKeys = anim.trimStart ? parseKeyframeTrack(anim.trimStart) : undefined;
  const trimEndKeys = anim.trimEnd ? parseKeyframeTrack(anim.trimEnd) : undefined;
  const colorKeys = anim.color ? parseKeyframeTrack(anim.color) : undefined;

  let xFrac = evalNumProp(layer.x, xKeys, tRel, exprCtx, 0.5);
  let yFrac = evalNumProp(layer.y, yKeys, tRel, exprCtx, 0.5);
  const baseScale = evalNumProp(layer.scale, scaleKeys, tRel, exprCtx, 1);
  let scaleX = evalNumProp(layer.scaleX, scaleXKeys, tRel, exprCtx, baseScale);
  let scaleY = evalNumProp(layer.scaleY, scaleYKeys, tRel, exprCtx, baseScale);
  let rotDeg = evalNumProp(layer.rot, rotKeys, tRel, exprCtx, 0);
  let opacity = evalNumProp(layer.opacity, opKeys, tRel, exprCtx, 1);
  let blurPx = evalNumProp(layer.blur, blurKeys, tRel, exprCtx, 0);
  const glowVal = evalNumProp(layer.glow, glowKeys, tRel, exprCtx, 0);
  const shadowVal = evalNumProp(layer.shadow, undefined, tRel, exprCtx, 0);
  const sizePx = evalNumProp(layer.size, undefined, tRel, exprCtx, 48);

  const defaultW =
    layer.type === 'text'
      ? refW * 0.65
      : layer.type === 'icon'
      ? 64
      : layer.type === 'figure'
      ? 220
      : 260;
  const defaultH =
    layer.type === 'shape' && (layer.kind === 'ellipse' || layer.kind === 'ring' || layer.kind === 'chevron' || layer.kind === 'plus' || layer.kind === 'check')
      ? resolveSizePx(layer.w, refW, defaultW)
      : layer.type === 'icon'
      ? resolveSizePx(layer.w, refW, 64)
      : layer.type === 'figure'
      ? 340
      : 160;

  let wPx = wKeys && wKeys.length > 0
    ? evaluateNumericTrack(wKeys, tRel, resolveSizePx(layer.w, refW, defaultW))
    : resolveSizePx(layer.w, refW, defaultW);
  let hPx = hKeys && hKeys.length > 0
    ? evaluateNumericTrack(hKeys, tRel, resolveSizePx(layer.h, refH, defaultH))
    : resolveSizePx(layer.h, refH, defaultH);

  const strokeWidthPx = evalNumProp(layer.strokeWidth, swKeys, tRel, exprCtx, layer.stroke ? 3 : 0);
  const radiusPx = evalNumProp(layer.radius, radiusKeys, tRel, exprCtx, 0);
  const trimStart = evalNumProp(layer.trimStart, trimStartKeys, tRel, exprCtx, 0);
  const trimEnd = evalNumProp(layer.trimEnd, trimEndKeys, tRel, exprCtx, 1);

  let dString = layer.d || '';
  if (anim.d) {
    const dKeys = parseKeyframeTrack(anim.d);
    if (dKeys.length >= 2) {
      for (let i = 0; i < dKeys.length - 1; i++) {
        if (tRel >= dKeys[i].t && tRel <= dKeys[i + 1].t) {
          const u = clamp((tRel - dKeys[i].t) / Math.max(1e-4, dKeys[i + 1].t - dKeys[i].t), 0, 1);
          dString = morphSvgPathStrings(String(dKeys[i].v), String(dKeys[i + 1].v), u).d;
          break;
        }
      }
    }
  }

  const colorOverride =
    colorKeys && colorKeys.length > 0
      ? evaluateColorTrack(colorKeys, tRel, tokens, String(layer.color || tokens.ink))
      : undefined;

  // Evaluate motion macros
  const hasEntranceMacro = layer.resolvedMotions.some((m) => ENTRANCE_MACROS.has(m.m));
  const motionDelta = evaluateLayerMotions(layer, tGlobal, refW, refH);
  if (motionDelta.absX !== undefined) xFrac = motionDelta.absX;
  else xFrac += motionDelta.dx;
  if (motionDelta.absY !== undefined) yFrac = motionDelta.absY;
  else yFrac += motionDelta.dy;

  scaleX *= motionDelta.scaleMult;
  scaleY *= motionDelta.scaleMult;
  rotDeg += motionDelta.rotDelta;
  opacity *= motionDelta.opacityMult;
  if (motionDelta.wOverride !== undefined) wPx = motionDelta.wOverride;
  if (motionDelta.hOverride !== undefined) hPx = motionDelta.hOverride;

  // Evaluate enter, exit, and emphasis presets
  const enterDelta = evaluateEnterPreset(layer.enter, hasEntranceMacro, tRel, refW, refH);
  const exitDelta = evaluateExitPreset(layer.exit, tRemaining, refW, refH);
  const emphDelta = evaluateEmphasisLoop(layer.emph, tRel, refW, refH);

  xFrac += enterDelta.dx + exitDelta.dx + emphDelta.dx;
  yFrac += enterDelta.dy + exitDelta.dy + emphDelta.dy;
  scaleX *= enterDelta.scaleMult * exitDelta.scaleMult * emphDelta.scaleMult;
  scaleY *= enterDelta.scaleMult * exitDelta.scaleMult * emphDelta.scaleMult;
  rotDeg += enterDelta.rotDelta + exitDelta.rotDelta + emphDelta.rotDelta;
  opacity = clamp(opacity * enterDelta.opacityMult * exitDelta.opacityMult * emphDelta.opacityMult, 0, 1);
  blurPx += enterDelta.blurAdd + exitDelta.blurAdd;

  return {
    xPx: xFrac * refW,
    yPx: yFrac * refH,
    wPx,
    hPx,
    scaleX,
    scaleY,
    rotDeg,
    opacity,
    blurPx,
    glowVal,
    shadowVal,
    strokeWidthPx,
    radiusPx,
    sizePx,
    trimStart,
    trimEnd,
    dString,
    colorOverride,
    textPresetType: enterDelta.textPresetType,
    textPresetProgress: enterDelta.textProgress,
    burstRings: motionDelta.burstRings,
  };
}

/**
 * Pure, deterministic frame renderer for RECIPE v3.1.
 * Same CompiledRecipe + same timestamp `t` -> identical pixels.
 */
export function renderFrame(
  ctx: Any2DContext,
  compiled: CompiledRecipe,
  t: number,
  options: RenderFrameOptions = {}
): void {
  const W = compiled.w;
  const H = compiled.h;
  const clampedT = clamp(t, 0, compiled.duration);
  const fastMode = options.fastPreview ?? isHeadlessSoftwareRenderer();

  ctx.save();
  ctx.clearRect(0, 0, W, H);

  // 1. Base scene background
  drawBaseSceneBackground(ctx, compiled.tokens, W, H);

  // 2. Find active scene for transition transform
  const activeScene = compiled.scenes.find((s) => clampedT >= s.t0 && clampedT <= s.t1);
  ctx.save();
  const transitionOverlays = applySceneTransitionTransform(ctx, activeScene, clampedT, W, H);

  // 3. Evaluate camera at t
  const cam = evaluateCamera(compiled, clampedT);

  // 4. Query active layers at t (sorted by zIndex then declaration order)
  const activeLayers = queryActiveLayersAtTime(compiled.intervalSorted, clampedT, compiled.duration);

  // Pre-evaluate group and parent transforms so children inherit them cleanly
  const evaluatedCache = new Map<string, EvaluatedLayerTransform>();
  const getEvaluated = (l: CompiledLayer): EvaluatedLayerTransform => {
    let ev = evaluatedCache.get(l.id);
    if (!ev) {
      ev = evaluateLayerAtTime(l, clampedT, W, H, compiled.tokens);
      evaluatedCache.set(l.id, ev);
    }
    return ev;
  };

  for (const layer of activeLayers) {
    if (layer.type === 'group') continue; // Group container transforms are applied to its children

    if (layer.type === 'background') {
      const ev = getEvaluated(layer);
      if (ev.opacity > 0.01) {
        drawBackgroundLayer(ctx, layer, clampedT, compiled.tokens, W, H, ev.opacity);
      }
      continue;
    }

    if (layer.type === 'captions') {
      drawCaptionsLayer(ctx, layer, compiled.transcript, clampedT, compiled.tokens, W, H);
      continue;
    }

    const ev = getEvaluated(layer);
    if (ev.opacity <= 0.005) continue;

    ctx.save();

    // Camera parallax transform
    applyCameraToContext(ctx, cam, layer.depth ?? 1, W, H);

    // Group box transform if inside a group
    let inheritedOpacity = 1;
    if (layer.groupId) {
      const groupLayer = compiled.layersById.get(layer.groupId);
      if (groupLayer) {
        const gEv = getEvaluated(groupLayer);
        inheritedOpacity *= gEv.opacity;
        ctx.translate(gEv.xPx, gEv.yPx);
        if (Math.abs(gEv.rotDeg) > 1e-4) {
          ctx.rotate((gEv.rotDeg * Math.PI) / 180);
        }
        ctx.scale(gEv.scaleX, gEv.scaleY);
        ctx.translate(-gEv.wPx * 0.5, -gEv.hPx * 0.5);
        if (groupLayer.clip) {
          ctx.beginPath();
          ctx.rect(0, 0, gEv.wPx, gEv.hPx);
          ctx.clip();
        }
      }
    }

    // Parent transform inheritance (inherits parent's animated offset, scale about parent's rest center, rotation, opacity)
    if (layer.parent) {
      const parentLayer = compiled.layersById.get(layer.parent);
      if (parentLayer) {
        const pEv = getEvaluated(parentLayer);
        const pRefW = parentLayer.groupBox ? parentLayer.groupBox.w : W;
        const pRefH = parentLayer.groupBox ? parentLayer.groupBox.h : H;
        const pRestX = (typeof parentLayer.x === 'number' ? parentLayer.x : 0.5) * pRefW;
        const pRestY = (typeof parentLayer.y === 'number' ? parentLayer.y : 0.5) * pRefH;

        inheritedOpacity *= pEv.opacity;
        ctx.translate(pEv.xPx, pEv.yPx);
        if (Math.abs(pEv.rotDeg) > 1e-4) {
          ctx.rotate((pEv.rotDeg * Math.PI) / 180);
        }
        ctx.scale(pEv.scaleX, pEv.scaleY);
        ctx.translate(-pRestX, -pRestY);
      }
    }

    const finalOpacity = clamp(ev.opacity * inheritedOpacity, 0, 1);
    if (finalOpacity <= 0.005) {
      ctx.restore();
      continue;
    }

    ctx.globalAlpha = finalOpacity;
    if (layer.blend && layer.blend !== 'normal') {
      ctx.globalCompositeOperation =
        layer.blend === 'add' ? 'lighter' : (layer.blend as GlobalCompositeOperation);
    }

    // Highlight layer positions itself directly on its target text layer
    if (layer.type === 'highlight') {
      const targetLayer = layer.target ? compiled.layersById.get(layer.target) : undefined;
      if (targetLayer) {
        const tRefW = targetLayer.groupBox ? targetLayer.groupBox.w : W;
        const tRefH = targetLayer.groupBox ? targetLayer.groupBox.h : H;
        const tx = (typeof targetLayer.x === 'number' ? targetLayer.x : 0.5) * tRefW;
        const ty = (typeof targetLayer.y === 'number' ? targetLayer.y : 0.5) * tRefH;
        ctx.translate(tx, ty);
        drawHighlightLayer(ctx, layer, targetLayer, clampedT, compiled.tokens, W);
      }
      ctx.restore();
      continue;
    }

    // Own anchor pivot transform
    const [ax, ay] = getAnchorOffsetFactors(layer.anchor);
    ctx.translate(ev.xPx, ev.yPx);
    if (Math.abs(ev.rotDeg) > 1e-4) {
      ctx.rotate((ev.rotDeg * Math.PI) / 180);
    }
    ctx.scale(ev.scaleX, ev.scaleY);
    // Shift from anchor pivot to local center (0,0)
    ctx.translate((0.5 - ax) * ev.wPx, (0.5 - ay) * ev.hPx);

    const tRel = Math.max(0, clampedT - layer.t0);
    const dur = Math.max(1e-4, layer.t1 - layer.t0);
    const p = clamp(tRel / dur, 0, 1);

    applyPreDrawLayerFx(
      ctx,
      layer,
      ev.glowVal,
      ev.shadowVal,
      ev.blurPx,
      tRel,
      compiled.tokens,
      fastMode
    );

    const layerWithColor = ev.colorOverride ? { ...layer, color: ev.colorOverride } : layer;

    switch (layer.type) {
      case 'shape':
        drawShapeLayer(
          ctx,
          layerWithColor,
          ev.wPx,
          ev.hPx,
          ev.radiusPx,
          ev.strokeWidthPx,
          compiled.tokens,
          tRel
        );
        break;
      case 'text':
        drawTextLayer(
          ctx,
          layerWithColor,
          ev.wPx,
          ev.sizePx,
          compiled.tokens,
          tRel,
          ev.textPresetType,
          ev.textPresetProgress
        );
        break;
      case 'icon':
        drawIconLayer(ctx, layerWithColor, ev.wPx, compiled.tokens);
        break;
      case 'path':
      case 'svg':
        drawPathOrSvgLayer(
          ctx,
          layerWithColor,
          ev.dString,
          ev.wPx,
          ev.hPx,
          ev.strokeWidthPx,
          ev.trimStart,
          ev.trimEnd,
          compiled.tokens
        );
        break;
      case 'chart':
        drawChartLayer(ctx, layerWithColor, ev.wPx, ev.hPx, clampedT, tRel, compiled.tokens);
        break;
      case 'figure':
        drawFigureLayer(ctx, layerWithColor, ev.wPx, ev.hPx, tRel, compiled.tokens);
        break;
      case 'particles':
        drawParticlesLayer(ctx, layerWithColor, ev.wPx, ev.hPx, tRel, compiled.tokens);
        break;
      case 'image':
      case 'video':
        drawImageOrVideoLayer(
          ctx,
          layerWithColor,
          layer.asset ? compiled.assets.get(layer.asset) : undefined,
          ev.wPx,
          ev.hPx,
          p,
          compiled.tokens
        );
        break;
      case 'code':
        drawCodeLayer(ctx, layerWithColor, tRel, p, ev.wPx, ev.hPx, compiled.tokens);
        break;
    }

    applyPostDrawLayerFx(ctx, layer, ev.wPx, ev.hPx, compiled.tokens);

    // Draw any active burst rings attached to this layer (clamped to safe area)
    if (ev.burstRings.length > 0) {
      const maxSafeRadius = Math.min(W, H) * 0.46;
      for (const ring of ev.burstRings) {
        drawBurstRing(ctx, ring, compiled.tokens, maxSafeRadius);
      }
    }

    ctx.restore();
  }

  ctx.restore(); // end scene transition transform

  // 5. Transition flash / fade overlays
  drawTransitionOverlays(ctx, transitionOverlays, compiled.tokens, W, H);

  // 6. Global vignette & FX
  drawGlobalFx(ctx, compiled.global, W, H);

  // 7. Optional Safe-Area & Layout Grid guides for preview inspection
  if (options.showLayoutGrid) {
    drawLayoutGridOverlay(ctx, W, H);
  }
  if (options.showSafeArea) {
    drawSafeAreaOverlay(ctx, W, H);
  }

  ctx.restore();
}

function drawSafeAreaOverlay(ctx: Any2DContext, w: number, h: number): void {
  ctx.save();
  const mx = w * 0.025;
  const my = h * 0.025;
  ctx.strokeStyle = 'rgba(46, 229, 157, 0.7)';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(mx, my, w - mx * 2, h - my * 2);
  ctx.restore();
}

function drawLayoutGridOverlay(ctx: Any2DContext, w: number, h: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  // Center crosshairs + Title zone (y 0.12-0.21) + Bottom pill zone (y 0.80-0.91)
  ctx.beginPath();
  ctx.moveTo(w * 0.5, 0);
  ctx.lineTo(w * 0.5, h);
  ctx.moveTo(0, h * 0.518);
  ctx.lineTo(w, h * 0.518);
  ctx.strokeRect(w * 0.08, h * 0.12, w * 0.84, h * 0.095);
  ctx.strokeRect(w * 0.2, h * 0.8, w * 0.6, h * 0.1);
  ctx.stroke();
  ctx.restore();
}
