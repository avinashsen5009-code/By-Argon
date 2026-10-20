import React, { useRef } from 'react';
import { clamp } from '../../core/ease.ts';
import { frameToTime, timeToFrame, totalFramesForDuration } from '../../core/time.ts';
import type { CompiledRecipe } from '../../core/types.ts';

interface TouchTimelineBarProps {
  compiled: CompiledRecipe;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  onSeek: (newTime: number) => void;
  onTogglePlay: () => void;
  onChangePlaybackRate: (rate: number) => void;
}

export function formatTimecode(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(2).padStart(5, '0')}`;
}

export const TouchTimelineBar: React.FC<TouchTimelineBarProps> = ({
  compiled,
  currentTime,
  isPlaying,
  playbackRate,
  onSeek,
  onTogglePlay,
  onChangePlaybackRate,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);

  const duration = Math.max(0.1, compiled.duration);
  const fps = compiled.fps || 60;
  const currentFrame = timeToFrame(currentTime, fps);
  const totalFrames = totalFramesForDuration(duration, fps);
  const progressPct = clamp((currentTime / duration) * 100, 0, 100);

  const seekFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = clamp((clientX - rect.left) / rect.width, 0, 1);
    const targetFrame = Math.round(frac * totalFrames);
    onSeek(clamp(frameToTime(targetFrame, fps), 0, duration));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    seekFromClientX(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  const stepFrames = (deltaFrames: number) => {
    const nextFrame = clamp(currentFrame + deltaFrames, 0, totalFrames);
    onSeek(clamp(frameToTime(nextFrame, fps), 0, duration));
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#131720] p-4">
      {/* Timecode & Frame Readout (Clean unboxed metadata with typographic separators) */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 tabular-nums">
        <div className="flex items-center gap-2 font-medium">
          <span className="text-sm font-bold text-white">{formatTimecode(currentTime)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatTimecode(duration)}</span>
          <span aria-hidden="true">·</span>
          <span>
            Frame {currentFrame} / {totalFrames}
          </span>
          <span aria-hidden="true">·</span>
          <span>{fps} fps</span>
        </div>

        {/* Scene quick-jump buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          {compiled.scenes.map((sc) => {
            const isActive = currentTime >= sc.t0 && currentTime < sc.t1;
            const populatedT = Math.min(
              sc.t1 - 0.05,
              sc.t0 + Math.min(1.8, Math.max(0.4, (sc.t1 - sc.t0) * 0.6))
            );
            return (
              <button
                key={sc.id}
                type="button"
                onClick={() => onSeek(isActive && Math.abs(currentTime - populatedT) < 0.2 ? sc.t0 : populatedT)}
                className={`min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-sky-500 text-slate-950'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {sc.id} ({sc.t0.toFixed(1)}s)
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Touch Timeline Track (48dp touch height, NO <input type="range">) */}
      <div
        ref={trackRef}
        role="group"
        aria-label="Timeline Scrub Track"
        data-testid="touch-timeline-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative h-12 w-full cursor-pointer select-none overflow-hidden rounded-xl border border-white/15 bg-[#0B0D12] touch-none"
      >
        {/* Scene interval segments */}
        {compiled.scenes.map((sc, idx) => {
          const leftPct = clamp((sc.t0 / duration) * 100, 0, 100);
          const widthPct = clamp(((sc.t1 - sc.t0) / duration) * 100, 0, 100 - leftPct);
          return (
            <div
              key={sc.id}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              className={`absolute top-0 bottom-0 border-r border-white/15 flex items-end px-2 pb-1 text-[11px] font-medium text-slate-400 pointer-events-none ${
                idx % 2 === 0 ? 'bg-white/[0.03]' : 'bg-white/[0.06]'
              }`}
            >
              <span className="truncate">{sc.id}</span>
            </div>
          );
        })}

        {/* Elapsed fill bar */}
        <div
          style={{ width: `${progressPct}%` }}
          className="absolute top-0 bottom-0 left-0 bg-sky-500/25 pointer-events-none"
        />

        {/* Playhead vertical bar + handle */}
        <div
          style={{ left: `${progressPct}%` }}
          className="absolute top-0 bottom-0 -ml-0.5 w-1 bg-emerald-400 shadow-[0_0_12px_rgba(46,229,157,0.9)] pointer-events-none"
        >
          <div className="mx-auto -mt-0.5 h-3.5 w-3.5 -translate-x-1.5 rounded-full bg-emerald-400" />
        </div>
      </div>

      {/* Transport Steppers & Playback Speed Segmented Control (all >= 48px touch targets) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSeek(0)}
            aria-label="Jump to start"
            className="min-h-[48px] min-w-[48px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            0.0s
          </button>
          <button
            type="button"
            onClick={() => stepFrames(-fps)}
            aria-label="Step back 1 second"
            className="min-h-[48px] min-w-[48px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            -1s
          </button>
          <button
            type="button"
            onClick={() => stepFrames(-1)}
            aria-label="Previous frame"
            className="min-h-[48px] min-w-[48px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            -1f
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
            className="min-h-[48px] px-6 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm transition-colors whitespace-nowrap shrink-0"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => stepFrames(1)}
            aria-label="Next frame"
            className="min-h-[48px] min-w-[48px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            +1f
          </button>
          <button
            type="button"
            onClick={() => stepFrames(fps)}
            aria-label="Step forward 1 second"
            className="min-h-[48px] min-w-[48px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            +1s
          </button>
        </div>

        {/* Speed Segmented Control */}
        <div className="flex items-center gap-1 rounded-xl bg-[#0B0D12] p-1 border border-white/10">
          {[0.5, 1, 2].map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => onChangePlaybackRate(rate)}
              className={`min-h-[40px] min-w-[48px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                playbackRate === rate
                  ? 'bg-white/15 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
