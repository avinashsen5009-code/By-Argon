import { Capacitor, registerPlugin } from '@capacitor/core';

export interface VideoSinkPluginInterface {
  // M15 primary methods
  open(options: { name: string; mime?: string }): Promise<{ handle: string; path: string }>;
  write(options: { handle: string; position: number; data: string }): Promise<{ bytesWritten: number }>;
  close(options: { handle: string }): Promise<{ closed: boolean }>;
  saveToMovies(options: {
    handle?: string;
    path?: string;
    displayName: string;
    mime: string;
  }): Promise<{ uri: string; size?: number }>;
  startForeground(options: { title: string; text: string }): Promise<{ started: boolean }>;
  updateForeground(options: { text: string; progress: number }): Promise<{ updated: boolean }>;
  stopForeground(): Promise<{ stopped: boolean }>;
  freeSpace(): Promise<{ bytes: number }>;
  share(options: { uri: string; mime?: string }): Promise<{ shared: boolean }>;
  openUri(options: { uri: string; mime?: string }): Promise<{ opened: boolean }>;

  // Backwards-compatible aliases
  openSink(options: { sessionId: string; fileName: string }): Promise<{ sessionId: string; path: string }>;
  writeChunk(options: { sessionId: string; data: string; offset?: number }): Promise<{ bytesWritten: number }>;
  closeSink(options: { sessionId: string; mimeType: string }): Promise<{ uri: string; size: number }>;
}

const capacitorVideoSink = registerPlugin<VideoSinkPluginInterface>('VideoSink');

function invokeNativeBridge<T>(methodName: keyof VideoSinkPluginInterface, options: Record<string, unknown> = {}): Promise<T> {
  const win = typeof window !== 'undefined' ? (window as unknown as Record<string, any>) : null;
  if (win && win.RecipeStudioNativeBridge && typeof win.RecipeStudioNativeBridge.invoke === 'function') {
    return new Promise<T>((resolve, reject) => {
      try {
        const raw = win.RecipeStudioNativeBridge.invoke('VideoSink', String(methodName), JSON.stringify(options));
        const parsed = JSON.parse(raw || '{}');
        if (parsed && parsed.error) {
          reject(new Error(parsed.error));
        } else {
          resolve(parsed as T);
        }
      } catch (err) {
        reject(err);
      }
    });
  }
  const fn = capacitorVideoSink[methodName] as (opts: any) => Promise<T>;
  return fn(options);
}

export const NativeVideoSink: VideoSinkPluginInterface = {
  open: (opts) => invokeNativeBridge('open', opts),
  write: (opts) => invokeNativeBridge('write', opts),
  close: (opts) => invokeNativeBridge('close', opts),
  saveToMovies: (opts) => invokeNativeBridge('saveToMovies', opts),
  startForeground: (opts) => invokeNativeBridge('startForeground', opts),
  updateForeground: (opts) => invokeNativeBridge('updateForeground', opts),
  stopForeground: () => invokeNativeBridge('stopForeground', {}),
  freeSpace: () => invokeNativeBridge('freeSpace', {}),
  share: (opts) => invokeNativeBridge('share', opts),
  openUri: (opts) => invokeNativeBridge('openUri', opts),
  openSink: (opts) => invokeNativeBridge('openSink', opts),
  writeChunk: (opts) => invokeNativeBridge('writeChunk', opts),
  closeSink: (opts) => invokeNativeBridge('closeSink', opts),
};

export function isNativeAndroid(): boolean {
  try {
    if (typeof window !== 'undefined' && (window as any).RecipeStudioNativeBridge) {
      return true;
    }
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

/**
 * Queries free disk space in bytes (via NativeVideoSink on Android or navigator.storage.estimate in browser).
 */
export async function queryAvailableDiskSpaceBytes(): Promise<number> {
  if (isNativeAndroid()) {
    try {
      const res = await NativeVideoSink.freeSpace();
      if (typeof res?.bytes === 'number') return res.bytes;
    } catch {
      // Fallback to browser storage estimate
    }
  }
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (typeof est.quota === 'number' && typeof est.usage === 'number') {
        return Math.max(0, est.quota - est.usage);
      }
    } catch {
      // Ignore
    }
  }
  return 2 * 1024 * 1024 * 1024; // Default 2 GB fallback
}
