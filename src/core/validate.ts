import { isValidEasingName } from './ease.ts';
import { validateExpression } from './expr.ts';
import { parseKeyframeTrack } from './keyframes.ts';
import { compileRecipe } from './layout.ts';
import { ENTRANCE_MACROS } from './macros.ts';
import { enterPresetRegistry } from './registry.ts';
import { resolveTimeValue } from './time.ts';
import type {
  Layer,
  LayerPatch,
  RecipeDocument,
  TranscriptData,
  ValidationIssue,
} from './types.ts';
import {
  BACKGROUND_KINDS,
  CAPTION_STYLES,
  CHART_KINDS,
  COMPONENT_NAMES,
  EMPH_NAMES,
  ENTER_PRESETS,
  EXIT_PRESETS,
  FX_NAMES,
  HIGHLIGHT_KINDS,
  ICON_NAMES,
  LAYER_TYPES,
  MACRO_NAMES,
  POSE_NAMES,
  SHAPE_KINDS,
  STYLE_TOKENS,
  THEME_TOKENS,
  TRANSITION_NAMES,
} from './vocab.ts';

export const FORBIDDEN_CODE_IDENTIFIERS = [
  'Math.random',
  'Date',
  'window',
  'document',
  'fetch',
  'eval',
  'Function',
  'import',
  'XMLHttpRequest',
  'localStorage',
  'setTimeout',
  'requestAnimationFrame',
  'constructor',
  '__proto__',
  'prototype',
  'globalThis',
  'self',
  'postMessage',
  'importScripts',
  'WebSocket',
  'indexedDB',
  'caches',
  'navigator',
  'location',
];

const UNKNOWN_VOCAB_CODES = new Set([
  'UNKNOWN_LAYER_TYPE',
  'UNKNOWN_SHAPE_KIND',
  'UNKNOWN_ICON_NAME',
  'UNKNOWN_CHART_KIND',
  'UNKNOWN_BACKGROUND_KIND',
  'UNKNOWN_FIGURE_POSE',
  'UNKNOWN_HIGHLIGHT_KIND',
  'UNKNOWN_CAPTION_STYLE',
  'UNKNOWN_STYLE_TOKEN',
  'UNKNOWN_MACRO',
  'UNKNOWN_EASING',
  'UNKNOWN_ENTER_PRESET',
  'UNKNOWN_EXIT_PRESET',
  'UNKNOWN_EMPH',
  'UNKNOWN_FX',
  'UNKNOWN_COMPONENT_DEF',
  'UNKNOWN_TRANSITION',
]);

const BROWSER_DOT_HEXES = new Set(['#FF5F57', '#FEBC2E', '#28C840', '#FFFFFF']);

function isColorTokenValid(col: string): boolean {
  const trimmed = col.trim();
  if (trimmed === 'none' || trimmed === 'transparent') return true;
  if (BROWSER_DOT_HEXES.has(trimmed.toUpperCase())) return true;
  if (trimmed.startsWith('@')) {
    return THEME_TOKENS.includes(trimmed.slice(1));
  }
  if (trimmed.startsWith('grad(') || trimmed.startsWith('gradr(')) {
    const inner = trimmed.slice(trimmed.indexOf('(') + 1, -1);
    return inner.split(',').every((part) => isColorTokenValid(part.trim()));
  }
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return true;
  return false;
}

/**
 * Estimates single-line text width in pixels for validator checks
 */
export function estimateTextWidthPx(text: string, fontSize: number, weight = 700): number {
  const avgCharFactor = weight >= 800 ? 0.56 : 0.52;
  return text.length * fontSize * avgCharFactor;
}

/**
 * Runs the complete 9-step SPEC Part D Section 2 validation suite on raw JSON or parsed RecipeDocument.
 */
export function validateRecipe(
  input: string | RecipeDocument,
  transcript?: TranscriptData,
  knownCarryIds: string[] = [],
  knownDefs: string[] = []
): { doc?: RecipeDocument; issues: ValidationIssue[]; valid: boolean } {
  const issues: ValidationIssue[] = [];
  let doc: RecipeDocument;

  // Step 1: JSON parses; recipe is v3.1; meta.part present
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input) as RecipeDocument;
    } catch (err: any) {
      issues.push({
        severity: 'error',
        code: 'JSON_PARSE_ERROR',
        message: `Invalid JSON syntax: ${err?.message ?? 'Failed to parse JSON'}`,
      });
      return { issues, valid: false };
    }
  } else {
    doc = input;
  }

  if (!doc || typeof doc !== 'object') {
    issues.push({
      severity: 'error',
      code: 'INVALID_ROOT',
      message: 'Root value must be a JSON object',
    });
    return { issues, valid: false };
  }

  if (doc.recipe !== 'v3.1') {
    issues.push({
      severity: 'error',
      code: 'INVALID_RECIPE_VERSION',
      message: `Expected "recipe": "v3.1", got "${String(doc.recipe)}"`,
    });
  }

  if (!doc.meta || !doc.meta.part) {
    issues.push({
      severity: 'error',
      code: 'MISSING_META_PART',
      message: 'Missing required "meta.part" object ({ n, of, from, to })',
    });
  }

  const partFrom = doc.meta?.part?.from ?? 0;
  const partTo = doc.meta?.part?.to ?? doc.meta?.duration ?? 0;
  const duration = doc.meta?.duration ?? partTo;
  const canvasW = doc.meta?.w ?? 1920;
  const canvasH = doc.meta?.h ?? 1080;

  if (!Array.isArray(doc.scenes) || doc.scenes.length === 0) {
    issues.push({
      severity: 'error',
      code: 'MISSING_SCENES',
      message: 'Document must contain a non-empty "scenes" array',
    });
    return { doc, issues, valid: false };
  }

  // Collect all IDs, assets, defs
  const allLayerIds = new Set<string>(knownCarryIds);
  const allAssetIds = new Set<string>((doc.assets || []).map((a) => a.id));
  const allDefNames = new Set<string>([
    ...COMPONENT_NAMES,
    ...knownDefs,
    ...Object.keys(doc.defs || {}),
  ]);

  function collectIds(layers: (Layer | LayerPatch)[], sceneId: string) {
    for (const item of layers) {
      if ('patch' in item) continue;
      const layer = item as Layer;
      if (!layer.id) {
        issues.push({
          severity: 'error',
          code: 'MISSING_LAYER_ID',
          sceneId,
          message: `Layer in scene "${sceneId}" is missing a unique "id"`,
        });
      } else if (allLayerIds.has(layer.id)) {
        issues.push({
          severity: 'error',
          code: 'DUPLICATE_ID',
          layerId: layer.id,
          sceneId,
          message: `Duplicate layer id "${layer.id}"`,
        });
      } else {
        allLayerIds.add(layer.id);
      }
      if (Array.isArray(layer.children)) {
        collectIds(layer.children, sceneId);
      }
    }
  }

  for (const scene of doc.scenes) {
    collectIds(scene.layers || [], scene.id);
  }

  // Step 3: Scene range coverage and timing checks
  let prevSceneEnd = partFrom;
  const beatTimes: number[] = [];

  for (let sIdx = 0; sIdx < doc.scenes.length; sIdx++) {
    const scene = doc.scenes[sIdx];
    const r0 = resolveTimeValue(scene.t?.[0], transcript, partFrom);
    const r1 = resolveTimeValue(scene.t?.[1], transcript, partTo);

    if (!r0.valid) {
      issues.push({
        severity: 'error',
        code: 'INVALID_SCENE_TIME',
        sceneId: scene.id,
        message: r0.error || `Invalid scene start time in "${scene.id}"`,
      });
    }
    if (!r1.valid) {
      issues.push({
        severity: 'error',
        code: 'INVALID_SCENE_TIME',
        sceneId: scene.id,
        message: r1.error || `Invalid scene end time in "${scene.id}"`,
      });
    }
    if (r0.seconds >= r1.seconds) {
      issues.push({
        severity: 'error',
        code: 'SCENE_TIME_ORDER',
        sceneId: scene.id,
        message: `Scene "${scene.id}" start (${r0.seconds}) must be < end (${r1.seconds})`,
      });
    }

    if (sIdx === 0 && Math.abs(r0.seconds - partFrom) > 0.05) {
      issues.push({
        severity: 'error',
        code: 'SCENE_GAP_START',
        sceneId: scene.id,
        message: `First scene "${scene.id}" starts at ${r0.seconds}s instead of part start ${partFrom}s`,
      });
    } else if (sIdx > 0 && r0.seconds - prevSceneEnd > 0.05) {
      issues.push({
        severity: 'error',
        code: 'SCENE_GAP',
        sceneId: scene.id,
        message: `Gap between previous scene end (${prevSceneEnd}s) and scene "${scene.id}" start (${r0.seconds}s)`,
      });
    }
    prevSceneEnd = Math.max(prevSceneEnd, r1.seconds);

    if (r1.seconds > duration + 0.05) {
      issues.push({
        severity: 'error',
        code: 'PAST_DURATION',
        sceneId: scene.id,
        message: `Scene "${scene.id}" ends at ${r1.seconds}s past duration ${duration}s`,
      });
    }

    // Transition check
    if (scene.transition) {
      const trType = scene.transition.type;
      if (!TRANSITION_NAMES.includes(trType)) {
        issues.push({
          severity: 'error',
          code: 'UNKNOWN_TRANSITION',
          sceneId: scene.id,
          message: `Unknown scene transition "${trType}" on scene "${scene.id}"`,
        });
      }
      if (trType !== 'cut' && scene.transition.dur === undefined) {
        issues.push({
          severity: 'warning',
          code: 'MISSING_TRANSITION_DUR',
          sceneId: scene.id,
          message: `Transition "${trType}" on scene "${scene.id}" should specify "dur" (0.15-0.5)`,
        });
      }
    }

    const isLastScene =
      sIdx === doc.scenes.length - 1 &&
      (doc.meta?.part?.n ?? 1) === (doc.meta?.part?.of ?? 1);

    function validateLayerList(layers: (Layer | LayerPatch)[]) {
      for (const entry of layers) {
        if ('patch' in entry) {
          const patch = entry as LayerPatch;
          if (!allLayerIds.has(patch.patch)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_PATCH_TARGET',
              sceneId: scene.id,
              message: `Patch target "${patch.patch}" does not exist`,
            });
          }
          continue;
        }

        const layer = entry as Layer;
        const lid = layer.id;

        // Layer type check
        if (!LAYER_TYPES.includes(layer.type)) {
          issues.push({
            severity: 'error',
            code: 'UNKNOWN_LAYER_TYPE',
            layerId: lid,
            sceneId: scene.id,
            message: `Unknown layer type "${layer.type}"`,
          });
        }

        // Layer timing check
        const lt0 = layer.t?.[0] !== undefined ? resolveTimeValue(layer.t[0], transcript, r0.seconds) : r0;
        const lt1 = layer.t?.[1] !== undefined ? resolveTimeValue(layer.t[1], transcript, r1.seconds) : r1;
        if (!lt0.valid) {
          issues.push({
            severity: 'error',
            code: 'INVALID_ANCHOR',
            layerId: lid,
            sceneId: scene.id,
            message: `${lt0.error} on layer "${lid}"`,
          });
        }
        if (!lt1.valid) {
          issues.push({
            severity: 'error',
            code: 'INVALID_ANCHOR',
            layerId: lid,
            sceneId: scene.id,
            message: `${lt1.error} on layer "${lid}"`,
          });
        }
        if (lt0.seconds >= lt1.seconds) {
          issues.push({
            severity: 'error',
            code: 'INVALID_LAYER_TIME_RANGE',
            layerId: lid,
            sceneId: scene.id,
            message: `Layer "${lid}" start (${lt0.seconds}s) must be < end (${lt1.seconds}s)`,
          });
        }
        if (lt1.seconds > duration + 0.05) {
          issues.push({
            severity: 'error',
            code: 'LAYER_PAST_DURATION',
            layerId: lid,
            sceneId: scene.id,
            message: `Layer "${lid}" runs until ${lt1.seconds}s, past video duration ${duration}s`,
          });
        }

        beatTimes.push(lt0.seconds);

        // Reference checks: parent, target, mask, onPath, asset, use.def
        if (layer.parent && !allLayerIds.has(layer.parent)) {
          issues.push({
            severity: 'error',
            code: 'UNKNOWN_PARENT_ID',
            layerId: lid,
            sceneId: scene.id,
            message: `Layer "${lid}" references unknown parent "${layer.parent}"`,
          });
        }
        if (layer.target && !allLayerIds.has(layer.target)) {
          issues.push({
            severity: 'error',
            code: 'UNKNOWN_TARGET_ID',
            layerId: lid,
            sceneId: scene.id,
            message: `Highlight layer "${lid}" references unknown target "${layer.target}"`,
          });
        }
        if (layer.mask && !allLayerIds.has(layer.mask)) {
          issues.push({
            severity: 'error',
            code: 'UNKNOWN_MASK_ID',
            layerId: lid,
            sceneId: scene.id,
            message: `Layer "${lid}" references unknown mask "${layer.mask}"`,
          });
        }
        if (layer.onPath && !allLayerIds.has(layer.onPath)) {
          issues.push({
            severity: 'error',
            code: 'UNKNOWN_ONPATH_ID',
            layerId: lid,
            sceneId: scene.id,
            message: `Layer "${lid}" references unknown onPath "${layer.onPath}"`,
          });
        }
        if (layer.type === 'use') {
          if (!layer.def || !allDefNames.has(layer.def)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_COMPONENT_DEF',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" uses unknown component or def "${String(layer.def)}"`,
            });
          }
          if (layer.args?.at !== undefined) {
            const atRes = resolveTimeValue(layer.args.at, transcript, lt0.seconds);
            if (!atRes.valid) {
              issues.push({
                severity: 'error',
                code: 'INVALID_ANCHOR',
                layerId: lid,
                sceneId: scene.id,
                message: `${atRes.error} in args.at on layer "${lid}"`,
              });
            } else {
              beatTimes.push(atRes.seconds);
            }
          }
        }
        if ((layer.type === 'image' || layer.type === 'video') && layer.asset) {
          if (!allAssetIds.has(layer.asset)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_ASSET_ID',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" references undeclared asset "${layer.asset}"`,
            });
          }
          if (layer.w !== undefined && layer.h !== undefined) {
            issues.push({
              severity: 'error',
              code: 'IMAGE_BOTH_W_AND_H',
              layerId: lid,
              sceneId: scene.id,
              message: `Image/video layer "${lid}" sets both w and h (SPEC rule: set w only)`,
            });
          }
        }

        // Vocabulary checks per layer type
        if (layer.type === 'shape') {
          if (!layer.kind || !SHAPE_KINDS.includes(layer.kind)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_SHAPE_KIND',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" has unknown shape kind "${String(layer.kind)}"`,
            });
          }
          if (
            (layer.kind === 'rect' || layer.kind === 'line') &&
            typeof layer.h === 'number' &&
            layer.h > 0 &&
            layer.h < 6
          ) {
            issues.push({
              severity: 'error',
              code: 'THIN_LINE_HEIGHT',
              layerId: lid,
              sceneId: scene.id,
              message: `Line/underline "${lid}" has h=${layer.h}px (SPEC rule: h >= 6 px)`,
            });
          }
        }

        if (layer.type === 'icon') {
          if (!layer.name || !ICON_NAMES.includes(layer.name)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_ICON_NAME',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" uses unknown icon name "${String(layer.name)}"`,
            });
          }
        }

        if (layer.type === 'chart') {
          if (!layer.kind || !CHART_KINDS.includes(layer.kind)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_CHART_KIND',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" uses unknown chart kind "${String(layer.kind)}"`,
            });
          }
          if (Array.isArray(layer.count)) {
            const c0 = resolveTimeValue(layer.count[0], transcript, lt0.seconds);
            if (c0.valid) beatTimes.push(c0.seconds);
          }
        }

        if (layer.type === 'background') {
          if (!layer.kind || !BACKGROUND_KINDS.includes(layer.kind)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_BACKGROUND_KIND',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" uses unknown background kind "${String(layer.kind)}"`,
            });
          }
        }

        if (layer.type === 'figure') {
          if (typeof layer.pose === 'string' && !POSE_NAMES.includes(layer.pose)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_FIGURE_POSE',
              layerId: lid,
              sceneId: scene.id,
              message: `Figure layer "${lid}" uses unknown pose "${layer.pose}"`,
            });
          }
          if (Array.isArray(layer.poseKeys)) {
            for (const pk of layer.poseKeys) {
              if (typeof pk.pose === 'string' && !POSE_NAMES.includes(pk.pose)) {
                issues.push({
                  severity: 'error',
                  code: 'UNKNOWN_FIGURE_POSE',
                  layerId: lid,
                  sceneId: scene.id,
                  message: `Figure layer "${lid}" poseKey uses unknown pose "${pk.pose}"`,
                });
              }
              if (pk.e && !isValidEasingName(pk.e)) {
                issues.push({
                  severity: 'error',
                  code: 'UNKNOWN_EASING',
                  layerId: lid,
                  sceneId: scene.id,
                  message: `Figure layer "${lid}" poseKey uses unknown easing "${pk.e}"`,
                });
              }
            }
          }
        }

        if (layer.type === 'highlight') {
          if (layer.kind && !HIGHLIGHT_KINDS.includes(layer.kind)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_HIGHLIGHT_KIND',
              layerId: lid,
              sceneId: scene.id,
              message: `Highlight layer "${lid}" uses unknown kind "${layer.kind}"`,
            });
          }
        }

        if (layer.type === 'captions') {
          if (layer.style && !CAPTION_STYLES.includes(layer.style)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_CAPTION_STYLE',
              layerId: lid,
              sceneId: scene.id,
              message: `Captions layer "${lid}" uses unknown style "${layer.style}"`,
            });
          }
        }

        if (layer.style && layer.type !== 'captions' && layer.type !== 'figure') {
          if (!STYLE_TOKENS.includes(layer.style as any)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_STYLE_TOKEN',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" uses unknown style token "${layer.style}"`,
            });
          }
        }

        // Size fraction check (SPEC rule: never write a 0-4 fraction for w, h, size, radius)
        for (const sizeProp of ['w', 'h', 'size', 'radius'] as const) {
          const v = layer[sizeProp];
          if (typeof v === 'number' && v > 0 && v <= 4) {
            issues.push({
              severity: 'error',
              code: 'FRACTIONAL_PIXEL_SIZE',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" property "${sizeProp}" is ${v} (0-4 fraction instead of pixels)`,
            });
          }
        }

        // Text width measurement check
        if (layer.type === 'text' && layer.text && typeof layer.w === 'number' && layer.fit !== 'shrink') {
          const fontSize = typeof layer.size === 'number' ? layer.size : 40;
          const weight = layer.weight ?? 700;
          const lines = String(layer.text).split('\n');
          const longestLine = lines.reduce((a, b) => (a.length >= b.length ? a : b), '');
          const estW = estimateTextWidthPx(longestLine, fontSize, weight);
          if (layer.w < estW * 0.72) {
            issues.push({
              severity: 'warning',
              code: 'TEXT_WIDTH_TOO_SMALL',
              layerId: lid,
              sceneId: scene.id,
              message: `Text layer "${lid}" w=${layer.w}px is narrower than estimated text width (${Math.round(estW)}px); add "fit":"shrink" or increase w`,
            });
          }
        }

        // Color token validation
        for (const colProp of ['color', 'stroke'] as const) {
          const cVal = layer[colProp];
          if (typeof cVal === 'string' && !isColorTokenValid(cVal)) {
            issues.push({
              severity: 'error',
              code: 'INVALID_COLOR_TOKEN',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" property "${colProp}" has invalid color/token "${cVal}"`,
            });
          }
        }
        if (typeof layer.fill === 'string' && !isColorTokenValid(layer.fill)) {
          issues.push({
            severity: 'error',
            code: 'INVALID_COLOR_TOKEN',
            layerId: lid,
            sceneId: scene.id,
            message: `Layer "${lid}" fill has invalid color/token "${layer.fill}"`,
          });
        }

        // Enter / Exit / Emph presets
        let hasEntranceMacro = false;
        if (Array.isArray(layer.motion)) {
          for (const m of layer.motion) {
            if (!MACRO_NAMES.includes(m.m)) {
              issues.push({
                severity: 'error',
                code: 'UNKNOWN_MACRO',
                layerId: lid,
                sceneId: scene.id,
                message: `Layer "${lid}" uses unknown motion macro "${m.m}"`,
              });
            }
            if (ENTRANCE_MACROS.has(m.m)) {
              hasEntranceMacro = true;
            }
            if (m.ease && !isValidEasingName(m.ease)) {
              issues.push({
                severity: 'error',
                code: 'UNKNOWN_EASING',
                layerId: lid,
                sceneId: scene.id,
                message: `Layer "${lid}" macro "${m.m}" uses unknown easing "${m.ease}"`,
              });
            }
            if (m.at !== undefined) {
              const mAt = resolveTimeValue(m.at, transcript, lt0.seconds);
              if (!mAt.valid) {
                issues.push({
                  severity: 'error',
                  code: 'INVALID_ANCHOR',
                  layerId: lid,
                  sceneId: scene.id,
                  message: `${mAt.error} on macro "${m.m}" in layer "${lid}"`,
                });
              } else {
                beatTimes.push(mAt.seconds);
              }
            }
          }
        }

        if (layer.enter) {
          const enterName = typeof layer.enter === 'string' ? layer.enter : layer.enter.type;
          const enterEase = typeof layer.enter === 'object' ? layer.enter.ease : undefined;
          if (!ENTER_PRESETS.includes(enterName)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_ENTER_PRESET',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" uses unknown enter preset "${enterName}"`,
            });
          } else if (enterPresetRegistry.get(enterName)?.textOnly && layer.type !== 'text') {
            issues.push({
              severity: 'error',
              code: 'TEXT_ONLY_ENTER_ON_NON_TEXT',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" (type "${layer.type}") uses text-only enter preset "${enterName}"`,
            });
          }
          if (enterEase && !isValidEasingName(enterEase)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_EASING',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" enter preset uses unknown easing "${enterEase}"`,
            });
          }
          if (hasEntranceMacro && enterName !== 'none') {
            issues.push({
              severity: 'warning',
              code: 'ENTER_AND_ENTRANCE_MACRO',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" has both an entrance macro and an enter preset "${enterName}"`,
            });
          }
        }

        if (layer.exit) {
          const exitName = typeof layer.exit === 'string' ? layer.exit : layer.exit.type;
          const exitEase = typeof layer.exit === 'object' ? layer.exit.ease : undefined;
          if (!EXIT_PRESETS.includes(exitName) && exitName !== 'fade') {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_EXIT_PRESET',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" uses unknown exit preset "${exitName}"`,
            });
          }
          if (exitEase && !isValidEasingName(exitEase)) {
            issues.push({
              severity: 'error',
              code: 'UNKNOWN_EASING',
              layerId: lid,
              sceneId: scene.id,
              message: `Layer "${lid}" exit preset uses unknown easing "${exitEase}"`,
            });
          }
        }

        if (isLastScene && Math.abs(lt1.seconds - duration) < 0.05 && layer.exit && layer.exit !== 'none') {
          issues.push({
            severity: 'warning',
            code: 'FINAL_SCENE_EXIT_NOT_NONE',
            layerId: lid,
            sceneId: scene.id,
            message: `Final scene layer "${lid}" ending at duration should have "exit": "none"`,
          });
        }

        if (layer.emph && !EMPH_NAMES.includes(layer.emph)) {
          issues.push({
            severity: 'error',
            code: 'UNKNOWN_EMPH',
            layerId: lid,
            sceneId: scene.id,
            message: `Layer "${lid}" uses unknown emphasis loop "${layer.emph}"`,
          });
        }

        // Anim keyframes check
        if (layer.anim && typeof layer.anim === 'object') {
          for (const [, trackVal] of Object.entries(layer.anim)) {
            const keys = parseKeyframeTrack(trackVal);
            for (const k of keys) {
              if (k.e && !isValidEasingName(k.e)) {
                issues.push({
                  severity: 'error',
                  code: 'UNKNOWN_EASING',
                  layerId: lid,
                  sceneId: scene.id,
                  message: `Layer "${lid}" anim track uses unknown easing "${k.e}"`,
                });
              }
            }
          }
        }

        // Expressions check
        for (const [propName, propVal] of Object.entries(layer)) {
          if (propVal && typeof propVal === 'object' && 'expr' in propVal && typeof propVal.expr === 'string') {
            const check = validateExpression(propVal.expr);
            if (!check.valid) {
              issues.push({
                severity: 'error',
                code: 'INVALID_EXPRESSION',
                layerId: lid,
                sceneId: scene.id,
                path: propName,
                message: `Layer "${lid}" property "${propName}": ${check.error}`,
              });
            }
          }
        }

        // FX check
        if (Array.isArray(layer.fx)) {
          for (const fxItem of layer.fx) {
            const fxName =
              typeof fxItem.type === 'string'
                ? fxItem.type
                : Object.keys(fxItem).find((k) => FX_NAMES.includes(k));
            if (!fxName || !FX_NAMES.includes(fxName)) {
              issues.push({
                severity: 'error',
                code: 'UNKNOWN_FX',
                layerId: lid,
                sceneId: scene.id,
                message: `Layer "${lid}" has unknown fx "${String(fxName ?? JSON.stringify(fxItem))}"`,
              });
            }
          }
        }

        // Step 8: Code layer check
        if (layer.type === 'code') {
          const codeBody = String(layer.draw ?? '');
          const lines = codeBody.split('\n');
          if (lines.length > 60) {
            issues.push({
              severity: 'warning',
              code: 'CODE_LAYER_TOO_LONG',
              layerId: lid,
              sceneId: scene.id,
              message: `Code layer "${lid}" has ${lines.length} lines (SPEC max is 60 lines)`,
            });
          }
          for (const forbidden of FORBIDDEN_CODE_IDENTIFIERS) {
            const esc = forbidden.replace('.', '\\.');
            const re = new RegExp(`\\b${esc}\\b`);
            if (re.test(codeBody)) {
              issues.push({
                severity: 'error',
                code: 'FORBIDDEN_CODE_IDENTIFIER',
                layerId: lid,
                sceneId: scene.id,
                message: `Code layer "${lid}" uses forbidden identifier "${forbidden}"`,
              });
            }
          }
          try {
            // Syntax parse check only (never invoked during validation)
            new Function('ctx', 't', 'p', 'w', 'h', 'api', codeBody);
          } catch (err: any) {
            issues.push({
              severity: 'error',
              code: 'CODE_SYNTAX_ERROR',
              layerId: lid,
              sceneId: scene.id,
              message: `Code layer "${lid}" has JS syntax error: ${err?.message ?? 'invalid syntax'}`,
            });
          }
        }

        if (Array.isArray(layer.children)) {
          validateLayerList(layer.children);
        }
      }
    }

    validateLayerList(scene.layers || []);
  }

  if (Math.abs(prevSceneEnd - partTo) > 0.08) {
    issues.push({
      severity: 'error',
      code: 'SCENE_COVERAGE_END',
      message: `Scenes end at ${prevSceneEnd.toFixed(2)}s instead of covering part end ${partTo.toFixed(2)}s`,
    });
  }

  // Camera easing checks
  for (const ck of doc.camera || []) {
    if (ck.e && !isValidEasingName(ck.e)) {
      issues.push({
        severity: 'error',
        code: 'UNKNOWN_EASING',
        message: `Camera keyframe at t=${String(ck.t)} uses unknown easing "${ck.e}"`,
      });
    }
    if (ck.follow && !allLayerIds.has(ck.follow)) {
      issues.push({
        severity: 'error',
        code: 'UNKNOWN_CAMERA_FOLLOW',
        message: `Camera follow references unknown layer id "${ck.follow}"`,
      });
    }
  }

  // Step 6: Safe-area & text overlap simulation via compiled recipe
  try {
    const compiled = compileRecipe(doc, transcript);
    for (const cl of compiled.layers) {
      if (cl.type === 'background' || cl.type === 'group' || cl.type === 'highlight' || cl.groupId) {
        continue;
      }
      const x = typeof cl.x === 'number' ? cl.x : 0.5;
      const y = typeof cl.y === 'number' ? cl.y : 0.5;
      const lw = typeof cl.w === 'number' ? cl.w : 200;
      const lh = typeof cl.h === 'number' ? cl.h : typeof cl.size === 'number' ? cl.size * 1.2 : 80;
      // Check at midpoint of layer lifetime with camera zoom
      const midT = (cl.t0 + cl.t1) * 0.5;
      const camZoom = compiled.camera.length > 0 ? 1.03 : 1.0;
      const projX = 0.5 + (x - 0.5) * camZoom;
      const projY = 0.5 + (y - 0.5) * camZoom;
      const halfW = (lw * 0.5) / canvasW;
      const halfH = (lh * 0.5) / canvasH;
      if (
        projX - halfW < 0.015 ||
        projX + halfW > 0.985 ||
        projY - halfH < 0.015 ||
        projY + halfH > 0.985
      ) {
        issues.push({
          severity: 'warning',
          code: 'SAFE_AREA_WARNING',
          layerId: cl.id,
          sceneId: cl.sceneId,
          message: `Layer "${cl.id}" approaches or crosses the 2.5% canvas safe-area margin`,
        });
      }
    }
  } catch {
    // Compiler errors are already caught above
  }

  // Step 7: Beat-gap check (warning if any beat gap > 1.2s)
  const sortedBeats = [partFrom, ...beatTimes, partTo]
    .filter((t) => Number.isFinite(t) && t >= partFrom && t <= partTo)
    .sort((a, b) => a - b);

  for (let i = 0; i < sortedBeats.length - 1; i++) {
    const gap = sortedBeats[i + 1] - sortedBeats[i];
    if (gap > 1.25 && partTo - partFrom <= 45) {
      issues.push({
        severity: 'warning',
        code: 'BEAT_GAP_WARNING',
        time: sortedBeats[i],
        message: `Beat gap of ${gap.toFixed(2)}s between ${sortedBeats[i].toFixed(2)}s and ${sortedBeats[i + 1].toFixed(2)}s exceeds 1.2s pace rule`,
        suggestedFix: `Add a motion macro (bump, pop, highlight) or layer entrance between ${sortedBeats[i].toFixed(2)}s and ${sortedBeats[i + 1].toFixed(2)}s.`,
      });
    }
  }

  // Enrich every issue with time, suggestedFix, and isUnknownName
  const sceneStartMap = new Map<string, number>();
  const layerTimeMap = new Map<string, number>();
  for (const scene of doc.scenes || []) {
    const st0 = resolveTimeValue(scene.t?.[0], transcript, partFrom).seconds;
    sceneStartMap.set(scene.id, st0);
    for (const entry of scene.layers || []) {
      if ('patch' in entry) continue;
      const lt0 = entry.t?.[0] !== undefined ? resolveTimeValue(entry.t[0], transcript, st0).seconds : st0;
      layerTimeMap.set(entry.id, lt0);
    }
  }

  for (const iss of issues) {
    if (iss.time === undefined) {
      if (iss.layerId && layerTimeMap.has(iss.layerId)) {
        iss.time = layerTimeMap.get(iss.layerId);
      } else if (iss.sceneId && sceneStartMap.has(iss.sceneId)) {
        iss.time = sceneStartMap.get(iss.sceneId);
      } else {
        iss.time = partFrom;
      }
    }
    iss.isUnknownName = UNKNOWN_VOCAB_CODES.has(iss.code);
    if (!iss.suggestedFix) {
      iss.suggestedFix = getSuggestedFixForIssue(iss);
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  return { doc, issues, valid: !hasErrors };
}

function getSuggestedFixForIssue(iss: ValidationIssue): string {
  switch (iss.code) {
    case 'FRACTIONAL_PIXEL_SIZE':
      return 'Convert fractional 0..1 size into pixel dimensions (e.g., w: 400, h: 120). Only x and y use 0..1 fractions.';
    case 'THIN_LINE_HEIGHT':
      return 'Set line or underline height h >= 6 px (or use Auto-Repair).';
    case 'IMAGE_BOTH_W_AND_H':
      return 'Remove "h" from the image/video layer and specify only "w" in pixels.';
    case 'INVALID_COLOR_TOKEN':
      return 'Use a valid @token (@acc, @ink, @surf, @warn, @second, @bg) or 6-digit #RRGGBB hex.';
    case 'FORBIDDEN_CODE_IDENTIFIER':
      return 'Replace Math.random/Date/window with deterministic api.rand(seed) or api.noise(x, seed).';
    case 'ENTER_AND_ENTRANCE_MACRO':
      return 'Remove "enter" or set "enter": "none" when using an entrance macro (pop, slam, drop, slide, rise).';
    case 'FINAL_SCENE_EXIT_NOT_NONE':
      return 'Set "exit": "none" on layers that stay on screen until the end of the final scene.';
    case 'SAFE_AREA_WARNING':
      return 'Move x/y closer to 0.10..0.90 or reduce w/h so the layer stays inside the 2.5% safe margin.';
    case 'TEXT_WIDTH_TOO_SMALL':
      return 'Add "fit": "shrink" or increase "w" on the text layer.';
    default:
      if (UNKNOWN_VOCAB_CODES.has(iss.code)) {
        return 'Replace the unknown name with one of the built-in SPEC Part A vocabulary names.';
      }
      return 'Update the property in JSON to match SPEC Part A rules and re-validate.';
  }
}

/**
 * M12 Lenient Preview check:
 * Returns true if there are zero errors OR if every error is of "unknown vocabulary name" type
 * (so the preview can still play while skipping unknown layers with a visible marker).
 */
export function canPlayLenientPreview(issues: ValidationIssue[]): {
  canPreview: boolean;
  hasUnknownOnlyErrors: boolean;
  blockingErrors: ValidationIssue[];
} {
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length === 0) {
    return { canPreview: true, hasUnknownOnlyErrors: false, blockingErrors: [] };
  }
  const nonVocabErrors = errors.filter((e) => !e.isUnknownName && !UNKNOWN_VOCAB_CODES.has(e.code));
  return {
    canPreview: nonVocabErrors.length === 0,
    hasUnknownOnlyErrors: nonVocabErrors.length === 0,
    blockingErrors: nonVocabErrors,
  };
}

/**
 * Formats SPEC Part B — Fix Prompt for pasting back into any AI chat when errors occur.
 * Auto-trims to the relevant scene snippet when `doc` is large (M12).
 */
export function buildFixPrompt(
  arg1: ValidationIssue[] | string,
  arg2?: RecipeDocument | ValidationIssue[] | string
): string {
  const issues: ValidationIssue[] = Array.isArray(arg1)
    ? arg1
    : Array.isArray(arg2)
    ? arg2
    : [];
  const docOrRaw = Array.isArray(arg1) ? arg2 : arg1;
  let doc: RecipeDocument | undefined;
  if (docOrRaw && typeof docOrRaw === 'object' && !Array.isArray(docOrRaw)) {
    doc = docOrRaw as RecipeDocument;
  } else if (typeof docOrRaw === 'string') {
    try {
      doc = JSON.parse(docOrRaw) as RecipeDocument;
    } catch {
      // ignore
    }
  }

  const errorLines = issues
    .map((iss, idx) => {
      const loc = [
        iss.sceneId ? `scene:${iss.sceneId}` : '',
        iss.layerId ? `layer:${iss.layerId}` : '',
        iss.path ? `prop:${iss.path}` : '',
        iss.time !== undefined ? `t:${iss.time.toFixed(2)}s` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const fixHint = iss.suggestedFix ? ` -> Fix: ${iss.suggestedFix}` : '';
      return `${idx + 1}. [${iss.severity.toUpperCase()} ${iss.code}] ${loc ? `(${loc}) ` : ''}${iss.message}${fixHint}`;
    })
    .join('\n');

  let snippetBlock = '';
  if (doc && Array.isArray(doc.scenes) && doc.scenes.length > 2) {
    const affectedSceneIds = new Set(issues.map((i) => i.sceneId).filter(Boolean));
    const relevantScenes = doc.scenes.filter((s) => affectedSceneIds.has(s.id));
    if (relevantScenes.length > 0 && relevantScenes.length < doc.scenes.length) {
      snippetBlock = `\n\nRELEVANT SCENE SNIPPET(S) TO FIX:\n${JSON.stringify(relevantScenes, null, 2)}`;
    }
  }

  return `Your RECIPE v3.1 JSON had these validation errors. Fix ONLY these. Return the complete corrected JSON (same part and range), nothing else, no explanation:\n\n${errorLines}${snippetBlock}`;
}
