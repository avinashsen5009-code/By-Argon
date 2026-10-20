import React, { useMemo, useState } from 'react';
import { PALETTE_NAMES, PALETTE_TABLE } from '../../core/palette.ts';
import { extractCarryFromPart, splitTranscriptIntoParts } from '../../core/parts.ts';
import { buildPromptForPart } from '../../core/promptbuilder.ts';
import { parseTranscript } from '../../core/transcript.ts';
import type { ScreenLang, ThemeSpec } from '../../core/types.ts';
import type { StoredProject } from '../../store/db.ts';

interface TranscriptPromptScreenProps {
  project: StoredProject;
  onUpdateProject: (updater: (prev: StoredProject) => StoredProject) => void;
  onGoToRecipeStep: () => void;
}

const CUSTOM_HEX_PRESETS = ['#FF7A00', '#00E5FF', '#FF2E93', '#7CFF4D', '#FFB800'];

export const TranscriptPromptScreen: React.FC<TranscriptPromptScreenProps> = ({
  project,
  onUpdateProject,
  onGoToRecipeStep,
}) => {
  const [copiedPart, setCopiedPart] = useState<number | null>(null);
  const [showPromptPreview, setShowPromptPreview] = useState(false);

  const activePartSlot = project.parts[project.activePartIndex] ?? project.parts[0];
  const partNumber = activePartSlot?.part.n ?? 1;
  const totalParts = project.parts.length || 1;

  // Compute carry from previous part if partNumber > 1
  const previousCarry = useMemo(() => {
    if (project.activePartIndex <= 0) return null;
    const prevSlot = project.parts[project.activePartIndex - 1];
    if (prevSlot?.doc) {
      return extractCarryFromPart(prevSlot.doc);
    }
    return prevSlot?.carryOut ?? null;
  }, [project.activePartIndex, project.parts]);

  const builtPrompt = useMemo(() => {
    const rangeFrom = activePartSlot?.part.from ?? 0;
    const rangeTo = activePartSlot?.part.to ?? project.transcript.duration;
    return buildPromptForPart({
      w: project.w,
      h: project.h,
      fps: project.fps,
      duration: project.transcript.duration,
      theme: project.theme,
      screenText: project.screenText,
      partNumber,
      totalParts,
      rangeFrom,
      rangeTo,
      carry: previousCarry,
      transcript: project.transcript,
    });
  }, [
    project.w,
    project.h,
    project.fps,
    project.theme,
    project.screenText,
    project.transcript,
    activePartSlot,
    partNumber,
    totalParts,
    previousCarry,
  ]);

  const handleTranscriptChange = (rawText: string, explicitDuration?: number) => {
    onUpdateProject((prev) => {
      const parsed = parseTranscript(rawText, explicitDuration ?? prev.transcript.duration);
      const newPartMetas = splitTranscriptIntoParts(parsed);
      const updatedParts = newPartMetas.map((pm, idx) => {
        const existing = prev.parts[idx];
        return {
          part: pm,
          rawJson: existing?.rawJson ?? '',
          doc: existing?.doc,
          issues: existing?.issues ?? [],
          status: existing?.status ?? 'empty',
        };
      });
      return {
        ...prev,
        transcriptRaw: rawText,
        transcript: parsed,
        parts: updatedParts,
        activePartIndex: Math.min(prev.activePartIndex, Math.max(0, updatedParts.length - 1)),
      };
    });
  };

  const adjustDuration = (deltaSec: number) => {
    const nextDur = Math.max(2, Math.round((project.transcript.duration + deltaSec) * 100) / 100);
    handleTranscriptChange(project.transcriptRaw, nextDur);
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const audioEl = new Audio(dataUrl);
      audioEl.onloadedmetadata = () => {
        const audioDur = Number.isFinite(audioEl.duration) && audioEl.duration > 0
          ? Math.round(audioEl.duration * 100) / 100
          : project.transcript.duration;
        onUpdateProject((prev) => {
          const parsed = parseTranscript(prev.transcriptRaw, audioDur);
          const newPartMetas = splitTranscriptIntoParts(parsed);
          return {
            ...prev,
            audioFileName: file.name,
            audioDataUrl: dataUrl,
            transcript: parsed,
            parts: newPartMetas.map((pm, idx) => ({
              part: pm,
              rawJson: prev.parts[idx]?.rawJson ?? '',
              doc: prev.parts[idx]?.doc,
              issues: prev.parts[idx]?.issues ?? [],
              status: prev.parts[idx]?.status ?? 'empty',
            })),
          };
        });
      };
    };
    reader.readAsDataURL(file);
  };

  const setCanvasRatio = (aspect: '16:9' | '9:16') => {
    onUpdateProject((prev) => ({
      ...prev,
      w: aspect === '16:9' ? 1920 : 1080,
      h: aspect === '16:9' ? 1080 : 1920,
    }));
  };

  const setFps = (fps: 30 | 60) => {
    onUpdateProject((prev) => ({ ...prev, fps }));
  };

  const setScreenLang = (screenText: ScreenLang) => {
    onUpdateProject((prev) => ({ ...prev, screenText }));
  };

  const setTheme = (theme: ThemeSpec) => {
    onUpdateProject((prev) => ({ ...prev, theme }));
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(builtPrompt);
    } catch {
      // Fallback copy
      const ta = document.createElement('textarea');
      ta.value = builtPrompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedPart(partNumber);
    setTimeout(() => setCopiedPart(null), 2500);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Configuration Controls (Zero Sliders: Segmented Buttons & Steppers Only) */}
      <div className="rounded-2xl border border-white/10 bg-[#131720] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-lg font-bold text-white">01. Voiceover Transcript & Prompt Pack</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Paste your word-timestamped or sentence transcript, choose theme & canvas, then copy the complete RECIPE v3.1 prompt.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-300 tabular-nums">
            <span>{project.transcript.sentences.length} sentences</span>
            <span aria-hidden="true">·</span>
            <span>{project.transcript.words.length} words</span>
            <span aria-hidden="true">·</span>
            <span>{project.transcript.duration.toFixed(2)}s</span>
          </div>
        </div>

        {/* Canvas, FPS, Language, and Duration Steppers */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Canvas Aspect Ratio */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-300">Canvas Aspect Ratio</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCanvasRatio('16:9')}
                className={`min-h-[48px] rounded-xl px-3 text-xs font-bold transition-colors whitespace-nowrap ${
                  project.w === 1920
                    ? 'bg-sky-500 text-slate-950'
                    : 'bg-[#0B0D12] text-slate-300 border border-white/10 hover:border-white/25'
                }`}
              >
                1920×1080 (16:9)
              </button>
              <button
                type="button"
                onClick={() => setCanvasRatio('9:16')}
                className={`min-h-[48px] rounded-xl px-3 text-xs font-bold transition-colors whitespace-nowrap ${
                  project.w === 1080
                    ? 'bg-sky-500 text-slate-950'
                    : 'bg-[#0B0D12] text-slate-300 border border-white/10 hover:border-white/25'
                }`}
              >
                1080×1920 (9:16)
              </button>
            </div>
          </div>

          {/* Frame Rate & Screen Text Language */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-300">Frame Rate</span>
              <div className="grid grid-cols-2 gap-1.5">
                {([60, 30] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFps(f)}
                    className={`min-h-[48px] rounded-xl px-3 text-xs font-bold transition-colors whitespace-nowrap ${
                      project.fps === f
                        ? 'bg-sky-500 text-slate-950'
                        : 'bg-[#0B0D12] text-slate-300 border border-white/10 hover:border-white/25'
                    }`}
                  >
                    {f} fps
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-300">Screen Text</span>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'en', label: 'EN' },
                    { id: 'hi', label: 'हिंदी' },
                    { id: 'same-as-voice', label: 'Voice' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setScreenLang(item.id)}
                    className={`min-h-[48px] rounded-xl px-2 text-xs font-bold transition-colors whitespace-nowrap ${
                      project.screenText === item.id
                        ? 'bg-sky-500 text-slate-950'
                        : 'bg-[#0B0D12] text-slate-300 border border-white/10 hover:border-white/25'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Theme Palette Selector (Palettes 1-5 + Custom Hex Swatches) */}
        <div className="mt-4">
          <span className="text-xs font-semibold text-slate-300">Theme Palette (SPEC Section 7)</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((num) => {
              const isSelected = project.theme.palette === num && !project.theme.hex;
              const tok = PALETTE_TABLE[num];
              return (
                <button
                  key={num}
                  type="button"
                  onClick={() => setTheme({ palette: num })}
                  className={`min-h-[48px] flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-left text-xs font-bold border transition-colors whitespace-nowrap ${
                    isSelected
                      ? 'border-white bg-white/15 text-white'
                      : 'border-white/10 bg-[#0B0D12] text-slate-300 hover:border-white/25'
                  }`}
                >
                  <span
                    style={{ backgroundColor: tok.acc }}
                    className="h-5 w-5 shrink-0 rounded-full border border-white/30"
                  />
                  <span>
                    {num}. {PALETTE_NAMES[num]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Custom Hex Row */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">Or Custom Hex:</span>
            {CUSTOM_HEX_PRESETS.map((hex) => {
              const isSelected = project.theme.hex?.toUpperCase() === hex;
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setTheme({ hex })}
                  className={`min-h-[40px] flex items-center gap-1.5 rounded-xl px-3 text-xs font-semibold border transition-colors ${
                    isSelected
                      ? 'border-white bg-white/15 text-white'
                      : 'border-white/10 bg-[#0B0D12] text-slate-300 hover:border-white/25'
                  }`}
                >
                  <span
                    style={{ backgroundColor: hex }}
                    className="h-3.5 w-3.5 rounded-full"
                  />
                  <span>{hex}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Voiceover Audio File & Duration Stepper */}
        <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="voiceover-audio-upload"
              className="min-h-[48px] inline-flex items-center px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer transition-colors"
            >
              {project.audioFileName ? `Audio: ${project.audioFileName}` : 'Attach Voiceover Audio (MP3/WAV)'}
            </label>
            <input
              id="voiceover-audio-upload"
              type="file"
              accept="audio/*"
              onChange={handleAudioUpload}
              className="sr-only"
            />
          </div>

          <div className="flex items-center gap-1.5 tabular-nums">
            <span className="text-xs text-slate-400 mr-1">Duration:</span>
            <button
              type="button"
              onClick={() => adjustDuration(-5)}
              aria-label="Decrease duration by 5 seconds"
              className="min-h-[44px] min-w-[44px] px-2.5 rounded-xl bg-[#0B0D12] border border-white/10 hover:bg-white/10 text-xs font-bold text-slate-200"
            >
              -5s
            </button>
            <button
              type="button"
              onClick={() => adjustDuration(-1)}
              aria-label="Decrease duration by 1 second"
              className="min-h-[44px] min-w-[44px] px-2.5 rounded-xl bg-[#0B0D12] border border-white/10 hover:bg-white/10 text-xs font-bold text-slate-200"
            >
              -1s
            </button>
            <span className="min-w-[68px] text-center text-sm font-bold text-white">
              {project.transcript.duration.toFixed(2)}s
            </span>
            <button
              type="button"
              onClick={() => adjustDuration(1)}
              aria-label="Increase duration by 1 second"
              className="min-h-[44px] min-w-[44px] px-2.5 rounded-xl bg-[#0B0D12] border border-white/10 hover:bg-white/10 text-xs font-bold text-slate-200"
            >
              +1s
            </button>
            <button
              type="button"
              onClick={() => adjustDuration(5)}
              aria-label="Increase duration by 5 seconds"
              className="min-h-[44px] min-w-[44px] px-2.5 rounded-xl bg-[#0B0D12] border border-white/10 hover:bg-white/10 text-xs font-bold text-slate-200"
            >
              +5s
            </button>
          </div>
        </div>
      </div>

      {/* Transcript Input Box */}
      <div className="rounded-2xl border border-white/10 bg-[#131720] p-5">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <label htmlFor="transcript-textarea" className="text-sm font-bold text-white">
            Timestamped Transcript (SRT, VTT, Whisper JSON, or `[start - end] text`)
          </label>
          <span className="text-xs text-slate-400 tabular-nums">
            Auto-splits into {project.parts.length} part(s) (30–40s each)
          </span>
        </div>
        <textarea
          id="transcript-textarea"
          rows={5}
          value={project.transcriptRaw}
          onChange={(e) => handleTranscriptChange(e.target.value)}
          placeholder="Paste word-timestamped JSON, SRT subtitles, or timestamped lines..."
          className="w-full rounded-xl border border-white/15 bg-[#0B0D12] p-3.5 font-mono text-xs leading-relaxed text-slate-100 placeholder-slate-500 focus:border-sky-400 focus:outline-none"
        />

        {/* Part Selector Bar (for multi-part videos) */}
        {project.parts.length > 1 && (
          <div className="mt-4">
            <span className="text-xs font-semibold text-slate-300">
              Select Part to Build Prompt ({project.parts.length} Parts Total)
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {project.parts.map((slot, idx) => {
                const isSelected = idx === project.activePartIndex;
                return (
                  <button
                    key={slot.part.n}
                    type="button"
                    onClick={() =>
                      onUpdateProject((prev) => ({ ...prev, activePartIndex: idx }))
                    }
                    className={`min-h-[48px] px-4 rounded-xl text-xs font-bold border transition-colors tabular-nums ${
                      isSelected
                        ? 'border-sky-400 bg-sky-500 text-slate-950'
                        : 'border-white/10 bg-[#0B0D12] text-slate-200 hover:border-white/25'
                    }`}
                  >
                    Part {slot.part.n}/{slot.part.of} ({slot.part.from.toFixed(0)}s–{slot.part.to.toFixed(0)}s)
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Primary One-Tap Copy Prompt Action */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleCopyPrompt}
            data-testid="copy-prompt-btn"
            className="min-h-[52px] flex-1 sm:flex-initial px-6 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-display font-bold text-sm transition-colors whitespace-nowrap"
          >
            {copiedPart === partNumber
              ? `Copied Prompt for Part ${partNumber} of ${totalParts}!`
              : `Copy Complete Prompt (Part ${partNumber} of ${totalParts})`}
          </button>

          <button
            type="button"
            onClick={() => setShowPromptPreview((v) => !v)}
            className="min-h-[52px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors whitespace-nowrap"
          >
            {showPromptPreview ? 'Hide Generated Prompt' : 'Inspect Generated Prompt'}
          </button>

          <button
            type="button"
            onClick={onGoToRecipeStep}
            className="min-h-[52px] px-5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs transition-colors whitespace-nowrap"
          >
            Next: Paste Recipe JSON →
          </button>
        </div>

        {showPromptPreview && (
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold text-slate-400">
              Complete Prompt (SPEC Part A + Filled INPUT Block · {builtPrompt.length.toLocaleString()} chars)
            </div>
            <pre
              data-testid="generated-prompt-preview"
              className="max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-[#0B0D12] p-3.5 font-mono text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap"
            >
              {builtPrompt}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
