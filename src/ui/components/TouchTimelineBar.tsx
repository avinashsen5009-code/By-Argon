import React, { useRef, useState } from 'react';
import { clamp } from '../../core/ease.ts';
import type { CompiledRecipe } from '../../core/types.ts';

interface TouchTimelineBarProps {
  compiled: CompiledRecipe;
  currentTime: number;
  isPlaying: boolean;
  loopScene?: boolean;
  audioPeaks?: number[];
  onSeek: (timeSec: number) => void;
  onTogglePlay: () => void;
  onStepFrame: (deltaFrames: number) => void;
  onToggleLoopScene?: () => void;
}

/**
 * Custom zero-slider touch timeline scrubber (M13: strictly NO <input type="range">).
 * Supports tap-to-seek, drag-to-scrub, scene block markers, word-tick markers,
 * downsampled audio waveform peaks, prev/next scene jump, loop scene toggle, and -1f / +1f steppers.
 */
export const TouchTimelineBar: React.FC<TouchTimelineBarProps> = ({
  compiled,
  currentTime,
  isPlaying,
  loopScene = false,
  audioPeaks = [],
  onSeek,
  onTogglePlay,
  onStepFrame,
  onToggleLoopScene,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const duration = Math.max(0.1, compiled.duration);
  const progress = clamp(currentTime / duration, 0, 1);
  const frameIndex = Math.round(currentTime * compiled.fps);
  const totalFrames = Math.round(duration * compiled.fps);

  const activeWord = compiled.transcript?.words.find(
    (w) => currentTime >= w.s && currentTime <= w.e
  );
  const activeSceneIdx = compiled.scenes.findIndex(
    (sc) => currentTime >= sc.t0 && currentTime < sc.t1
  );

  const seekFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    onSeek(ratio * duration);
  };

  const handlePrevScene = () => {
    if (compiled.scenes.length === 0) return;
    const targetIdx = activeSceneIdx > 0 ? activeSceneIdx - 1 : 0;
    onSeek(compiled.scenes[targetIdx].t0);
  };

  const handleNextScene = () => {
    if (compiled.scenes.length === 0) return;
    const targetIdx =
      activeSceneIdx >= 0 && activeSceneIdx + 1 < compiled.scenes.length
        ? activeSceneIdx + 1
        : compiled.scenes.length - 1;
    onSeek(compiled.scenes[targetIdx].t0);
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-[#131720] p-3.5 select-none">
      {/* Custom Touch Track Bar */}
      <div
        ref={trackRef}
        role="group"
        aria-label="Timeline Scrub Track"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setIsDragging(true);
          seekFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (isDragging) {
            seekFromClientX(e.clientX);
          }
        }}
        onPointerUp={(e) => {
          if (isDragging) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setIsDragging(false);
          }
        }}
        className="relative h-14 w-full cursor-pointer overflow-hidden rounded-xl border border-white/15 bg-[#0A0C10] touch-none"
      >
        {/* Downsampled Audio Waveform Peaks (M13) */}
        {audioPeaks.length > 0 && (
          <div className="absolute inset-0 flex items-center justify-between px-1 pointer-events-none opacity-35">
            {audioPeaks.map((pk, idx) => (
              <div
                key={idx}
                style={{ height: `${Math.max(10, Math.round(pk * 85))}%` }}
                className="w-[2px] rounded-full bg-emerald-400"
              />
            ))}
          </div>
        )}

        {/* Scene blocks */}
        {compiled.scenes.map((sc, idx) => {
          const leftPct = (sc.t0 / duration) * 100;
          const widthPct = ((sc.t1 - sc.t0) / duration) * 100;
          const isCurrentScene = currentTime >= sc.t0 && currentTime < sc.t1;
          return (
            <div
              key={sc.id}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              className={`absolute inset-y-0 border-r border-white/15 px-2 py-1 flex flex-col justify-between transition-colors ${
                isCurrentScene ? 'bg-sky-500/15' : idx % 2 === 0 ? 'bg-white/[0.02]' : 'bg-transparent'
              }`}
            >
              <span className="truncate font-mono text-[11px] font-semibold text-slate-300">
                {sc.id}
              </span>
              <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                {sc.t0.toFixed(1)}s
              </span>
            </div>
          );
        })}

        {/* Word timestamp ticks along bottom edge */}
        {compiled.transcript?.words.map((w) => {
          const leftPct = (w.s / duration) * 100;
          return (
            <div
              key={w.i}
              style={{ left: `${leftPct}%` }}
              className="absolute bottom-0 h-2 w-[1.5px] bg-emerald-400/45 pointer-events-none"
            />
          );
        })}

        {/* Played fill overlay */}
        <div
          style={{ width: `${progress * 100}%` }}
          className="pointer-events-none absolute inset-y-0 left-0 bg-emerald-400/15"
        />

        {/* Playhead needle */}
        <div
          style={{ left: `${progress * 100}%` }}
          className="pointer-events-none absolute inset-y-0 -ml-[1.5px] w-[3px] bg-emerald-400 shadow-[0_0_12px_#2EE59D]"
        />
      </div>

      {/* Transport & Frame Stepper Row (48dp touch buttons, zero sliders) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onTogglePlay}
            data-testid="timeline-play-btn"
            className="min-h-[48px] min-w-[92px] rounded-xl bg-emerald-400 px-3.5 py-2 font-display text-sm font-bold text-slate-950 hover:bg-emerald-300 active:scale-95 transition-all"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>

          <button
            type="button"
            onClick={handlePrevScene}
            title="Previous Scene"
            className="min-h-[48px] min-w-[48px] rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 font-mono text-xs font-semibold text-slate-200 hover:bg-white/10"
          >
            |◀
          </button>

          <button
            type="button"
            onClick={() => onStepFrame(-1)}
            title="Step Back 1 Frame"
            className="min-h-[48px] min-w-[48px] rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 font-mono text-xs font-semibold text-slate-200 hover:bg-white/10"
          >
            -1f
          </button>

          <button
            type="button"
            onClick={() => onStepFrame(1)}
            title="Step Forward 1 Frame"
            className="min-h-[48px] min-w-[48px] rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 font-mono text-xs font-semibold text-slate-200 hover:bg-white/10"
          >
            +1f
          </button>

          <button
            type="button"
            onClick={() => onStepFrame(compiled.fps)}
            title="Step Forward 1 Second"
            className="min-h-[48px] min-w-[48px] rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 font-mono text-xs font-semibold text-slate-200 hover:bg-white/10"
          >
            +1s
          </button>

          <button
            type="button"
            onClick={handleNextScene}
            title="Next Scene"
            className="min-h-[48px] min-w-[48px] rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 font-mono text-xs font-semibold text-slate-200 hover:bg-white/10"
          >
            ▶|
          </button>

          {onToggleLoopScene && (
            <button
              type="button"
              onClick={onToggleLoopScene}
              data-testid="loop-scene-btn"
              className={`min-h-[48px] rounded-xl border px-3 py-2 font-mono text-xs font-semibold transition-colors ${
                loopScene
                  ? 'border-amber-400 bg-amber-400/20 text-amber-200'
                  : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {loopScene ? 'Loop Scene: ON' : 'Loop Scene'}
            </button>
          )}
        </div>

        {/* Scene quick-jump buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          {compiled.scenes.map((sc) => {
            const isActive = currentTime >= sc.t0 && currentTime < sc.t1;
            const populatedT = Math.min(
              sc.t1 - 0.05,
              sc.t0 + Math.min(1.6, (sc.t1 - sc.t0) * 0.55)
            );
            return (
              <button
                key={sc.id}
                type="button"
                onClick={() => onSeek(isActive ? sc.t0 : populatedT)}
                className={`min-h-[44px] rounded-lg px-3 py-1.5 font-mono text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-sky-500 text-slate-950'
                    : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {sc.id}
              </button>
            );
          })}
        </div>

        {/* Deterministic Frame & Word Readout */}
        <div className="flex items-center gap-3 font-mono text-xs text-slate-300 tabular-nums">
          {activeWord && (
            <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-1 text-emerald-300">
              @w{activeWord.i} &ldquo;{activeWord.w}&rdquo;
            </span>
          )}
          <span>
            {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
          </span>
          <span className="text-slate-400">
            F:{frameIndex}/{totalFrames}
          </span>
        </div>
      </div>
    </div>
  );
};
