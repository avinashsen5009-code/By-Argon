import { isNativeAndroid, NativeVideoSink, uint8ToBase64 } from '../native/bridge.ts';

export interface StreamingSinkHandle {
  write(data: Uint8Array, position: number): void;
  finalize(): Promise<{ blob: Blob; nativeUri?: string; byteLength: number }>;
  cancel(): Promise<void>;
}

/**
 * Creates a random-access streaming sink compatible with `mp4-muxer` (`fastStart: false`)
 * and `webm-muxer` `StreamTarget`.
 * Batches binary writes into 2 MB chunks (`chunkSize: 2 * 1024 * 1024` in `StreamTarget`)
 * to keep the Capacitor native bridge fast (M14 & M15).
 */
export async function createStreamingSink(
  fileName: string,
  mimeType: string
): Promise<StreamingSinkHandle> {
  let handle = `sink_${Date.now()}`;
  let nativePath: string | undefined;
  const useNative = isNativeAndroid();
  const pendingNativeWrites: Promise<any>[] = [];

  if (useNative) {
    try {
      const opened = await NativeVideoSink.open({ name: fileName, mime: mimeType });
      handle = opened.handle || handle;
      nativePath = opened.path;
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
      const pos = position >= 0 ? position : maxLength;
      const end = pos + data.byteLength;
      ensureCapacity(end);
      buffer.set(data, pos);
      if (end > maxLength) maxLength = end;

      if (useNative) {
        // Batch writes in up to 2 MB base64 slices across the bridge
        const maxSlice = 2 * 1024 * 1024;
        for (let offset = 0; offset < data.byteLength; offset += maxSlice) {
          const slice = data.subarray(offset, Math.min(data.byteLength, offset + maxSlice));
          const b64 = uint8ToBase64(slice);
          pendingNativeWrites.push(
            NativeVideoSink.write({
              handle,
              position: pos + offset,
              data: b64,
            }).catch(() => {})
          );
        }
      }
    },

    async finalize() {
      if (pendingNativeWrites.length > 0) {
        await Promise.allSettled(pendingNativeWrites);
      }
      let nativeUri: string | undefined;
      if (useNative) {
        try {
          await NativeVideoSink.close({ handle });
          const saved = await NativeVideoSink.saveToMovies({
            handle,
            path: nativePath,
            displayName: fileName,
            mime: mimeType,
          });
          nativeUri = saved.uri;
        } catch {
          // Ignore native save failure in web preview
        }
      }

      const finalView = buffer.subarray(0, maxLength);
      const blob = new Blob([finalView], { type: mimeType });
      return { blob, nativeUri, byteLength: maxLength };
    },

    async cancel() {
      if (useNative) {
        try {
          await NativeVideoSink.close({ handle });
        } catch {
          // Ignore
        }
      }
      buffer = new Uint8Array(0);
      maxLength = 0;
    },
  };
}
