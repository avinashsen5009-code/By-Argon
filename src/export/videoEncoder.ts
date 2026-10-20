import type { UnifiedMuxer } from './muxer.ts';

export interface VideoEncoderSession {
  encodeFrame(canvas: HTMLCanvasElement | OffscreenCanvas, frameIndex: number): Promise<void>;
  flushAndClose(): Promise<void>;
}

export async function createVideoEncoderSession(options: {
  muxer: UnifiedMuxer;
  width: number;
  height: number;
  fps: number;
  bitrate?: number;
}): Promise<VideoEncoderSession> {
  const codec = options.muxer.container === 'mp4' ? 'avc1.420028' : 'vp09.00.10.08';
  const bitrate = options.bitrate ?? (options.width >= 1920 ? 6_000_000 : 3_500_000);
  const frameDurationUs = Math.round(1_000_000 / options.fps);

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      options.muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });

  encoder.configure({
    codec,
    width: options.width,
    height: options.height,
    bitrate,
    framerate: options.fps,
  });

  return {
    async encodeFrame(canvas, frameIndex) {
      if (encoderError) throw encoderError;
      const timestampUs = Math.round((frameIndex * 1_000_000) / options.fps);
      const vf = new VideoFrame(canvas as any, {
        timestamp: timestampUs,
        duration: frameDurationUs,
      });
      const isKeyFrame = frameIndex % (options.fps * 2) === 0;
      encoder.encode(vf, { keyFrame: isKeyFrame });
      vf.close();

      // Backpressure control so queue never grows unbounded on 5-minute exports
      while (encoder.encodeQueueSize > 8) {
        await new Promise((r) => setTimeout(r, 4));
      }
    },

    async flushAndClose() {
      if (encoderError) throw encoderError;
      await encoder.flush();
      encoder.close();
    },
  };
}
