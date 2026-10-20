import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { compileRecipe } from '../core/layout.ts';
import { splitTranscriptIntoParts } from '../core/parts.ts';
import { repairRecipeJson } from '../core/repair.ts';
import { DEMO_HINGLISH_TRANSCRIPT, parseTranscript } from '../core/transcript.ts';
import { APP_NAME, type CompiledRecipe, type RecipeDocument } from '../core/types.ts';
import { validateRecipe } from '../core/validate.ts';
import { deleteProjectFromDb, saveProjectToDb, type StoredProject } from '../store/db.ts';
import { getDefaultSampleProject, initializeProjectsStore } from '../store/projects.ts';
import { ProjectDrawerModal } from './components/ProjectDrawerModal.tsx';
import { ExportScreen } from './screens/ExportScreen.tsx';
import { PreviewStageScreen } from './screens/PreviewStageScreen.tsx';
import { RecipeEditorScreen } from './screens/RecipeEditorScreen.tsx';
import { TranscriptPromptScreen } from './screens/TranscriptPromptScreen.tsx';

export type ActiveTab = 'transcript' | 'recipe' | 'preview' | 'export';

export const RecipeStudioApp: React.FC = () => {
  const defaultSample = useMemo(() => getDefaultSampleProject(), []);
  const [projects, setProjects] = useState<StoredProject[]>([defaultSample]);
  const [activeProject, setActiveProject] = useState<StoredProject>(defaultSample);
  const [activeTab, setActiveTab] = useState<ActiveTab>('transcript');
  const [currentTime, setCurrentTime] = useState(5.6);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Load persisted projects from IndexedDB on mount
  useEffect(() => {
    initializeProjectsStore()
      .then(({ projects: loaded, activeProject: active }) => {
        setProjects(loaded);
        setActiveProject(active);
        setCurrentTime(Math.min(5.6, Math.max(1.2, active.transcript.duration * 0.45)));
      })
      .catch(() => {});
  }, []);

  const updateActiveProject = useCallback((updater: (prev: StoredProject) => StoredProject) => {
    setActiveProject((prev) => {
      const updated = { ...updater(prev), updatedAt: Date.now() };
      saveProjectToDb(updated).catch(() => {});
      setProjects((list) => {
        const exists = list.some((p) => p.id === updated.id);
        return exists ? list.map((p) => (p.id === updated.id ? updated : p)) : [updated, ...list];
      });
      return updated;
    });
  }, []);

  const handleSelectProject = (proj: StoredProject) => {
    setActiveProject(proj);
    setCurrentTime(Math.min(3.0, Math.max(1.0, proj.transcript.duration * 0.25)));
    saveProjectToDb(proj).catch(() => {});
    setProjects((list) => {
      const exists = list.some((p) => p.id === proj.id);
      return exists ? list.map((p) => (p.id === proj.id ? proj : p)) : [proj, ...list];
    });
  };

  const handleCreateProject = (title: string, aspect: '16:9' | '9:16') => {
    const w = aspect === '16:9' ? 1920 : 1080;
    const h = aspect === '16:9' ? 1080 : 1920;
    const transcript = parseTranscript(DEMO_HINGLISH_TRANSCRIPT, 11.76);
    const starterDoc: RecipeDocument = {
      recipe: 'v3.1',
      meta: {
        w,
        h,
        fps: 60,
        duration: 11.76,
        lang: 'en',
        part: { n: 1, of: 1, from: 0, to: 11.76 },
      },
      theme: { palette: 1 },
      global: { vignette: 0.6 },
      camera: [{ t: 0, x: 0.5, y: 0.5, zoom: 1.0 }],
      scenes: [
        {
          id: 's1',
          t: [0, 11.76],
          layers: [
            {
              id: 'title_1',
              type: 'text',
              t: [0.1, 11.76],
              x: 0.5,
              y: 0.45,
              w: Math.round(w * 0.75),
              text: title,
              size: 84,
              weight: 800,
              color: '@ink',
              enter: 'charIn',
              exit: 'none',
            },
          ],
        },
      ],
    };
    const rawJson = JSON.stringify(starterDoc, null, 2);
    const val = validateRecipe(starterDoc, transcript);
    const newProj: StoredProject = {
      id: `proj_${Date.now()}`,
      title,
      updatedAt: Date.now(),
      w,
      h,
      fps: 60,
      theme: { palette: 1 },
      screenText: 'en',
      transcriptRaw: DEMO_HINGLISH_TRANSCRIPT,
      transcript,
      recipeJson: rawJson,
      parts: splitTranscriptIntoParts(transcript).map((pm) => ({
        part: pm,
        rawJson,
        doc: starterDoc,
        issues: val.issues,
        status: 'valid',
      })),
      activePartIndex: 0,
    };
    handleSelectProject(newProj);
  };

  const handleDeleteProject = (id: string) => {
    deleteProjectFromDb(id).catch(() => {});
    setProjects((prev) => {
      const filtered = prev.filter((p) => p.id !== id);
      if (activeProject.id === id && filtered.length > 0) {
        setActiveProject(filtered[0]);
      }
      return filtered;
    });
  };

  // Compile current recipe for the deterministic stage preview
  const compiledRecipe: CompiledRecipe = useMemo(() => {
    const repaired = repairRecipeJson(activeProject.recipeJson);
    const doc = repaired.doc ?? (JSON.parse(defaultSample.recipeJson) as RecipeDocument);
    // Apply project canvas/theme overrides if user toggled them in Step 1
    const mergedDoc: RecipeDocument = {
      ...doc,
      meta: {
        ...doc.meta,
        w: activeProject.w,
        h: activeProject.h,
        fps: activeProject.fps,
      },
      theme: activeProject.theme,
    };
    return compileRecipe(mergedDoc, activeProject.transcript);
  }, [
    activeProject.recipeJson,
    activeProject.w,
    activeProject.h,
    activeProject.fps,
    activeProject.theme,
    activeProject.transcript,
    defaultSample.recipeJson,
  ]);

  const navItems: { id: ActiveTab; label: string; shortLabel: string }[] = [
    { id: 'transcript', label: '01. Transcript & Prompt', shortLabel: '1. Prompt' },
    { id: 'recipe', label: '02. Recipe JSON', shortLabel: '2. JSON' },
    { id: 'preview', label: '03. Stage Preview', shortLabel: '3. Stage' },
    { id: 'export', label: '04. Export MP4', shortLabel: '4. Export' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0D12] text-[#F4F6FA] pb-20 lg:pb-8">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 border-b border-white/10 bg-[#0B0D12]/90 backdrop-blur-md px-4 sm:px-6 h-14">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('transcript');
          }}
          className="font-display text-lg font-extrabold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          {APP_NAME}
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav aria-label="Primary Workspace Steps" className="hidden md:flex items-center gap-6 text-sm font-medium">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === item.id
                  ? 'border-sky-400 text-white font-semibold'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            data-testid="switch-project-btn"
            className="min-h-[40px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0"
          >
            Projects ({projects.length})
          </button>
        </div>
      </header>

      {/* Main Content Container (1440px Desktop Split-Screen + Mobile Single-Hand Layout) */}
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 sm:px-6 pt-5 pb-28 lg:pb-12">
        {/* Active Project Header Bar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 tabular-nums">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-200">{activeProject.title}</span>
            <span aria-hidden="true">·</span>
            <span>RECIPE v3.1</span>
            <span aria-hidden="true">·</span>
            <span>
              {compiledRecipe.w}×{compiledRecipe.h}
            </span>
            <span aria-hidden="true">·</span>
            <span>{compiledRecipe.fps} fps</span>
            <span aria-hidden="true">·</span>
            <span>{compiledRecipe.duration.toFixed(2)}s</span>
          </div>
          <div>Autosaved to IndexedDB · 100% Offline</div>
        </div>

        {activeTab === 'preview' ? (
          <PreviewStageScreen
            compiled={compiledRecipe}
            audioDataUrl={activeProject.audioDataUrl}
            audioOffsetSec={activeProject.audioOffsetSec ?? 0}
            audioPeaks={activeProject.audioPeaks}
            currentTime={currentTime}
            onChangeTime={setCurrentTime}
            onGoToExport={() => setActiveTab('export')}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left / Primary Workflow Column */}
            <div className="lg:col-span-7">
              {activeTab === 'transcript' && (
                <TranscriptPromptScreen
                  project={activeProject}
                  onUpdateProject={updateActiveProject}
                  onGoToRecipeStep={() => setActiveTab('recipe')}
                />
              )}
              {activeTab === 'recipe' && (
                <RecipeEditorScreen
                  project={activeProject}
                  onUpdateProject={updateActiveProject}
                  onGoToPreviewStep={() => setActiveTab('preview')}
                  onSeekToTime={(tSec) => setCurrentTime(tSec)}
                />
              )}
              {activeTab === 'export' && (
                <ExportScreen
                  compiled={compiledRecipe}
                  projectTitle={activeProject.title}
                  audioDataUrl={activeProject.audioDataUrl}
                  audioOffsetSec={activeProject.audioOffsetSec ?? 0}
                  currentTime={currentTime}
                />
              )}
            </div>

            {/* Right / Persistent Live Stage Preview on Desktop */}
            <div className="hidden lg:block lg:col-span-5 sticky top-20">
              <PreviewStageScreen
                compiled={compiledRecipe}
                audioDataUrl={activeProject.audioDataUrl}
                audioOffsetSec={activeProject.audioOffsetSec ?? 0}
                audioPeaks={activeProject.audioPeaks}
                currentTime={currentTime}
                onChangeTime={setCurrentTime}
                onGoToExport={() => setActiveTab('export')}
                compact
              />
            </div>
          </div>
        )}
      </main>

      {/* Mobile Fixed Bottom Navigation Bar (48dp touch targets, <= 15% viewport height) */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 grid grid-cols-4 items-center h-14 border-t border-white/10 bg-[#0B0D12]/95 backdrop-blur-md px-2"
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`min-h-[48px] flex items-center justify-center rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
                isActive ? 'text-sky-400 bg-sky-500/10' : 'text-slate-400 hover:text-white'
              }`}
            >
              {item.shortLabel}
            </button>
          );
        })}
      </nav>

      {/* Project Drawer Modal */}
      <ProjectDrawerModal
        isOpen={isDrawerOpen}
        projects={projects}
        activeProjectId={activeProject.id}
        onSelectProject={handleSelectProject}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleDeleteProject}
        onClose={() => setIsDrawerOpen(false)}
      />
    </div>
  );
};
