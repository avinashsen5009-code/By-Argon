import React, { useMemo, useState } from 'react';
import { mergeRecipeParts } from '../../core/merge.ts';
import {
  buildSceneChangePrompt,
  replaceSceneInRecipe,
} from '../../core/promptbuilder.ts';
import { repairRecipeJson } from '../../core/repair.ts';
import type { RecipeDocument } from '../../core/types.ts';
import {
  buildFixPrompt,
  canPlayLenientPreview,
  validateRecipe,
} from '../../core/validate.ts';
import {
  registerLoadedImageAsset,
  registerLoadedVideoAsset,
} from '../../render/sprites.ts';
import { triggerHaptic, type StoredProject } from '../../store/db.ts';
import { getBuiltInSampleProjects } from '../../store/projects.ts';

interface RecipeEditorScreenProps {
  project: StoredProject;
  onUpdateProject: (updater: (prev: StoredProject) => StoredProject) => void;
  onGoToPreviewStep: () => void;
  onSeekToTime?: (tSec: number) => void;
}

export const RecipeEditorScreen: React.FC<RecipeEditorScreenProps> = ({
  project,
  onUpdateProject,
  onGoToPreviewStep,
  onSeekToTime,
}) => {
  const [repairLog, setRepairLog] = useState<string[]>([]);
  const [copiedFixPrompt, setCopiedFixPrompt] = useState(false);
  const [copiedContinuation, setCopiedContinuation] = useState(false);

  // Scene Change Helper state (M11)
  const [selectedSceneId, setSelectedSceneId] = useState<string>('');
  const [sceneChangeRequest, setSceneChangeRequest] = useState('');
  const [copiedScenePrompt, setCopiedScenePrompt] = useState(false);
  const [replacementSceneJson, setReplacementSceneJson] = useState('');
  const [sceneReplaceMsg, setSceneReplaceMsg] = useState<string | null>(null);

  const activePartIdx = project.activePartIndex;
  const activePartSlot = project.parts[activePartIdx] ?? project.parts[0];
  const isMultiPart = project.parts.length > 1;

  const currentJsonText = isMultiPart
    ? activePartSlot?.rawJson || project.recipeJson
    : project.recipeJson;

  // Run repair + validation on current JSON
  const analysis = useMemo(() => {
    const repaired = repairRecipeJson(currentJsonText);
    if (!repaired.doc) {
      return {
        doc: undefined,
        repairs: repaired.repairs,
        parseError: repaired.parseError || 'Invalid JSON syntax',
        truncated: repaired.truncated,
        continuationPrompt: repaired.continuationPrompt,
        issues: [
          {
            severity: 'error',
            path: '$',
            code: 'JSON_PARSE_ERROR',
            message: repaired.parseError || 'Unable to parse Recipe JSON',
          },
        ] as import('../../core/types.ts').ValidationIssue[],
      };
    }

    const val = validateRecipe(repaired.doc, project.transcript);
    return {
      doc: repaired.doc,
      repairs: repaired.repairs,
      parseError: undefined,
      truncated: false,
      continuationPrompt: undefined,
      issues: val.issues,
    };
  }, [currentJsonText, project.transcript]);

  const errorIssues = analysis.issues.filter((i) => i.severity === 'error');
  const warningIssues = analysis.issues.filter((i) => i.severity === 'warning');
  const lenientAllowed = canPlayLenientPreview(analysis.issues).canPreview;

  const updateRecipeText = (newRawJson: string) => {
    const repaired = repairRecipeJson(newRawJson);
    const val = repaired.doc ? validateRecipe(repaired.doc, project.transcript) : null;

    onUpdateProject((prev) => {
      const nextParts = prev.parts.map((slot, idx) => {
        if (idx !== prev.activePartIndex && prev.parts.length > 1) return slot;
        return {
          ...slot,
          rawJson: newRawJson,
          doc: repaired.doc,
          issues: val?.issues ?? [],
          status: !repaired.doc
            ? ('errors' as const)
            : val && val.issues.some((i) => i.severity === 'error')
            ? ('errors' as const)
            : ('valid' as const),
        };
      });

      const validPartDocs = nextParts
        .map((p) => p.doc)
        .filter((d): d is RecipeDocument => Boolean(d));

      let masterJson = newRawJson;
      if (prev.parts.length > 1 && validPartDocs.length > 0) {
        const merged = mergeRecipeParts(validPartDocs, prev.transcript.duration);
        masterJson = JSON.stringify(merged, null, 2);
      }

      return {
        ...prev,
        recipeJson: masterJson,
        parts: nextParts,
      };
    });
  };

  const handleAutoRepairAndFormat = () => {
    const repaired = repairRecipeJson(currentJsonText);
    setRepairLog(
      repaired.repairs.length > 0
        ? repaired.repairs
        : ['JSON formatted cleanly — no structural repairs needed.']
    );
    if (repaired.doc) {
      updateRecipeText(repaired.repairedJson);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        const repaired = repairRecipeJson(text);
        setRepairLog(repaired.repairs);
        updateRecipeText(repaired.doc ? repaired.repairedJson : text);
      }
    } catch {
      // Clipboard read denied
    }
  };

  const handleOpenJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const repaired = repairRecipeJson(text);
      setRepairLog(repaired.repairs);
      updateRecipeText(repaired.doc ? repaired.repairedJson : text);
    };
    reader.readAsText(file);
  };

  const handleCopyFixPrompt = async () => {
    const prompt = buildFixPrompt(currentJsonText, analysis.issues);
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    triggerHaptic(15);
    setCopiedFixPrompt(true);
    setTimeout(() => setCopiedFixPrompt(false), 2500);
  };

  const handleCopyContinuationPrompt = async () => {
    if (!analysis.continuationPrompt) return;
    try {
      await navigator.clipboard.writeText(analysis.continuationPrompt);
    } catch {
      // ignore
    }
    triggerHaptic(15);
    setCopiedContinuation(true);
    setTimeout(() => setCopiedContinuation(false), 2500);
  };

  const handleCopySceneChangePrompt = async () => {
    if (!analysis.doc) return;
    const targetScene =
      analysis.doc.scenes.find((s) => s.id === selectedSceneId) ?? analysis.doc.scenes[0];
    if (!targetScene) return;
    const prompt = buildSceneChangePrompt({
      doc: analysis.doc,
      scene: targetScene,
      transcript: project.transcript,
      userChangeRequest: sceneChangeRequest || 'Improve visual hierarchy and motion polish',
    });
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // ignore
    }
    triggerHaptic(15);
    setCopiedScenePrompt(true);
    setTimeout(() => setCopiedScenePrompt(false), 2500);
  };

  const handleApplyReplacementScene = () => {
    if (!analysis.doc || !replacementSceneJson.trim()) return;
    const targetScene =
      analysis.doc.scenes.find((s) => s.id === selectedSceneId) ?? analysis.doc.scenes[0];
    if (!targetScene) return;
    const res = replaceSceneInRecipe(analysis.doc, targetScene.id, replacementSceneJson);
    if (res.error || !res.updatedDoc) {
      setSceneReplaceMsg(`Error: ${res.error}`);
      return;
    }
    updateRecipeText(JSON.stringify(res.updatedDoc, null, 2));
    setReplacementSceneJson('');
    setSceneReplaceMsg(`Replaced scene "${targetScene.id}" and re-validated!`);
    setTimeout(() => setSceneReplaceMsg(null), 3000);
  };

  const handleAttachAssetFile = (assetKey: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.preload = 'auto';
      video.onloadeddata = () => {
        registerLoadedVideoAsset(assetKey, video);
      };
    } else {
      const img = new Image();
      img.onload = () => {
        registerLoadedImageAsset(assetKey, img);
      };
      img.src = url;
    }
  };

  const loadSampleRecipe = (sampleIndex: number) => {
    const sample = getBuiltInSampleProjects()[sampleIndex];
    if (!sample) return;
    onUpdateProject((prev) => ({
      ...prev,
      title: sample.title,
      w: sample.w,
      h: sample.h,
      fps: sample.fps,
      theme: sample.theme,
      transcriptRaw: sample.transcriptRaw,
      transcript: sample.transcript,
      recipeJson: sample.recipeJson,
      parts: sample.parts,
      activePartIndex: 0,
    }));
    setRepairLog([]);
  };

  const scenesList = analysis.doc?.scenes ?? [];
  const declaredAssets = Object.entries(analysis.doc?.assets ?? {});

  return (
    <div className="flex flex-col gap-5">
      {/* Header & Status Bar */}
      <div className="rounded-2xl border border-white/10 bg-[#131720] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-lg font-bold text-white">
              02. Recipe v3.1 JSON Validator & Auto-Repair
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Paste the AI output below. Auto-repair strips markdown fences, fixes smart quotes & trailing commas, and normalizes types.
            </p>
          </div>

          {/* Validation Badge */}
          <div className="flex items-center gap-2 text-xs font-bold">
            {errorIssues.length === 0 ? (
              <span
                data-testid="validation-status-valid"
                className="rounded-xl bg-emerald-400/15 border border-emerald-400/40 px-3.5 py-1.5 text-emerald-300"
              >
                VALID RECIPE v3.1 ({warningIssues.length} warnings)
              </span>
            ) : (
              <span
                data-testid="validation-status-invalid"
                className="rounded-xl bg-rose-500/15 border border-rose-500/40 px-3.5 py-1.5 text-rose-300"
              >
                {errorIssues.length} Validation Error(s)
              </span>
            )}
          </div>
        </div>

        {/* Multi-part Selector if >1 part */}
        {isMultiPart && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-300 mr-1">Editing Part:</span>
            {project.parts.map((slot, idx) => {
              const isSelected = idx === project.activePartIndex;
              return (
                <button
                  key={slot.part.n}
                  type="button"
                  onClick={() => onUpdateProject((prev) => ({ ...prev, activePartIndex: idx }))}
                  className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold border transition-colors tabular-nums ${
                    isSelected
                      ? 'border-sky-400 bg-sky-500 text-slate-950'
                      : 'border-white/10 bg-[#0B0D12] text-slate-200'
                  }`}
                >
                  Part {slot.part.n}/{slot.part.of} ({slot.status})
                </button>
              );
            })}
          </div>
        )}

        {/* Quick Toolbar: Paste, Open File, Auto-Repair, Sample Loader */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePasteClipboard}
              className="min-h-[44px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors"
            >
              Paste Clipboard
            </button>
            <label
              htmlFor="open-recipe-json-file"
              className="min-h-[44px] inline-flex items-center px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer transition-colors"
            >
              Open .json File
            </label>
            <input
              id="open-recipe-json-file"
              type="file"
              accept=".json,application/json,text/plain"
              onChange={handleOpenJsonFile}
              className="sr-only"
            />
            <button
              type="button"
              onClick={handleAutoRepairAndFormat}
              data-testid="auto-repair-btn"
              className="min-h-[44px] px-4 rounded-xl bg-sky-500/20 border border-sky-400/40 hover:bg-sky-500/30 text-xs font-bold text-sky-300 transition-colors"
            >
              Auto-Repair & Format JSON
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-400 mr-1">Load Sample:</span>
            <button
              type="button"
              onClick={() => loadSampleRecipe(0)}
              className="min-h-[40px] px-3 rounded-xl bg-[#0B0D12] border border-white/10 hover:border-white/25 text-xs font-semibold text-slate-300"
            >
              16:9 Worked Example
            </button>
            <button
              type="button"
              onClick={() => loadSampleRecipe(1)}
              className="min-h-[40px] px-3 rounded-xl bg-[#0B0D12] border border-white/10 hover:border-white/25 text-xs font-semibold text-slate-300"
            >
              9:16 Vertical Shorts
            </button>
          </div>
        </div>

        {/* Repair Log Banner */}
        {repairLog.length > 0 && (
          <div className="mt-3 rounded-xl border border-sky-400/30 bg-sky-500/10 p-3 text-xs text-sky-200">
            <div className="font-bold mb-1">Auto-Repair Summary:</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {repairLog.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Truncated JSON Continuation Prompt Banner (M12) */}
        {analysis.truncated && analysis.continuationPrompt && (
          <div className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3.5 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-bold text-sm">Truncated AI Output Detected</div>
              <p className="mt-0.5 text-amber-200/80">
                The pasted JSON ended mid-stream before closing all brackets. Copy a continuation prompt for the remaining scenes.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopyContinuationPrompt}
              className="min-h-[44px] px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs transition-colors"
            >
              {copiedContinuation ? 'Copied Continuation Prompt!' : 'Prompt for Remaining Scenes'}
            </button>
          </div>
        )}

        {/* Recipe JSON Textarea */}
        <div className="mt-4">
          <label htmlFor="recipe-json-textarea" className="sr-only">
            RECIPE v3.1 JSON Document
          </label>
          <textarea
            id="recipe-json-textarea"
            data-testid="recipe-json-textarea"
            rows={14}
            value={currentJsonText}
            onChange={(e) => updateRecipeText(e.target.value)}
            spellCheck={false}
            className="w-full rounded-xl border border-white/15 bg-[#0B0D12] p-4 font-mono text-xs leading-relaxed text-slate-100 focus:border-sky-400 focus:outline-none"
          />
        </div>

        {/* Validation Issues & Fix Prompt Generator (M12) */}
        {analysis.issues.length > 0 && (
          <div className="mt-4 rounded-xl border border-white/10 bg-[#0B0D12] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <span className="text-xs font-bold text-white">
                Validation Diagnostics ({errorIssues.length} errors, {warningIssues.length} warnings)
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {lenientAllowed && errorIssues.length > 0 && (
                  <button
                    type="button"
                    onClick={onGoToPreviewStep}
                    className="min-h-[40px] px-3.5 rounded-xl bg-sky-500/20 border border-sky-400/40 hover:bg-sky-500/30 text-sky-200 font-bold text-xs transition-colors"
                  >
                    Preview Anyway (Skip Unknown Layers)
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCopyFixPrompt}
                  data-testid="copy-fix-prompt-btn"
                  className="min-h-[40px] px-3.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs transition-colors"
                >
                  {copiedFixPrompt ? 'Copied AI Fix Prompt!' : 'Copy Fix Prompt for AI'}
                </button>
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
              {analysis.issues.map((iss, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    iss.severity === 'error'
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                      : 'border-amber-400/30 bg-amber-500/10 text-amber-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] font-bold">
                    <span>
                      [{iss.severity.toUpperCase()}] {iss.code} · {iss.path}
                    </span>
                    {typeof iss.time === 'number' && onSeekToTime && (
                      <button
                        type="button"
                        onClick={() => {
                          onSeekToTime(iss.time!);
                          onGoToPreviewStep();
                        }}
                        className="rounded bg-white/15 px-2 py-0.5 text-[10px] text-white hover:bg-white/25"
                      >
                        Jump to {iss.time.toFixed(2)}s →
                      </button>
                    )}
                  </div>
                  <div className="mt-0.5 text-slate-200">{iss.message}</div>
                  {iss.suggestedFix && (
                    <div className="mt-1 text-[11px] text-emerald-300 font-mono">
                      Fix: {iss.suggestedFix}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Scene Change Prompt Helper (M11) */}
        {scenesList.length > 0 && (
          <div className="mt-4 rounded-xl border border-white/10 bg-[#0B0D12] p-4">
            <div className="text-xs font-bold text-white mb-2">
              Scene Change Helper (M11 — Edit Single Scene with AI)
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {scenesList.map((sc) => {
                const isSel = (selectedSceneId || scenesList[0]?.id) === sc.id;
                return (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => setSelectedSceneId(sc.id)}
                    className={`min-h-[38px] px-3 rounded-lg font-mono text-xs font-bold transition-colors ${
                      isSel
                        ? 'bg-sky-500 text-slate-950'
                        : 'bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {sc.id} ({sc.name || 'scene'})
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={sceneChangeRequest}
                onChange={(e) => setSceneChangeRequest(e.target.value)}
                placeholder="Describe change for this scene (e.g., Make the hero badge larger and add a burst)..."
                className="min-h-[44px] flex-1 rounded-xl border border-white/15 bg-[#131720] px-3.5 text-xs text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopySceneChangePrompt}
                className="min-h-[44px] px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs transition-colors whitespace-nowrap"
              >
                {copiedScenePrompt ? 'Copied Scene Prompt!' : 'Copy Scene Change Prompt'}
              </button>
            </div>
            <div className="mt-2.5 flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={replacementSceneJson}
                onChange={(e) => setReplacementSceneJson(e.target.value)}
                placeholder="Paste replacement scene JSON object here to splice in..."
                className="min-h-[40px] flex-1 rounded-xl border border-white/15 bg-[#131720] px-3.5 font-mono text-xs text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleApplyReplacementScene}
                className="min-h-[40px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-xs transition-colors whitespace-nowrap"
              >
                Replace Scene & Validate
              </button>
            </div>
            {sceneReplaceMsg && (
              <div className="mt-2 text-xs font-semibold text-emerald-300">{sceneReplaceMsg}</div>
            )}
          </div>
        )}

        {/* Asset Picker Drawer if recipe declares assets (M8 / M16) */}
        {declaredAssets.length > 0 && (
          <div className="mt-4 rounded-xl border border-white/10 bg-[#0B0D12] p-4">
            <div className="text-xs font-bold text-white mb-2">
              Declared Media Assets ({declaredAssets.length}) — Attach Local Files
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {declaredAssets.map(([key, def]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#131720] px-3 py-2 text-xs"
                >
                  <div>
                    <div className="font-mono font-bold text-sky-400">{key}</div>
                    <div className="text-[11px] text-slate-400">
                      {def.type} · {def.src || def.file}
                    </div>
                  </div>
                  <label className="min-h-[36px] inline-flex items-center px-3 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer">
                    Choose File
                    <input
                      type="file"
                      accept={def.type === 'video' ? 'video/*' : 'image/*'}
                      onChange={(e) => handleAttachAssetFile(key, e)}
                      className="sr-only"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer CTA */}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onGoToPreviewStep}
            className="min-h-[52px] px-6 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-display font-bold text-sm transition-colors"
          >
            Open Stage Preview →
          </button>
        </div>
      </div>
    </div>
  );
};
