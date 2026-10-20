import { repairRecipeJson } from '../core/repair.ts';
import type { TranscriptData } from '../core/types.ts';
import { buildFixPrompt, validateRecipe } from '../core/validate.ts';

self.onmessage = (event: MessageEvent) => {
  const { id, rawJson, transcript, autoRepair } = event.data || {};
  let jsonToValidate = String(rawJson || '');
  let repairs: string[] = [];

  if (autoRepair) {
    const rep = repairRecipeJson(jsonToValidate);
    jsonToValidate = rep.repairedJson;
    repairs = rep.repairs;
  }

  const res = validateRecipe(jsonToValidate, transcript as TranscriptData | undefined);
  const fixPrompt = res.issues.length > 0 ? buildFixPrompt(res.issues) : '';

  self.postMessage({
    id,
    repairedJson: jsonToValidate,
    repairs,
    valid: res.valid,
    issues: res.issues,
    fixPrompt,
  });
};
