import React, { useState } from 'react';
import type { StoredProject } from '../../store/db.ts';
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

  if (!isOpen) return null;

  const builtInSamples = getBuiltInSampleProjects();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim() || `New Explainer (${newAspect})`;
    onCreateProject(title, newAspect);
    setNewTitle('');
    onClose();
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
          <h2 className="font-display text-xl font-bold text-white">Projects & Built-In Demos</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors"
          >
            Close
          </button>
        </div>

        {/* Create New Project Form */}
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
          <h3 className="text-xs font-semibold text-slate-400 mb-3">Saved Projects (IndexedDB Autosave)</h3>
          <div className="flex flex-col gap-2.5">
            {projects.map((proj) => {
              const isCurrent = proj.id === activeProjectId;
              return (
                <div
                  key={proj.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 transition-colors ${
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
                    className="flex-1 text-left"
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
                  {projects.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteProject(proj.id)}
                      aria-label={`Delete '${proj.title}'`}
                      className="min-h-[44px] px-3 rounded-lg bg-white/5 hover:bg-rose-500/20 text-xs font-medium text-slate-300 hover:text-rose-300 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Reset / Load Built-In Reference Samples */}
        <div className="mt-6 pt-5 border-t border-white/10">
          <h3 className="text-xs font-semibold text-slate-400 mb-3">Load Fresh SPEC v3.1 Reference Sample</h3>
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
      </div>
    </div>
  );
};
