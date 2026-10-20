import { ENTRANCE_MACROS } from './macros.ts';
import type { Layer, LayerPatch, RecipeDocument } from './types.ts';

export interface RepairResult {
  repairedJson: string;
  doc?: RecipeDocument;
  repairs: string[];
  parseError?: string;
  truncated?: boolean;
  continuationPrompt?: string;
}

/**
 * Automatically repairs common AI output formatting issues and safe structural defaults (M12):
 * - Strips markdown code fences (```json ... ```) and leading/trailing prose
 * - Converts smart quotes (“ ” ‘ ’) to straight quotes
 * - Extracts the first balanced `{...}` object, or detects truncated output (unbalanced braces)
 *   with a clear "the AI stopped early, ask it to continue" message and ready continuationPrompt
 * - Strips single-line (//) and block (/* *\/) comments outside strings
 * - Fixes unescaped literal newlines inside JSON string literals
 * - Removes trailing commas before } or ]
 * - Ensures recipe: "v3.1" and meta.part defaults
 * - Removes `enter` preset if layer already has an entrance macro (pop, slam, drop, slide, rise)
 * - Enforces h >= 6 on thin line/rect shapes
 * - Removes `h` if both `w` and `h` are set on an `image` layer
 * - Sets `exit: "none"` on final scene layers ending at duration
 */
export function repairRecipeJson(rawInput: string): RepairResult {
  const repairs: string[] = [];
  let text = rawInput.trim();

  // 1. Strip markdown code fences
  if (text.includes('```')) {
    const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    if (fenceMatch && fenceMatch[1]) {
      text = fenceMatch[1].trim();
      repairs.push('Stripped markdown code fences');
    } else {
      // Opening fence without closing fence (often happens on truncated AI output)
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      repairs.push('Stripped open markdown code fence');
    }
  }

  // 2. Convert smart quotes to straight quotes
  if (/[“”‘’]/.test(text)) {
    text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    repairs.push('Converted smart quotes to straight quotes');
  }

  // 3. Strip comments outside of JSON strings
  const strippedComments = stripJsonCommentsAndFixNewlines(text, repairs);
  text = strippedComments;

  // 4. Extract first balanced {...} or detect truncated output (unbalanced braces)
  const balanceInfo = extractFirstBalancedObject(text);
  if (balanceInfo.truncated) {
    const tailSnippet = text.slice(-Math.min(180, text.length));
    const continuationPrompt = [
      'Your RECIPE v3.1 JSON output was cut off early (unbalanced braces).',
      'Continue the exact JSON from where you stopped, starting immediately after:',
      '```',
      tailSnippet,
      '```',
      'Return only the remaining JSON characters to close the object cleanly, or return the complete corrected JSON.',
    ].join('\n');

    return {
      repairedJson: text,
      repairs,
      truncated: true,
      parseError: 'The AI stopped early (unbalanced braces). Ask it to continue from where it stopped.',
      continuationPrompt,
    };
  }

  if (balanceInfo.extracted !== text) {
    text = balanceInfo.extracted;
    repairs.push('Extracted first balanced JSON object and trimmed surrounding prose');
  }

  // 5. Remove trailing commas before } or ]
  const withoutTrailingCommas = text.replace(/,\s*([}\]])/g, '$1');
  if (withoutTrailingCommas !== text) {
    text = withoutTrailingCommas;
    repairs.push('Removed trailing commas');
  }

  let doc: RecipeDocument;
  try {
    doc = JSON.parse(text) as RecipeDocument;
  } catch (err: any) {
    return {
      repairedJson: text,
      repairs,
      parseError: err?.message ?? 'Invalid JSON syntax',
    };
  }

  if (doc.recipe !== 'v3.1') {
    doc.recipe = 'v3.1';
    repairs.push('Set "recipe" version to "v3.1"');
  }

  if (!doc.meta) {
    doc.meta = {
      w: 1920,
      h: 1080,
      fps: 60,
      duration: 10,
      lang: 'en',
      part: { n: 1, of: 1, from: 0, to: 10 },
    };
    repairs.push('Added default "meta" block');
  }

  const duration = doc.meta.duration ?? doc.meta.part?.to ?? 10;
  if (!doc.meta.part) {
    doc.meta.part = { n: 1, of: 1, from: 0, to: duration };
    repairs.push('Added default "meta.part" range');
  }

  if (Array.isArray(doc.scenes) && doc.scenes.length > 0) {
    const isFinalPart = (doc.meta.part.n ?? 1) === (doc.meta.part.of ?? 1);
    doc.scenes.forEach((scene, sIdx) => {
      const isLastScene = isFinalPart && sIdx === doc.scenes.length - 1;
      if (isLastScene && Array.isArray(scene.t) && typeof scene.t[1] === 'number') {
        if (Math.abs(scene.t[1] - duration) > 0.01 && scene.t[1] > duration) {
          scene.t[1] = duration;
          repairs.push(`Clamped final scene "${scene.id}" end time to duration ${duration}s`);
        }
      }

      const repairLayers = (layers: (Layer | LayerPatch)[]) => {
        for (const item of layers) {
          if ('patch' in item) continue;
          const layer = item as Layer;

          // Remove enter if entrance macro exists
          if (
            layer.enter &&
            layer.enter !== 'none' &&
            Array.isArray(layer.motion) &&
            layer.motion.some((m) => ENTRANCE_MACROS.has(m.m))
          ) {
            delete layer.enter;
            repairs.push(`Removed redundant "enter" preset on layer "${layer.id}" (has entrance macro)`);
          }

          // Enforce thin line h >= 6 px
          if (
            layer.type === 'shape' &&
            (layer.kind === 'rect' || layer.kind === 'line') &&
            typeof layer.h === 'number' &&
            layer.h > 0 &&
            layer.h < 6
          ) {
            layer.h = 6;
            repairs.push(`Raised thin line "${layer.id}" height to minimum 6px`);
          }

          // Image w+h rule
          if ((layer.type === 'image' || layer.type === 'video') && layer.w !== undefined && layer.h !== undefined) {
            delete layer.h;
            repairs.push(`Removed "h" from image layer "${layer.id}" (SPEC: set w only)`);
          }

          // Final scene exit "none"
          if (isLastScene && Array.isArray(layer.t) && typeof layer.t[1] === 'number') {
            if (layer.t[1] > duration) {
              layer.t[1] = duration;
              repairs.push(`Clamped layer "${layer.id}" end time to ${duration}s`);
            }
            if (Math.abs(layer.t[1] - duration) < 0.05 && !layer.exit) {
              layer.exit = 'none';
              repairs.push(`Set exit:"none" on final scene layer "${layer.id}"`);
            }
          }

          if (Array.isArray(layer.children)) {
            repairLayers(layer.children);
          }
        }
      };

      repairLayers(scene.layers || []);
    });
  }

  const formatted = JSON.stringify(doc, null, 2);
  return {
    repairedJson: formatted,
    doc,
    repairs,
    truncated: false,
  };
}

function extractFirstBalancedObject(src: string): { extracted: string; truncated: boolean } {
  const startIdx = src.indexOf('{');
  if (startIdx === -1) {
    return { extracted: src, truncated: false };
  }

  let depth = 0;
  let inStr = false;
  let i = startIdx;

  while (i < src.length) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        inStr = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inStr = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return { extracted: src.slice(startIdx, i + 1), truncated: false };
      }
    }
    i++;
  }

  return {
    extracted: src.slice(startIdx),
    truncated: depth > 0 || inStr,
  };
}

function stripJsonCommentsAndFixNewlines(src: string, repairs: string[]): string {
  let out = '';
  let inStr = false;
  let quote = '"';
  let i = 0;
  let removedComment = false;
  let fixedNewline = false;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (inStr) {
      if (ch === '\\' && i + 1 < src.length) {
        out += ch + src[i + 1];
        i += 2;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && next === '\n') i++;
        out += '\\n';
        fixedNewline = true;
        i++;
        continue;
      }
      out += ch;
      if (ch === quote) {
        inStr = false;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      removedComment = true;
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      removedComment = true;
      i += 2;
      while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }

  if (removedComment) repairs.push('Removed JS comments from JSON');
  if (fixedNewline) repairs.push('Escaped literal newlines inside JSON strings');
  return out;
}
