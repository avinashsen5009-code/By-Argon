import { PROMPT_PACK_TEXT as promptPackRaw } from '../assets/promptPack.ts';
import type {
  CarryState,
  CompiledLayer,
  RecipeDocument,
  Scene,
  ScreenLang,
  ThemeSpec,
  TranscriptData,
} from './types.ts';

export interface PromptBuildOptions {
  w: number;
  h: number;
  fps: number;
  duration: number;
  theme: ThemeSpec;
  screenText: ScreenLang;
  partNumber: number;
  totalParts: number;
  rangeFrom: number;
  rangeTo: number;
  carry?: CarryState | null;
  assetsList?: string[];
  transcript: TranscriptData;
}

/**
 * Returns the exact SPEC Part A prompt pack text (before ## 15. INPUT)
 * and appends the filled-in ## 15. INPUT section for the requested part.
 */
export function buildPromptForPart(opts: PromptBuildOptions): string {
  const aspectLabel =
    opts.w === 1080 && opts.h === 1920
      ? '9:16'
      : opts.w === 1920 && opts.h === 1080
      ? '16:9'
      : opts.w === 1080 && opts.h === 1080
      ? '1:1'
      : `${opts.w}:${opts.h}`;

  const themeVal = opts.theme.hex ? opts.theme.hex : String(opts.theme.palette ?? 1);
  const carryStr =
    opts.carry && (opts.carry.persist?.length || opts.carry.last?.length || opts.carry.hero)
      ? JSON.stringify(opts.carry)
      : '(none)';

  const assetsStr =
    opts.assetsList && opts.assetsList.length > 0 ? opts.assetsList.join(', ') : 'none';

  // Filter sentences and words within [rangeFrom, rangeTo] (keeping global indices `i`)
  const eps = 0.05;
  const sliceSentences = opts.transcript.sentences.filter(
    (s) => s.e > opts.rangeFrom + eps && s.s < opts.rangeTo - eps
  );
  const sliceWords = opts.transcript.words.filter(
    (w) => w.e > opts.rangeFrom + eps && w.s < opts.rangeTo - eps
  );

  const inputSection = [
    '## 15. INPUT (filled in by you or the app)',
    `CANVAS: ${opts.w}x${opts.h} (${aspectLabel}), ${opts.fps} fps`,
    `DURATION: ${opts.duration.toFixed(2)} s (whole video)`,
    `THEME: ${themeVal}`,
    `SCREEN_TEXT: ${opts.screenText}`,
    `PART: ${opts.partNumber} of ${opts.totalParts}, RANGE ${opts.rangeFrom.toFixed(2)}-${opts.rangeTo.toFixed(2)}`,
    `CARRY: ${carryStr}`,
    `ASSETS I CAN PROVIDE: ${assetsStr}`,
    `SENTENCES: ${JSON.stringify(sliceSentences)}`,
    `WORDS: ${JSON.stringify(sliceWords)}`,
  ].join('\n');

  const marker = '## 15. INPUT';
  const idx = promptPackRaw.indexOf(marker);
  const basePrompt = idx !== -1 ? promptPackRaw.slice(0, idx).trimEnd() : promptPackRaw.trimEnd();

  return `${basePrompt}\n\n${inputSection}\n`;
}

export function getRawPromptPackText(): string {
  return promptPackRaw;
}

/**
 * M11 Scene Change Request Prompt:
 * Given a single Scene object, user's plain-language request, and relevant transcript slice,
 * builds a self-contained prompt asking the AI to return ONLY the replacement Scene JSON object
 * with the exact same `id` and `t` range.
 */
export interface SceneChangePromptArgs {
  doc?: RecipeDocument;
  scene: Scene;
  transcript?: TranscriptData;
  userChangeRequest: string;
}

export function buildSceneChangePrompt(
  sceneOrOpts: Scene | SceneChangePromptArgs,
  userRequest = '',
  transcript?: TranscriptData,
  canvasW = 1920,
  canvasH = 1080
): string {
  const isOpts = 'scene' in sceneOrOpts && 'userChangeRequest' in sceneOrOpts;
  const scene = isOpts ? sceneOrOpts.scene : sceneOrOpts;
  const reqText = isOpts ? sceneOrOpts.userChangeRequest : userRequest;
  const tr = isOpts ? sceneOrOpts.transcript : transcript;
  const cw = isOpts && sceneOrOpts.doc?.meta?.w ? sceneOrOpts.doc.meta.w : canvasW;
  const ch = isOpts && sceneOrOpts.doc?.meta?.h ? sceneOrOpts.doc.meta.h : canvasH;

  const s0 = typeof scene.t?.[0] === 'number' ? scene.t[0] : 0;
  const s1 = typeof scene.t?.[1] === 'number' ? scene.t[1] : 10;
  const sliceWords = tr
    ? tr.words.filter((w) => w.e >= s0 - 0.1 && w.s <= s1 + 0.1)
    : [];

  return [
    'You are editing a single scene in a RECIPE v3.1 motion-graphics document.',
    `Canvas: ${cw}x${ch} px. Safe area: x,y in 0.05..0.95. Positions x,y are 0..1 fractions; sizes w,h,size,radius are ALWAYS pixels (>4).`,
    'Allowed layer types: text, shape, path, svg, icon, image, video, figure, group, use, highlight, particles, chart, background, captions, code.',
    'Allowed motion macros: pop, slam, drop, slide, rise, bump, shake, grow, to, orbit, arc, hop, merge, burst, press, pulse, breathe, float, sway, wiggle, blink.',
    'Allowed components: disc, chip, badge, stamp, button, cursor, meter, bubble, chat, phone, browser, toast, kpi, timeline, logo, photo.',
    'Allowed color tokens: @bg, @scn, @surf, @cardHi, @cardLo, @cardBorder, @cardStroke, @heroHi, @heroLo, @ink, @muted, @dim, @acc, @accSoft, @second, @warn, @warnBg, @dark, @track, @line.',
    '',
    `USER CHANGE REQUEST FOR SCENE "${scene.id}":`,
    reqText.trim() || 'Make this scene more dynamic and clear while preserving timing.',
    '',
    sliceWords.length > 0 ? `WORDS IN THIS SCENE RANGE:\n${JSON.stringify(sliceWords)}\n` : '',
    'CURRENT SCENE JSON:',
    JSON.stringify(scene, null, 2),
    '',
    `Return ONLY the replacement Scene JSON object with the exact same "id": "${scene.id}" and "t": ${JSON.stringify(scene.t)}. No markdown prose, no outer document wrapper.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Replaces a scene in a RecipeDocument by matching `id` (or parsing a single Scene JSON pasted by the user).
 */
export function replaceSceneInRecipe(
  doc: RecipeDocument,
  arg2: string,
  arg3?: string
): { updatedDoc?: RecipeDocument; replacedSceneId?: string; error?: string } {
  try {
    // Support both (doc, targetSceneId, rawReplacementJson) and (doc, rawReplacementJson, targetSceneId)
    const arg2LooksLikeJson = arg2.trim().startsWith('{') || arg2.includes('```');
    const rawReplacementJson = arg2LooksLikeJson ? arg2 : (arg3 ?? '');
    const targetSceneId = arg2LooksLikeJson ? arg3 : arg2;

    let text = rawReplacementJson.trim();
    if (text.includes('```')) {
      const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
      if (m?.[1]) text = m[1].trim();
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    }
    const parsed = JSON.parse(text) as Scene;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.layers)) {
      return { error: 'Pasted JSON is not a valid Scene object (must contain a "layers" array)' };
    }

    const clone = structuredClone(doc);
    const matchId = targetSceneId || parsed.id;
    const idx = clone.scenes.findIndex((s) => s.id === matchId);
    if (idx === -1) {
      return { error: `Scene "${matchId}" not found in recipe` };
    }
    const origScene = clone.scenes[idx];
    clone.scenes[idx] = {
      ...parsed,
      id: origScene.id,
      t: parsed.t ?? origScene.t,
    };
    return { updatedDoc: clone, replacedSceneId: origScene.id };
  } catch (err: any) {
    return { error: err?.message ?? 'Invalid replacement scene JSON' };
  }
}

/**
 * M11 Tap-to-Select Layer Change Note:
 * Builds a concise note identifying a tapped layer (`id`, `type`, `sceneId`, `t0..t1`)
 * so the user can paste it into their AI chat when asking for adjustments.
 */
export function buildLayerChangeNote(layer: CompiledLayer, note?: string): string {
  const base = `In scene "${layer.sceneId}", update layer "${layer.id}" (type: "${layer.type}"${layer.kind ? `, kind: "${layer.kind}"` : ''}, active ${layer.t0.toFixed(2)}s–${layer.t1.toFixed(2)}s at x=${Number(layer.x ?? 0.5).toFixed(2)}, y=${Number(layer.y ?? 0.5).toFixed(2)})`;
  return note && note.trim() ? `${base}: ${note.trim()}` : `${base}: `;
}
