import React, { useMemo, useState } from 'react';
import { compileRecipe } from '../../core/layout.ts';
import { mergeRecipeParts } from '../../core/merge.ts';
import { extractCarryFromPart } from '../../core/parts.ts';
import { repairRecipeJson } from '../../core/repair.ts';
import type { RecipeDocument } from '../../core/types.ts';
import { buildFixPrompt, validateRecipe } from '../../core/validate.ts';
import type { StoredProject } from '../../store/db.ts';

interface RecipeEditorScreenProps {
  project: StoredProject;
  onUpdateProject: (updater: (prev: StoredProject) => StoredProject) => void;
  onGoToPreviewStep: () => void;
}

export const RecipeEditorScreen: React.FC<RecipeEditorScreenProps> = ({
  project,
  onUpdateProject,
  onGoToPreviewStep,
}) => {
  const [repairsApplied, setRepairsApplied] = useState<string[]>([]);
  const [copiedFix, setCopiedFix] = useState(false);
  const [showFlattened, setShowFlattened] = useState(false);

  const validation = useMemo(() => {
    return validateRecipe(project.recipeJson, project.transcript);
  }, [project.recipeJson, project.transcript]);

  const errors = validation.issues.filter((i) => i.severity === 'error');
  const warnings = validation.issues.filter((i) => i.severity === 'warning');

  const flattenedSummary = useMemo(() => {
    if (!showFlattened || !validation.doc) return '';
    try {
      const compiled = compileRecipe(validation.doc, project.transcript);
      return JSON.stringify(
        compiled.layers.map((l) => ({
          id: l.id,
          type: l.type,
          kind: l.kind,
          t: [Number(l.t0.toFixed(2)), Number(l.t1.toFixed(2))],
          x: l.x,
          y: l.y,
          w: l.w,
          h: l.h,
          parent: l.parent,
          groupId: l.groupId,
        })),
        null,
        2
      );
    } catch (err: any) {
      return `Failed to compile flattened scene graph: ${err?.message ?? 'error'}`;
    }
  }, [showFlattened, validation.doc, project.transcript]);

  const handleJsonChange = (nextJson: string) => {
    setRepairsApplied([]);
    onUpdateProject((prev) => {
      const val = validateRecipe(nextJson, prev.transcript);
      const updatedParts = [...prev.parts];
      if (updatedParts[prev.activePartIndex]) {
        updatedParts[prev.activePartIndex] = {
          ...updatedParts[prev.activePartIndex],
          rawJson: nextJson,
          doc: val.doc,
          issues: val.issues,
          status: val.issues.some((i) => i.severity === 'error')
            ? 'errors'
            : val.issues.length > 0
            ? 'warnings'
            : 'valid',
          carryOut: val.doc ? extractCarryFromPart(val.doc) : undefined,
        };
      }
      return {
        ...prev,
        recipeJson: nextJson,
        parts: updatedParts,
      };
    });
  };

  const handleRepairAndValidate = () => {
    const result = repairRecipeJson(project.recipeJson);
    setRepairsApplied(
      result.repairs.length > 0 ? result.repairs : ['No structural repairs needed — JSON is clean.']
    );
    handleJsonChange(result.repairedJson);
  };

  const handleMergeAllParts = () => {
    const validDocs: RecipeDocument[] = [];
    for (const slot of project.parts) {
      if (slot.doc) {
        validDocs.push(slot.doc);
      } else if (slot.rawJson.trim()) {
        const rep = repairRecipeJson(slot.rawJson);
        if (rep.doc) validDocs.push(rep.doc);
      }
    }
    if (validDocs.length === 0) return;
    const merged = mergeRecipeParts(validDocs);
    const mergedStr = JSON.stringify(merged, null, 2);
    setRepairsApplied([`Merged ${validDocs.length} part(s) into unified timeline (${merged.scenes.length} scenes).`]);
    onUpdateProject((prev) => ({
      ...prev,
      recipeJson: mergedStr,
    }));
  };

  const handleCopyFixPrompt = async () => {
    const fixText = buildFixPrompt(validation.issues);
    try {
      await navigator.clipboard.writeText(fixText);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = fixText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedFix(true);
    setTimeout(() => setCopiedFix(false), 2500);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header & Actions */}
      <div className="rounded-2xl border border-white/10 bg-[#131720] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-lg font-bold text-white">02. Recipe v3.1 JSON Validator & Repair</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Paste the AI's RECIPE v3.1 JSON response. Auto-repair cleans markdown fences, comments, and defaults.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold tabular-nums">
            <span className={errors.length === 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {errors.length} Error(s)
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-amber-300">{warnings.length} Warning(s)</span>
            {validation.doc && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-300">{validation.doc.scenes?.length ?? 0} Scenes</span>
              </>
            )}
          </div>
        </div>

        {/* Multi-Part Switcher if project has >1 parts */}
        {project.parts.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-white/10">
            <div className="flex flex-wrap gap-2">
              {project.parts.map((slot, idx) => {
                const isSelected = idx === project.activePartIndex;
                return (
                  <button
                    key={slot.part.n}
                    type="button"
                    onClick={() =>
                      onUpdateProject((prev) => ({
                        ...prev,
                        activePartIndex: idx,
                        recipeJson: prev.parts[idx]?.rawJson || prev.recipeJson,
                      }))
                    }
                    className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold border transition-colors tabular-nums ${
                      isSelected
                        ? 'border-sky-400 bg-sky-500 text-slate-950'
                        : 'border-white/10 bg-[#0B0D12] text-slate-200'
                    }`}
                  >
                    Part {slot.part.n} ({slot.status})
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleMergeAllParts}
              className="min-h-[44px] px-4 rounded-xl bg-emerald-400/20 hover:bg-emerald-400/30 border border-emerald-400/40 text-xs font-bold text-emerald-300 transition-colors"
            >
              Merge All Parts into Master
            </button>
          </div>
        )}

        {/* Primary Action Bar */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleRepairAndValidate}
            data-testid="repair-validate-btn"
            className="min-h-[48px] px-5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs transition-colors whitespace-nowrap"
          >
            Auto-Repair & Validate JSON
          </button>

          {validation.issues.length > 0 && (
            <button
              type="button"
              onClick={handleCopyFixPrompt}
              data-testid="copy-fix-prompt-btn"
              className="min-h-[48px] px-4 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs transition-colors whitespace-nowrap"
            >
              {copiedFix ? 'Copied Part B Fix Prompt!' : 'Copy Fix Prompt (Part B)'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowFlattened((v) => !v)}
            className="min-h-[48px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors whitespace-nowrap"
          >
            {showFlattened ? 'Hide Compiled Scene Graph' : 'Inspect Flattened Layers'}
          </button>

          <button
            type="button"
            onClick={onGoToPreviewStep}
            className="min-h-[48px] px-5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs transition-colors whitespace-nowrap"
          >
            Open Stage Preview →
          </button>
        </div>

        {/* Repairs Banner */}
        {repairsApplied.length > 0 && (
          <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
            <div className="font-bold mb-1">Auto-Repair Log:</div>
            <ul className="list-disc list-inside space-y-0.5">
              {repairsApplied.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {/* JSON Editor */}
        <div className="mt-4">
          <label htmlFor="recipe-json-textarea" className="sr-only">
            RECIPE v3.1 JSON Document
          </label>
          <textarea
            id="recipe-json-textarea"
            data-testid="recipe-json-textarea"
            rows={14}
            value={project.recipeJson}
            onChange={(e) => handleJsonChange(e.target.value)}
            spellCheck={false}
            className="w-full rounded-xl border border-white/15 bg-[#0B0D12] p-4 font-mono text-xs leading-relaxed text-slate-100 focus:border-sky-400 focus:outline-none"
          />
        </div>

        {showFlattened && (
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold text-slate-400">
              Compiled & Flattened Scene Graph (Anchors Resolved, Components Expanded, Sorted by Z)
            </div>
            <pre className="max-h-60 overflow-y-auto rounded-xl border border-white/10 bg-[#0B0D12] p-3.5 font-mono text-[11px] text-slate-300">
              {flattenedSummary}
            </pre>
          </div>
        )}
      </div>

      {/* Validation Issues List */}
      <div className="rounded-2xl border border-white/10 bg-[#131720] p-5">
        <h3 className="font-display text-sm font-bold text-white">
          SPEC Part D Validation Report
        </h3>
        {validation.issues.length === 0 ? (
          <p className="mt-2 text-xs text-emerald-400 font-medium">
            All 9 SPEC validation checks passed with zero errors or warnings. Ready for deterministic rendering.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2 max-h-64 overflow-y-auto">
            {validation.issues.map((iss, idx) => (
              <div
                key={idx}
                className={`rounded-xl border p-3 text-xs ${
                  iss.severity === 'error'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                }`}
              >
                <div className="font-bold">
                  [{iss.severity.toUpperCase()}] {iss.code}
                  {iss.sceneId ? ` · Scene: ${iss.sceneId}` : ''}
                  {iss.layerId ? ` · Layer: ${iss.layerId}` : ''}
                </div>
                <div className="mt-0.5 text-slate-200">{iss.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
