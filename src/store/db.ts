import { type IDBPDatabase, openDB } from 'idb';
import type { PartSlot } from '../core/parts.ts';
import type { ScreenLang, ThemeSpec, TranscriptData } from '../core/types.ts';

export interface StoredProject {
  id: string;
  title: string;
  updatedAt: number;
  w: number;
  h: number;
  fps: 30 | 60;
  theme: ThemeSpec;
  screenText: ScreenLang;
  transcriptRaw: string;
  transcript: TranscriptData;
  recipeJson: string;
  parts: PartSlot[];
  activePartIndex: number;
  audioFileName?: string;
  audioDataUrl?: string;
}

const DB_NAME = 'recipe_studio_v31_db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_META = 'meta';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
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
  try {
    const db = await getDb();
    await db.put(STORE_PROJECTS, { ...project, updatedAt: Date.now() });
    await db.put(STORE_META, { key: 'activeProjectId', value: project.id });
  } catch {
    // Fallback to localStorage if IndexedDB is unavailable in restricted contexts
    try {
      localStorage.setItem(`rs_proj_${project.id}`, JSON.stringify(project));
      localStorage.setItem('rs_active_id', project.id);
    } catch {
      // Ignore storage quota errors
    }
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
  } catch {
    // Ignore
  }
}
