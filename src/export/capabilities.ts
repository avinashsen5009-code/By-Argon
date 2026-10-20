export interface ExportCapabilities {
  hasWebCodecsVideo: boolean;
  hasWebCodecsAudio: boolean;
  supportsH264Mp4: boolean;
  supportsVp9Webm: boolean;
  supportsVp9Alpha: boolean;
  supportsAacAudio: boolean;
  supportsOpusAudio: boolean;
  selectedVideoCodec: string;
  selectedAudioCodec: 'aac' | 'opus' | 'none';
  hardwareAccelerated: boolean;
  hasMediaRecorder: boolean;
  hasOffscreenCanvas: boolean;
  recommendedPipeline: 'webcodecs-mp4' | 'webcodecs-webm' | 'mediarecorder';
}

const VIDEO_CODEC_CANDIDATES = [
  { codec: 'avc1.640034', container: 'mp4' as const },
  { codec: 'avc1.64002A', container: 'mp4' as const },
  { codec: 'avc1.42E01F', container: 'mp4' as const },
  { codec: 'avc1.420028', container: 'mp4' as const },
  { codec: 'vp09.00.40.08', container: 'webm' as const },
  { codec: 'vp09.00.10.08', container: 'webm' as const },
  { codec: 'vp8', container: 'webm' as const },
];

/**
 * M14 Capabilities Probe:
 * Tests VideoEncoder.isConfigSupported in order:
 * avc1.640034 / avc1.64002A (High), avc1.42E01F (Baseline), vp09.00.40.08, vp8;
 * hardware preference first, then software.
 * Tests AudioEncoder for mp4a.40.2 then opus.
 */
export async function probeExportCapabilities(
  width = 1920,
  height = 1080,
  fps = 30
): Promise<ExportCapabilities> {
  const hasWebCodecsVideo = typeof globalThis.VideoEncoder !== 'undefined';
  const hasWebCodecsAudio = typeof globalThis.AudioEncoder !== 'undefined';
  const hasMediaRecorder = typeof globalThis.MediaRecorder !== 'undefined';
  const hasOffscreenCanvas = typeof globalThis.OffscreenCanvas !== 'undefined';

  let supportsH264Mp4 = false;
  let supportsVp9Webm = false;
  let supportsVp9Alpha = false;
  let selectedVideoCodec = 'avc1.42E01F';
  let hardwareAccelerated = false;

  if (hasWebCodecsVideo) {
    for (const cand of VIDEO_CODEC_CANDIDATES) {
      for (const accel of ['prefer-hardware', 'prefer-software'] as const) {
        try {
          const res = await VideoEncoder.isConfigSupported({
            codec: cand.codec,
            width,
            height,
            bitrate: 6_000_000,
            framerate: fps,
            hardwareAcceleration: accel,
          });
          if (res.supported) {
            if (cand.container === 'mp4' && !supportsH264Mp4) {
              supportsH264Mp4 = true;
              selectedVideoCodec = cand.codec;
              hardwareAccelerated = accel === 'prefer-hardware';
            }
            if (cand.container === 'webm' && !supportsVp9Webm) {
              supportsVp9Webm = true;
              if (!supportsH264Mp4) {
                selectedVideoCodec = cand.codec;
                hardwareAccelerated = accel === 'prefer-hardware';
              }
            }
            break;
          }
        } catch {
          // Try next candidate
        }
      }
    }

    // Check optional VP9 with alpha support (M14)
    try {
      const alphaRes = await VideoEncoder.isConfigSupported({
        codec: 'vp09.00.40.08',
        width,
        height,
        bitrate: 5_000_000,
        framerate: fps,
        alpha: 'keep',
      } as VideoEncoderConfig);
      supportsVp9Alpha = Boolean(alphaRes.supported);
    } catch {
      supportsVp9Alpha = false;
    }
  }

  let supportsAacAudio = false;
  let supportsOpusAudio = false;

  if (hasWebCodecsAudio) {
    try {
      const aacRes = await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128_000,
      });
      supportsAacAudio = Boolean(aacRes.supported);
    } catch {
      supportsAacAudio = false;
    }

    try {
      const opusRes = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128_000,
      });
      supportsOpusAudio = Boolean(opusRes.supported);
    } catch {
      supportsOpusAudio = false;
    }
  }

  const selectedAudioCodec: 'aac' | 'opus' | 'none' = supportsAacAudio
    ? 'aac'
    : supportsOpusAudio
    ? 'opus'
    : 'none';

  const recommendedPipeline = supportsH264Mp4
    ? 'webcodecs-mp4'
    : supportsVp9Webm
    ? 'webcodecs-webm'
    : 'mediarecorder';

  return {
    hasWebCodecsVideo,
    hasWebCodecsAudio,
    supportsH264Mp4,
    supportsVp9Webm,
    supportsVp9Alpha,
    supportsAacAudio,
    supportsOpusAudio,
    selectedVideoCodec,
    selectedAudioCodec,
    hardwareAccelerated,
    hasMediaRecorder,
    hasOffscreenCanvas,
    recommendedPipeline,
  };
}

/**
 * Computes target video bitrate (bps) per M14:
 * Auto: `Math.round(w * h * fps * 0.10)` (~12.4 Mbps for 1080p60)
 * High: `Math.round(w * h * fps * 0.15)` (~18.6 Mbps for 1080p60)
 */
export function computeTargetBitrate(
  width: number,
  height: number,
  fps: number,
  preset: 'auto' | 'high' = 'auto'
): number {
  const factor = preset === 'high' ? 0.15 : 0.1;
  return Math.round(width * height * fps * factor);
}
