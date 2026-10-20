import { clamp, ease, lerp } from '../core/ease.ts';
import { resolveColorToken, resolveFillValue } from '../core/palette.ts';
import type { CompiledLayer, ThemeTokens, TranscriptData } from '../core/types.ts';
import type { Any2DContext } from './background.ts';
import { createCanvasFillStyle, traceRoundedRect } from './shapes.ts';

export function resolveFontFamily(font: string | undefined): string {
  switch (font) {
    case 'sans':
      return "'Inter', 'Noto Color Emoji', sans-serif";
    case 'hindi':
      return "'Noto Sans Devanagari', 'Inter', 'Noto Color Emoji', sans-serif";
    case 'display':
    default:
      return "'Sora', 'Inter', 'Noto Color Emoji', sans-serif";
  }
}

export function containsDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

/**
 * Waits for `document.fonts.load(...)` for every bundled font family before the first frame and before export (M8).
 */
export async function ensureFontsLoaded(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  try {
    await Promise.all([
      document.fonts.load("800 48px 'Sora'"),
      document.fonts.load("700 32px 'Inter'"),
      document.fonts.load("700 36px 'Noto Sans Devanagari'"),
      document.fonts.ready,
    ]);
  } catch {
    // Ignore in environments where FontFaceSet is stubbed
  }
}

export interface MeasuredTextLayout {
  fontSize: number;
  lineHeightPx: number;
  lines: string[];
  maxLineWidth: number;
  totalHeight: number;
  wordBoxes: Array<{
    word: string;
    cleanWord: string;
    x: number;
    y: number;
    leftX: number;
    w: number;
    h: number;
  }>;
}

const MAX_TEXT_CACHE_SIZE = 256;
const textLayoutCache = new Map<string, MeasuredTextLayout>();

export function clearTextLayoutCache(): void {
  textLayoutCache.clear();
}

export function measureAndLayoutText(
  ctx: Any2DContext,
  text: string,
  boxW: number,
  initialSize: number,
  weight: number,
  font: string | undefined,
  align: 'center' | 'left' | 'right',
  lineHeightMult = 1.2,
  fitShrink = false,
  maxLines = 4
): MeasuredTextLayout {
  const cacheKey = `${text}|${font ?? 'display'}|${weight}|${initialSize}|${Math.round(boxW)}|${align}|${lineHeightMult}|${fitShrink ? 1 : 0}|${maxLines}`;
  const cached = textLayoutCache.get(cacheKey);
  if (cached) {
    textLayoutCache.delete(cacheKey);
    textLayoutCache.set(cacheKey, cached);
    return cached;
  }

  const family = resolveFontFamily(font);
  let fontSize = Math.max(12, initialSize);

  const computeWrap = (size: number) => {
    ctx.font = `${weight} ${size}px ${family}`;
    const rawParas = text.split('\n');
    const lines: string[] = [];

    for (const para of rawParas) {
      const words = para.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        lines.push('');
        continue;
      }
      let currentLine = '';

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        const m = ctx.measureText(candidate).width;

        if (m <= boxW || fitShrink) {
          currentLine = candidate;
        } else if (!currentLine && ctx.measureText(word).width > boxW && !fitShrink) {
          // Character-level fallback wrapping for long CJK/unbroken tokens
          let charChunk = '';
          for (const ch of Array.from(word)) {
            const nextChunk = charChunk + ch;
            if (ctx.measureText(nextChunk).width > boxW && charChunk.length > 0) {
              lines.push(charChunk);
              charChunk = ch;
            } else {
              charChunk = nextChunk;
            }
          }
          currentLine = charChunk;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) lines.push(currentLine);
    }

    let maxW = 0;
    for (const l of lines) {
      const w = ctx.measureText(l).width;
      if (w > maxW) maxW = w;
    }
    return { lines, maxW };
  };

  let wrapped = computeWrap(fontSize);

  // M8: Binary search on fontSize when fit:"shrink" (or single-line overflow)
  if ((fitShrink || wrapped.maxW > boxW) && wrapped.maxW > boxW && boxW > 20) {
    let low = 12;
    let high = fontSize;
    let bestSize = 12;
    let bestWrap = wrapped;

    for (let iter = 0; iter < 9; iter++) {
      const mid = Math.floor((low + high) * 0.5);
      const testWrap = computeWrap(mid);
      const fitsWidth = testWrap.maxW <= boxW * 0.96;
      const fitsLines = maxLines <= 0 || testWrap.lines.length <= maxLines;
      if (fitsWidth && fitsLines) {
        bestSize = mid;
        bestWrap = testWrap;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    fontSize = bestSize;
    wrapped = bestWrap;
  }

  if (maxLines > 0 && wrapped.lines.length > maxLines) {
    wrapped.lines = wrapped.lines.slice(0, maxLines);
  }

  const lineHeightPx = fontSize * lineHeightMult;
  const totalHeight = wrapped.lines.length * lineHeightPx;
  ctx.font = `${weight} ${fontSize}px ${family}`;

  const wordBoxes: MeasuredTextLayout['wordBoxes'] = [];
  const startY = -totalHeight * 0.5 + lineHeightPx * 0.5;

  wrapped.lines.forEach((line, lineIdx) => {
    const lineW = ctx.measureText(line).width;
    const lineStartX =
      align === 'left'
        ? -boxW * 0.5
        : align === 'right'
        ? boxW * 0.5 - lineW
        : -lineW * 0.5;
    const lineY = startY + lineIdx * lineHeightPx;

    // Prefix measurement for exact word x-ranges (M8)
    const tokens = line.split(/(\s+)/);
    let prefix = '';
    for (const tok of tokens) {
      const prefixW = prefix.length > 0 ? ctx.measureText(prefix).width : 0;
      const fullWithTokW = ctx.measureText(prefix + tok).width;
      const tw = Math.max(0, fullWithTokW - prefixW);
      const leftX = lineStartX + prefixW;

      if (tok.trim().length > 0) {
        const cleanWord = tok.replace(/^[.,!?;:"'()[\]]+|[.,!?;:"'()[\]]+$/g, '');
        wordBoxes.push({
          word: tok,
          cleanWord,
          x: leftX + tw * 0.5,
          y: lineY,
          leftX,
          w: tw,
          h: fontSize,
        });
      }
      prefix += tok;
    }
  });

  const layout: MeasuredTextLayout = {
    fontSize,
    lineHeightPx,
    lines: wrapped.lines,
    maxLineWidth: wrapped.maxW,
    totalHeight,
    wordBoxes,
  };

  if (textLayoutCache.size >= MAX_TEXT_CACHE_SIZE) {
    const oldest = textLayoutCache.keys().next().value;
    if (oldest) textLayoutCache.delete(oldest);
  }
  textLayoutCache.set(cacheKey, layout);
  return layout;
}

/**
 * Draws a `text` layer centered around local (0,0), including optional `plate`, inline `highlight` words,
 * `letterSpacing` (automatically disabled for Devanagari so conjuncts never break),
 * `textAnim`, and text enter presets (`typeOn`, `charIn`, `charFade`, `charPop`, `wordIn`, `wordFade`, `wordPop`, `lineIn`).
 */
export function drawTextLayer(
  ctx: Any2DContext,
  layer: CompiledLayer,
  boxW: number,
  fontSize: number,
  tokens: ThemeTokens,
  tRel: number,
  textPresetType?: string,
  textPresetProgress = 1
): MeasuredTextLayout {
  const rawText = String(layer.text ?? '');
  const weight = layer.weight ?? (layer.font === 'sans' ? 700 : 800);
  const align = layer.align || 'center';
  const lineHeightMult = layer.lineHeight ?? 1.18;
  const fitShrink = layer.fit === 'shrink';
  const layout = measureAndLayoutText(
    ctx,
    rawText,
    boxW,
    fontSize,
    weight,
    layer.font,
    align,
    lineHeightMult,
    fitShrink,
    layer.maxLines ?? 4
  );

  // 1. Optional background plate
  if (layer.plate) {
    const padX = layer.plate.pad?.[0] ?? 28;
    const padY = layer.plate.pad?.[1] ?? 16;
    const pw = layout.maxLineWidth + padX * 2;
    const ph = layout.totalHeight + padY * 2;
    const prad = layer.plate.radius ?? ph * 0.5;

    ctx.save();
    traceRoundedRect(ctx, -pw * 0.5, -ph * 0.5, pw, ph, prad);
    const fillRes = resolveFillValue(layer.plate.fill ?? '@surf', tokens);
    if (fillRes.kind !== 'none') {
      ctx.fillStyle = createCanvasFillStyle(ctx, fillRes, pw, ph);
      ctx.fill();
    }
    if (layer.plate.stroke) {
      ctx.strokeStyle = resolveColorToken(layer.plate.stroke, tokens);
      ctx.lineWidth = layer.plate.strokeWidth ?? 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  const baseColor = resolveColorToken(layer.color || '@ink', tokens);
  const highlightMap = new Map<string, string>();
  if (Array.isArray(layer.highlight)) {
    for (const h of layer.highlight) {
      if (h.word && h.color) {
        highlightMap.set(h.word.toLowerCase(), resolveColorToken(h.color, tokens));
      }
    }
  }

  const isDevanagari = layer.font === 'hindi' || containsDevanagari(rawText);
  const family = resolveFontFamily(isDevanagari && !layer.font ? 'hindi' : layer.font);
  ctx.save();
  ctx.font = `${weight} ${layout.fontSize}px ${family}`;
  ctx.textBaseline = 'middle';

  // M8: letterSpacing is disabled automatically for Devanagari because it breaks conjuncts
  if ('letterSpacing' in ctx) {
    const rawLs = typeof layer.letterSpacing === 'number' ? layer.letterSpacing : 0;
    (ctx as any).letterSpacing = isDevanagari ? '0px' : `${rawLs}px`;
  }

  const animSpec = layer.textAnim;
  const activePreset = textPresetType && textPresetProgress < 1 ? textPresetType : undefined;

  if (activePreset === 'typeOn') {
    const charLimit = Math.ceil(rawText.length * textPresetProgress);
    let remaining = charLimit;
    const startY = -layout.totalHeight * 0.5 + layout.lineHeightPx * 0.5;
    layout.lines.forEach((line, idx) => {
      if (remaining <= 0) return;
      const sub = line.slice(0, remaining);
      remaining -= line.length;
      const fullW = ctx.measureText(line).width;
      const x =
        align === 'left'
          ? -boxW * 0.5
          : align === 'right'
          ? boxW * 0.5 - fullW
          : -fullW * 0.5;
      ctx.textAlign = 'left';
      ctx.fillStyle = baseColor;
      ctx.fillText(sub, x, startY + idx * layout.lineHeightPx);
    });
    ctx.restore();
    return layout;
  }

  const isWordSplit =
    animSpec?.split === 'word' ||
    activePreset === 'wordIn' ||
    activePreset === 'wordFade' ||
    activePreset === 'wordPop';

  if (isWordSplit || highlightMap.size > 0) {
    const totalWords = Math.max(1, layout.wordBoxes.length);
    layout.wordBoxes.forEach((wb, wIdx) => {
      let wordOp = 1;
      let wordDy = 0;
      let wordScale = 1;

      if (animSpec && animSpec.split === 'word') {
        const stagger = animSpec.stagger ?? 0.05;
        const dur = animSpec.dur ?? 0.4;
        const u = clamp((tRel - wIdx * stagger) / Math.max(1e-4, dur), 0, 1);
        const f = ease(animSpec.ease || 'outExpo', u);
        wordOp = lerp(animSpec.from?.opacity ?? 0, 1, f);
        wordDy = lerp(animSpec.from?.y ?? 28, 0, f);
        wordScale = lerp(animSpec.from?.scale ?? 0.85, 1, f);
      } else if (activePreset) {
        const staggerSpan = 0.5;
        const wStart = (wIdx / totalWords) * staggerSpan;
        const u = clamp((textPresetProgress - wStart) / (1 - staggerSpan), 0, 1);
        const f = ease(activePreset === 'wordPop' ? 'outBack' : 'outCubic', u);
        wordOp = clamp(u * 2, 0, 1);
        if (activePreset === 'wordIn') wordDy = (1 - f) * 24;
        if (activePreset === 'wordPop') wordScale = lerp(0.5, 1, f);
      }

      if (wordOp <= 0.01) return;
      ctx.save();
      ctx.globalAlpha *= wordOp;
      ctx.translate(wb.x, wb.y + wordDy);
      if (Math.abs(wordScale - 1) > 1e-3) {
        ctx.scale(wordScale, wordScale);
      }
      ctx.textAlign = 'center';
      const hlColor = highlightMap.get(wb.cleanWord.toLowerCase());
      ctx.fillStyle = hlColor || baseColor;
      if (layer.stroke && typeof layer.stroke === 'object' && layer.stroke.color) {
        ctx.strokeStyle = resolveColorToken(layer.stroke.color, tokens);
        ctx.lineWidth = layer.stroke.width ?? 2;
        ctx.strokeText(wb.word, 0, 0);
      }
      ctx.fillText(wb.word, 0, 0);
      ctx.restore();
    });
    ctx.restore();
    return layout;
  }

  // Character or line rendering
  const isCharSplit =
    (animSpec?.split === 'char' ||
      activePreset === 'charIn' ||
      activePreset === 'charFade' ||
      activePreset === 'charPop') &&
    !isDevanagari; // Keep Devanagari conjuncts intact at word/line level

  const startY = -layout.totalHeight * 0.5 + layout.lineHeightPx * 0.5;
  let globalCharIdx = 0;
  const totalChars = Math.max(1, rawText.length);

  layout.lines.forEach((line, lineIdx) => {
    const lineY = startY + lineIdx * layout.lineHeightPx;
    const lineW = ctx.measureText(line).width;
    const lineStartX =
      align === 'left'
        ? -boxW * 0.5
        : align === 'right'
        ? boxW * 0.5 - lineW
        : -lineW * 0.5;

    if (isCharSplit) {
      let curX = lineStartX;
      const chars = Array.from(line);
      for (const ch of chars) {
        const cw = ctx.measureText(ch).width;
        let chOp = 1;
        let chDy = 0;
        let chScale = 1;

        if (animSpec && animSpec.split === 'char') {
          const stagger = animSpec.stagger ?? 0.025;
          const dur = animSpec.dur ?? 0.38;
          const u = clamp((tRel - globalCharIdx * stagger) / Math.max(1e-4, dur), 0, 1);
          const f = ease(animSpec.ease || 'outExpo', u);
          chOp = lerp(animSpec.from?.opacity ?? 0, 1, f);
          chDy = lerp(animSpec.from?.y ?? 24, 0, f);
          chScale = lerp(animSpec.from?.scale ?? 0.75, 1, f);
        } else if (activePreset) {
          const staggerSpan = 0.6;
          const cStart = (globalCharIdx / totalChars) * staggerSpan;
          const u = clamp((textPresetProgress - cStart) / (1 - staggerSpan), 0, 1);
          const f = ease(activePreset === 'charPop' ? 'outBack' : 'outExpo', u);
          chOp = clamp(u * 2.2, 0, 1);
          if (activePreset === 'charIn') chDy = (1 - f) * 22;
          if (activePreset === 'charPop') chScale = lerp(0.4, 1, f);
        }
        globalCharIdx++;

        if (chOp > 0.01 && ch.trim().length > 0) {
          ctx.save();
          ctx.globalAlpha *= chOp;
          ctx.translate(curX + cw * 0.5, lineY + chDy);
          if (Math.abs(chScale - 1) > 1e-3) ctx.scale(chScale, chScale);
          ctx.textAlign = 'center';
          ctx.fillStyle = baseColor;
          ctx.fillText(ch, 0, 0);
          ctx.restore();
        }
        curX += cw;
      }
    } else {
      ctx.save();
      if (activePreset === 'lineIn' || animSpec?.split === 'line') {
        const lStart = (lineIdx / Math.max(1, layout.lines.length)) * 0.4;
        const u = clamp((textPresetProgress - lStart) / 0.6, 0, 1);
        const f = ease('outExpo', u);
        ctx.globalAlpha *= f;
        ctx.translate(0, (1 - f) * 28);
      }
      ctx.textAlign = align;
      const ax = align === 'left' ? -boxW * 0.5 : align === 'right' ? boxW * 0.5 : 0;
      ctx.fillStyle = baseColor;
      if (layer.stroke && typeof layer.stroke === 'object' && layer.stroke.color) {
        ctx.strokeStyle = resolveColorToken(layer.stroke.color, tokens);
        ctx.lineWidth = layer.stroke.width ?? 2;
        ctx.strokeText(line, ax, lineY);
      }
      ctx.fillText(line, ax, lineY);
      ctx.restore();
    }
  });

  ctx.restore();
  return layout;
}

/**
 * M8 Highlight Layer:
 * Measures the target word's x-range via prefix measurement (`match.leftX .. match.leftX + match.w`).
 * - `underline` sits at `baseline + 0.14 * size`, thickness >= 8 px, grows left-pinned.
 * - `box` is centred about `0.30 * size` above the text baseline / around text centre, grows left-pinned.
 */
export function drawHighlightLayer(
  ctx: Any2DContext,
  layer: CompiledLayer,
  targetLayer: CompiledLayer | undefined,
  tGlobal: number,
  tokens: ThemeTokens,
  canvasW: number
): void {
  if (!targetLayer || targetLayer.type !== 'text') return;
  const at = layer.resolvedAt ?? layer.t0;
  const dur = layer.dur ?? 0.35;
  if (tGlobal < at) return;
  const progress = ease('outCubic', clamp((tGlobal - at) / Math.max(1e-4, dur), 0, 1));

  const targetBoxW = typeof targetLayer.w === 'number' ? targetLayer.w : canvasW * 0.6;
  const targetSize = typeof targetLayer.size === 'number' ? targetLayer.size : 72;
  const targetWeight = targetLayer.weight ?? 800;
  const layout = measureAndLayoutText(
    ctx,
    String(targetLayer.text ?? ''),
    targetBoxW,
    targetSize,
    targetWeight,
    targetLayer.font,
    targetLayer.align || 'center',
    targetLayer.lineHeight ?? 1.18,
    targetLayer.fit === 'shrink'
  );

  const searchWord = String(layer.word ?? '').toLowerCase();
  const match =
    layout.wordBoxes.find((wb) => wb.cleanWord.toLowerCase() === searchWord) ??
    layout.wordBoxes.find((wb) => wb.cleanWord.toLowerCase().includes(searchWord)) ??
    layout.wordBoxes[layout.wordBoxes.length - 1];

  if (!match) return;

  const col = resolveColorToken(layer.color || '@acc', tokens);
  const kind = layer.kind || 'underline';
  const size = layout.fontSize;
  const baselineY = match.y + size * 0.36;

  ctx.save();
  if (kind === 'underline') {
    const thickness = Math.max(8, Number(layer.thickness ?? 8));
    const uw = (match.w + 12) * progress;
    const ux = match.leftX - 6;
    const uy = baselineY + size * 0.14;
    ctx.fillStyle = col;
    traceRoundedRect(ctx, ux, uy, Math.max(6, uw), thickness, thickness * 0.5);
    ctx.fill();
  } else if (kind === 'box') {
    const bw = (match.w + 24) * progress;
    const bh = size * 1.16;
    const boxCenterY = baselineY - size * 0.3;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(4, Number(layer.thickness ?? 4));
    traceRoundedRect(ctx, match.leftX - 12, boxCenterY - bh * 0.5, bw, bh, 12);
    ctx.stroke();
  } else if (kind === 'marker') {
    const mw = (match.w + 20) * progress;
    const mh = size * 1.05;
    const boxCenterY = baselineY - size * 0.3;
    ctx.globalAlpha *= 0.32;
    ctx.fillStyle = col;
    traceRoundedRect(ctx, match.leftX - 10, boxCenterY - mh * 0.5, mw, mh, 10);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Draws a `captions` layer driven by the project transcript at global time `t`.
 * Supports styles: `word-pop`, `karaoke`, `line`, `box`.
 */
export function drawCaptionsLayer(
  ctx: Any2DContext,
  layer: CompiledLayer,
  transcript: TranscriptData | undefined,
  tGlobal: number,
  tokens: ThemeTokens,
  canvasW: number,
  canvasH: number
): void {
  if (!transcript || transcript.words.length === 0) return;
  const maxWords = layer.maxWords ?? 5;
  const fontSize = typeof layer.size === 'number' ? layer.size : 52;
  const yPx = (typeof layer.y === 'number' ? layer.y : 0.86) * canvasH;
  const activeCol = resolveColorToken(layer.activeColor || '@acc', tokens);
  const baseCol = resolveColorToken(layer.color || '@ink', tokens);

  const activeIdx = transcript.words.findIndex((w) => tGlobal >= w.s && tGlobal <= w.e);
  if (activeIdx === -1) return;

  const chunkIndex = Math.floor(activeIdx / maxWords);
  const chunkWords = transcript.words.slice(chunkIndex * maxWords, (chunkIndex + 1) * maxWords);
  if (chunkWords.length === 0) return;

  ctx.save();
  ctx.font = `800 ${fontSize}px ${resolveFontFamily('display')}`;
  ctx.textBaseline = 'middle';

  const fullStr = chunkWords.map((w) => w.w).join(' ');
  const totalW = ctx.measureText(fullStr).width;

  if (layer.style === 'box') {
    ctx.fillStyle = tokens.surf;
    traceRoundedRect(
      ctx,
      canvasW * 0.5 - totalW * 0.5 - 28,
      yPx - fontSize * 0.75,
      totalW + 56,
      fontSize * 1.5,
      20
    );
    ctx.fill();
  }

  let cursorX = canvasW * 0.5 - totalW * 0.5;
  const spaceW = ctx.measureText(' ').width;

  for (const wItem of chunkWords) {
    const ww = ctx.measureText(wItem.w).width;
    const isCurrent = wItem.i === transcript.words[activeIdx].i;
    const isPastOrCurrent = wItem.i <= transcript.words[activeIdx].i;

    ctx.save();
    ctx.translate(cursorX + ww * 0.5, yPx);
    if (isCurrent && layer.style === 'word-pop') {
      ctx.scale(1.14, 1.14);
    }
    ctx.textAlign = 'center';
    if (layer.style === 'karaoke') {
      ctx.fillStyle = isPastOrCurrent ? activeCol : baseCol;
    } else if (layer.style === 'line') {
      ctx.fillStyle = baseCol;
    } else {
      ctx.fillStyle = isCurrent ? activeCol : baseCol;
    }
    ctx.fillText(wItem.w, 0, 0);
    ctx.restore();
    cursorX += ww + spaceW;
  }

  ctx.restore();
}
