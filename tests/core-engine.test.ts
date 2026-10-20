import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ease, mulberry32 } from '../src/core/ease.ts';
import { evaluateExpression, validateExpression } from '../src/core/expr.ts';
import { evaluateNumericTrack, parseKeyframeTrack } from '../src/core/keyframes.ts';
import { compileRecipe } from '../src/core/layout.ts';
import { evaluateLayerMotions, expandMacroToKeyframes } from '../src/core/macros.ts';
import { mergeRecipeParts } from '../src/core/merge.ts';
import { expandThemeTokens } from '../src/core/palette.ts';
import { splitTranscriptIntoParts } from '../src/core/parts.ts';
import { repairRecipeJson } from '../src/core/repair.ts';
import { frameToTime, queryActiveLayersAtTime, resolveTimeValue, timeToFrame } from '../src/core/time.ts';
import { DEMO_HINGLISH_TRANSCRIPT, parseTranscript } from '../src/core/transcript.ts';
import type { RecipeDocument } from '../src/core/types.ts';
import { buildFixPrompt, validateRecipe } from '../src/core/validate.ts';

test('Anchor resolution and integer frame clock', () => {
  const transcript = parseTranscript(DEMO_HINGLISH_TRANSCRIPT, 11.76);
  assert.equal(transcript.sentences.length, 3);
  assert.ok(transcript.words.length > 15);

  const s0 = resolveTimeValue('s0', transcript);
  assert.equal(s0.valid, true);
  assert.equal(s0.seconds, 0);

  const s1eOffset = resolveTimeValue('s1e+0.2', transcript);
  assert.equal(s1eOffset.valid, true);
  assert.ok(Math.abs(s1eOffset.seconds - 7.3) < 0.01);

  const badWord = resolveTimeValue('w999', transcript);
  assert.equal(badWord.valid, false);
  assert.ok(badWord.error?.includes('w999'));

  assert.equal(frameToTime(30, 60), 0.5);
  assert.equal(timeToFrame(0.5, 60), 30);
});

test('Easings, compact keyframes, and deterministic expressions', () => {
  assert.equal(ease('linear', 0.5), 0.5);
  assert.ok(ease('outBack', 0.6) > 1.0); // overshoot
  assert.ok(ease('bezier(0.25,0.1,0.25,1)', 0.5) > 0.5);
  assert.ok(ease('spring(180,12,1)', 1.0) === 1);

  const keys = parseKeyframeTrack('0.5@0 1.12@0.19:outBack 1@0.3');
  assert.equal(keys.length, 3);
  assert.equal(evaluateNumericTrack(keys, 0, 1), 0.5);
  assert.equal(evaluateNumericTrack(keys, 0.3, 1), 1);

  const exprCheck = validateExpression('0.5 + 0.02 * sin(t * 3)');
  assert.equal(exprCheck.valid, true);
  const badExpr = validateExpression('window.location');
  assert.equal(badExpr.valid, false);

  const val = evaluateExpression('0.5 + 0.1 * sin(0)', {
    t: 0, p: 0, T: 0, d: 2, i: 0, n: 1, w: 1920, h: 1080, seed: 42,
  });
  assert.equal(val, 0.5);

  // Seeded PRNG determinism
  const r1 = mulberry32(12345);
  const r2 = mulberry32(12345);
  assert.equal(r1(), r2());
  assert.equal(r1(), r2());
});

test('Motion macros expand to keyframes and chain overlapping `to` moves smoothly', () => {
  const popKeys = expandMacroToKeyframes({ m: 'pop', at: 1.0, from: 0.5, over: 1.15, dur: 0.3 }, 1.0);
  assert.equal(popKeys.scale.length, 3);
  assert.equal(popKeys.scale[1].v, 1.15);

  const doc: RecipeDocument = {
    recipe: 'v3.1',
    meta: { w: 1920, h: 1080, fps: 60, duration: 5, part: { n: 1, of: 1, from: 0, to: 5 } },
    scenes: [
      {
        id: 's1',
        t: [0, 5],
        layers: [
          {
            id: 'box',
            type: 'shape',
            kind: 'rect',
            t: [0, 5],
            x: 0.2,
            y: 0.5,
            w: 200,
            h: 100,
            exit: 'none',
            motion: [
              { m: 'to', at: 1.0, dur: 1.0, x: 0.6, ease: 'linear' },
              { m: 'to', at: 1.5, dur: 1.0, x: 0.8, ease: 'linear' },
            ],
          },
        ],
      },
    ],
  };

  const compiled = compileRecipe(doc);
  const layer = compiled.layersById.get('box')!;
  // At t=1.5, first `to` is halfway from 0.2 to 0.6 -> 0.4 (dx = +0.2)
  const mid = evaluateLayerMotions(layer, 1.5, 1920, 1080);
  assert.ok(Math.abs(mid.dx - 0.2) < 0.01);
  // At t=2.5, both `to` moves have completed -> x = 0.8 (dx = +0.6)
  const end = evaluateLayerMotions(layer, 2.5, 1920, 1080);
  assert.ok(Math.abs(end.dx - 0.6) < 0.01);
});

test('Theme palettes 1-5 and custom hex HSL expansion', () => {
  const p1 = expandThemeTokens({ palette: 1 });
  assert.equal(p1.acc, '#FF3DB8');
  assert.equal(p1.bg, '#0C0612');

  // Custom orange hex should switch warn to #FFC23D per SPEC Part D 4
  const customOrange = expandThemeTokens({ hex: '#FF7A00' });
  assert.equal(customOrange.acc, '#FF7A00');
  assert.equal(customOrange.warn, '#FFC23D');

  // Custom blue hex keeps warn as #FF4D5A
  const customBlue = expandThemeTokens({ hex: '#0088FF' });
  assert.equal(customBlue.warn, '#FF4D5A');
});

test('Sample recipes validate cleanly and compile into deterministic interval index', () => {
  for (const file of ['samples/part-c-demo.json', 'samples/vertical-demo.json', 'samples/stress-5min.json']) {
    const raw = fs.readFileSync(file, 'utf8');
    const res = validateRecipe(raw);
    const errs = res.issues.filter((i) => i.severity === 'error');
    assert.equal(errs.length, 0, `Unexpected validation errors in ${file}: ${JSON.stringify(errs)}`);

    const compiled = compileRecipe(res.doc!);
    assert.ok(compiled.layers.length > 5);
    const activeMid = queryActiveLayersAtTime(compiled.intervalSorted, compiled.duration * 0.5, compiled.duration);
    assert.ok(activeMid.length > 0);
  }
});

test('Validator catches forbidden code identifiers, unknown vocabulary, and fractional sizes, and repair fixes common mistakes', () => {
  const dirtyRaw = '```json\n' + JSON.stringify({
    recipe: 'v3.0',
    meta: { w: 1920, h: 1080, fps: 60, duration: 4 },
    scenes: [
      {
        id: 's1',
        t: [0, 4],
        layers: [
          {
            id: 'badLine',
            type: 'shape',
            kind: 'rect',
            t: [0, 4],
            x: 0.5,
            y: 0.5,
            w: 300,
            h: 2, // too thin (< 6px), also fractional size trigger if <=4
            fill: '@acc',
            enter: 'fade',
            motion: [{ m: 'pop', at: 0 }],
          },
        ],
      },
    ],
  }) + '\n```';

  const repaired = repairRecipeJson(dirtyRaw);
  assert.ok(repaired.repairs.length >= 3);
  const valAfterRepair = validateRecipe(repaired.repairedJson);
  assert.equal(valAfterRepair.valid, true);

  // Test forbidden identifier in code layer
  const badCodeDoc: RecipeDocument = {
    recipe: 'v3.1',
    meta: { w: 1920, h: 1080, fps: 60, duration: 4, part: { n: 1, of: 1, from: 0, to: 4 } },
    scenes: [
      {
        id: 's1',
        t: [0, 4],
        layers: [
          {
            id: 'c1',
            type: 'code',
            t: [0, 4],
            draw: 'const r = Math.random(); ctx.fillRect(0,0,w*r,h);',
          },
        ],
      },
    ],
  };
  const codeVal = validateRecipe(badCodeDoc);
  assert.equal(codeVal.valid, false);
  assert.ok(codeVal.issues.some((i) => i.code === 'FORBIDDEN_CODE_IDENTIFIER'));
  const fixPrompt = buildFixPrompt(codeVal.issues);
  assert.ok(fixPrompt.includes('FORBIDDEN_CODE_IDENTIFIER'));
});

test('Long video part splitting and continuation merging with carry.persist and patch', () => {
  const longText = Array.from({ length: 12 })
    .map((_, i) => `[${i * 10}.00 - ${(i + 1) * 10}.00] Sentence number ${i + 1} explains part of the system.`)
    .join('\n');
  const tr = parseTranscript(longText, 120);
  const parts = splitTranscriptIntoParts(tr);
  assert.ok(parts.length >= 3);
  assert.equal(parts[0].from, 0);
  assert.equal(parts[parts.length - 1].to, 120);

  const part1: RecipeDocument = {
    recipe: 'v3.1',
    meta: { w: 1920, h: 1080, fps: 60, duration: 76, part: { n: 1, of: 2, from: 0, to: 38 } },
    theme: { palette: 1 },
    scenes: [
      {
        id: 's1',
        t: [0, 38],
        layers: [
          { id: 'hdr', type: 'text', t: [0, 38], x: 0.5, y: 0.15, w: 600, text: 'Header', size: 64, exit: 'none' },
        ],
      },
    ],
    carry: { persist: [{ id: 'hdr', until: 'open' }], last: ['statement'] },
  };

  const part2: RecipeDocument = {
    recipe: 'v3.1',
    meta: { part: { n: 2, of: 2, from: 38, to: 76 } },
    scenes: [
      {
        id: 's2',
        t: [38, 76],
        layers: [
          { patch: 'hdr', motion: [{ m: 'to', at: 40, y: 0.08, scale: 0.6 }], t: [null, 76] },
          { id: 'b2', type: 'shape', kind: 'card', t: [38.2, 76], x: 0.5, y: 0.55, w: 800, h: 400, exit: 'none' },
        ],
      },
    ],
  };

  const merged = mergeRecipeParts([part1, part2]);
  assert.equal(merged.scenes.length, 2);
  const compiled = compileRecipe(merged);
  const hdrLayer = compiled.layersById.get('hdr')!;
  assert.equal(hdrLayer.t1, 76);
  assert.equal(hdrLayer.resolvedMotions.length, 1);
});
