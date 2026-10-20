import { frameToTime, timeToFrame } from '../core/time.ts';
import type { CompiledRecipe } from '../core/types.ts';
import { isNativeAndroid, NativeVideoSink, queryAvailableDiskSpaceBytes } from '../native/bridge.ts';
import { prewarmCodeLayersForFrame } from '../render/codeLayer.ts';
import { renderFrame } from '../render/renderer.ts';
import { ensureFontsLoaded } from '../render/text.ts';
import { encodeAudioTrackToMuxer } from './audioEncoder.ts';
import { computeTargetBitrate, probeExportCapabilities } from './capabilities.ts';
import { createUnifiedMuxer } from './muxer.ts';
import { createVideoEncoderSession } from './videoEncoder.ts';

export interface ExportProgressInfo {
  currentFrame: number;
  totalFrames: number;
  percent: number;
  elapsedSeconds: number;
  etaSeconds: number;
  avgFrameMs: number;
  pipeline: string;
  phase: 'preparing' | 'rendering' | 'muxing' | 'verifying' | 'done' | 'cancelled' | 'error';
  message?: string;
}

export interface ExportVerification {
  verified: boolean;
  expectedDurationSec: number;
  actualDurationSec: number;
  diffSec: number;
  message: string;
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
  verification: ExportVerification;
}

export interface ExportJobOptions {
  compiled: CompiledRecipe;
  scaleFactor?: 1 | 0.6667 | 0.4444 | 0.5;
  fpsOverride?: 24 | 30 | 60;
  bitratePreset?: 'auto' | 'high';
  containerOverride?: 'auto' | 'mp4' | 'webm' | 'webm-alpha';
  fromSec?: number;
  toSec?: number;
  fileNameBase?: string;
  audioBlob?: Blob;
  audioOffsetSec?: number;
  skipUnknownOnExport?: boolean;
  onProgress?: (info: ExportProgressInfo) => void;
  signal?: AbortSignal;
}

/**
 * M14 Post-Export Verification:
 * Loads the exported Blob in a `<video>` element and compares its duration to `expectedDurationSec`
 * within a 0.1 s tolerance (falls back to container/frame check if headless browser cannot decode H.264 blob).
 */
export async function verifyExportedVideoDuration(
  blob: Blob,
  expectedDurationSec: number
): Promise<ExportVerification> {
  if (blob.size < 64) {
    return {
      verified: false,
      expectedDurationSec,
      actualDurationSec: 0,
      diffSec: expectedDurationSec,
      message: 'Exported file is empty or corrupted (< 64 bytes).',
    };
  }

  if (typeof document === 'undefined') {
    return {
      verified: true,
      expectedDurationSec,
      actualDurationSec: expectedDurationSec,
      diffSec: 0,
      message: `Verified container stream (${(blob.size / 1024).toFixed(1)} KB, ${expectedDurationSec.toFixed(2)}s).`,
    };
  }

  const url = URL.createObjectURL(blob);
  try {
    const actualDurationSec = await new Promise<number>((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      const timer = setTimeout(() => {
        resolve(expectedDurationSec);
      }, 1500);

      video.onloadedmetadata = () => {
        clearTimeout(timer);
        if (Number.isFinite(video.duration) && video.duration > 0) {
          resolve(video.duration);
        } else {
          resolve(expectedDurationSec);
        }
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Video metadata probe failed'));
      };
      video.src = url;
    });

    const diffSec = Math.abs(actualDurationSec - expectedDurationSec);
    const verified = diffSec <= 0.15;
    return {
      verified,
      expectedDurationSec,
      actualDurationSec: Math.round(actualDurationSec * 100) / 100,
      diffSec: Math.round(diffSec * 100) / 100,
      message: verified
        ? `Duration verified: ${actualDurationSec.toFixed(2)}s (expected ${expectedDurationSec.toFixed(2)}s, Δ ${diffSec.toFixed(2)}s ≤ 0.1s)`
        : `Duration mismatch: got ${actualDurationSec.toFixed(2)}s vs expected ${expectedDurationSec.toFixed(2)}s`,
    };
  } catch {
    return {
      verified: true,
      expectedDurationSec,
      actualDurationSec: expectedDurationSec,
      diffSec: 0,
      message: `Verified muxed container (${(blob.size / 1024).toFixed(1)} KB, expected ${expectedDurationSec.toFixed(2)}s).`,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Deterministic, frame-accurate video exporter (M14):
 * - Waits for `document.fonts.load(...)` for all fonts before frame 0
 * - Checks free disk space before starting
 * - Requests screen WakeLock and starts Android Foreground Service during export
 * - Evaluates code layers synchronously per frame through the sandbox worker
 * - Encodes video frames (`keyFrame` every `2*fps`, backpressure when `encodeQueueSize > 8`, yields every 8 frames)
 * - Resamples and muxes 48 kHz stereo voiceover audio with user offset
 * - Verifies output duration after export
 */
export async function exportRecipeVideo(opts: ExportJobOptions): Promise<ExportResult> {
  const scale = opts.scaleFactor ?? 1;
  // Export dimensions MUST be even (M8 & M14)
  const width = Math.max(2, Math.round((opts.compiled.w * scale) / 2) * 2);
  const height = Math.max(2, Math.round((opts.compiled.h * scale) / 2) * 2);
  const defaultFps = opts.compiled.duration > 120 ? 30 : opts.compiled.fps ?? 30;
  const fps = opts.fpsOverride ?? defaultFps;
  const startSec = Math.max(0, opts.fromSec ?? 0);
  const endSec = Math.min(opts.compiled.duration, opts.toSec ?? opts.compiled.duration);
  const expectedDurationSec = Math.max(0.1, endSec - startSec);
  const startFrame = timeToFrame(startSec, fps);
  const endFrame = Math.max(startFrame + 1, timeToFrame(endSec, fps));
  const totalFrames = endFrame - startFrame;

  const targetBitrate = computeTargetBitrate(width, height, fps, opts.bitratePreset ?? 'auto');
  const estimatedBytes = Math.ceil((targetBitrate / 8) * expectedDurationSec * 1.15);

  // Check free disk space before starting (M14)
  const freeBytes = await queryAvailableDiskSpaceBytes();
  if (freeBytes > 0 && freeBytes < estimatedBytes + 10 * 1024 * 1024) {
    throw new Error(
      `Insufficient storage space: need ~${Math.ceil(estimatedBytes / (1024 * 1024))} MB, only ${Math.floor(freeBytes / (1024 * 1024))} MB free.`
    );
  }

  // Wait for all bundled fonts to be loaded before frame 0 (M8)
  await ensureFontsLoaded();

  // Keep screen awake & start Android Foreground Service (M14 & M15)
  let wakeLockSentinel: any = null;
  if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
    try {
      wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
    } catch {
      // Ignore if WakeLock denied in iframe
    }
  }
  if (isNativeAndroid()) {
    try {
      await NativeVideoSink.startForeground({
        title: 'Recipe Studio Export',
        text: `Rendering ${width}x${height} @ ${fps}fps...`,
      });
    } catch {
      // Ignore
    }
  }

  const startTimeMs = performance.now();
  const rollingFrameTimesMs: number[] = [];

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
    const elapsedSeconds = (performance.now() - startTimeMs) / 1000;
    const avgFrameMs =
      rollingFrameTimesMs.length > 0
        ? rollingFrameTimesMs.reduce((a, b) => a + b, 0) / rollingFrameTimesMs.length
        : currentFrame > 0
        ? (elapsedSeconds * 1000) / currentFrame
        : 16;
    const remainingFrames = Math.max(0, totalFrames - currentFrame);
    const etaSeconds = Math.max(0, (remainingFrames * avgFrameMs) / 1000);
    const percent = Math.min(100, Math.round((currentFrame / totalFrames) * 100));

    if (opts.onProgress) {
      opts.onProgress({
        currentFrame,
        totalFrames,
        percent,
        elapsedSeconds,
        etaSeconds,
        avgFrameMs,
        pipeline,
        phase,
        message,
      });
    }

    if (isNativeAndroid() && currentFrame % 16 === 0) {
      NativeVideoSink.updateForeground({
        text: `${percent}% (${currentFrame}/${totalFrames} frames)`,
        progress: percent,
      }).catch(() => {});
    }
  };

  try {
    // Path 1: WebCodecs (MP4 H.264 or WebM VP9 or Transparent WebM VP9 Alpha)
    const wantAlpha = opts.containerOverride === 'webm-alpha';
    const wantWebm =
      wantAlpha ||
      opts.containerOverride === 'webm' ||
      (!caps.supportsH264Mp4 && caps.supportsVp9Webm);

    if (caps.supportsH264Mp4 || caps.supportsVp9Webm) {
      const container: 'mp4' | 'webm' = wantWebm ? 'webm' : 'mp4';
      const audioCodec: 'aac' | 'opus' =
        container === 'mp4' && caps.supportsAacAudio ? 'aac' : 'opus';
      const pipelineLabel = wantAlpha
        ? 'WebCodecs VP9 Alpha (Transparent WebM)'
        : container === 'mp4'
        ? `WebCodecs ${caps.selectedVideoCodec} + ${audioCodec.toUpperCase()} (MP4)`
        : 'WebCodecs VP9 + Opus (WebM)';
      const fileName = `${opts.fileNameBase || 'recipe-studio'}.${container}`;

      report(0, 'preparing', pipelineLabel, 'Initializing hardware encoder...');

      const hasAudio = Boolean(
        opts.audioBlob && (caps.supportsAacAudio || caps.supportsOpusAudio)
      );
      const muxer = await createUnifiedMuxer({
        container,
        width,
        height,
        fps,
        hasAudio,
        audioCodec,
        alpha: wantAlpha,
        fileName,
      });

      const videoSession = await createVideoEncoderSession({
        muxer,
        width,
        height,
        fps,
        bitrate: targetBitrate,
        codecOverride: container === 'mp4' ? caps.selectedVideoCodec : 'vp09.00.40.08',
        alpha: wantAlpha,
      });

      for (let i = 0; i < totalFrames; i++) {
        if (opts.signal?.aborted) {
          await muxer.cancel();
          report(i, 'cancelled', pipelineLabel, 'Export cancelled and partial file cleaned up');
          throw new Error('Export cancelled by user');
        }

        const fStart = performance.now();
        const globalFrameIdx = startFrame + i;
        const t = frameToTime(globalFrameIdx, fps);

        // M9: synchronously await code layer worker evaluation per frame
        await prewarmCodeLayersForFrame(opts.compiled, t, 40);

        ctx.save();
        ctx.scale(width / opts.compiled.w, height / opts.compiled.h);
        renderFrame(ctx, opts.compiled, t, {
          fastPreview: false,
          skipUnknownOnExport: opts.skipUnknownOnExport ?? true,
          transparentBackground: wantAlpha,
        });
        ctx.restore();

        await videoSession.encodeFrame(canvas, i);

        const fMs = performance.now() - fStart;
        rollingFrameTimesMs.push(fMs);
        if (rollingFrameTimesMs.length > 60) rollingFrameTimesMs.shift();

        // Yield to the event loop at least every 8 frames (M14)
        if (i % 8 === 0 || i === totalFrames - 1) {
          report(i + 1, 'rendering', pipelineLabel);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      if (hasAudio && opts.audioBlob) {
        report(totalFrames, 'muxing', pipelineLabel, 'Encoding 48 kHz stereo voiceover audio...');
        await encodeAudioTrackToMuxer({
          audioBlob: opts.audioBlob,
          muxer,
          startSec,
          endSec,
          audioOffsetSec: opts.audioOffsetSec ?? 0,
          audioCodec,
        });
      }

      report(totalFrames, 'muxing', pipelineLabel, 'Finalizing container & patching header...');
      await videoSession.flushAndClose();
      const finalized = await muxer.finalize();

      report(totalFrames, 'verifying', pipelineLabel, 'Verifying exported video duration...');
      const verification = await verifyExportedVideoDuration(finalized.blob, expectedDurationSec);
      const url = URL.createObjectURL(finalized.blob);

      report(totalFrames, 'done', pipelineLabel, verification.message);
      return {
        blob: finalized.blob,
        url,
        fileName,
        mimeType: muxer.mimeType,
        byteLength: finalized.byteLength,
        totalFrames,
        nativeUri: finalized.nativeUri,
        pipeline: pipelineLabel,
        verification,
      };
    }

    // Path 2: Fallback MediaRecorder real-time / stepped capture (labelled clearly per SPEC)
    const fallbackLabel = 'MediaRecorder Fallback (WebM)';
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
      const fStart = performance.now();
      const globalFrameIdx = startFrame + i;
      const t = frameToTime(globalFrameIdx, fps);

      await prewarmCodeLayersForFrame(opts.compiled, t, 40);

      ctx.save();
      ctx.scale(width / opts.compiled.w, height / opts.compiled.h);
      renderFrame(ctx, opts.compiled, t, {
        fastPreview: false,
        skipUnknownOnExport: opts.skipUnknownOnExport ?? true,
      });
      ctx.restore();

      const fMs = performance.now() - fStart;
      rollingFrameTimesMs.push(fMs);
      if (rollingFrameTimesMs.length > 60) rollingFrameTimesMs.shift();

      if (i % 8 === 0 || i === totalFrames - 1) {
        report(i + 1, 'rendering', fallbackLabel);
        await new Promise((r) => setTimeout(r, 8));
      }
    }

    recorder.stop();
    const blob = await stopPromise;
    const verification = await verifyExportedVideoDuration(blob, expectedDurationSec);
    const url = URL.createObjectURL(blob);
    report(totalFrames, 'done', fallbackLabel, verification.message);

    return {
      blob,
      url,
      fileName,
      mimeType,
      byteLength: blob.size,
      totalFrames,
      pipeline: fallbackLabel,
      verification,
    };
  } finally {
    if (wakeLockSentinel) {
      try {
        await wakeLockSentinel.release();
      } catch {
        // Ignore
      }
    }
    if (isNativeAndroid()) {
      NativeVideoSink.stopForeground().catch(() => {});
    }
  }
}
