import type {
  CarryState,
  PartMeta,
  RecipeDocument,
  TranscriptData,
  ValidationIssue,
} from './types.ts';

export interface PartSlot {
  part: PartMeta;
  rawJson: string;
  doc?: RecipeDocument;
  issues: ValidationIssue[];
  status: 'empty' | 'valid' | 'warnings' | 'errors';
  carryOut?: CarryState;
}

/**
 * Splits a transcript into 30–40 second parts at sentence boundaries (never mid-sentence)
 * per SPEC Part A Section 12 & Part D Section 5.
 * Videos under 45 seconds remain a single part (1 of 1).
 */
export function splitTranscriptIntoParts(
  transcript: TranscriptData,
  targetPartSeconds = 36
): PartMeta[] {
  const totalDur = Math.max(1, transcript.duration);
  if (totalDur <= 45 || transcript.sentences.length <= 1) {
    return [
      {
        n: 1,
        of: 1,
        from: 0,
        to: Math.round(totalDur * 100) / 100,
      },
    ];
  }

  const ranges: { from: number; to: number }[] = [];
  let partStart = 0;

  for (let i = 0; i < transcript.sentences.length; i++) {
    const sent = transcript.sentences[i];
    const span = sent.e - partStart;
    const remaining = totalDur - sent.e;
    const isLast = i === transcript.sentences.length - 1;

    if (isLast) {
      ranges.push({
        from: Math.round(partStart * 100) / 100,
        to: Math.round(totalDur * 100) / 100,
      });
      break;
    }

    // Cut at sentence boundary when span is 30-40s and remaining isn't a tiny orphan (< 12s)
    if (span >= 30 && (span >= targetPartSeconds || remaining >= 25) && remaining >= 12) {
      ranges.push({
        from: Math.round(partStart * 100) / 100,
        to: Math.round(sent.e * 100) / 100,
      });
      partStart = sent.e;
    }
  }

  if (ranges.length === 0) {
    ranges.push({ from: 0, to: Math.round(totalDur * 100) / 100 });
  }

  return ranges.map((r, idx) => ({
    n: idx + 1,
    of: ranges.length,
    from: r.from,
    to: r.to,
  }));
}

/**
 * Extracts or synthesizes the CarryState from a completed part document so the next part's
 * prompt gets `carry.persist` and `carry.last`.
 */
export function extractCarryFromPart(doc: RecipeDocument): CarryState {
  if (doc.carry) {
    return doc.carry;
  }
  const partEnd = doc.meta?.part?.to ?? doc.meta?.duration ?? 0;
  const persist: { id: string; until: 'open' | number }[] = [];

  for (const scene of doc.scenes || []) {
    for (const item of scene.layers || []) {
      if ('patch' in item) continue;
      const t1 = item.t?.[1];
      if (typeof t1 === 'number' && Math.abs(t1 - partEnd) < 0.05 && item.exit === 'none') {
        persist.push({ id: item.id, until: 'open' });
      }
    }
  }

  const lastSceneIds = (doc.scenes || []).slice(-3).map((s) => s.id);
  return {
    persist,
    last: lastSceneIds,
    hero: doc.scenes?.[doc.scenes.length - 1]?.id ?? 'previous scene',
    notes: 'Auto-extracted carry state from previous part',
  };
}
