import type { SentenceItem, TranscriptData, WordItem } from './types.ts';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseTimestampToSeconds(str: string): number {
  const clean = str.trim().replace(',', '.');
  const parts = clean.split(':').map((p) => parseFloat(p));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

/**
 * Spreads words inside a sentence interval [s, e] proportionally by character count
 * per SPEC Part A Section 2 ("spread time inside each sentence by character count").
 */
function spreadWordsAcrossSentence(
  text: string,
  s: number,
  e: number,
  startWordIdx: number
): WordItem[] {
  const rawTokens = text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[.,!?;:"'()[\]]+|[.,!?;:"'()[\]]+$/g, ''))
    .filter((w) => w.length > 0);

  if (rawTokens.length === 0) return [];
  const totalChars = Math.max(1, rawTokens.reduce((acc, w) => acc + w.length, 0));
  const span = Math.max(0.1, e - s);
  let curChar = 0;

  return rawTokens.map((w, idx) => {
    const wStart = s + (curChar / totalChars) * span;
    curChar += w.length;
    const wEnd = s + (curChar / totalChars) * span;
    return {
      i: startWordIdx + idx,
      w,
      s: round2(wStart),
      e: round2(Math.max(wStart + 0.05, wEnd)),
    };
  });
}

/**
 * Parses a transcript from any common format:
 * 1. JSON with `{ sentences, words }` or Whisper `{ segments, words }` or array of `{ w/word, s/start, e/end }`
 * 2. SRT or WebVTT subtitle blocks (`00:00:00,000 --> 00:00:03,100`)
 * 3. Timestamped lines (`0:00.00 - 0:03.10 Text` or `[00:00] Text` or `0.22 sequence`)
 * 4. Plain text (spreads sentences and words across `fallbackDuration`)
 */
export function parseTranscript(rawInput: string, fallbackDuration = 12): TranscriptData {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      rawText: '',
      duration: fallbackDuration,
      sentences: [],
      words: [],
    };
  }

  // 1. Try JSON format
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return parseJsonTranscript(parsed, trimmed, fallbackDuration);
    } catch {
      // Fall through to text parsers
    }
  }

  // 2. Try SRT / WebVTT format (`-->`)
  if (trimmed.includes('-->')) {
    return parseSrtOrVtt(trimmed, fallbackDuration);
  }

  // 3. Try line-timestamped format (`[00:00 - 00:03] ...` or `0:00 ...`)
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const timeLineRegex = /^\[?(\d+:?\d*(?:[.,]\d+)?)(?:\s*(?:-|-->|to)\s*(\d+:?\d*(?:[.,]\d+)?))?\]?\s+(.+)$/;
  if (lines.length > 0 && lines.every((l) => timeLineRegex.test(l))) {
    const sentences: SentenceItem[] = [];
    const words: WordItem[] = [];
    for (let idx = 0; idx < lines.length; idx++) {
      const m = timeLineRegex.exec(lines[idx])!;
      const s = parseTimestampToSeconds(m[1]);
      let e = m[2] ? parseTimestampToSeconds(m[2]) : 0;
      if (!e && idx + 1 < lines.length) {
        const nextM = timeLineRegex.exec(lines[idx + 1]);
        if (nextM) e = parseTimestampToSeconds(nextM[1]);
      }
      const text = m[3].trim();
      if (!e || e <= s) {
        e = s + Math.max(1.5, text.length / 14);
      }
      sentences.push({ i: idx, text, s: round2(s), e: round2(e) });
      const spread = spreadWordsAcrossSentence(text, s, e, words.length);
      words.push(...spread);
    }
    const maxEnd = sentences.length > 0 ? sentences[sentences.length - 1].e : fallbackDuration;
    return {
      rawText: trimmed,
      duration: round2(Math.max(maxEnd, fallbackDuration)),
      sentences,
      words,
    };
  }

  // 4. Plain text: split into sentences and spread by character count across fallbackDuration
  const rawSentences = trimmed
    .split(/(?<=[.!?।|])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sentenceList = rawSentences.length > 0 ? rawSentences : [trimmed];
  const totalChars = Math.max(1, sentenceList.reduce((acc, s) => acc + s.length, 0));
  const dur = Math.max(2, fallbackDuration || round2(totalChars / 13));

  const sentences: SentenceItem[] = [];
  const words: WordItem[] = [];
  let charCursor = 0;

  sentenceList.forEach((sText, idx) => {
    const sStart = (charCursor / totalChars) * dur;
    charCursor += sText.length;
    const sEnd = (charCursor / totalChars) * dur;
    sentences.push({
      i: idx,
      text: sText,
      s: round2(sStart),
      e: round2(sEnd),
    });
    const spread = spreadWordsAcrossSentence(sText, sStart, sEnd, words.length);
    words.push(...spread);
  });

  return {
    rawText: trimmed,
    duration: round2(dur),
    sentences,
    words,
  };
}

function parseJsonTranscript(parsed: any, rawText: string, fallbackDuration: number): TranscriptData {
  const sentences: SentenceItem[] = [];
  const words: WordItem[] = [];

  if (Array.isArray(parsed)) {
    // Could be an array of words or sentences
    if (parsed.length > 0 && ('w' in parsed[0] || 'word' in parsed[0])) {
      parsed.forEach((item, idx) => {
        const w = String(item.w ?? item.word ?? '').trim();
        const s = round2(Number(item.s ?? item.start ?? 0));
        const e = round2(Number(item.e ?? item.end ?? s + 0.25));
        if (w.length > 0 && e > s) {
          words.push({ i: words.length, w, s, e });
        }
        void idx;
      });
      // Group words into clauses/sentences of ~7 words
      for (let i = 0; i < words.length; i += 7) {
        const chunk = words.slice(i, i + 7);
        sentences.push({
          i: sentences.length,
          text: chunk.map((c) => c.w).join(' '),
          s: chunk[0].s,
          e: chunk[chunk.length - 1].e,
        });
      }
    } else {
      parsed.forEach((item, idx) => {
        const text = String(item.text ?? '').trim();
        const s = round2(Number(item.s ?? item.start ?? 0));
        const e = round2(Number(item.e ?? item.end ?? s + 2));
        sentences.push({ i: idx, text, s, e });
        words.push(...spreadWordsAcrossSentence(text, s, e, words.length));
      });
    }
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.sentences)) {
      parsed.sentences.forEach((item: any, idx: number) => {
        const text = String(item.text ?? '').trim();
        const s = round2(Number(item.s ?? item.start ?? 0));
        const e = round2(Number(item.e ?? item.end ?? s + 2));
        sentences.push({ i: item.i ?? idx, text, s, e });
      });
    } else if (Array.isArray(parsed.segments)) {
      parsed.segments.forEach((seg: any, idx: number) => {
        const text = String(seg.text ?? '').trim();
        const s = round2(Number(seg.start ?? seg.s ?? 0));
        const e = round2(Number(seg.end ?? seg.e ?? s + 2));
        sentences.push({ i: idx, text, s, e });
        if (Array.isArray(seg.words)) {
          seg.words.forEach((wObj: any) => {
            const w = String(wObj.word ?? wObj.w ?? '').trim();
            const ws = round2(Number(wObj.start ?? wObj.s ?? s));
            const we = round2(Number(wObj.end ?? wObj.e ?? ws + 0.2));
            if (w && we > ws) {
              words.push({ i: words.length, w, s: ws, e: we });
            }
          });
        }
      });
    }

    if (Array.isArray(parsed.words) && words.length === 0) {
      parsed.words.forEach((wObj: any, idx: number) => {
        const w = String(wObj.w ?? wObj.word ?? '').trim();
        const s = round2(Number(wObj.s ?? wObj.start ?? 0));
        const e = round2(Number(wObj.e ?? wObj.end ?? s + 0.2));
        if (w && e > s) {
          words.push({ i: wObj.i ?? idx, w, s, e });
        }
      });
    }

    if (words.length === 0 && sentences.length > 0) {
      for (const sent of sentences) {
        words.push(...spreadWordsAcrossSentence(sent.text, sent.s, sent.e, words.length));
      }
    }
    if (sentences.length === 0 && words.length > 0) {
      for (let i = 0; i < words.length; i += 7) {
        const chunk = words.slice(i, i + 7);
        sentences.push({
          i: sentences.length,
          text: chunk.map((c) => c.w).join(' '),
          s: chunk[0].s,
          e: chunk[chunk.length - 1].e,
        });
      }
    }
  }

  const maxS = sentences.length > 0 ? sentences[sentences.length - 1].e : 0;
  const maxW = words.length > 0 ? words[words.length - 1].e : 0;
  const duration = round2(Number(parsed?.duration) || Math.max(maxS, maxW, fallbackDuration));

  return { rawText, duration, sentences, words };
}

function parseSrtOrVtt(raw: string, fallbackDuration: number): TranscriptData {
  const blocks = raw
    .replace(/^WEBVTT[^\n]*\n+/i, '')
    .trim()
    .split(/\n\s*\n/);

  const sentences: SentenceItem[] = [];
  const words: WordItem[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const arrowLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowLineIdx === -1) continue;
    const arrowParts = lines[arrowLineIdx].split('-->');
    const s = parseTimestampToSeconds(arrowParts[0]);
    const e = parseTimestampToSeconds((arrowParts[1] || '').split(/\s+/)[0]);
    const text = lines
      .slice(arrowLineIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!text) continue;

    sentences.push({
      i: sentences.length,
      text,
      s: round2(s),
      e: round2(Math.max(s + 0.2, e)),
    });
    words.push(...spreadWordsAcrossSentence(text, s, Math.max(s + 0.2, e), words.length));
  }

  const maxEnd = sentences.length > 0 ? sentences[sentences.length - 1].e : fallbackDuration;
  return {
    rawText: raw,
    duration: round2(Math.max(maxEnd, fallbackDuration)),
    sentences,
    words,
  };
}

export const DEMO_HINGLISH_TRANSCRIPT = `[0.00 - 4.80] Yeh sequence hota hai app banane ka: sabse pehle app banao, test karo aur improve karo,
[4.80 - 7.10] jab tak ki aapko app final na lage.
[7.10 - 11.76] Yeh abhi aapko aur acche samajh mein aayega jab main aapko mere app ka sequence dikhaunga.`;
