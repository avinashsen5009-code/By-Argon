import { type IDBPDatabase, openDB } from 'idb';
import { extractCarryFromPart, type PartSlot } from '../core/parts.ts';
import type { ScreenLang, ThemeSpec, TranscriptData } from '../core/types.ts';
import {
  bytesToDataUrl,
  createZipArchive,
  dataUrlToBytes,
  readZipArchive,
  type ZipEntry,
} from './zip.ts';

export interface StoredProject {
  id: string;
  title: string;
  createdAt?: number;
  updatedAt: number;
  w: number;
  h: number;
  fps: 24 | 30 | 60;
  theme: ThemeSpec;
  screenText: ScreenLang;
  transcriptRaw: string;
  transcript: TranscriptData;
  recipeJson: string;
  parts: PartSlot[];
  activePartIndex: number;
  audioFileName?: string;
  audioDataUrl?: string;
  audioPeaks?: number[];
  audioOffsetSec?: number;
}

export interface ExportHistoryEntry {
  id: string;
  projectId: string;
  fileName: string;
  mimeType: string;
  byteLength: number;
  durationSec: number;
  w: number;
  h: number;
  fps: number;
  createdAt: number;
}

export interface AppSettings {
  defaultFps: 24 | 30 | 60;
  previewScale: 0.5 | 1;
  defaultPalette: number;
  defaultCanvas: '16:9' | '9:16' | '1:1';
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultFps: 60,
  previewScale: 1,
  defaultPalette: 1,
  defaultCanvas: '16:9',
};

export const IDB_STORE_NAMES = [
  'projects',
  'transcripts',
  'parts',
  'assets',
  'audio',
  'exports',
  'meta',
] as const;

const DB_NAME = 'recipe_studio_v31_db';
const DB_VERSION = 2;
const STORE_PROJECTS = 'projects';
const STORE_TRANSCRIPTS = 'transcripts';
const STORE_PARTS = 'parts';
const STORE_ASSETS = 'assets';
const STORE_AUDIO = 'audio';
const STORE_EXPORTS = 'exports';
const STORE_META = 'meta';

let dbPromise: Promise<IDBPDatabase> | null = null;
const appLogRingBuffer: string[] = [];

export function appendAppLog(message: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  appLogRingBuffer.push(`[${ts}] ${message}`);
  if (appLogRingBuffer.length > 200) {
    appLogRingBuffer.shift();
  }
}

export function getRecentAppLogs(limit = 200): string[] {
  return appLogRingBuffer.slice(-limit);
}

export function triggerHaptic(durationMs = 12): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(durationMs);
    }
  } catch {
    // Ignore on desktop browsers
  }
}

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_TRANSCRIPTS)) {
          db.createObjectStore(STORE_TRANSCRIPTS, { keyPath: 'projectId' });
        }
        if (!db.objectStoreNames.contains(STORE_PARTS)) {
          db.createObjectStore(STORE_PARTS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          db.createObjectStore(STORE_ASSETS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_AUDIO)) {
          db.createObjectStore(STORE_AUDIO, { keyPath: 'projectId' });
        }
        if (!db.objectStoreNames.contains(STORE_EXPORTS)) {
          db.createObjectStore(STORE_EXPORTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveProjectToDb(project: StoredProject): Promise<void> {
  const now = Date.now();
  const normalized: StoredProject = {
    ...project,
    createdAt: project.createdAt ?? now,
    updatedAt: now,
  };
  try {
    const db = await getDb();
    await db.put(STORE_PROJECTS, normalized);
    await db.put(STORE_META, { key: 'activeProjectId', value: normalized.id });

    // Normalize into dedicated M17 stores (`transcripts`, `parts`, `assets`, `audio`)
    await db.put(STORE_TRANSCRIPTS, {
      projectId: normalized.id,
      rawText: normalized.transcriptRaw,
      parsed: normalized.transcript,
      updatedAt: now,
    });

    for (const slot of normalized.parts) {
      await db.put(STORE_PARTS, {
        key: `${normalized.id}:part:${slot.part.n}`,
        projectId: normalized.id,
        n: slot.part.n,
        rawText: slot.rawJson,
        parsedDoc: slot.doc ?? null,
        validationResult: slot.issues,
        carry: slot.doc ? extractCarryFromPart(slot.doc) : null,
        updatedAt: now,
      });
    }

    if (normalized.audioDataUrl || normalized.audioPeaks) {
      await db.put(STORE_AUDIO, {
        projectId: normalized.id,
        fileName: normalized.audioFileName ?? 'voiceover.wav',
        dataUrl: normalized.audioDataUrl ?? '',
        peaks: normalized.audioPeaks ?? [],
        offsetSec: normalized.audioOffsetSec ?? 0,
        updatedAt: now,
      });
    }

    try {
      const parsedDoc = JSON.parse(normalized.recipeJson);
      const assetsMap = parsedDoc?.assets as Record<string, string> | undefined;
      if (assetsMap && typeof assetsMap === 'object') {
        for (const [assetId, dataUrl] of Object.entries(assetsMap)) {
          if (typeof dataUrl === 'string') {
            await db.put(STORE_ASSETS, {
              key: `${normalized.id}:asset:${assetId}`,
              projectId: normalized.id,
              assetId,
              dataUrl,
              updatedAt: now,
            });
          }
        }
      }
    } catch {
      // Ignore if recipeJson is currently being edited and invalid
    }
  } catch {
    try {
      localStorage.setItem(`rs_proj_${normalized.id}`, JSON.stringify(normalized));
      localStorage.setItem('rs_active_id', normalized.id);
    } catch {
      // Ignore storage quota errors
    }
  }
}

export async function recordExportHistory(entry: ExportHistoryEntry): Promise<void> {
  try {
    const db = await getDb();
    await db.put(STORE_EXPORTS, entry);
  } catch {
    // Ignore on restricted environments
  }
}

export async function loadExportHistory(projectId?: string): Promise<ExportHistoryEntry[]> {
  try {
    const db = await getDb();
    const all = (await db.getAll(STORE_EXPORTS)) as ExportHistoryEntry[];
    const filtered = projectId ? all.filter((e) => e.projectId === projectId) : all;
    filtered.sort((a, b) => b.createdAt - a.createdAt);
    return filtered;
  } catch {
    return [];
  }
}

export async function loadAllProjectsFromDb(): Promise<{
  projects: StoredProject[];
  activeProjectId?: string;
}> {
  try {
    const db = await getDb();
    const projects = (await db.getAll(STORE_PROJECTS)) as StoredProject[];
    const activeMeta = await db.get(STORE_META, 'activeProjectId');
    projects.sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      projects,
      activeProjectId: activeMeta?.value,
    };
  } catch {
    return { projects: [] };
  }
}

export async function deleteProjectFromDb(id: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(STORE_PROJECTS, id);
    await db.delete(STORE_TRANSCRIPTS, id);
    await db.delete(STORE_AUDIO, id);
  } catch {
    // Ignore
  }
}

export async function loadAppSettings(): Promise<AppSettings> {
  try {
    const db = await getDb();
    const saved = await db.get(STORE_META, 'appSettings');
    if (saved?.value) {
      return { ...DEFAULT_APP_SETTINGS, ...saved.value };
    }
  } catch {
    try {
      const raw = localStorage.getItem('rs_app_settings');
      if (raw) return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) };
    } catch {
      // Ignore
    }
  }
  return DEFAULT_APP_SETTINGS;
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  try {
    const db = await getDb();
    await db.put(STORE_META, { key: 'appSettings', value: settings });
  } catch {
    // Fallback
  }
  try {
    localStorage.setItem('rs_app_settings', JSON.stringify(settings));
  } catch {
    // Ignore
  }
}

export function estimateProjectStorageBytes(project: StoredProject): number {
  return (
    (project.recipeJson?.length ?? 0) * 2 +
    (project.transcriptRaw?.length ?? 0) * 2 +
    (project.audioDataUrl?.length ?? 0)
  );
}

/**
 * M17: Packs a StoredProject (JSON + asset blobs + audio blob) into a single `.recipestudio` ZIP archive.
 */
export function packProjectToRecipeStudioZip(project: StoredProject): Uint8Array {
  const entries: ZipEntry[] = [];
  const encoder = new TextEncoder();

  const manifestProject: StoredProject & {
    _zipAudioEntry?: { path: string; mime: string };
    _zipAssetEntries?: Record<string, { path: string; mime: string }>;
  } = structuredClone(project);

  // Extract audio blob if present
  if (manifestProject.audioDataUrl && manifestProject.audioDataUrl.startsWith('data:')) {
    const { mime, bytes } = dataUrlToBytes(manifestProject.audioDataUrl);
    const path = `audio/${manifestProject.audioFileName || 'voiceover.bin'}`;
    entries.push({ name: path, data: bytes });
    manifestProject._zipAudioEntry = { path, mime };
    delete manifestProject.audioDataUrl;
  }

  // Extract recipe asset blobs into assets/* inside the ZIP
  try {
    const doc = JSON.parse(manifestProject.recipeJson);
    if (doc && doc.assets && typeof doc.assets === 'object') {
      const zipAssetEntries: Record<string, { path: string; mime: string }> = {};
      for (const [assetId, val] of Object.entries(doc.assets)) {
        if (typeof val === 'string' && val.startsWith('data:')) {
          const { mime, bytes } = dataUrlToBytes(val);
          const path = `assets/${assetId}.bin`;
          entries.push({ name: path, data: bytes });
          zipAssetEntries[assetId] = { path, mime };
          doc.assets[assetId] = `__zip_asset__:${assetId}`;
        }
      }
      if (Object.keys(zipAssetEntries).length > 0) {
        manifestProject._zipAssetEntries = zipAssetEntries;
        manifestProject.recipeJson = JSON.stringify(doc, null, 2);
      }
    }
  } catch {
    // Keep recipeJson untouched if not valid JSON
  }

  const manifestBytes = encoder.encode(
    JSON.stringify(
      {
        bundleFormat: 'recipestudio-v3.1',
        exportedAt: new Date().toISOString(),
        project: manifestProject,
      },
      null,
      2
    )
  );
  entries.unshift({ name: 'project.json', data: manifestBytes });

  return createZipArchive(entries);
}

/**
 * M17: Unpacks either a `.recipestudio` ZIP archive or a plain JSON backup into a StoredProject.
 */
export function unpackProjectFromRecipeStudioZip(bytes: Uint8Array): StoredProject {
  const decoder = new TextDecoder();

  // Check for ZIP magic number PK\x03\x04 (0x04034b50 little-endian)
  const isZip =
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;

  if (!isZip) {
    const raw = decoder.decode(bytes);
    const parsed = JSON.parse(raw);
    const proj = (parsed.project ?? parsed) as StoredProject;
    if (!proj || typeof proj.title !== 'string' || typeof proj.recipeJson !== 'string') {
      throw new Error('Invalid .recipestudio project file');
    }
    return proj;
  }

  const entries = readZipArchive(bytes);
  const entryMap = new Map<string, Uint8Array>();
  for (const e of entries) {
    entryMap.set(e.name, e.data);
  }

  const projectJsonBytes = entryMap.get('project.json');
  if (!projectJsonBytes) {
    throw new Error('Missing project.json inside .recipestudio archive');
  }

  const parsed = JSON.parse(decoder.decode(projectJsonBytes));
  const proj = (parsed.project ?? parsed) as StoredProject & {
    _zipAudioEntry?: { path: string; mime: string };
    _zipAssetEntries?: Record<string, { path: string; mime: string }>;
  };

  if (proj._zipAudioEntry) {
    const audioBytes = entryMap.get(proj._zipAudioEntry.path);
    if (audioBytes) {
      proj.audioDataUrl = bytesToDataUrl(audioBytes, proj._zipAudioEntry.mime);
    }
    delete proj._zipAudioEntry;
  }

  if (proj._zipAssetEntries) {
    try {
      const doc = JSON.parse(proj.recipeJson);
      if (doc && doc.assets && typeof doc.assets === 'object') {
        for (const [assetId, info] of Object.entries(proj._zipAssetEntries)) {
          const assetBytes = entryMap.get(info.path);
          if (assetBytes) {
            doc.assets[assetId] = bytesToDataUrl(assetBytes, info.mime);
          }
        }
        proj.recipeJson = JSON.stringify(doc, null, 2);
      }
    } catch {
      // Ignore
    }
    delete proj._zipAssetEntries;
  }

  return proj;
}
