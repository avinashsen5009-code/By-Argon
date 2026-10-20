import React, { useEffect, useMemo, useRef, useState } from 'react';
import { queryActiveLayersAtTime } from '../../core/time.ts';
import type { CompiledRecipe } from '../../core/types.ts';
import { isHeadlessSoftwareRenderer } from '../../render/fx.ts';
import { renderFrame } from '../../render/renderer.ts';
import { TouchTimelineBar } from '../components/TouchTimelineBar.tsx';

interface PreviewStageScreenProps {
  compiled: CompiledRecipe;
  audioDataUrl?: string;
  currentTime: number;
  onChangeTime: (t: number) => void;
  onGoToExport?: () => void;
  compact?: boolean;
}

export const PreviewStageScreen: React.FC<PreviewStageScreenProps> = ({
  compiled,
  audioDataUrl,
  currentTime,
  onChangeTime,
  onGoToExport,
  compact = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [showLayoutGrid, setShowLayoutGrid] = useState(false);
  const [previewScale, setPreviewScale] = useState<1 | 0.5>(0.5);

  const timeRef = useRef(currentTime);
  timeRef.current = currentTime;

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const rateRef = useRef(playbackRate);
  rateRef.current = playbackRate;

  // Render on demand whenever currentTime, compiled, or overlays change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const targetW = Math.round(compiled.w * previewScale);
    const targetH = Math.round(compiled.h * previewScale);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(previewScale, previewScale);
    renderFrame(ctx, compiled, currentTime, {
      showSafeArea,
      showLayoutGrid,
      fastPreview: isHeadlessSoftwareRenderer(),
    });
    ctx.restore();
  }, [compiled, currentTime, showSafeArea, showLayoutGrid, previewScale]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      return;
    }

    const headless = isHeadlessSoftwareRenderer();
    const minStepMs = headless ? 66 : 16; // ~15fps throttle in headless software Chromium
    let lastFrameMs = performance.now();
    let rafId = 0;

    if (audioRef.current && audioDataUrl) {
      audioRef.current.currentTime = timeRef.current;
      audioRef.current.playbackRate = rateRef.current;
      audioRef.current.play().catch(() => {});
    }

    const tick = (nowMs: number) => {
      if (!isPlayingRef.current) return;
      const dtMs = nowMs - lastFrameMs;
      if (dtMs >= minStepMs) {
        lastFrameMs = nowMs;
        const dtSec = (dtMs / 1000) * rateRef.current;
        const nextT = timeRef.current + dtSec;
        if (nextT >= compiled.duration) {
          onChangeTime(0);
          setIsPlaying(false);
          return;
        }
        onChangeTime(nextT);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isPlaying, compiled.duration, audioDataUrl, onChangeTime]);

  const activeLayers = useMemo(() => {
    return queryActiveLayersAtTime(compiled.intervalSorted, currentTime, compiled.duration);
  }, [compiled, currentTime]);

  const isVertical = compiled.h > compiled.w;

  return (
    <div className="flex flex-col gap-4" data-state={isPlaying ? 'playing' : 'paused'}>
      {audioDataUrl && <audio ref={audioRef} src={audioDataUrl} preload="auto" className="hidden" />}

      {/* Stage Viewport Container */}
      <div className="rounded-2xl border border-white/10 bg-[#131720] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 text-xs text-slate-300 tabular-nums">
            <span className="font-bold text-white">Deterministic Canvas 2D Stage</span>
            <span aria-hidden="true">·</span>
            <span>
              {compiled.w}×{compiled.h}
            </span>
            <span aria-hidden="true">·</span>
            <span>{activeLayers.length} active layers</span>
          </div>

          {/* Guide & Preview Quality Toggles */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowSafeArea((v) => !v)}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                showSafeArea
                  ? 'bg-emerald-400 text-slate-950'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              Safe Area (2.5%)
            </button>
            <button
              type="button"
              onClick={() => setShowLayoutGrid((v) => !v)}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                showLayoutGrid
                  ? 'bg-sky-400 text-slate-950'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              Layout Grid
            </button>
            <button
              type="button"
              onClick={() => setPreviewScale((s) => (s === 1 ? 0.5 : 1))}
              className="min-h-[38px] px-3 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 transition-colors whitespace-nowrap"
            >
              {previewScale === 1 ? '100% Res' : '50% Fast Res'}
            </button>
          </div>
        </div>

        {/* Canvas Wrapper */}
        <div className="flex items-center justify-center rounded-xl border border-white/10 bg-[#07080C] p-3 overflow-hidden">
          <canvas
            ref={canvasRef}
            data-testid="recipe-stage-canvas"
            style={{
              aspectRatio: `${compiled.w} / ${compiled.h}`,
              maxHeight: isVertical ? (compact ? '420px' : '540px') : '460px',
              width: isVertical ? 'auto' : '100%',
            }}
            className={`${
              isVertical ? 'h-[400px] sm:h-[500px] w-auto' : 'w-full h-auto'
            } max-w-full rounded-lg shadow-2xl`}
          />
        </div>
      </div>

      {/* Zero-Slider Custom Touch Timeline Bar */}
      <TouchTimelineBar
        compiled={compiled}
        currentTime={currentTime}
        isPlaying={isPlaying}
        playbackRate={playbackRate}
        onSeek={(t) => {
          setIsPlaying(false);
          onChangeTime(t);
        }}
        onTogglePlay={() => setIsPlaying((p) => !p)}
        onChangePlaybackRate={(r) => setPlaybackRate(r)}
      />

      {/* Active Layer Inspector at Current Frame */}
      {!compact && (
        <div className="rounded-2xl border border-white/10 bg-[#131720] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="font-display text-sm font-bold text-white">
              Active Layers at t = {currentTime.toFixed(2)}s ({activeLayers.length})
            </h3>
            {onGoToExport && (
              <button
                type="button"
                onClick={onGoToExport}
                className="min-h-[44px] px-4 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs transition-colors"
              >
                Export Video (MP4) →
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {activeLayers.map((l) => (
              <div
                key={l.id}
                className="rounded-xl border border-white/10 bg-[#0B0D12] px-3 py-2 text-xs text-slate-300 tabular-nums"
              >
                <div className="font-bold text-white truncate">
                  {l.id} · <span className="text-sky-400">{l.type}</span>
                  {l.kind ? ` (${l.kind})` : ''}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  [{l.t0.toFixed(2)}s – {l.t1.toFixed(2)}s]
                  {l.resolvedMotions.length > 0
                    ? ` · macros: ${l.resolvedMotions.map((m) => m.m).join(', ')}`
                    : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
