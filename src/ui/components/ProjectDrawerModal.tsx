import React, { useEffect, useState } from 'react';
import { APP_ID, APP_NAME } from '../../core/types.ts';
import { probeExportCapabilities, type ExportCapabilities } from '../../export/capabilities.ts';
import { clearGlowSpriteCache, getGlowSpriteCacheStats } from '../../render/sprites.ts';
import { clearTextLayoutCache } from '../../render/text.ts';
import {
  appendAppLog,
  estimateProjectStorageBytes,
  getRecentAppLogs,
  packProjectToRecipeStudioZip,
  triggerHaptic,
  type StoredProject,
  unpackProjectFromRecipeStudioZip,
} from '../../store/db.ts';
import { getBuiltInSampleProjects } from '../../store/projects.ts';

interface ProjectDrawerModalProps {
  isOpen: boolean;
  projects: StoredProject[];
  activeProjectId: string;
  onSelectProject: (project: StoredProject) => void;
  onCreateProject: (title: string, aspect: '16:9' | '9:16') => void;
  onDeleteProject: (id: string) => void;
  onClose: () => void;
}

export const ProjectDrawerModal: React.FC<ProjectDrawerModalProps> = ({
  isOpen,
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onClose,
}) => {
  const [newTitle, setNewTitle] = useState('');
  const [newAspect, setNewAspect] = useState<'16:9' | '9:16'>('16:9');
  const [caps, setCaps] = useState<ExportCapabilities | null>(null);
  const [cacheClearedMsg, setCacheClearedMsg] = useState<string | null>(null);
  const [copiedDebug, setCopiedDebug] = useState(false);

  useEffect(() => {
    if (isOpen) {
      probeExportCapabilities(1920, 1080, 60).then(setCaps).catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const builtInSamples = getBuiltInSampleProjects();
  const totalStorageBytes = projects.reduce((acc, p) => acc + estimateProjectStorageBytes(p), 0);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim() || `New Explainer (${newAspect})`;
    onCreateProject(title, newAspect);
    setNewTitle('');
    onClose();
  };

  const handleDuplicateProject = (proj: StoredProject) => {
    const dup: StoredProject = {
      ...proj,
      id: `proj_${Date.now()}`,
      title: `${proj.title} (Copy)`,
      updatedAt: Date.now(),
    };
    appendAppLog(`Duplicated project "${proj.title}"`);
    onSelectProject(dup);
    onClose();
  };

  const handleExportProjectBundle = (proj: StoredProject) => {
    const zipBytes = packProjectToRecipeStudioZip(proj);
    const blob = new Blob([zipBytes as unknown as BlobPart], {
      type: 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = proj.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.href = url;
    a.download = `${safeName || 'project'}.recipestudio`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportProjectBundle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const ab = reader.result as ArrayBuffer;
        const parsed = unpackProjectFromRecipeStudioZip(new Uint8Array(ab));
        if (parsed && parsed.recipeJson && parsed.transcript) {
          const imported: StoredProject = {
            ...parsed,
            id: `proj_${Date.now()}`,
            updatedAt: Date.now(),
          };
          appendAppLog(`Imported project bundle "${imported.title}"`);
          onSelectProject(imported);
          onClose();
        }
      } catch {
        // Ignore invalid bundle
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleClearCaches = () => {
    clearGlowSpriteCache();
    clearTextLayoutCache();
    setCacheClearedMsg('Cleared sprite glow cache & text layout LRU cache.');
    setTimeout(() => setCacheClearedMsg(null), 2500);
  };

  const handleCopyDebugReport = async () => {
    const report = {
      app: APP_NAME,
      appId: APP_ID,
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0,
      capabilities: caps,
      storageUsedKb: Math.round(totalStorageBytes / 1024),
      glowSpriteCache: getGlowSpriteCacheStats(),
      recentLogs: getRecentAppLogs(200),
    };
    const text = JSON.stringify(report, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
    triggerHaptic(15);
    setCopiedDebug(true);
    setTimeout(() => setCopiedDebug(false), 2500);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Switch or Create Project"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[#131720] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-xl font-bold text-white">
              Projects, Samples & Diagnostics
            </h2>
            <p className="text-xs text-slate-400">
              {APP_NAME} ({APP_ID}) · 100% Offline Deterministic Studio
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors"
          >
            Close
          </button>
        </div>

        {/* Create New Project Form + Import .recipestudio.json */}
        <form onSubmit={handleCreate} className="mt-5 flex flex-col sm:flex-row gap-3">
          <label className="sr-only" htmlFor="new-project-title">
            New project title
          </label>
          <input
            id="new-project-title"
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New project name (e.g., AI Coding Workflow)..."
            className="min-h-[48px] flex-1 rounded-xl border border-white/15 bg-[#0B0D12] px-4 text-sm text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
          />
          <div className="flex items-center gap-1 rounded-xl bg-[#0B0D12] p-1 border border-white/15">
            {(['16:9', '9:16'] as const).map((asp) => (
              <button
                key={asp}
                type="button"
                onClick={() => setNewAspect(asp)}
                className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  newAspect === asp ? 'bg-sky-500 text-slate-950' : 'text-slate-300'
                }`}
              >
                {asp}
              </button>
            ))}
          </div>
          <button
            type="submit"
            className="min-h-[48px] px-5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-sm transition-colors whitespace-nowrap shrink-0"
          >
            Create Project
          </button>
        </form>

        {/* Saved Projects in IndexedDB */}
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-xs font-semibold text-slate-400">
              Saved Projects (IndexedDB · {(totalStorageBytes / 1024).toFixed(1)} KB used)
            </h3>
            <label className="min-h-[36px] inline-flex items-center px-3 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer">
              Import .recipestudio
              <input
                type="file"
                accept=".recipestudio,.zip,.json,application/json,application/octet-stream"
                onChange={handleImportProjectBundle}
                className="sr-only"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2.5">
            {projects.map((proj) => {
              const isCurrent = proj.id === activeProjectId;
              return (
                <div
                  key={proj.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 transition-colors ${
                    isCurrent
                      ? 'border-sky-400 bg-sky-500/10'
                      : 'border-white/10 bg-[#0B0D12] hover:border-white/20'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectProject(proj);
                      onClose();
                    }}
                    className="flex-1 text-left min-w-[180px]"
                  >
                    <div className="font-semibold text-sm text-white">{proj.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-400 tabular-nums">
                      <span>
                        {proj.w}×{proj.h}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{proj.fps} fps</span>
                      <span aria-hidden="true">·</span>
                      <span>{proj.transcript.duration.toFixed(2)}s</span>
                      <span aria-hidden="true">·</span>
                      <span>{proj.parts.length} part(s)</span>
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleDuplicateProject(proj)}
                      className="min-h-[40px] px-2.5 rounded-lg bg-white/5 hover:bg-white/15 text-xs font-medium text-slate-300"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportProjectBundle(proj)}
                      className="min-h-[40px] px-2.5 rounded-lg bg-white/5 hover:bg-white/15 text-xs font-medium text-slate-300"
                    >
                      Export JSON
                    </button>
                    {projects.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDeleteProject(proj.id)}
                        aria-label={`Delete '${proj.title}'`}
                        className="min-h-[40px] px-2.5 rounded-lg bg-white/5 hover:bg-rose-500/20 text-xs font-medium text-slate-300 hover:text-rose-300 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Reset / Load Built-In Reference Samples (including Demo: Loop Scene) */}
        <div className="mt-6 pt-5 border-t border-white/10">
          <h3 className="text-xs font-semibold text-slate-400 mb-3">
            Load Fresh SPEC v3.1 Reference Sample / Demo Loop Scene
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {builtInSamples.map((samp) => (
              <button
                key={samp.id}
                type="button"
                onClick={() => {
                  onSelectProject(samp);
                  onClose();
                }}
                className="min-h-[60px] rounded-xl border border-white/10 bg-[#0B0D12] hover:border-sky-400/60 p-3 text-left transition-colors"
              >
                <div className="text-xs font-bold text-white leading-snug">{samp.title}</div>
                <div className="mt-1 text-[11px] text-slate-400 tabular-nums">
                  {samp.w}×{samp.h} · {samp.transcript.duration}s
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Settings, Cache & Diagnostics Section (M16) */}
        <div className="mt-6 pt-5 border-t border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-xs font-semibold text-slate-400">
              Settings, Cache & Device Diagnostics
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClearCaches}
                className="min-h-[38px] px-3 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors"
              >
                Clear Sprite/Text Cache
              </button>
              <button
                type="button"
                onClick={handleCopyDebugReport}
                data-testid="copy-debug-report-btn"
                className="min-h-[38px] px-3 rounded-lg bg-sky-500/20 border border-sky-400/40 hover:bg-sky-500/30 text-xs font-bold text-sky-200 transition-colors"
              >
                {copiedDebug ? 'Copied Debug Report!' : 'Copy Debug Report'}
              </button>
            </div>
          </div>
          {cacheClearedMsg && (
            <div className="mb-2 text-xs text-emerald-300 font-semibold">{cacheClearedMsg}</div>
          )}
          <div className="rounded-xl border border-white/10 bg-[#0B0D12] p-3 text-[11px] text-slate-400 space-y-1">
            <div>
              <strong className="text-slate-200">Bundled Offline Assets & Licences:</strong> Sora &
              Inter (OFL), Noto Sans Devanagari & Noto Color Emoji (OFL), Lucide Icons (ISC),
              mp4-muxer & webm-muxer (MIT).
            </div>
            {caps && (
              <div className="font-mono text-[10px] text-slate-400">
                WebCodecs VideoEncoder: {String(caps.hasWebCodecsVideo)} · H.264 MP4:{' '}
                {String(caps.supportsH264Mp4)} ({caps.selectedVideoCodec}) · VP9 WebM:{' '}
                {String(caps.supportsVp9Webm)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
