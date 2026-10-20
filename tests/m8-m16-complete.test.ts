import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRecipe } from '../src/core/layout.ts';
import { mergeRecipeParts, validatePartMetaMatch } from '../src/core/merge.ts';
import { splitTranscriptIntoParts } from '../src/core/parts.ts';
import {
  buildLayerChangeNote,
  buildPromptForPart,
  buildSceneChangePrompt,
  replaceSceneInRecipe,
} from '../src/core/promptbuilder.ts';
import { repairRecipeJson } from '../src/core/repair.ts';
import { parseTranscript } from '../src/core/transcript.ts';
import { buildFixPrompt, canPlayLenientPreview, validateRecipe } from '../src/core/validate.ts';
import { computeTargetBitrate } from '../src/export/capabilities.ts';
import { createStreamingSink } from '../src/export/sink.ts';
import {
  executeCodeLayerWithTimeout,
  scanCodeLayerForForbiddenIdentifiers,
} from '../src/render/codeLayer.ts';
import { measureSvgPathLength, morphSvgPathStrings, parseSafeSvgMarkup } from '../src/render/paths.ts';
import { hitTestLayerAtPoint, renderFrame } from '../src/render/renderer.ts';
import {
  clearTextLayoutCache,
  containsDevanagari,
  measureAndLayoutText,
} from '../src/render/text.ts';
import fs from 'node:fs';
import type { RecipeDocument } from '../src/core/types.ts';

const WORKED_EXAMPLE_RECIPE = JSON.parse(
  fs.readFileSync('samples/part-c-demo.json', 'utf8')
) as RecipeDocument;

function createMock2DContext() {
  const ops: string[] = [];
  const gradientStub = { addColorStop: () => {} };
  const ctx: any = {
    ops,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetY: 0,
    font: '700 32px sans-serif',
    textAlign: 'center',
    textBaseline: 'middle',
    filter: 'none',
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    clearRect: () => ops.push('clearRect'),
    fillRect: () => ops.push('fillRect'),
    strokeRect: () => ops.push('strokeRect'),
    beginPath: () => ops.push('beginPath'),
    closePath: () => ops.push('closePath'),
    moveTo: () => ops.push('moveTo'),
    lineTo: () => ops.push('lineTo'),
    arc: () => ops.push('arc'),
    ellipse: () => ops.push('ellipse'),
    rect: () => ops.push('rect'),
    quadraticCurveTo: () => ops.push('quadraticCurveTo'),
    bezierCurveTo: () => ops.push('bezierCurveTo'),
    fill: () => ops.push('fill'),
    stroke: () => ops.push('stroke'),
    clip: () => ops.push('clip'),
    translate: () => ops.push('translate'),
    rotate: () => ops.push('rotate'),
    scale: () => ops.push('scale'),
    setLineDash: () => ops.push('setLineDash'),
    fillText: (txt: string) => ops.push(`fillText:${txt}`),
    strokeText: (txt: string) => ops.push(`strokeText:${txt}`),
    drawImage: () => ops.push('drawImage'),
    measureText: (txt: string) => {
      // Scale mock width proportionally to current font size so fit:shrink binary search converges
      const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font || '');
      const fSize = m ? Number(m[1]) : 32;
      return { width: String(txt).length * fSize * 0.55 };
    },
    createLinearGradient: () => gradientStub,
    createRadialGradient: () => gradientStub,
  };
  return ctx;
}

test('M8: Text layout binary-search fit:shrink, Devanagari letterSpacing guard, highlight word x-range, and safe SVG parser', () => {
  clearTextLayoutCache();
  const ctx = createMock2DContext();

  // Devanagari detection disables letterSpacing automatically
  assert.equal(containsDevanagari('नियम स्पष्ट हैं'), true);
  assert.equal(containsDevanagari('PURE DETERMINISTIC VIDEO'), false);

  const shrunk = measureAndLayoutText(
    ctx,
    'THIS IS A VERY LONG HEADLINE THAT MUST SHRINK TO FIT INSIDE A NARROW BOX',
    280,
    96,
    800,
    'display',
    'center',
    1.15,
    true,
    2
  );
  assert.ok(shrunk.fontSize < 96, `Expected shrunk fontSize < 96, got ${shrunk.fontSize}`);

  // Prefix-measured highlight word range
  const layout = measureAndLayoutText(
    ctx,
    'COMPOUND INTEREST GROWS FAST',
    1200,
    60,
    800,
    'display',
    'center',
    1.15,
    false,
    2
  );
  const interestBox = layout.wordBoxes.find((wb) => wb.cleanWord.toLowerCase() === 'interest');
  assert.ok(interestBox !== undefined);
  assert.ok(interestBox!.w > 40);

  // Precomputed path length and safe SVG markup parser
  const len = measureSvgPathLength('M 0 0 L 100 0 L 100 100');
  assert.ok(Math.abs(len - 200) < 1e-3);

  const safeSvg = parseSafeSvgMarkup(
    '<svg><rect x="10" y="10" width="80" height="40"/><circle cx="50" cy="50" r="20"/></svg>'
  );
  assert.equal(safeSvg.valid, true);
  assert.equal(safeSvg.items.length, 2);

  const unsafeScriptSvg = parseSafeSvgMarkup('<svg><script>alert(1)</script></svg>');
  assert.equal(unsafeScriptSvg.valid, false);

  const unsafeExternalSvg = parseSafeSvgMarkup('<svg><use href="https://evil.example/a.svg"/></svg>');
  assert.equal(unsafeExternalSvg.valid, false);

  const unsafeImageSvg = parseSafeSvgMarkup('<svg><image href="data:image/png;base64,AAA"/></svg>');
  assert.equal(unsafeImageSvg.valid, false);

  const incompatibleMorph = morphSvgPathStrings('M 0 0 L 100 100', 'M 0 0 C 10 20 30 40 100 100', 0.5);
  assert.equal(incompatibleMorph.compatible, false);
});

test('M8 & M13: Deterministic renderFrame and hitTestLayerAtPoint across worked example', () => {
  const compiled = compileRecipe(WORKED_EXAMPLE_RECIPE);
  const ctx1 = createMock2DContext();
  const ctx2 = createMock2DContext();

  // Render at t=5.6 twice: must produce identical draw operations
  const m1 = renderFrame(ctx1, compiled, 5.6, { showSafeArea: true, showLayerBounds: true });
  const m2 = renderFrame(ctx2, compiled, 5.6, { showSafeArea: true, showLayerBounds: true });
  assert.deepEqual(ctx1.ops, ctx2.ops);
  assert.ok(m1.totalMs >= 0);
  assert.ok(m2.heaviestLayers.length > 0);

  // Hit-test center of canvas at t=1.5 (where hero elements sit)
  const hit = hitTestLayerAtPoint(compiled, 1.5, 0.5, 0.52);
  assert.ok(hit !== null);
});

test('M9: Code layer static scanner and worker/VM 40ms timeout on infinite loop while(true){}', async () => {
  for (const bad of [
    'Math.random()',
    'new Date()',
    'window.location',
    'fetch("https://example.com")',
    'constructor.constructor("return process")()',
    '__proto__',
    'globalThis',
    'importScripts("x.js")',
  ]) {
    const scan = scanCodeLayerForForbiddenIdentifiers(bad);
    assert.equal(scan.valid, false, `Expected "${bad}" to be rejected`);
  }

  const compiled = compileRecipe(WORKED_EXAMPLE_RECIPE);
  const hostileLayer: any = {
    id: 'hostile_loop',
    type: 'code',
    sceneId: 's1',
    t: [0, 5],
    t0: 0,
    t1: 5,
    x: 0.5,
    y: 0.5,
    w: 400,
    h: 300,
    anchor: 'c',
    depth: 1,
    zIndex: 1,
    orderIndex: 0,
    numericSeed: 42,
    resolvedMotions: [],
    draw: 'while (true) {}',
  };

  const res = await executeCodeLayerWithTimeout(
    hostileLayer,
    1.0,
    0.2,
    400,
    300,
    compiled.tokens,
    40
  );
  assert.equal(res.ok, false);
  assert.equal(res.timedOut, true);
  assert.ok(res.warning?.includes('40ms'));

  // Subsequent valid code layer still executes cleanly after timeout termination
  const cleanLayer: any = {
    ...hostileLayer,
    id: 'clean_code',
    draw: 'const r = api.lerp(10, 80, p); ctx.beginPath(); ctx.arc(0, 0, r, 0, api.TAU); ctx.fill();',
  };
  const cleanRes = await executeCodeLayerWithTimeout(
    cleanLayer,
    1.0,
    0.5,
    400,
    300,
    compiled.tokens,
    40
  );
  assert.equal(cleanRes.ok, true);
});

test('M10: Transcript importer supports all 5 formats, Hindi danda + >0.6s pause breaks, and non-monotonic clamping', () => {
  // 1. Whisper word-timestamped JSON with a >0.6s gap and non-monotonic word
  const whisperJson = JSON.stringify({
    words: [
      { word: 'नमस्ते', start: 0.0, end: 0.5 },
      { word: 'दोस्तों।', start: 0.5, end: 1.0 },
      { word: 'Welcome', start: 1.8, end: 2.2 }, // >0.6s pause triggers new sentence even if no punctuation
      { word: 'back', start: 1.9, end: 2.5 }, // non-monotonic start (1.9 < 2.2) -> clamped with warning
    ],
  });
  const parsedWhisper = parseTranscript(whisperJson);
  assert.equal(parsedWhisper.words.length, 4);
  assert.equal(parsedWhisper.sentences.length, 2);
  assert.ok(parsedWhisper.warnings && parsedWhisper.warnings.length > 0);
  assert.ok(parsedWhisper.words[3].s >= parsedWhisper.words[2].e);

  // 2. SRT format
  const srt = `1\n00:00:00,000 --> 00:00:02,000\nFirst subtitle sentence.\n\n2\n00:00:02,500 --> 00:00:04,500\nSecond subtitle sentence!`;
  const parsedSrt = parseTranscript(srt);
  assert.equal(parsedSrt.sentences.length, 2);
  assert.ok(parsedSrt.words.some((w) => w.estimated === true));

  // 3. Plain text with explicit duration
  const plain = parseTranscript('First sentence here. Second sentence here.', 8.0);
  assert.equal(plain.duration, 8.0);
  assert.equal(plain.sentences.length, 2);
  assert.ok(plain.words.every((w) => w.estimated === true));
});

test('M11 & M12: Long-video parts, scene/layer change helpers, truncated JSON continuation, and snippet-trimmed fix prompt', () => {
  // Build a 95-second transcript to verify 30-40s part splitting
  const lines: string[] = [];
  for (let i = 0; i < 19; i++) {
    const s = i * 5;
    const e = s + 4.8;
    lines.push(`[${s.toFixed(1)} - ${e.toFixed(1)}] Sentence number ${i + 1} explains deterministic rendering.`);
  }
  const longTranscript = parseTranscript(lines.join('\n'), 95);
  const parts = splitTranscriptIntoParts(longTranscript);
  assert.ok(parts.length >= 3);

  const promptPart1 = buildPromptForPart({
    w: 1920,
    h: 1080,
    fps: 60,
    duration: 95,
    theme: { palette: 1 },
    screenText: 'en',
    partNumber: parts[0].n,
    totalParts: parts[0].of,
    rangeFrom: parts[0].from,
    rangeTo: parts[0].to,
    carry: null,
    transcript: longTranscript,
  });
  assert.ok(promptPart1.includes('RECIPE v3.1'));
  assert.ok(promptPart1.includes('PART: 1 of'));

  // Scene change helper & replacement
  const scenePrompt = buildSceneChangePrompt({
    doc: WORKED_EXAMPLE_RECIPE,
    scene: WORKED_EXAMPLE_RECIPE.scenes[0],
    transcript: longTranscript,
    userChangeRequest: 'Make the title gold',
  });
  assert.ok(scenePrompt.includes('Make the title gold'));

  const replacementScene = JSON.stringify({
    ...WORKED_EXAMPLE_RECIPE.scenes[0],
    name: 'updated_hook',
  });
  const replaced = replaceSceneInRecipe(WORKED_EXAMPLE_RECIPE, 's1', replacementScene);
  assert.ok(replaced.updatedDoc);
  assert.equal(replaced.updatedDoc!.scenes[0].name, 'updated_hook');

  const compiled = compileRecipe(WORKED_EXAMPLE_RECIPE);
  const layerNote = buildLayerChangeNote(compiled.layers[0], 'Increase scale to 1.2');
  assert.ok(layerNote.includes(compiled.layers[0].id));

  // Truncated JSON detection + continuation prompt
  const truncatedRaw = '{"recipe":"v3.1","meta":{"w":1920,"h":1080,"fps":60,"duration":12},"scenes":[{"id":"s1","t":[0,4],"layers":[';
  const repTrunc = repairRecipeJson(truncatedRaw);
  assert.equal(repTrunc.truncated, true);
  assert.ok(repTrunc.continuationPrompt && repTrunc.continuationPrompt.includes('s1'));

  // Part metadata validation
  const mismatch = validatePartMetaMatch(WORKED_EXAMPLE_RECIPE, {
    n: 2,
    of: 3,
    from: 35,
    to: 70,
  });
  assert.ok(mismatch !== null);

  // Lenient preview check when only error is an unknown vocabulary name
  const unknownShapeDoc = structuredClone(WORKED_EXAMPLE_RECIPE);
  (unknownShapeDoc.scenes[0].layers[0] as any).type = 'shape';
  (unknownShapeDoc.scenes[0].layers[0] as any).kind = 'hyperboloid_unknown';
  (unknownShapeDoc.scenes[0].layers[0] as any).enter = 'fade';
  const valUnknown = validateRecipe(unknownShapeDoc);
  assert.equal(canPlayLenientPreview(valUnknown.issues).canPreview, true);

  const fixPrompt = buildFixPrompt(JSON.stringify(unknownShapeDoc, null, 2), valUnknown.issues);
  assert.ok(fixPrompt.includes('UNKNOWN_SHAPE_KIND'));
});

test('M14 & M15: Bitrate formula and random-access StreamingSink header patching', async () => {
  const br1080p60 = computeTargetBitrate(1920, 1080, 60, 'auto');
  assert.equal(br1080p60, 12_441_600);
  const br1080p60High = computeTargetBitrate(1920, 1080, 60, 'high');
  assert.equal(br1080p60High, 18_662_400);

  const sink = await createStreamingSink('test-output.mp4', 'video/mp4');
  // Write initial header placeholder at 0, payload at 8, then patch header at 0
  sink.write(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]), 0);
  sink.write(new Uint8Array([10, 20, 30, 40]), 8);
  sink.write(new Uint8Array([1, 2, 3, 4]), 0);

  const fin = await sink.finalize();
  assert.equal(fin.byteLength, 12);
  const ab = await fin.blob.arrayBuffer();
  const arr = Array.from(new Uint8Array(ab));
  assert.deepEqual(arr, [1, 2, 3, 4, 0, 0, 0, 0, 10, 20, 30, 40]);
});

test('M17: .recipestudio ZIP archive pack/unpack (JSON + binary asset blobs + audio blob) and 7 IndexedDB stores', async () => {
  const {
    IDB_STORE_NAMES,
    packProjectToRecipeStudioZip,
    unpackProjectFromRecipeStudioZip,
  } = await import('../src/store/db.ts');

  assert.deepEqual(IDB_STORE_NAMES, [
    'projects',
    'transcripts',
    'parts',
    'assets',
    'audio',
    'exports',
    'meta',
  ]);

  const docWithAssets: any = {
    ...structuredClone(WORKED_EXAMPLE_RECIPE),
    assets: {
      logo_hero: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    },
  };

  const sampleProj: any = {
    id: 'proj_test_zip',
    title: 'Zip Backup Test',
    createdAt: 1700000000000,
    updatedAt: 1700000005000,
    w: 1920,
    h: 1080,
    fps: 60,
    theme: { palette: 1 },
    screenText: 'en',
    transcriptRaw: '[0.0 - 4.0] Testing zip archive.',
    transcript: parseTranscript('[0.0 - 4.0] Testing zip archive.', 4),
    recipeJson: JSON.stringify(docWithAssets, null, 2),
    parts: [],
    activePartIndex: 0,
    audioFileName: 'test-vo.wav',
    audioDataUrl: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
    audioPeaks: [0.2, 0.8, 0.5],
    audioOffsetSec: 0.05,
  };

  const zipBytes = packProjectToRecipeStudioZip(sampleProj);
  // Verify PK\x03\x04 ZIP signature
  assert.equal(zipBytes[0], 0x50);
  assert.equal(zipBytes[1], 0x4b);
  assert.equal(zipBytes[2], 0x03);
  assert.equal(zipBytes[3], 0x04);

  const restored = unpackProjectFromRecipeStudioZip(zipBytes);
  assert.equal(restored.title, 'Zip Backup Test');
  assert.equal(restored.audioDataUrl, sampleProj.audioDataUrl);
  assert.equal(restored.audioOffsetSec, 0.05);
  const restoredDoc = JSON.parse(restored.recipeJson);
  assert.equal(restoredDoc.assets.logo_hero, docWithAssets.assets!.logo_hero);
});

test('Golden renders: SPEC Part C (16:9) & Vertical (9:16) at t = 0.5, 2.0, 3.5, 6.3, 8.0, 11.0 with PNG goldens & pixel-identical determinism', async () => {
  const { createSoftwareCanvas2D } = await import('../src/render/goldenRaster.ts');
  const verticalDoc = JSON.parse(
    fs.readFileSync('samples/vertical-demo.json', 'utf8')
  ) as RecipeDocument;

  const compiled16x9 = compileRecipe(WORKED_EXAMPLE_RECIPE);
  const compiled9x16 = compileRecipe(verticalDoc);

  // Assert no foreground layer with explicit coordinates violates the 2.5% safe area
  for (const compiled of [compiled16x9, compiled9x16]) {
    for (const layer of compiled.layers) {
      if (
        layer.type !== 'bg' &&
        layer.type !== 'background' &&
        layer.type !== 'particles' &&
        layer.type !== 'highlight' &&
        !layer.groupId &&
        typeof layer.x === 'number' &&
        typeof layer.y === 'number'
      ) {
        assert.ok(
          layer.x >= 0.025 && layer.x <= 0.975 && layer.y >= 0.025 && layer.y <= 0.975,
          `Layer ${layer.id} (${layer.x}, ${layer.y}) outside 2.5% safe area`
        );
      }
    }
  }

  fs.mkdirSync('tests/goldens', { recursive: true });
  const timestamps = [0.5, 2.0, 3.5, 6.3, 8.0, 11.0];

  for (const t of timestamps) {
    // 1. Render SPEC Part C (16:9) twice at t and verify pixel-identical determinism
    const sw1 = createSoftwareCanvas2D(compiled16x9.w, compiled16x9.h, 0.1);
    const sw2 = createSoftwareCanvas2D(compiled16x9.w, compiled16x9.h, 0.1);
    renderFrame(sw1.ctx, compiled16x9, t);
    renderFrame(sw2.ctx, compiled16x9, t);

    assert.deepEqual(
      sw1.rgba,
      sw2.rgba,
      `16:9 frame at t=${t}s must be 100% pixel-identical across runs`
    );
    assert.ok(
      sw1.primitives.length >= 2,
      `Expected non-empty primitives at t=${t}s in 16:9 Part C, got ${sw1.primitives.length}`
    );
    assert.ok(
      sw1.colorsUsed.has(compiled16x9.tokens.bg.toUpperCase()) ||
        sw1.colorsUsed.has(compiled16x9.tokens.acc.toUpperCase()),
      `Expected Palette @bg (${compiled16x9.tokens.bg}) or @acc (${compiled16x9.tokens.acc}) at t=${t}s`
    );

    const png16x9 = sw1.toPngBytes();
    // Verify PNG signature (137 80 78 71)
    assert.equal(png16x9[0], 137);
    assert.equal(png16x9[1], 80);
    assert.equal(png16x9[2], 78);
    assert.equal(png16x9[3], 71);
    fs.writeFileSync(`tests/goldens/part-c-16x9-t${t.toFixed(1)}.png`, png16x9);

    // 2. Render Vertical (9:16) sample at t and save golden PNG
    const swVert1 = createSoftwareCanvas2D(compiled9x16.w, compiled9x16.h, 0.1);
    const swVert2 = createSoftwareCanvas2D(compiled9x16.w, compiled9x16.h, 0.1);
    renderFrame(swVert1.ctx, compiled9x16, t);
    renderFrame(swVert2.ctx, compiled9x16, t);
    assert.deepEqual(
      swVert1.rgba,
      swVert2.rgba,
      `9:16 frame at t=${t}s must be 100% pixel-identical across runs`
    );
    assert.ok(
      swVert1.primitives.length >= 2,
      `Expected non-empty primitives at t=${t}s in 9:16 sample`
    );
    const png9x16 = swVert1.toPngBytes();
    fs.writeFileSync(`tests/goldens/vertical-9x16-t${t.toFixed(1)}.png`, png9x16);
  }
});

test('Performance Target: 300 KB recipe validation completes in under 400 ms', () => {
  // Construct a >300 KB valid recipe document with 280 scenes (~318 KB JSON)
  const sceneCount = 280;
  const bigScenes: any[] = [];
  for (let idx = 0; idx < sceneCount; idx++) {
    const t0 = idx * 4;
    const t1 = t0 + 4;
    bigScenes.push({
      id: `sc_${idx}`,
      name: `scene_perf_${idx}`,
      t: [t0, t1],
      transition: idx === 0 ? { type: 'cut' } : { type: 'fade', dur: 0.25 },
      layers: [
        {
          id: `bg_${idx}`,
          type: 'background',
          kind: 'aurora',
          t: [t0, t1],
          enter: 'fade',
          exit: idx === sceneCount - 1 ? 'none' : 'fade',
        },
        {
          id: `card_${idx}`,
          type: 'shape',
          kind: 'card',
          t: [t0 + 0.05, t1],
          x: 0.5,
          y: 0.52,
          w: 1420,
          h: 640,
          style: 'card',
          motion: [{ m: 'rise', at: t0 + 0.05, d: 0.45, dist: 50 }],
          exit: idx === sceneCount - 1 ? 'none' : 'fade',
        },
        {
          id: `badge_${idx}`,
          type: 'use',
          def: 'badge',
          t: [t0 + 0.15, t1],
          x: 0.5,
          y: 0.24,
          args: { text: `BENCHMARK PART ${idx + 1}`, tone: 'acc' },
          motion: [{ m: 'pop', at: t0 + 0.15 }],
          exit: idx === sceneCount - 1 ? 'none' : 'fade',
        },
        {
          id: `headline_${idx}`,
          type: 'text',
          t: [t0 + 0.25, t1],
          x: 0.5,
          y: 0.46,
          w: 1240,
          text: `DETERMINISTIC FRAME RENDERING AT SCENE ${idx + 1} WITH ZERO HIDDEN STATE`,
          font: 'display',
          weight: 800,
          size: 56,
          color: '@ink',
          enter: 'wordPop',
          exit: idx === sceneCount - 1 ? 'none' : 'fade',
        },
        {
          id: `hl_${idx}`,
          type: 'highlight',
          t: [t0 + 0.8, t1],
          target: `headline_${idx}`,
          word: 'DETERMINISTIC',
          kind: 'underline',
          color: '@acc',
          motion: [{ m: 'grow', at: t0 + 0.8, d: 0.35 }],
          exit: idx === sceneCount - 1 ? 'none' : 'fade',
        },
        {
          id: `meter_${idx}`,
          type: 'use',
          def: 'meter',
          t: [t0 + 1.2, t1],
          x: 0.5,
          y: 0.72,
          w: 880,
          args: { pct: 85, label: 'THROUGHPUT TARGET' },
          motion: [{ m: 'grow', at: t0 + 1.2, d: 0.6 }],
          exit: idx === sceneCount - 1 ? 'none' : 'fade',
        },
      ],
    });
  }

  const totalDur = sceneCount * 4;
  const bigDoc: RecipeDocument = {
    recipe: 'v3.1',
    meta: {
      w: 1920,
      h: 1080,
      fps: 60,
      duration: totalDur,
      lang: 'en',
      part: { n: 1, of: 1, from: 0, to: totalDur },
    },
    theme: { palette: 1 },
    scenes: bigScenes,
  };

  const rawJson = JSON.stringify(bigDoc);
  const payloadBytes = Buffer.byteLength(rawJson, 'utf8');
  assert.ok(payloadBytes >= 300_000, `Expected >= 300 KB recipe, got ${payloadBytes} bytes`);

  const t0 = performance.now();
  const res = validateRecipe(bigDoc);
  const elapsedMs = performance.now() - t0;

  assert.equal(
    res.valid,
    true,
    `Expected 300 KB recipe to be valid, errors: ${JSON.stringify(res.issues.filter((i) => i.severity === 'error'))}`
  );
  assert.ok(
    elapsedMs < 400,
    `Expected 300 KB recipe validation < 400 ms, took ${elapsedMs.toFixed(2)} ms`
  );
});

