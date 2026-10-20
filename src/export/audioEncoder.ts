import type { UnifiedMuxer } from './muxer.ts';

/**
 * Decodes an audio File/Blob and encodes the slice `[startSec, endSec]` into the muxer
 * using WebCodecs `AudioEncoder` (AAC for MP4, Opus for WebM) when supported.
 */
export async function encodeAudioTrackToMuxer(options: {
  audioBlob: Blob | undefined;
  muxer: UnifiedMuxer;
  startSec: number;
  endSec: number;
}): Promise<boolean> {
  if (!options.audioBlob || typeof globalThis.AudioEncoder === 'undefined' || typeof globalThis.AudioData === 'undefined') {
    return false;
  }

  try {
    const arrayBuf = await options.audioBlob.arrayBuffer();
    const audioCtx = new OfflineAudioContext(2, 48000, 48000);
    const decoded = await audioCtx.decodeAudioData(arrayBuf);
    const sampleRate = decoded.sampleRate;
    const channels = Math.min(2, decoded.numberOfChannels);
    const codec = options.muxer.container === 'mp4' ? 'mp4a.40.2' : 'opus';

    const support = await AudioEncoder.isConfigSupported({
      codec,
      sampleRate,
      numberOfChannels: channels,
      bitrate: 128_000,
    });
    if (!support.supported) return false;

    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        options.muxer.addAudioChunk(chunk, meta);
      },
      error: () => {},
    });

    encoder.configure({
      codec,
      sampleRate,
      numberOfChannels: channels,
      bitrate: 128_000,
    });

    const startSample = Math.max(0, Math.floor(options.startSec * sampleRate));
    const endSample = Math.min(decoded.length, Math.floor(options.endSec * sampleRate));
    const chunkSamples = 4096;

    for (let offset = startSample; offset < endSample; offset += chunkSamples) {
      const frameCount = Math.min(chunkSamples, endSample - offset);
      const planar = new Float32Array(frameCount * channels);
      for (let ch = 0; ch < channels; ch++) {
        const chData = decoded.getChannelData(ch).subarray(offset, offset + frameCount);
        planar.set(chData, ch * frameCount);
      }

      const timestampUs = Math.round(((offset - startSample) / sampleRate) * 1_000_000);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: frameCount,
        numberOfChannels: channels,
        timestamp: timestampUs,
        data: planar,
      });
      encoder.encode(audioData);
      audioData.close();
    }

    await encoder.flush();
    encoder.close();
    return true;
  } catch {
    return false;
  }
}
