import React, { useEffect, useRef, useState } from 'react';
import type { CompiledRecipe } from '../../core/types.ts';
import { type ExportCapabilities, probeExportCapabilities } from '../../export/capabilities.ts';
import {
  type ExportProgressInfo,
  type ExportResult,
  exportRecipeVideo,
} from '../../export/exporter.ts';
import { isNativeAndroid, NativeVideoSink } from '../../native/bridge.ts';
import { recordExportHistory, triggerHaptic } from '../../store/db.ts';

interface ExportScreenProps {
  compiled: CompiledRecipe;
  projectTitle: string;
  audioDataUrl?: string;
  audioOffsetSec?: number;
  currentTime?: number;
}

export const ExportScreen: React.FC<ExportScreenProps> = ({
  compiled,
  projectTitle,
  audioDataUrl,
  audioOffsetSec = 0,
  currentTime = 0,
}) => {
  const [scaleFactor, setScaleFactor] = useState<1 | 0.6667 | 0.4444>(1);
  const [fpsChoice, setFpsChoice] = useState<24 | 30 | 60>(
    compiled.duration > 120 ? 30 : compiled.fps === 24 ? 24 : compiled.fps === 30 ? 30 : 60
  );
  const [bitratePreset, setBitratePreset] = useState<'auto' | 'high'>('auto');
  const [containerChoice, setContainerChoice] = useState<'auto' | 'mp4' | 'webm' | 'webm-alpha'>('auto');
  const [rangeMode, setRangeMode] = useState<'full' | 'currentScene' | 'segment60s' | 'quick3s'>('full');
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [caps, setCaps] = useState<ExportCapabilities | null>(null);
  const [progress, setProgress] = useState<ExportProgressInfo | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const exportW = Math.round((compiled.w * scaleFactor) / 2) * 2;
  const exportH = Math.round((compiled.h * scaleFactor) / 2) * 2;

  useEffect(() => {
    probeExportCapabilities(exportW, exportH, fpsChoice).then(setCaps).catch(() => {});
  }, [exportW, exportH, fpsChoice]);

  const totalSegments = Math.max(1, Math.ceil(compiled.duration / 60));

  const getExportRange = (): [number, number] => {
    if (rangeMode === 'quick3s') {
      return [0, Math.min(3.0, compiled.duration)];
    }
    if (rangeMode === 'currentScene') {
      const sc =
        compiled.scenes.find((s) => currentTime >= s.t0 && currentTime <= s.t1) ??
        compiled.scenes[0];
      return sc ? [sc.t0, sc.t1] : [0, compiled.duration];
    }
    if (rangeMode === 'segment60s') {
      const from = segmentIndex * 60;
      const to = Math.min(compiled.duration, (segmentIndex + 1) * 60);
      return [from, to];
    }
    return [0, compiled.duration];
  };

  const [fromSec, toSec] = getExportRange();
  const estFrames = Math.max(1, Math.ceil((toSec - fromSec) * fpsChoice));

  const handleStartExport = async () => {
    setErrorMsg(null);
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let audioBlob: Blob | undefined;
      if (audioDataUrl) {
        try {
          const resp = await fetch(audioDataUrl);
          audioBlob = await resp.blob();
        } catch {
          // ignore
        }
      }

      const safeName = projectTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const res = await exportRecipeVideo({
        compiled,
        scaleFactor,
        fpsOverride: fpsChoice,
        bitratePreset,
        containerOverride: containerChoice,
        fromSec,
        toSec,
        audioBlob,
        audioOffsetSec,
        fileNameBase: `${safeName || 'recipe-video'}-${exportW}x${exportH}`,
        signal: controller.signal,
        onProgress: (info) => setProgress(info),
      });
      triggerHaptic(25);
      await recordExportHistory({
        id: `exp_${Date.now()}`,
        projectId: safeName || 'default',
        fileName: res.fileName,
        mimeType: res.mimeType,
        byteLength: res.byteLength,
        durationSec: res.verification.actualDurationSec,
        w: exportW,
        h: exportH,
        fps: fpsChoice,
        createdAt: Date.now(),
      });
      setResult(res);
    } catch (err: any) {
      if (err?.message !== 'Export cancelled by user') {
        setErrorMsg(err?.message ?? 'Export failed');
      }
    } finally {
      abortRef.current = null;
    }
  };

  const handleCancelExport = () => {
    abortRef.current?.abort();
  };

  const handleShareResult = async () => {
    if (!result) return;
    if (isNativeAndroid() && result.nativeUri) {
      try {
        await NativeVideoSink.share({
          uri: result.nativeUri,
          mime: result.mimeType,
        });
        return;
      } catch {
        // Fallback to Web Share
      }
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        const file = new File([result.blob], result.fileName, { type: result.mimeType });
        await navigator.share({
          title: result.fileName,
          files: [file],
        });
      } catch {
        // User dismissed share sheet
      }
    }
  };

  const isRunning =
    progress?.phase === 'preparing' ||
    progress?.phase === 'rendering' ||
    progress?.phase === 'muxing' ||
    progress?.phase === 'verifying';

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-white/10 bg-[#131720] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-lg font-bold text-white">
              04. Offline Frame-Accurate Video Export
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Renders identical deterministic pixels using WebCodecs hardware encoding and streaming MP4/WebM muxing.
            </p>
          </div>

          {caps && (
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span>Pipeline:</span>
              <span className="font-bold text-emerald-400">
                {caps.supportsH264Mp4
                  ? `WebCodecs H.264 MP4 (${caps.selectedVideoCodec})`
                  : caps.supportsVp9Webm
                  ? 'WebCodecs VP9 WebM'
                  : 'MediaRecorder Fallback (slower, lower quality)'}
              </span>
            </div>
          )}
        </div>

        {/* Export Settings (Zero Sliders: Segmented Buttons Only) */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Resolution Scale: 1080p, 720p, 480p */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-300">Output Resolution</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { scale: 1, label: '1080p Full' },
                  { scale: 0.6667, label: '720p HD' },
                  { scale: 0.4444, label: '480p Fast' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setScaleFactor(opt.scale)}
                  className={`min-h-[48px] rounded-xl px-2 text-xs font-bold transition-colors whitespace-nowrap ${
                    scaleFactor === opt.scale
                      ? 'bg-sky-500 text-slate-950'
                      : 'bg-[#0B0D12] text-slate-300 border border-white/10 hover:border-white/25'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Export Frame Rate: 24, 30, 60 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-300">
              Export Frame Rate {compiled.duration > 120 ? '(30 fps recommended for >2 min)' : ''}
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {([24, 30, 60] as const).map((fps) => (
                <button
                  key={fps}
                  type="button"
                  onClick={() => setFpsChoice(fps)}
                  className={`min-h-[48px] rounded-xl px-3 text-xs font-bold transition-colors whitespace-nowrap ${
                    fpsChoice === fps
                      ? 'bg-sky-500 text-slate-950'
                      : 'bg-[#0B0D12] text-slate-300 border border-white/10 hover:border-white/25'
                  }`}
                >
                  {fps} fps
                </button>
              ))}
            </div>
          </div>

          {/* Bitrate & Container */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-300">Bitrate</span>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { id: 'auto', label: 'Auto' },
                    { id: 'high', label: 'High' },
                  ] as const
                ).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBitratePreset(b.id)}
                    className={`min-h-[48px] rounded-xl px-2 text-xs font-bold transition-colors ${
                      bitratePreset === b.id
                        ? 'bg-sky-500 text-slate-950'
                        : 'bg-[#0B0D12] text-slate-300 border border-white/10 hover:border-white/25'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-300">Container</span>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'auto', label: 'MP4' },
                    { id: 'webm', label: 'WebM' },
                    { id: 'webm-alpha', label: 'Alpha' },
                  ] as const
                ).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setContainerChoice(c.id)}
                    className={`min-h-[48px] rounded-xl px-1.5 text-xs font-bold transition-colors whitespace-nowrap ${
                      containerChoice === c.id
                        ? 'bg-sky-500 text-slate-950'
                        : 'bg-[#0B0D12] text-slate-300 border border-white/10 hover:border-white/25'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Export Range Scope */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-300">Export Range</span>
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  { id: 'full', label: 'Full' },
                  { id: 'currentScene', label: 'Scene' },
                  { id: 'segment60s', label: '60s Part' },
                  { id: 'quick3s', label: '3s Test' },
                ] as const
              ).map((rm) => (
                <button
                  key={rm.id}
                  type="button"
                  onClick={() => setRangeMode(rm.id)}
                  className={`min-h-[48px] rounded-xl px-2 text-xs font-bold transition-colors whitespace-nowrap ${
                    rangeMode === rm.id
                      ? 'bg-sky-500 text-slate-950'
                      : 'bg-[#0B0D12] text-slate-300 border border-white/10 hover:border-white/25'
                  }`}
                >
                  {rm.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Segment selector if 60s Segment mode is active */}
        {rangeMode === 'segment60s' && totalSegments > 1 && (
          <div className="mt-4">
            <span className="text-xs font-semibold text-slate-300">Select 60-Second Segment:</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {Array.from({ length: totalSegments }).map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSegmentIndex(idx)}
                  className={`min-h-[44px] px-4 rounded-xl text-xs font-bold border transition-colors tabular-nums ${
                    segmentIndex === idx
                      ? 'border-sky-400 bg-sky-500 text-slate-950'
                      : 'border-white/10 bg-[#0B0D12] text-slate-200'
                  }`}
                >
                  Segment {idx + 1} ({idx * 60}s–{Math.min(compiled.duration, (idx + 1) * 60)}s)
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Summary & Start Export Button */}
        <div className="mt-5 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 tabular-nums">
            <span>
              Resolution: <strong className="text-white">{exportW}×{exportH}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Range: <strong className="text-white">{fromSec.toFixed(1)}s – {toSec.toFixed(1)}s</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Frames to Render: <strong className="text-white">{estFrames.toLocaleString()}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            {!isRunning ? (
              <button
                type="button"
                onClick={handleStartExport}
                data-testid="start-export-btn"
                className="min-h-[52px] px-7 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-display font-bold text-sm transition-colors whitespace-nowrap"
              >
                Render & Export Video
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCancelExport}
                className="min-h-[52px] px-6 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-sm transition-colors whitespace-nowrap"
              >
                Cancel Export
              </button>
            )}
          </div>
        </div>

        {/* Live Progress Indicator */}
        {progress && (
          <div className="mt-4 rounded-xl border border-white/10 bg-[#0B0D12] p-4 tabular-nums">
            <div className="flex items-center justify-between text-xs font-semibold text-white">
              <span>
                {progress.phase.toUpperCase()} — {progress.pipeline}
              </span>
              <span>
                {progress.currentFrame} / {progress.totalFrames} frames ({progress.percent}%)
              </span>
            </div>
            <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div
                style={{ width: `${progress.percent}%` }}
                className="h-full bg-emerald-400 transition-all"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>Elapsed: {progress.elapsedSeconds.toFixed(1)}s</span>
              <span>Avg Frame: {progress.avgFrameMs.toFixed(1)}ms</span>
              <span>ETA: {progress.etaSeconds.toFixed(1)}s</span>
            </div>
            {progress.message && (
              <div className="mt-1.5 text-[11px] text-emerald-300">{progress.message}</div>
            )}
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-200">
            Export error: {errorMsg}
          </div>
        )}

        {/* Completed Video Download, Verification & Share */}
        {result && (
          <div
            data-testid="export-result-card"
            className="mt-5 rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-200 tabular-nums">
                <div className="font-bold text-sm text-emerald-300">
                  Export Complete: {result.fileName}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-slate-300">
                  <span>{(result.byteLength / 1024).toFixed(1)} KB</span>
                  <span aria-hidden="true">·</span>
                  <span>{result.totalFrames} frames</span>
                  <span aria-hidden="true">·</span>
                  <span>{result.pipeline}</span>
                </div>
                <div className="mt-1 text-[11px] text-emerald-200">
                  {result.verification.message}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleShareResult}
                  className="min-h-[48px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs transition-colors"
                >
                  Share
                </button>
                <a
                  href={result.url}
                  download={result.fileName}
                  data-testid="download-exported-video"
                  className="min-h-[48px] inline-flex items-center px-6 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs transition-colors whitespace-nowrap"
                >
                  Download {result.fileName}
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
