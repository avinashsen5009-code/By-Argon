import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildLayerChangeNote } from '../../core/promptbuilder.ts';
import { frameToTime, queryActiveLayersAtTime, timeToFrame } from '../../core/time.ts';
import type { CompiledLayer, CompiledRecipe } from '../../core/types.ts';
import { isHeadlessSoftwareRenderer } from '../../render/fx.ts';
import {
  hitTestLayerAtPoint,
  type RenderFrameMetrics,
  renderFrame,
} from '../../render/renderer.ts';
import { triggerHaptic } from '../../store/db.ts';
import { TouchTimelineBar } from '../components/TouchTimelineBar.tsx';

interface PreviewStageScreenProps {
  compiled: CompiledRecipe;
  audioDataUrl?: string;
  audioOffsetSec?: number;
  audioPeaks?: number[];
  currentTime: number;
  onChangeTime: (t: number) => void;
  onGoToExport?: () => void;
  compact?: boolean;
}

export const PreviewStageScreen: React.FC<PreviewStageScreenProps> = ({
  compiled,
  audioDataUrl,
  audioOffsetSec = 0,
  audioPeaks = [],
  currentTime,
  onChangeTime,
  onGoToExport,
  compact = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopScene, setLoopScene] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [showLayoutGrid, setShowLayoutGrid] = useState(false);
  const [showLayerBounds, setShowLayerBounds] = useState(false);
  const [showFrameMeter, setShowFrameMeter] = useState(false);
  const [previewScale, setPreviewScale] = useState<1 | 0.5>(0.5);

  // M11 Tap-to-select layer in preview
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [layerNoteText, setLayerNoteText] = useState('');
  const [copiedLayerNote, setCopiedLayerNote] = useState(false);

  // M13 Frame-time meter metrics
  const [frameMetrics, setFrameMetrics] = useState<RenderFrameMetrics>({
    totalMs: 0,
    heaviestLayers: [],
    skippedUnknownLayers: [],
  });

  const timeRef = useRef(currentTime);
  timeRef.current = currentTime;

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const loopSceneRef = useRef(loopScene);
  loopSceneRef.current = loopScene;

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
    const metrics = renderFrame(ctx, compiled, currentTime, {
      showSafeArea,
      showLayoutGrid,
      showLayerBounds,
      selectedLayerId,
      fastPreview: isHeadlessSoftwareRenderer(),
    });
    ctx.restore();
    setFrameMetrics(metrics);
  }, [
    compiled,
    currentTime,
    showSafeArea,
    showLayoutGrid,
    showLayerBounds,
    selectedLayerId,
    previewScale,
  ]);

  // Playback loop (clocked to audio master clock or monotonic performance.now())
  useEffect(() => {
    if (!isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      return;
    }

    const headless = isHeadlessSoftwareRenderer();
    const minStepMs = headless ? 66 : 16;
    let lastFrameMs = performance.now();
    let rafId = 0;

    if (audioRef.current && audioDataUrl) {
      audioRef.current.muted = isMuted;
      audioRef.current.currentTime = Math.max(0, timeRef.current + audioOffsetSec);
      audioRef.current.play().catch(() => {});
    }

    const tick = (nowMs: number) => {
      if (!isPlayingRef.current) return;
      const dtMs = nowMs - lastFrameMs;
      if (dtMs >= minStepMs) {
        lastFrameMs = nowMs;
        const dtSec = dtMs / 1000;
        let nextT = timeRef.current + dtSec;

        // If audio is playing, resync if drift > 40 ms (M13)
        if (audioRef.current && !audioRef.current.paused && audioDataUrl) {
          const audioT = audioRef.current.currentTime - audioOffsetSec;
          if (Math.abs(audioT - nextT) > 0.04) {
            nextT = Math.max(0, audioT);
          }
        }

        // Loop current scene if enabled (M13)
        if (loopSceneRef.current) {
          const curScene = compiled.scenes.find(
            (sc) => timeRef.current >= sc.t0 && timeRef.current <= sc.t1
          );
          if (curScene && nextT >= curScene.t1) {
            nextT = curScene.t0;
            if (audioRef.current && audioDataUrl) {
              audioRef.current.currentTime = Math.max(0, nextT + audioOffsetSec);
            }
          }
        }

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
  }, [isPlaying, compiled.duration, compiled.scenes, audioDataUrl, audioOffsetSec, isMuted, onChangeTime]);

  const activeLayers = useMemo(() => {
    return queryActiveLayersAtTime(compiled.intervalSorted, currentTime, compiled.duration);
  }, [compiled, currentTime]);

  const selectedLayer: CompiledLayer | undefined = useMemo(() => {
    if (!selectedLayerId) return undefined;
    return compiled.layersById.get(selectedLayerId);
  }, [compiled, selectedLayerId]);

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const normX = (e.clientX - rect.left) / Math.max(1, rect.width);
    const normY = (e.clientY - rect.top) / Math.max(1, rect.height);
    const hit = hitTestLayerAtPoint(compiled, currentTime, normX, normY);
    setSelectedLayerId(hit ? hit.id : null);
  };

  const handleCopyLayerNote = async () => {
    if (!selectedLayer) return;
    const note = buildLayerChangeNote(
      selectedLayer,
      layerNoteText || 'Adjust position, size, or animation timing'
    );
    try {
      await navigator.clipboard.writeText(note);
    } catch {
      // ignore
    }
    triggerHaptic(15);
    setCopiedLayerNote(true);
    setTimeout(() => setCopiedLayerNote(false), 2500);
  };

  const handleStepFrame = (deltaFrames: number) => {
    setIsPlaying(false);
    const curFrame = timeToFrame(currentTime, compiled.fps);
    const maxFrame = timeToFrame(compiled.duration, compiled.fps);
    const nextFrame = Math.max(0, Math.min(maxFrame, curFrame + deltaFrames));
    onChangeTime(frameToTime(nextFrame, compiled.fps));
  };

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

          {/* Guide, Bounds, Frame Meter & Preview Quality Toggles */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowSafeArea((v) => !v)}
              className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                showSafeArea
                  ? 'bg-emerald-400 text-slate-950'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              Safe Area
            </button>
            <button
              type="button"
              onClick={() => setShowLayoutGrid((v) => !v)}
              className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                showLayoutGrid
                  ? 'bg-sky-400 text-slate-950'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              Grid
            </button>
            <button
              type="button"
              onClick={() => setShowLayerBounds((v) => !v)}
              className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                showLayerBounds
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              Bounds
            </button>
            <button
              type="button"
              onClick={() => setShowFrameMeter((v) => !v)}
              className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                showFrameMeter
                  ? 'bg-violet-400 text-slate-950'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {frameMetrics.totalMs.toFixed(1)} ms
            </button>
            {audioDataUrl && (
              <button
                type="button"
                onClick={() => setIsMuted((m) => !m)}
                className="min-h-[38px] px-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 transition-colors"
              >
                {isMuted ? 'Muted' : 'Audio ON'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPreviewScale((s) => (s === 1 ? 0.5 : 1))}
              className="min-h-[38px] px-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 transition-colors whitespace-nowrap"
            >
              {previewScale === 1 ? '100% Res' : '50% Fast'}
            </button>
          </div>
        </div>

        {/* M13 Frame-Time Meter Diagnostic Strip */}
        {showFrameMeter && (
          <div className="mb-3 rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-200 flex flex-wrap items-center justify-between gap-2 tabular-nums">
            <span>
              Frame Render Time: <strong>{frameMetrics.totalMs.toFixed(2)} ms</strong>
            </span>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
              <span>Heaviest Layers:</span>
              {frameMetrics.heaviestLayers.map((hl) => (
                <span key={hl.id} className="rounded bg-white/10 px-2 py-0.5">
                  {hl.id} ({hl.type}): {hl.ms.toFixed(2)}ms
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Canvas Wrapper (Tap to select layer in M11) */}
        <div className="flex items-center justify-center rounded-xl border border-white/10 bg-[#07080C] p-3 overflow-hidden">
          <canvas
            ref={canvasRef}
            onPointerDown={handleCanvasPointerDown}
            data-testid="recipe-stage-canvas"
            style={{
              aspectRatio: `${compiled.w} / ${compiled.h}`,
              maxHeight: isVertical ? (compact ? '420px' : '540px') : '460px',
              width: isVertical ? 'auto' : '100%',
            }}
            className={`${
              isVertical ? 'h-[400px] sm:h-[500px] w-auto' : 'w-full h-auto'
            } max-w-full cursor-crosshair rounded-lg shadow-2xl`}
          />
        </div>

        {/* M11 Selected Layer Change Note Bar */}
        {selectedLayer && (
          <div className="mt-3 rounded-xl border border-sky-400/40 bg-sky-500/10 p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-sky-200 font-mono">
              Selected: <strong>{selectedLayer.id}</strong> ({selectedLayer.type} · scene{' '}
              {selectedLayer.sceneId})
            </div>
            <div className="flex flex-1 min-w-[240px] items-center gap-2">
              <input
                type="text"
                value={layerNoteText}
                onChange={(e) => setLayerNoteText(e.target.value)}
                placeholder="Note for AI (e.g. Move higher and usehero style)..."
                className="min-h-[38px] flex-1 rounded-lg border border-white/15 bg-[#0B0D12] px-3 text-xs text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopyLayerNote}
                className="min-h-[38px] px-3 rounded-lg bg-sky-400 hover:bg-sky-300 text-slate-950 font-bold text-xs whitespace-nowrap"
              >
                {copiedLayerNote ? 'Copied Note!' : 'Copy Layer Note'}
              </button>
              <button
                type="button"
                onClick={() => setSelectedLayerId(null)}
                className="min-h-[38px] px-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-slate-300"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Zero-Slider Custom Touch Timeline Bar */}
      <TouchTimelineBar
        compiled={compiled}
        currentTime={currentTime}
        isPlaying={isPlaying}
        loopScene={loopScene}
        audioPeaks={audioPeaks}
        onSeek={(t) => {
          setIsPlaying(false);
          onChangeTime(t);
        }}
        onTogglePlay={() => setIsPlaying((p) => !p)}
        onStepFrame={handleStepFrame}
        onToggleLoopScene={() => setLoopScene((l) => !l)}
      />

      {/* Active Layer Inspector at Current Frame */}
      {!compact && (
        <div className="rounded-2xl border border-white/10 bg-[#131720] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="font-display text-sm font-bold text-white">
              Active Layers at t = {currentTime.toFixed(2)}s ({activeLayers.length}) — Tap any layer to inspect
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
            {activeLayers.map((l) => {
              const isSel = selectedLayerId === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setSelectedLayerId(isSel ? null : l.id)}
                  className={`rounded-xl border px-3 py-2 text-left text-xs tabular-nums transition-colors ${
                    isSel
                      ? 'border-sky-400 bg-sky-500/15 text-white'
                      : 'border-white/10 bg-[#0B0D12] text-slate-300 hover:border-white/25'
                  }`}
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
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
