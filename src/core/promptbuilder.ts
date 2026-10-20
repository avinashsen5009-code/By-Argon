import promptPackRaw from '../assets/prompt-pack.txt?raw';
import type { CarryState, ScreenLang, ThemeSpec, TranscriptData } from './types.ts';

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
