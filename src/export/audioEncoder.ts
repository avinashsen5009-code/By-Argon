import type { UnifiedMuxer } from './muxer.ts';

/**
 * M14 Voiceover Audio Pipeline:
 * Decodes the voiceover once (`decodeAudioData`), resamples to 48 kHz stereo via `OfflineAudioContext`,
 * feeds `AudioEncoder` in 1-second `AudioData` chunks (48,000 frames), and frees buffers as it goes.
 * Sync: audio timestamp 0 = video timestamp 0 plus user's `audioOffsetSec`.
 */
export async function encodeAudioTrackToMuxer(options: {
  audioBlob: Blob | undefined;
  muxer: UnifiedMuxer;
  startSec: number;
  endSec: number;
  audioOffsetSec?: number;
  audioCodec?: 'aac' | 'opus';
}): Promise<boolean> {
  if (
    !options.audioBlob ||
    typeof globalThis.AudioEncoder === 'undefined' ||
    typeof globalThis.AudioData === 'undefined'
  ) {
    return false;
  }

  try {
    const arrayBuf = await options.audioBlob.arrayBuffer();
    const targetSampleRate = 48000;
    const targetChannels = 2;

    // Decode source buffer
    const tempCtx = new OfflineAudioContext(targetChannels, targetSampleRate, targetSampleRate);
    const rawDecoded = await tempCtx.decodeAudioData(arrayBuf.slice(0));

    // Resample to 48 kHz stereo covering the requested export duration
    const clipDuration = Math.max(0.1, options.endSec - options.startSec);
    const totalResampledFrames = Math.ceil(clipDuration * targetSampleRate);
    const offlineCtx = new OfflineAudioContext(targetChannels, totalResampledFrames, targetSampleRate);
    const srcNode = offlineCtx.createBufferSource();
    srcNode.buffer = rawDecoded;

    const offsetSec = options.audioOffsetSec ?? 0;
    const sourceStart = Math.max(0, options.startSec - offsetSec);
    const whenToStart = Math.max(0, offsetSec - options.startSec);
    srcNode.connect(offlineCtx.destination);
    srcNode.start(whenToStart, sourceStart, clipDuration);

    const resampled = await offlineCtx.startRendering();

    const codec =
      options.audioCodec === 'opus'
        ? 'opus'
        : options.muxer.container === 'mp4'
        ? 'mp4a.40.2'
        : 'opus';

    const support = await AudioEncoder.isConfigSupported({
      codec,
      sampleRate: targetSampleRate,
      numberOfChannels: targetChannels,
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
      sampleRate: targetSampleRate,
      numberOfChannels: targetChannels,
      bitrate: 128_000,
    });

    // Feed in 1-second (48,000-sample) chunks per M14
    const chunkSamples = targetSampleRate;
    const ch0 = resampled.getChannelData(0);
    const ch1 = resampled.numberOfChannels > 1 ? resampled.getChannelData(1) : ch0;

    for (let offset = 0; offset < totalResampledFrames; offset += chunkSamples) {
      const frameCount = Math.min(chunkSamples, totalResampledFrames - offset);
      const planar = new Float32Array(frameCount * targetChannels);
      planar.set(ch0.subarray(offset, offset + frameCount), 0);
      planar.set(ch1.subarray(offset, offset + frameCount), frameCount);

      const timestampUs = Math.round((offset / targetSampleRate) * 1_000_000);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: targetSampleRate,
        numberOfFrames: frameCount,
        numberOfChannels: targetChannels,
        timestamp: timestampUs,
        data: planar,
      });
      encoder.encode(audioData);
      audioData.close();

      while (encoder.encodeQueueSize > 8) {
        await new Promise((r) => setTimeout(r, 4));
      }
    }

    await encoder.flush();
    encoder.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Computes downsampled waveform peaks (0..1) once on audio import for the M13 timeline bar.
 */
export async function computeAudioWaveformPeaks(
  audioBlob: Blob,
  bucketCount = 120
): Promise<{ peaks: number[]; durationSec: number }> {
  try {
    const arrayBuf = await audioBlob.arrayBuffer();
    const ctx =
      typeof OfflineAudioContext !== 'undefined'
        ? new OfflineAudioContext(1, 44100, 44100)
        : new (window.AudioContext || (window as any).webkitAudioContext)();
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    const data = decoded.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / bucketCount));
    const peaks: number[] = [];
    let maxPeak = 0.01;

    for (let i = 0; i < bucketCount; i++) {
      const start = i * step;
      const end = Math.min(data.length, start + step);
      let sumSq = 0;
      for (let j = start; j < end; j++) {
        sumSq += data[j] * data[j];
      }
      const rms = Math.sqrt(sumSq / Math.max(1, end - start));
      if (rms > maxPeak) maxPeak = rms;
      peaks.push(rms);
    }

    return {
      peaks: peaks.map((p) => Math.round((p / maxPeak) * 100) / 100),
      durationSec: Math.round(decoded.duration * 100) / 100,
    };
  } catch {
    return { peaks: [], durationSec: 0 };
  }
}
