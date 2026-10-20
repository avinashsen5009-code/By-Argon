import type { SentenceItem, TranscriptData, WordItem } from './types.ts';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseTimestampToSeconds(str: string): number {
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
 * Marks estimated: true on every word.
 */
function spreadWordsAcrossSentence(
  text: string,
  s: number,
  e: number,
  startWordIdx: number,
  estimated = true
): WordItem[] {
  const rawTokens = text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[.,!?;:"'()[\]]+|[.,!?;:"'()[\]]+$/g, ''))
    .filter((w) => w.length > 0);

  if (rawTokens.length === 0) return [];
  const totalChars = Math.max(1, rawTokens.reduce((acc, w) => acc + w.length, 0));
  const span = Math.max(0.05, e - s);
  let curChar = 0;

  return rawTokens.map((w, idx) => {
    const wStart = s + (curChar / totalChars) * span;
    curChar += w.length;
    const wEnd = s + (curChar / totalChars) * span;
    return {
      i: startWordIdx + idx,
      w,
      s: round2(wStart),
      e: round2(Math.max(wStart + 0.04, wEnd)),
      estimated,
    };
  });
}

/**
 * Groups word items into sentences, breaking at punctuation (. ? ! | ।)
 * OR at pauses longer than 0.6 s per M10.
 */
function buildSentencesFromWords(words: WordItem[], rawWordsWithPunct?: string[]): SentenceItem[] {
  if (words.length === 0) return [];
  const sentences: SentenceItem[] = [];
  let chunk: WordItem[] = [];
  let rawChunk: string[] = [];

  const flushChunk = () => {
    if (chunk.length === 0) return;
    sentences.push({
      i: sentences.length,
      text: rawChunk.length === chunk.length ? rawChunk.join(' ') : chunk.map((c) => c.w).join(' '),
      s: chunk[0].s,
      e: chunk[chunk.length - 1].e,
      estimated: chunk.some((c) => c.estimated),
    });
    chunk = [];
    rawChunk = [];
  };

  for (let idx = 0; idx < words.length; idx++) {
    const w = words[idx];
    const rawTok = rawWordsWithPunct?.[idx] ?? w.w;
    if (chunk.length > 0) {
      const prev = chunk[chunk.length - 1];
      const pause = w.s - prev.e;
      if (pause > 0.6) {
        flushChunk();
      }
    }
    chunk.push(w);
    rawChunk.push(rawTok);

    if (/[.!?|।]$/.test(rawTok) || chunk.length >= 14) {
      flushChunk();
    }
  }
  flushChunk();
  return sentences;
}

/**
 * Enforces monotonic timestamps on words and sentences, clamping non-monotonic entries
 * and appending warnings to `warnings`. Also drops zero-length words.
 */
function sanitizeAndNormalizeTranscript(
  rawText: string,
  sentences: SentenceItem[],
  words: WordItem[],
  fallbackDuration: number,
  estimated: boolean,
  warnings: string[]
): TranscriptData {
  // 1. Filter zero-length words and clamp non-monotonic word times
  const cleanWords: WordItem[] = [];
  let prevWordEnd = 0;

  for (const w of words) {
    const trimmed = w.w.trim();
    if (!trimmed) continue;
    let s = round2(Math.max(0, w.s));
    let e = round2(w.e);
    if (s < prevWordEnd - 0.01) {
      warnings.push(
        `Clamped non-monotonic word "${trimmed}" start time from ${s.toFixed(2)}s to ${prevWordEnd.toFixed(2)}s`
      );
      s = prevWordEnd;
    }
    if (e <= s) {
      if (w.e < w.s) {
        warnings.push(`Clamped inverted word "${trimmed}" end time (${w.e.toFixed(2)}s < ${s.toFixed(2)}s)`);
      }
      e = round2(s + 0.12);
    }
    prevWordEnd = e;
    cleanWords.push({
      i: cleanWords.length,
      w: trimmed,
      s,
      e,
      estimated: w.estimated ?? estimated,
    });
  }

  // 2. Clamp non-monotonic sentence times
  const cleanSentences: SentenceItem[] = [];
  let prevSentStart = 0;
  for (const sent of sentences) {
    const text = sent.text.trim();
    if (!text) continue;
    let s = round2(Math.max(0, sent.s));
    let e = round2(sent.e);
    if (s < prevSentStart - 0.01) {
      warnings.push(`Clamped non-monotonic sentence #${cleanSentences.length} start time to ${prevSentStart.toFixed(2)}s`);
      s = prevSentStart;
    }
    if (e <= s) {
      e = round2(s + Math.max(0.5, text.length / 14));
    }
    prevSentStart = s;
    cleanSentences.push({
      i: cleanSentences.length,
      text,
      s,
      e,
      estimated: sent.estimated ?? estimated,
    });
  }

  const maxS = cleanSentences.length > 0 ? cleanSentences[cleanSentences.length - 1].e : 0;
  const maxW = cleanWords.length > 0 ? cleanWords[cleanWords.length - 1].e : 0;
  const duration = round2(Math.max(maxS, maxW, fallbackDuration));

  return {
    rawText,
    duration,
    sentences: cleanSentences,
    words: cleanWords,
    estimated,
    warnings,
  };
}

/**
 * Parses a transcript from any of the M10 formats:
 * 1. SRT and WebVTT (cue-level)
 * 2. Lines `MM:SS.ss --> MM:SS.ss spoken words` (also `HH:MM:SS.mmm` or `[0.00 - 4.80] ...`)
 * 3. JSON: array of `{w,s,e}` or `{word,start,end}`, or `{text,start,end}`, or nested `{segments:[{words:[...]}]}`
 * 4. One word per line: `0.12 Hello` or `Hello 0.12 0.40`
 * 5. Plain text + total duration: distribute by character count (flagged as `estimated: true`)
 */
export function parseTranscript(rawInput: string, fallbackDuration = 12): TranscriptData {
  const trimmed = rawInput.trim();
  const warnings: string[] = [];

  if (!trimmed) {
    return {
      rawText: '',
      duration: fallbackDuration,
      sentences: [],
      words: [],
      estimated: false,
      warnings: [],
    };
  }

  // 1. Try JSON format
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return parseJsonTranscript(parsed, trimmed, fallbackDuration, warnings);
    } catch {
      // Fall through to text parsers
    }
  }

  // 2. Try SRT / WebVTT cue blocks (multi-line blocks with `-->`)
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const singleLineArrowRegex =
    /^\[?(\d+(?::\d+)*(?:[.,]\d+)?)\s*(?:-->|-|to)\s*(\d+(?::\d+)*(?:[.,]\d+)?)\]?\s+(.+)$/i;

  if (trimmed.includes('-->') && !lines.every((l) => singleLineArrowRegex.test(l))) {
    return parseSrtOrVtt(trimmed, fallbackDuration, warnings);
  }

  // 3. Try one-word-per-line format: `Hello 0.12 0.40` or `0.12 Hello`
  const wordStartEndRegex = /^([^\d\s]\S*)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/;
  const timeThenSingleWordRegex = /^(\d+(?:\.\d+)?)\s+([^\s]+)$/;

  if (lines.length > 0 && lines.every((l) => wordStartEndRegex.test(l))) {
    const rawTokens: string[] = [];
    const words: WordItem[] = [];
    for (const line of lines) {
      const m = wordStartEndRegex.exec(line)!;
      const rawTok = m[1].trim();
      const cleanW = rawTok.replace(/^[.,!?;:"'()[\]]+|[.,!?;:"'()[\]]+$/g, '');
      const s = parseFloat(m[2]);
      const e = parseFloat(m[3]);
      if (cleanW.length > 0) {
        rawTokens.push(rawTok);
        words.push({ i: words.length, w: cleanW, s: round2(s), e: round2(e), estimated: false });
      }
    }
    const sentences = buildSentencesFromWords(words, rawTokens);
    return sanitizeAndNormalizeTranscript(trimmed, sentences, words, fallbackDuration, false, warnings);
  }

  if (lines.length > 0 && lines.every((l) => timeThenSingleWordRegex.test(l))) {
    const rawTokens: string[] = [];
    const words: WordItem[] = [];
    for (let idx = 0; idx < lines.length; idx++) {
      const m = timeThenSingleWordRegex.exec(lines[idx])!;
      const s = parseFloat(m[1]);
      const nextM = idx + 1 < lines.length ? timeThenSingleWordRegex.exec(lines[idx + 1]) : null;
      const e = nextM ? Math.max(s + 0.08, parseFloat(nextM[1])) : s + 0.35;
      const rawTok = m[2].trim();
      const cleanW = rawTok.replace(/^[.,!?;:"'()[\]]+|[.,!?;:"'()[\]]+$/g, '');
      if (cleanW.length > 0) {
        rawTokens.push(rawTok);
        words.push({ i: words.length, w: cleanW, s: round2(s), e: round2(e), estimated: false });
      }
    }
    const sentences = buildSentencesFromWords(words, rawTokens);
    return sanitizeAndNormalizeTranscript(trimmed, sentences, words, fallbackDuration, false, warnings);
  }

  // 4. Try line-timestamped sentence format (`MM:SS.ss --> MM:SS.ss spoken words` or `[0.00 - 4.80] ...`)
  const timeLineRegex =
    /^\[?(\d+(?::\d+)*(?:[.,]\d+)?)(?:\s*(?:-->|-|to)\s*(\d+(?::\d+)*(?:[.,]\d+)?))?\]?\s+(.+)$/i;
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
        e = s + Math.max(1.2, text.length / 14);
      }
      // Split sub-clauses if sentence break punctuation appears inside the line
      const subParts = text
        .split(/(?<=[.!?।|])\s+/)
        .map((p) => p.trim())
        .filter(Boolean);
      const totalChars = Math.max(1, subParts.reduce((a, b) => a + b.length, 0));
      let curChar = 0;
      for (const sub of subParts) {
        const subS = s + (curChar / totalChars) * (e - s);
        curChar += sub.length;
        const subE = s + (curChar / totalChars) * (e - s);
        sentences.push({
          i: sentences.length,
          text: sub,
          s: round2(subS),
          e: round2(subE),
          estimated: true,
        });
        words.push(...spreadWordsAcrossSentence(sub, subS, subE, words.length, true));
      }
    }
    return sanitizeAndNormalizeTranscript(trimmed, sentences, words, fallbackDuration, true, warnings);
  }

  // 5. Plain text: split into sentences at . ? ! | and Hindi danda ।, distribute by character count (estimated: true)
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
      estimated: true,
    });
    const spread = spreadWordsAcrossSentence(sText, sStart, sEnd, words.length, true);
    words.push(...spread);
  });

  warnings.push('Plain text transcript: word and sentence timestamps were estimated by character count (ESTIMATED).');
  return sanitizeAndNormalizeTranscript(trimmed, sentences, words, dur, true, warnings);
}

function parseJsonTranscript(
  parsed: any,
  rawText: string,
  fallbackDuration: number,
  warnings: string[]
): TranscriptData {
  const sentences: SentenceItem[] = [];
  const words: WordItem[] = [];
  const rawTokens: string[] = [];
  let estimated = false;

  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && ('w' in parsed[0] || 'word' in parsed[0])) {
      parsed.forEach((item) => {
        const rawW = String(item.w ?? item.word ?? '').trim();
        const cleanW = rawW.replace(/^[.,!?;:"'()[\]]+|[.,!?;:"'()[\]]+$/g, '');
        const s = round2(Number(item.s ?? item.start ?? 0));
        const e = round2(Number(item.e ?? item.end ?? s + 0.25));
        if (cleanW.length > 0) {
          rawTokens.push(rawW);
          words.push({ i: words.length, w: cleanW, s, e, estimated: false });
        }
      });
      sentences.push(...buildSentencesFromWords(words, rawTokens));
    } else {
      estimated = true;
      parsed.forEach((item, idx) => {
        const text = String(item.text ?? '').trim();
        const s = round2(Number(item.s ?? item.start ?? 0));
        const e = round2(Number(item.e ?? item.end ?? s + 2));
        if (text) {
          sentences.push({ i: idx, text, s, e, estimated: true });
          words.push(...spreadWordsAcrossSentence(text, s, e, words.length, true));
        }
      });
    }
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.sentences)) {
      parsed.sentences.forEach((item: any, idx: number) => {
        const text = String(item.text ?? '').trim();
        const s = round2(Number(item.s ?? item.start ?? 0));
        const e = round2(Number(item.e ?? item.end ?? s + 2));
        if (text) {
          sentences.push({ i: item.i ?? idx, text, s, e });
        }
      });
    } else if (Array.isArray(parsed.segments)) {
      parsed.segments.forEach((seg: any, idx: number) => {
        const text = String(seg.text ?? '').trim();
        const s = round2(Number(seg.start ?? seg.s ?? 0));
        const e = round2(Number(seg.end ?? seg.e ?? s + 2));
        if (text) {
          sentences.push({ i: idx, text, s, e });
        }
        if (Array.isArray(seg.words)) {
          seg.words.forEach((wObj: any) => {
            const rawW = String(wObj.word ?? wObj.w ?? '').trim();
            const cleanW = rawW.replace(/^[.,!?;:"'()[\]]+|[.,!?;:"'()[\]]+$/g, '');
            const ws = round2(Number(wObj.start ?? wObj.s ?? s));
            const we = round2(Number(wObj.end ?? wObj.e ?? ws + 0.2));
            if (cleanW) {
              rawTokens.push(rawW);
              words.push({ i: words.length, w: cleanW, s: ws, e: we, estimated: false });
            }
          });
        }
      });
    }

    if (Array.isArray(parsed.words) && words.length === 0) {
      parsed.words.forEach((wObj: any, idx: number) => {
        const rawW = String(wObj.w ?? wObj.word ?? '').trim();
        const cleanW = rawW.replace(/^[.,!?;:"'()[\]]+|[.,!?;:"'()[\]]+$/g, '');
        const s = round2(Number(wObj.s ?? wObj.start ?? 0));
        const e = round2(Number(wObj.e ?? wObj.end ?? s + 0.2));
        if (cleanW) {
          rawTokens.push(rawW);
          words.push({ i: wObj.i ?? idx, w: cleanW, s, e, estimated: false });
        }
      });
    }

    if (words.length === 0 && sentences.length > 0) {
      estimated = true;
      for (const sent of sentences) {
        sent.estimated = true;
        words.push(...spreadWordsAcrossSentence(sent.text, sent.s, sent.e, words.length, true));
      }
    }
    if (sentences.length === 0 && words.length > 0) {
      sentences.push(...buildSentencesFromWords(words, rawTokens));
    }
  }

  const dur = Number(parsed?.duration) || fallbackDuration;
  return sanitizeAndNormalizeTranscript(rawText, sentences, words, dur, estimated, warnings);
}

function parseSrtOrVtt(raw: string, fallbackDuration: number, warnings: string[]): TranscriptData {
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

    const cueEnd = Math.max(s + 0.2, e);
    sentences.push({
      i: sentences.length,
      text,
      s: round2(s),
      e: round2(cueEnd),
      estimated: true,
    });
    words.push(...spreadWordsAcrossSentence(text, s, cueEnd, words.length, true));
  }

  return sanitizeAndNormalizeTranscript(raw, sentences, words, fallbackDuration, true, warnings);
}

export const DEMO_HINGLISH_TRANSCRIPT = `[0.00 - 4.80] Yeh sequence hota hai app banane ka: sabse pehle app banao, test karo aur improve karo,
[4.80 - 7.10] jab tak ki aapko app final na lage.
[7.10 - 11.76] Yeh abhi aapko aur acche samajh mein aayega jab main aapko mere app ka sequence dikhaunga.`;
