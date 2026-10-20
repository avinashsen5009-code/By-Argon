import { frameToTime, timeToFrame } from '../core/time.ts';
import type { CompiledRecipe } from '../core/types.ts';
import { renderFrame } from '../render/renderer.ts';
import { probeExportCapabilities } from './capabilities.ts';
import { createUnifiedMuxer } from './muxer.ts';
import { createVideoEncoderSession } from './videoEncoder.ts';

export interface ExportProgressInfo {
  currentFrame: number;
  totalFrames: number;
  percent: number;
  elapsedSeconds: number;
  etaSeconds: number;
  pipeline: string;
  phase: 'preparing' | 'rendering' | 'muxing' | 'done' | 'cancelled' | 'error';
  message?: string;
}

export interface ExportResult {
  blob: Blob;
  url: string;
  fileName: string;
  mimeType: string;
  byteLength: number;
  totalFrames: number;
  nativeUri?: string;
  pipeline: string;
}

export interface ExportJobOptions {
  compiled: CompiledRecipe;
  scaleFactor?: 1 | 0.6667 | 0.5;
  fpsOverride?: 30 | 60;
  fromSec?: number;
  toSec?: number;
  fileNameBase?: string;
  onProgress?: (info: ExportProgressInfo) => void;
  signal?: AbortSignal;
}

/**
 * Deterministic, frame-accurate video exporter.
 * Uses WebCodecs (`VideoEncoder` + `mp4-muxer` or `webm-muxer`) when supported,
 * and falls back gracefully to `MediaRecorder` canvas capture when running on a browser
 * without WebCodecs support.
 */
export async function exportRecipeVideo(opts: ExportJobOptions): Promise<ExportResult> {
  const scale = opts.scaleFactor ?? 1;
  const width = Math.round((opts.compiled.w * scale) / 2) * 2;
  const height = Math.round((opts.compiled.h * scale) / 2) * 2;
  const fps = opts.fpsOverride ?? opts.compiled.fps ?? 30;
  const startSec = Math.max(0, opts.fromSec ?? 0);
  const endSec = Math.min(opts.compiled.duration, opts.toSec ?? opts.compiled.duration);
  const startFrame = timeToFrame(startSec, fps);
  const endFrame = Math.max(startFrame + 1, timeToFrame(endSec, fps));
  const totalFrames = endFrame - startFrame;

  const startTimeMs = performance.now();

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const caps = await probeExportCapabilities(width, height, fps);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const report = (
    currentFrame: number,
    phase: ExportProgressInfo['phase'],
    pipeline: string,
    message?: string
  ) => {
    if (!opts.onProgress) return;
    const elapsedSeconds = (performance.now() - startTimeMs) / 1000;
    const doneRatio = Math.max(1e-4, currentFrame / totalFrames);
    const etaSeconds = currentFrame > 0 ? Math.max(0, (elapsedSeconds / doneRatio) - elapsedSeconds) : 0;
    opts.onProgress({
      currentFrame,
      totalFrames,
      percent: Math.min(100, Math.round((currentFrame / totalFrames) * 100)),
      elapsedSeconds,
      etaSeconds,
      pipeline,
      phase,
      message,
    });
  };

  // Path 1: WebCodecs (MP4 H.264 or WebM VP9)
  if (caps.supportsH264Mp4 || caps.supportsVp9Webm) {
    const container = caps.supportsH264Mp4 ? 'mp4' : 'webm';
    const pipelineLabel =
      container === 'mp4' ? 'WebCodecs H.264 + mp4-muxer' : 'WebCodecs VP9 + webm-muxer';
    const fileName = `${opts.fileNameBase || 'recipe-studio'}.${container}`;

    report(0, 'preparing', pipelineLabel, 'Initializing hardware encoder...');

    const muxer = await createUnifiedMuxer({
      container,
      width,
      height,
      fps,
      hasAudio: false,
      fileName,
    });

    const videoSession = await createVideoEncoderSession({
      muxer,
      width,
      height,
      fps,
    });

    for (let i = 0; i < totalFrames; i++) {
      if (opts.signal?.aborted) {
        report(i, 'cancelled', pipelineLabel, 'Export cancelled');
        throw new Error('Export cancelled by user');
      }

      const globalFrameIdx = startFrame + i;
      const t = frameToTime(globalFrameIdx, fps);

      ctx.save();
      ctx.scale(width / opts.compiled.w, height / opts.compiled.h);
      renderFrame(ctx, opts.compiled, t, { fastPreview: false });
      ctx.restore();

      await videoSession.encodeFrame(canvas, i);

      if (i % 5 === 0 || i === totalFrames - 1) {
        report(i + 1, 'rendering', pipelineLabel);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    report(totalFrames, 'muxing', pipelineLabel, 'Finalizing container...');
    await videoSession.flushAndClose();
    const finalized = await muxer.finalize();
    const url = URL.createObjectURL(finalized.blob);

    report(totalFrames, 'done', pipelineLabel, 'Export complete');
    return {
      blob: finalized.blob,
      url,
      fileName,
      mimeType: muxer.mimeType,
      byteLength: finalized.byteLength,
      totalFrames,
      nativeUri: finalized.nativeUri,
      pipeline: pipelineLabel,
    };
  }

  // Path 2: Fallback MediaRecorder real-time / stepped capture (labelled clearly per SPEC)
  const fallbackLabel = 'MediaRecorder Fallback (slower, lower quality)';
  const fileName = `${opts.fileNameBase || 'recipe-studio'}.webm`;
  report(0, 'preparing', fallbackLabel, 'Starting MediaRecorder fallback...');

  const stream = canvas.captureStream(fps);
  const mimeType =
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType });
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  const stopPromise = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
  });

  recorder.start(100);

  for (let i = 0; i < totalFrames; i++) {
    if (opts.signal?.aborted) {
      recorder.stop();
      throw new Error('Export cancelled by user');
    }
    const globalFrameIdx = startFrame + i;
    const t = frameToTime(globalFrameIdx, fps);

    ctx.save();
    ctx.scale(width / opts.compiled.w, height / opts.compiled.h);
    renderFrame(ctx, opts.compiled, t, { fastPreview: false });
    ctx.restore();

    if (i % 4 === 0 || i === totalFrames - 1) {
      report(i + 1, 'rendering', fallbackLabel);
      await new Promise((r) => setTimeout(r, 8));
    }
  }

  recorder.stop();
  const blob = await stopPromise;
  const url = URL.createObjectURL(blob);
  report(totalFrames, 'done', fallbackLabel, 'Export complete');

  return {
    blob,
    url,
    fileName,
    mimeType,
    byteLength: blob.size,
    totalFrames,
    pipeline: fallbackLabel,
  };
}
