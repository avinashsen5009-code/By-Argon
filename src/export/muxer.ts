import { Muxer as Mp4Muxer, StreamTarget as Mp4StreamTarget } from 'mp4-muxer';
import { Muxer as WebmMuxer, StreamTarget as WebmStreamTarget } from 'webm-muxer';
import { createStreamingSink, type StreamingSinkHandle } from './sink.ts';

export interface UnifiedMuxer {
  container: 'mp4' | 'webm';
  mimeType: string;
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  finalize(): Promise<{ blob: Blob; nativeUri?: string; byteLength: number }>;
}

export async function createUnifiedMuxer(options: {
  container: 'mp4' | 'webm';
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  audioSampleRate?: number;
  audioChannels?: number;
  fileName: string;
}): Promise<UnifiedMuxer> {
  const mimeType = options.container === 'mp4' ? 'video/mp4' : 'video/webm';
  const sink: StreamingSinkHandle = await createStreamingSink(options.fileName, mimeType);

  if (options.container === 'mp4') {
    const target = new Mp4StreamTarget({
      onData: (data: Uint8Array, position: number) => {
        sink.write(data, position);
      },
      chunked: true,
      chunkSize: 1024 * 1024,
    });

    const muxer = new Mp4Muxer({
      target,
      video: {
        codec: 'avc',
        width: options.width,
        height: options.height,
        frameRate: options.fps,
      },
      audio: options.hasAudio
        ? {
            codec: 'aac',
            sampleRate: options.audioSampleRate ?? 48000,
            numberOfChannels: options.audioChannels ?? 2,
          }
        : undefined,
      fastStart: 'in-memory',
    });

    return {
      container: 'mp4',
      mimeType,
      addVideoChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      addAudioChunk: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      finalize: async () => {
        muxer.finalize();
        return sink.finalize();
      },
    };
  } else {
    const target = new WebmStreamTarget({
      onData: (data: Uint8Array, position: number) => {
        sink.write(data, position);
      },
      chunked: true,
      chunkSize: 1024 * 1024,
    });

    const muxer = new WebmMuxer({
      target,
      video: {
        codec: 'V_VP9',
        width: options.width,
        height: options.height,
        frameRate: options.fps,
      },
      audio: options.hasAudio
        ? {
            codec: 'A_OPUS',
            sampleRate: options.audioSampleRate ?? 48000,
            numberOfChannels: options.audioChannels ?? 2,
          }
        : undefined,
    });

    return {
      container: 'webm',
      mimeType,
      addVideoChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      addAudioChunk: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      finalize: async () => {
        muxer.finalize();
        return sink.finalize();
      },
    };
  }
}
