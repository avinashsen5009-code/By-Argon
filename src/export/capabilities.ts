export interface ExportCapabilities {
  hasWebCodecsVideo: boolean;
  hasWebCodecsAudio: boolean;
  supportsH264Mp4: boolean;
  supportsVp9Webm: boolean;
  hasMediaRecorder: boolean;
  hasOffscreenCanvas: boolean;
  recommendedPipeline: 'webcodecs-mp4' | 'webcodecs-webm' | 'mediarecorder';
}

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

  if (hasWebCodecsVideo) {
    try {
      const h264Support = await VideoEncoder.isConfigSupported({
        codec: 'avc1.420028',
        width,
        height,
        bitrate: 6_000_000,
        framerate: fps,
      });
      supportsH264Mp4 = Boolean(h264Support.supported);
    } catch {
      supportsH264Mp4 = false;
    }

    try {
      const vp9Support = await VideoEncoder.isConfigSupported({
        codec: 'vp09.00.10.08',
        width,
        height,
        bitrate: 5_000_000,
        framerate: fps,
      });
      supportsVp9Webm = Boolean(vp9Support.supported);
    } catch {
      supportsVp9Webm = false;
    }
  }

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
    hasMediaRecorder,
    hasOffscreenCanvas,
    recommendedPipeline,
  };
}
