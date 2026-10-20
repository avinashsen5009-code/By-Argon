import { isNativeAndroid, NativeVideoSink, uint8ToBase64 } from '../native/bridge.ts';

export interface StreamingSinkHandle {
  write(data: Uint8Array, position: number): void;
  finalize(): Promise<{ blob: Blob; nativeUri?: string; byteLength: number }>;
}

/**
 * Creates a random-access streaming sink compatible with `mp4-muxer` and `webm-muxer` `StreamTarget`.
 * On Android native, mirrors chunks to `VideoSinkPlugin` while also building a downloadable Blob for preview.
 */
export async function createStreamingSink(
  fileName: string,
  mimeType: string
): Promise<StreamingSinkHandle> {
  const sessionId = `sink_${Date.now()}`;
  const useNative = isNativeAndroid();
  const pendingNativeWrites: Promise<any>[] = [];

  if (useNative) {
    try {
      await NativeVideoSink.openSink({ sessionId, fileName });
    } catch {
      // Fallback to in-memory buffer if native plugin not attached
    }
  }

  let buffer = new Uint8Array(2 * 1024 * 1024); // Start at 2 MB and grow geometrically
  let maxLength = 0;

  function ensureCapacity(required: number) {
    if (required <= buffer.byteLength) return;
    let nextCap = buffer.byteLength;
    while (nextCap < required) {
      nextCap *= 2;
    }
    const grown = new Uint8Array(nextCap);
    grown.set(buffer.subarray(0, maxLength));
    buffer = grown;
  }

  return {
    write(data: Uint8Array, position: number) {
      const end = position + data.byteLength;
      ensureCapacity(end);
      buffer.set(data, position);
      if (end > maxLength) maxLength = end;

      if (useNative) {
        const b64 = uint8ToBase64(data);
        pendingNativeWrites.push(
          NativeVideoSink.writeChunk({ sessionId, data: b64, offset: position }).catch(() => {})
        );
      }
    },

    async finalize() {
      if (pendingNativeWrites.length > 0) {
        await Promise.allSettled(pendingNativeWrites);
      }
      let nativeUri: string | undefined;
      if (useNative) {
        try {
          const res = await NativeVideoSink.closeSink({ sessionId, mimeType });
          nativeUri = res.uri;
        } catch {
          // Ignore native close failure
        }
      }

      const finalView = buffer.subarray(0, maxLength);
      const blob = new Blob([finalView], { type: mimeType });
      return { blob, nativeUri, byteLength: maxLength };
    },
  };
}
