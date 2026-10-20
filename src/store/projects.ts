import partCDemoJson from '../../samples/part-c-demo.json?raw';
import stress5MinJson from '../../samples/stress-5min.json?raw';
import verticalDemoJson from '../../samples/vertical-demo.json?raw';
import { splitTranscriptIntoParts } from '../core/parts.ts';
import { DEMO_HINGLISH_TRANSCRIPT, parseTranscript } from '../core/transcript.ts';
import type { RecipeDocument } from '../core/types.ts';
import { validateRecipe } from '../core/validate.ts';
import { loadAllProjectsFromDb, saveProjectToDb, type StoredProject } from './db.ts';

let cachedSamples: StoredProject[] | null = null;
let cachedDefaultSample: StoredProject | null = null;

export function buildProjectFromSample(
  id: string,
  title: string,
  rawJson: string,
  rawTranscript: string,
  skipInitialValidation = false
): StoredProject {
  const doc = JSON.parse(rawJson) as RecipeDocument;
  const duration = doc.meta?.duration ?? 12;
  const transcript = parseTranscript(rawTranscript, duration);
  const val = skipInitialValidation ? { valid: true, issues: [] } : validateRecipe(doc, transcript);
  const partMetaList = splitTranscriptIntoParts(transcript);
  const formattedJson = rawJson.trim();

  return {
    id,
    title,
    updatedAt: Date.now(),
    w: doc.meta?.w ?? 1920,
    h: doc.meta?.h ?? 1080,
    fps: (doc.meta?.fps === 30 ? 30 : 60) as 30 | 60,
    theme: doc.theme ?? { palette: 1 },
    screenText: doc.meta?.lang ?? 'en',
    transcriptRaw: rawTranscript,
    transcript,
    recipeJson: formattedJson,
    parts: partMetaList.map((pm, idx) => ({
      part: pm,
      rawJson: idx === 0 ? formattedJson : '',
      doc: idx === 0 ? doc : undefined,
      issues: idx === 0 ? val.issues : [],
      status: idx === 0 ? (val.valid ? 'valid' : 'errors') : 'empty',
    })),
    activePartIndex: 0,
  };
}

export function getDefaultSampleProject(): StoredProject {
  if (!cachedDefaultSample) {
    cachedDefaultSample = buildProjectFromSample(
      'sample-part-c',
      'Part C Worked Example (16:9 Hinglish)',
      partCDemoJson,
      DEMO_HINGLISH_TRANSCRIPT
    );
  }
  return cachedDefaultSample;
}

export function getBuiltInSampleProjects(): StoredProject[] {
  if (cachedSamples) {
    return cachedSamples;
  }

  const p1 = getDefaultSampleProject();

  const verticalTranscript = `[0.00 - 4.20] Ship motion graphics 3 times faster with deterministic frame rendering.
[4.20 - 8.20] Paste your voiceover transcript and validate every RECIPE v3.1 JSON layer instantly.
[8.20 - 12.00] Export crisp 1080p MP4 videos completely offline on your phone.`;
  const p2 = buildProjectFromSample(
    'sample-vertical',
    'Vertical Mobile Explainer (9:16)',
    verticalDemoJson,
    verticalTranscript
  );

  const stressTranscript = [
    '[0.00 - 38.00] Part 1 builds the core architecture foundation for deterministic offline rendering.',
    '[38.00 - 76.00] Part 2 resolves global word and sentence anchors to exact frame timestamps.',
    '[76.00 - 114.00] Part 3 expands choreography motion macros like pop, slam, orbit, and arc into keyframes.',
    '[114.00 - 152.00] Part 4 expands reusable built-in components with staggered internal layer timing.',
    '[152.00 - 190.00] Part 5 runs the pure Canvas 2D engine with zero hidden state or random drift.',
    '[190.00 - 228.00] Part 6 simulates camera zoom and verifies the 2.5 percent safe-area margin.',
    '[228.00 - 266.00] Part 7 streams encoded H.264 chunks through the random-access MP4 muxer.',
    '[266.00 - 300.00] Part 8 merges all eight parts into a continuous five-minute master video.',
  ].join('\n');
  const p3 = buildProjectFromSample(
    'sample-5min-stress',
    '5-Minute Multi-Part Master (300s)',
    stress5MinJson,
    stressTranscript,
    true
  );

  cachedSamples = [p1, p2, p3];
  return cachedSamples;
}

export async function initializeProjectsStore(): Promise<{
  projects: StoredProject[];
  activeProject: StoredProject;
}> {
  const existing = await loadAllProjectsFromDb();
  if (existing.projects.length > 0) {
    const active =
      existing.projects.find((p) => p.id === existing.activeProjectId) ?? existing.projects[0];
    return { projects: existing.projects, activeProject: active };
  }

  const samples = getBuiltInSampleProjects();
  for (const s of samples) {
    await saveProjectToDb(s);
  }
  await saveProjectToDb(samples[0]);
  return { projects: samples, activeProject: samples[0] };
}
