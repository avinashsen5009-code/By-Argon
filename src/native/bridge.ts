import { Capacitor, registerPlugin } from '@capacitor/core';

export interface VideoSinkPluginInterface {
  openSink(options: { sessionId: string; fileName: string }): Promise<{ sessionId: string; path: string }>;
  writeChunk(options: { sessionId: string; data: string; offset?: number }): Promise<{ bytesWritten: number }>;
  closeSink(options: { sessionId: string; mimeType: string }): Promise<{ uri: string; size: number }>;
}

export const NativeVideoSink = registerPlugin<VideoSinkPluginInterface>('VideoSink');

export function isNativeAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}
