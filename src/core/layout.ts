import { expandUseLayer } from './components/index.ts';
import { hashString } from './ease.ts';
import { expandThemeTokens } from './palette.ts';
import { applyStyleToLayer } from './styles.ts';
import { resolveTimeValue } from './time.ts';
import type {
  AnchorType,
  AssetDef,
  CompiledCameraKey,
  CompiledLayer,
  CompiledRecipe,
  CompiledScene,
  GroupLayout,
  Layer,
  LayerPatch,
  RecipeDocument,
  SizeProp,
  TranscriptData,
} from './types.ts';

export function resolveSizePx(
  val: SizeProp | undefined,
  refPx: number,
  fallbackPx: number
): number {
  if (val === undefined || val === null) return fallbackPx;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.endsWith('%')) {
      const pct = parseFloat(trimmed.slice(0, -1));
      return Number.isFinite(pct) ? (pct / 100) * refPx : fallbackPx;
    }
    const parsed = parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : fallbackPx;
  }
  return fallbackPx;
}

export function getAnchorOffsetFactors(anchor: AnchorType | undefined): [number, number] {
  switch (anchor) {
    case 'left':
      return [0, 0.5];
    case 'right':
      return [1, 0.5];
    case 'top':
      return [0.5, 0];
    case 'bottom':
      return [0.5, 1];
    case 'top-left':
      return [0, 0];
    case 'top-right':
      return [1, 0];
    case 'bottom-left':
      return [0, 1];
    case 'bottom-right':
      return [1, 1];
    case 'center':
    default:
      return [0.5, 0.5];
  }
}

/**
 * Auto-positions children inside a group according to `group.layout` (row | column | grid)
 * per SPEC Section 5.
 */
export function applyGroupLayout(
  children: Layer[],
  layout: GroupLayout | undefined,
  groupW: number,
  groupH: number
): Layer[] {
  if (!layout || children.length === 0) return children;
  const gap = layout.gap ?? 24;
  const n = children.length;

  if (layout.type === 'row') {
    const widths = children.map((c) => (typeof c.w === 'number' ? c.w : Math.min(260, (groupW - gap * (n - 1)) / n)));
    const totalW = widths.reduce((a, b) => a + b, 0) + gap * (n - 1);
    let curX = (groupW - totalW) * 0.5;
    return children.map((child, idx) => {
      const cw = widths[idx];
      const cx = (curX + cw * 0.5) / Math.max(1, groupW);
      curX += cw + gap;
      return {
        ...child,
        x: child.x ?? cx,
        y: child.y ?? 0.5,
      };
    });
  }

  if (layout.type === 'column') {
    const heights = children.map((c) => (typeof c.h === 'number' ? c.h : Math.min(110, (groupH - gap * (n - 1)) / n)));
    const totalH = heights.reduce((a, b) => a + b, 0) + gap * (n - 1);
    let curY = (groupH - totalH) * 0.5;
    return children.map((child, idx) => {
      const ch = heights[idx];
      const cy = (curY + ch * 0.5) / Math.max(1, groupH);
      curY += ch + gap;
      return {
        ...child,
        x: child.x ?? 0.5,
        y: child.y ?? cy,
      };
    });
  }

  if (layout.type === 'grid') {
    const cols = Math.max(1, layout.cols ?? 3);
    const rows = Math.ceil(n / cols);
    const cellW = (groupW - gap * (cols - 1)) / cols;
    const cellH = (groupH - gap * (rows - 1)) / rows;
    return children.map((child, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cx = (col * (cellW + gap) + cellW * 0.5) / Math.max(1, groupW);
      const cy = (row * (cellH + gap) + cellH * 0.5) / Math.max(1, groupH);
      return {
        ...child,
        x: child.x ?? cx,
        y: child.y ?? cy,
      };
    });
  }

  return children;
}

function isPatch(entry: Layer | LayerPatch): entry is LayerPatch {
  return 'patch' in entry && typeof (entry as any).patch === 'string';
}

/**
 * Compiles a RecipeDocument into an immutable, normal-form CompiledRecipe scene graph:
 * - Resolves anchors (`wN`, `sN`, offsets) to float64 seconds
 * - Expands `theme` into `@token` colors and expands `style` tokens on layers
 * - Expands `use` components (built-in and user `defs`) to plain layers
 * - Flattens `group` children with group-local box metadata and stagger offsets
 * - Applies `patch` entries from continuation parts
 * - Sorts layers by `z` then declaration order, plus builds `intervalSorted` (by `t0`)
 */
export function compileRecipe(
  doc: RecipeDocument,
  transcript?: TranscriptData
): CompiledRecipe {
  const w = doc.meta?.w ?? 1920;
  const h = doc.meta?.h ?? 1080;
  const fps = doc.meta?.fps ?? 60;
  const partFrom = doc.meta?.part?.from ?? 0;
  const partTo = doc.meta?.part?.to ?? doc.meta?.duration ?? 10;
  const duration = doc.meta?.duration ?? partTo;
  const lang = doc.meta?.lang ?? 'en';
  const tokens = expandThemeTokens(doc.theme);

  const assets = new Map<string, AssetDef>();
  for (const a of doc.assets || []) {
    assets.set(a.id, a);
  }

  const camera: CompiledCameraKey[] = (doc.camera || [])
    .map((ck) => ({
      t: resolveTimeValue(ck.t, transcript, 0).seconds,
      x: ck.x ?? 0.5,
      y: ck.y ?? 0.5,
      zoom: ck.zoom ?? 1.0,
      rot: ck.rot ?? 0,
      shake: ck.shake ?? 0,
      e: ck.e || 'inOutSine',
      follow: ck.follow,
      lag: ck.lag,
    }))
    .sort((a, b) => a.t - b.t);

  const compiledScenes: CompiledScene[] = [];
  const compiledLayers: CompiledLayer[] = [];
  const layersById = new Map<string, CompiledLayer>();
  const pendingPatches: LayerPatch[] = [];
  let orderCounter = 0;

  function processLayerList(
    rawLayers: (Layer | LayerPatch)[],
    sceneId: string,
    sceneT0: number,
    sceneT1: number,
    groupCtx?: {
      groupId: string;
      box: { x: number; y: number; w: number; h: number; clip?: boolean };
      stagger?: number;
    }
  ): string[] {
    const collectedIds: string[] = [];

    for (let idx = 0; idx < rawLayers.length; idx++) {
      const entry = rawLayers[idx];
      if (isPatch(entry)) {
        pendingPatches.push(entry);
        continue;
      }

      const staggerDelay = groupCtx?.stagger ? idx * groupCtx.stagger : 0;
      const rawT0 = entry.t?.[0] !== undefined
        ? resolveTimeValue(entry.t[0], transcript, sceneT0).seconds + staggerDelay
        : sceneT0 + staggerDelay;
      const rawT1 = entry.t?.[1] !== undefined
        ? resolveTimeValue(entry.t[1], transcript, sceneT1).seconds
        : sceneT1;

      if (entry.type === 'use') {
        // Resolve time anchors inside args (`at`, `pressAt`, `messages[].at`, etc.)
        const resolvedArgs: Record<string, any> = { ...(entry.args || {}) };
        if (resolvedArgs.at !== undefined) {
          resolvedArgs.at = resolveTimeValue(resolvedArgs.at, transcript, rawT0).seconds + staggerDelay;
        } else {
          resolvedArgs.at = rawT0;
        }
        if (resolvedArgs.pressAt !== undefined) {
          resolvedArgs.pressAt = resolveTimeValue(resolvedArgs.pressAt, transcript, rawT0 + 0.5).seconds;
        }
        if (Array.isArray(resolvedArgs.messages)) {
          resolvedArgs.messages = resolvedArgs.messages.map((m: any, mIdx: number) => ({
            ...m,
            at: resolveTimeValue(m.at, transcript, resolvedArgs.at + 0.25 + mIdx * 0.45).seconds,
          }));
        }

        const expanded = expandUseLayer(
          { ...entry, args: resolvedArgs, t: [rawT0, rawT1] },
          [rawT0, rawT1],
          doc.defs,
          tokens,
          groupCtx ? groupCtx.box.w : w,
          groupCtx ? groupCtx.box.h : h
        );
        const subIds = processLayerList(expanded, sceneId, rawT0, rawT1, groupCtx);
        collectedIds.push(...subIds);
        continue;
      }

      const styled = applyStyleToLayer(entry);
      const resolvedMotions = (styled.motion || []).map((m) => ({
        ...m,
        atSec:
          m.at !== undefined
            ? resolveTimeValue(m.at, transcript, rawT0).seconds + staggerDelay
            : rawT0,
        untilSec:
          m.until !== undefined
            ? resolveTimeValue(m.until, transcript, rawT1).seconds
            : undefined,
      }));

      let resolvedCount: [number, number] | undefined;
      if (Array.isArray(styled.count) && styled.count.length === 2) {
        resolvedCount = [
          resolveTimeValue(styled.count[0], transcript, rawT0).seconds,
          resolveTimeValue(styled.count[1], transcript, rawT1).seconds,
        ];
      }

      const resolvedAt =
        styled.at !== undefined
          ? resolveTimeValue(styled.at, transcript, rawT0).seconds
          : undefined;

      const resolvedPoseKeys = Array.isArray(styled.poseKeys)
        ? styled.poseKeys
            .map((pk) => ({
              t: resolveTimeValue(pk.t, transcript, 0).seconds,
              pose: pk.pose,
              e: pk.e || 'outBack',
            }))
            .sort((a, b) => a.t - b.t)
        : undefined;

      const orderIndex = orderCounter++;
      const zIndex = typeof styled.z === 'number' ? styled.z : 0;

      const compiled: CompiledLayer = {
        ...styled,
        t0: rawT0,
        t1: rawT1,
        sceneId,
        sceneT0,
        sceneT1,
        orderIndex,
        zIndex,
        groupId: groupCtx?.groupId,
        groupBox: groupCtx?.box,
        resolvedMotions,
        resolvedCount,
        resolvedAt,
        resolvedPoseKeys,
        staggerIndex: idx,
        staggerTotal: rawLayers.length,
        numericSeed: hashString(styled.id || `layer_${orderIndex}`, styled.seed ?? 0),
      };

      compiledLayers.push(compiled);
      layersById.set(compiled.id, compiled);
      collectedIds.push(compiled.id);

      if (styled.type === 'group' && Array.isArray(styled.children)) {
        const refW = groupCtx ? groupCtx.box.w : w;
        const refH = groupCtx ? groupCtx.box.h : h;
        const gw = resolveSizePx(styled.w, refW, refW * 0.5);
        const gh = resolveSizePx(styled.h, refH, refH * 0.5);
        const gx = typeof styled.x === 'number' ? styled.x : 0.5;
        const gy = typeof styled.y === 'number' ? styled.y : 0.5;

        const laidOutChildren = applyGroupLayout(styled.children, styled.layout, gw, gh);
        const childIds = processLayerList(laidOutChildren, sceneId, rawT0, rawT1, {
          groupId: compiled.id,
          box: { x: gx, y: gy, w: gw, h: gh, clip: styled.clip },
          stagger: styled.stagger,
        });
        collectedIds.push(...childIds);
      }
    }

    return collectedIds;
  }

  for (const scene of doc.scenes || []) {
    const sT0 = resolveTimeValue(scene.t?.[0], transcript, partFrom).seconds;
    const sT1 = resolveTimeValue(scene.t?.[1], transcript, partTo).seconds;
    const transition = scene.transition ?? { type: 'cut' };
    const layerIds = processLayerList(scene.layers || [], scene.id, sT0, sT1);
    compiledScenes.push({
      id: scene.id,
      t0: sT0,
      t1: sT1,
      transition,
      layerIds,
    });
  }

  // Apply continuation patches (`{"patch":"hdr","motion":[...],"t":[null,"endTime"]}`)
  for (const patch of pendingPatches) {
    const target = layersById.get(patch.patch);
    if (!target) continue;
    if (Array.isArray(patch.t)) {
      if (patch.t[0] !== null && patch.t[0] !== undefined) {
        target.t0 = resolveTimeValue(patch.t[0], transcript, target.t0).seconds;
      }
      if (patch.t[1] !== null && patch.t[1] !== undefined) {
        target.t1 = resolveTimeValue(patch.t[1], transcript, target.t1).seconds;
      }
    }
    if (patch.exit !== undefined) {
      target.exit = patch.exit;
    }
    if (patch.anim) {
      target.anim = { ...(target.anim || {}), ...patch.anim };
    }
    if (Array.isArray(patch.motion)) {
      const moreMotions = patch.motion.map((m) => ({
        ...m,
        atSec: m.at !== undefined ? resolveTimeValue(m.at, transcript, target.t0).seconds : target.t0,
        untilSec:
          m.until !== undefined ? resolveTimeValue(m.until, transcript, target.t1).seconds : undefined,
      }));
      target.resolvedMotions.push(...moreMotions);
    }
  }

  compiledLayers.sort((a, b) => {
    if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
    return a.orderIndex - b.orderIndex;
  });

  const intervalSorted = [...compiledLayers].sort((a, b) => {
    if (a.t0 !== b.t0) return a.t0 - b.t0;
    return a.orderIndex - b.orderIndex;
  });

  return {
    w,
    h,
    fps,
    duration,
    lang,
    part: doc.meta?.part ?? { n: 1, of: 1, from: 0, to: duration },
    tokens,
    global: doc.global ?? { vignette: 0.6 },
    assets,
    camera,
    scenes: compiledScenes,
    layers: compiledLayers,
    layersById,
    intervalSorted,
    transcript,
  };
}
