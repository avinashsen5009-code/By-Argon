import type { CompiledLayer, SentenceItem, TimeValue, TranscriptData, WordItem } from './types.ts';

const ANCHOR_REGEX = /^(w|s)(\d+)(e)?([+-]\d+(?:\.\d+)?)?$/;

export interface AnchorResolutionResult {
  seconds: number;
  valid: boolean;
  error?: string;
}

/**
 * Resolves a time value (number in seconds, or anchor string like "w12", "w12e", "s3+0.2", "s3e-0.1")
 * against the project's transcript.
 */
export function resolveTimeValue(
  val: TimeValue | undefined,
  transcript?: TranscriptData,
  fallback = 0
): AnchorResolutionResult {
  if (val === undefined || val === null) {
    return { seconds: fallback, valid: true };
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      return { seconds: fallback, valid: false, error: `Non-finite time value: ${String(val)}` };
    }
    return { seconds: val, valid: true };
  }
  const trimmed = String(val).trim();
  const numeric = Number(trimmed);
  if (trimmed !== '' && !Number.isNaN(numeric) && /^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    return { seconds: numeric, valid: true };
  }

  const match = ANCHOR_REGEX.exec(trimmed);
  if (!match) {
    return {
      seconds: fallback,
      valid: false,
      error: `Invalid time or anchor syntax "${trimmed}"`,
    };
  }

  const [, kind, idxStr, isEnd, offsetStr] = match;
  const idx = parseInt(idxStr, 10);
  const offset = offsetStr ? parseFloat(offsetStr) : 0;

  if (!transcript) {
    return {
      seconds: fallback,
      valid: false,
      error: `Cannot resolve anchor "${trimmed}" without a transcript`,
    };
  }

  if (kind === 'w') {
    const word: WordItem | undefined = transcript.words.find((w) => w.i === idx) ?? transcript.words[idx];
    if (!word) {
      return {
        seconds: fallback,
        valid: false,
        error: `Unknown word anchor "${trimmed}" (word index ${idx} not found in transcript)`,
      };
    }
    const base = isEnd ? word.e : word.s;
    return { seconds: Math.max(0, base + offset), valid: true };
  } else {
    const sentence: SentenceItem | undefined =
      transcript.sentences.find((s) => s.i === idx) ?? transcript.sentences[idx];
    if (!sentence) {
      return {
        seconds: fallback,
        valid: false,
        error: `Unknown sentence anchor "${trimmed}" (sentence index ${idx} not found in transcript)`,
      };
    }
    const base = isEnd ? sentence.e : sentence.s;
    return { seconds: Math.max(0, base + offset), valid: true };
  }
}

export function isValidAnchorSyntax(val: TimeValue): boolean {
  if (typeof val === 'number') return Number.isFinite(val);
  const trimmed = String(val).trim();
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return true;
  return ANCHOR_REGEX.test(trimmed);
}

/**
 * Integer frame clock: t = frameIndex / fps
 */
export function frameToTime(frameIndex: number, fps: number): number {
  return Math.max(0, Math.floor(frameIndex)) / Math.max(1, fps);
}

export function timeToFrame(t: number, fps: number): number {
  return Math.max(0, Math.round(t * Math.max(1, fps)));
}

export function totalFramesForDuration(duration: number, fps: number): number {
  return Math.max(1, Math.ceil(duration * Math.max(1, fps)));
}

/**
 * Fast active-layer query at timestamp t using intervalSorted (sorted by t0).
 * Returns layers active at t (t0 <= t < t1, or at the exact final frame if exit === 'none')
 * sorted by zIndex ascending, then orderIndex ascending.
 */
export function queryActiveLayersAtTime(
  intervalSorted: CompiledLayer[],
  t: number,
  duration: number
): CompiledLayer[] {
  // Binary search to find first layer with t0 > t + epsilon
  const eps = 1e-7;
  let lo = 0;
  let hi = intervalSorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (intervalSorted[mid].t0 <= t + eps) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  const active: CompiledLayer[] = [];
  const isAtEnd = Math.abs(t - duration) < 1e-4;
  for (let i = 0; i < lo; i++) {
    const layer = intervalSorted[i];
    if (t >= layer.t0 - eps && (t < layer.t1 - eps || (isAtEnd && Math.abs(layer.t1 - duration) < 1e-3))) {
      active.push(layer);
    }
  }

  active.sort((a, b) => {
    if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
    return a.orderIndex - b.orderIndex;
  });

  return active;
}
