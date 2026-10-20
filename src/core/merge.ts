import type {
  AssetDef,
  CameraKeyframe,
  ComponentDef,
  Layer,
  LayerPatch,
  RecipeDocument,
  Scene,
} from './types.ts';

/**
 * Merges an ordered list of RecipeDocument parts (Part 1 full document + Part 2..N continuation shapes)
 * into a single unified RecipeDocument covering [0, totalDuration] per SPEC Part D Section 5.
 * - Concatenates scenes in order
 * - Merges new `defs` and `assets` without overwriting Part 1's theme or existing defs
 * - Resolves `carry.persist` layers (`"until": "open"`) across boundaries
 * - Applies `patch` entries (`{"patch":"hdr","motion":[...],"t":[null,"endTime"]}`) directly to persisted layers
 */
export function mergeRecipeParts(parts: RecipeDocument[]): RecipeDocument {
  if (parts.length === 0) {
    throw new Error('Cannot merge an empty list of recipe parts');
  }
  if (parts.length === 1) {
    return structuredClone(parts[0]);
  }

  const first = structuredClone(parts[0]);
  const mergedDefs: Record<string, ComponentDef> = { ...(first.defs || {}) };
  const mergedAssetsMap = new Map<string, AssetDef>();
  for (const a of first.assets || []) {
    mergedAssetsMap.set(a.id, a);
  }

  const mergedCamera: CameraKeyframe[] = [...(first.camera || [])];
  const mergedScenes: Scene[] = [];

  // Map from layer id -> reference to Layer object in mergedScenes so patches can update it directly
  const layerMap = new Map<string, Layer>();
  const openPersistIds = new Set<string>();

  function indexLayers(layers: (Layer | LayerPatch)[]) {
    for (const entry of layers) {
      if ('patch' in entry) continue;
      layerMap.set(entry.id, entry);
      if (Array.isArray(entry.children)) {
        indexLayers(entry.children);
      }
    }
  }

  for (let pIdx = 0; pIdx < parts.length; pIdx++) {
    const partDoc = pIdx === 0 ? first : structuredClone(parts[pIdx]);
    const partTo = partDoc.meta?.part?.to ?? partDoc.meta?.duration ?? 0;

    if (pIdx > 0) {
      for (const [k, defVal] of Object.entries(partDoc.defs || {})) {
        if (!mergedDefs[k]) {
          mergedDefs[k] = defVal;
        }
      }
      for (const asset of partDoc.assets || []) {
        if (!mergedAssetsMap.has(asset.id)) {
          mergedAssetsMap.set(asset.id, asset);
        }
      }
      for (const ck of partDoc.camera || []) {
        mergedCamera.push(ck);
      }
    }

    // Extend any open persisted layers to at least this part's end unless patched
    for (const persistId of openPersistIds) {
      const persistedLayer = layerMap.get(persistId);
      if (persistedLayer && Array.isArray(persistedLayer.t)) {
        persistedLayer.t[1] = partTo;
      }
    }

    for (const scene of partDoc.scenes || []) {
      const cleanLayers: (Layer | LayerPatch)[] = [];
      for (const item of scene.layers || []) {
        if ('patch' in item && typeof item.patch === 'string') {
          const target = layerMap.get(item.patch);
          if (target) {
            if (Array.isArray(item.t)) {
              target.t = [
                item.t[0] !== null && item.t[0] !== undefined ? item.t[0] : target.t?.[0] ?? 0,
                item.t[1] !== null && item.t[1] !== undefined ? item.t[1] : target.t?.[1] ?? partTo,
              ];
              if (item.t[1] !== null && item.t[1] !== undefined) {
                openPersistIds.delete(item.patch);
              }
            }
            if (Array.isArray(item.motion)) {
              target.motion = [...(target.motion || []), ...item.motion];
            }
            if (item.exit !== undefined) {
              target.exit = item.exit;
            }
            if (item.anim) {
              target.anim = { ...(target.anim || {}), ...item.anim };
            }
          } else {
            cleanLayers.push(item);
          }
        } else {
          cleanLayers.push(item);
        }
      }

      const sceneCopy: Scene = {
        ...scene,
        layers: cleanLayers,
      };
      indexLayers(sceneCopy.layers);
      mergedScenes.push(sceneCopy);
    }

    // Record carry.persist from this part
    if (partDoc.carry?.persist) {
      for (const p of partDoc.carry.persist) {
        if (p.until === 'open') {
          openPersistIds.add(p.id);
        } else if (typeof p.until === 'number') {
          const target = layerMap.get(p.id);
          if (target && Array.isArray(target.t)) {
            target.t[1] = p.until;
          }
          openPersistIds.delete(p.id);
        }
      }
    }
  }

  const lastPart = parts[parts.length - 1];
  const totalDuration =
    first.meta?.duration ??
    lastPart.meta?.part?.to ??
    (mergedScenes.length > 0 ? Number(mergedScenes[mergedScenes.length - 1].t[1]) : 10);

  return {
    recipe: 'v3.1',
    meta: {
      w: first.meta?.w ?? 1920,
      h: first.meta?.h ?? 1080,
      fps: first.meta?.fps ?? 60,
      duration: totalDuration,
      lang: first.meta?.lang ?? 'en',
      part: {
        n: 1,
        of: 1,
        from: first.meta?.part?.from ?? 0,
        to: totalDuration,
      },
    },
    theme: first.theme ?? { palette: 1 },
    global: first.global ?? { vignette: 0.6 },
    assets: Array.from(mergedAssetsMap.values()),
    audio: first.audio,
    defs: mergedDefs,
    camera: mergedCamera,
    scenes: mergedScenes,
  };
}
