import assert from 'node:assert/strict';
import test from 'node:test';
import { expandUseLayer } from '../src/core/components/index.ts';
import { ease } from '../src/core/ease.ts';
import { compileExpression, evaluateExpression, validateExpression } from '../src/core/expr.ts';
import { evaluateColorTrack, evaluateNumericTrack, parseKeyframeTrack } from '../src/core/keyframes.ts';
import { applyGroupLayout, compileRecipe, flattenRecipeDocument, getAnchorOffsetFactors } from '../src/core/layout.ts';
import { evaluateLayerMotions } from '../src/core/macros.ts';
import { expandThemeTokens, interpolateHexColor, PALETTE_TABLE } from '../src/core/palette.ts';
import { applyStyleToLayer } from '../src/core/styles.ts';
import type { CompiledLayer, RecipeDocument } from '../src/core/types.ts';
import { validateRecipe } from '../src/core/validate.ts';
import { morphSvgPathStrings } from '../src/render/paths.ts';

function makeDummyLayer(overrides: Partial<CompiledLayer> = {}): CompiledLayer {
  return {
    id: 'test_layer',
    type: 'shape',
    kind: 'rect',
    t0: 0,
    t1: 10,
    x: 0.5,
    y: 0.5,
    w: 200,
    h: 100,
    scale: 1,
    rot: 0,
    opacity: 1,
    sceneId: 's1',
    sceneT0: 0,
    sceneT1: 10,
    orderIndex: 0,
    zIndex: 0,
    resolvedMotions: [],
    numericSeed: 12345,
    ...overrides,
  };
}

test('M3: Easings, bezier, spring, linear RGB color interpolation, path morphing, and Pratt parser with hostile inputs', () => {
  // Parametric bezier & spring determinism
  const b1 = ease('bezier(0.25, 0.1, 0.25, 1.0)', 0.5);
  const b2 = ease('bezier(0.25, 0.1, 0.25, 1.0)', 0.5);
  assert.equal(b1, b2);
  assert.ok(b1 > 0.7 && b1 < 0.9);

  const sp1 = ease('spring(200, 14, 1)', 0.4);
  const sp2 = ease('spring(200, 14, 1)', 0.4);
  assert.equal(sp1, sp2);

  // Hold before first and after last keyframe
  const track = parseKeyframeTrack(['10@1', '50@3:linear']);
  assert.equal(evaluateNumericTrack(track, 0.2, 0), 10);
  assert.equal(evaluateNumericTrack(track, 2.0, 0), 30);
  assert.equal(evaluateNumericTrack(track, 5.0, 0), 50);

  // Linear RGB color interpolation (brighter midtone than naive sRGB)
  const midLinear = interpolateHexColor('#000000', '#FFFFFF', 0.5);
  // 0.5^(1/2.2) * 255 = ~186 (#BA)
  assert.equal(midLinear, '#BABABA');

  const colorTrack = parseKeyframeTrack(['#000000@0', '#FFFFFF@2:linear']);
  assert.equal(evaluateColorTrack(colorTrack, 1.0, PALETTE_TABLE[1], '#000000'), '#BABABA');

  // Path command morphing
  const morphed = morphSvgPathStrings('M 0 0 L 100 0', 'M 0 100 L 100 100', 0.5);
  assert.equal(morphed.compatible, true);
  assert.equal(morphed.d, 'M0 50 L100 50');

  // Pratt parser: operators, precedence, comparisons, ternary, and closure caching
  const ctx = { t: 2, p: 0.5, T: 2, d: 4, i: 1, n: 5, w: 1920, h: 1080, seed: 42 };
  const fnA = compileExpression('p >= 0.5 ? 2 + 3 * 4 ^ 2 : 0');
  const fnB = compileExpression('p >= 0.5 ? 2 + 3 * 4 ^ 2 : 0');
  assert.equal(fnA, fnB, 'compileExpression must cache compiled closures');
  assert.equal(fnA(ctx), 50); // 2 + 3 * 16 = 50
  assert.equal(evaluateExpression('t < 1 ? 10 : t == 2 ? 20 : 30', ctx), 20);
  assert.equal(evaluateExpression('i != 0 ? max(10, min(50, w / 64)) : -5', ctx), 30);

  // Hostile inputs MUST be rejected by validateExpression / compileExpression
  const hostileInputs = [
    'constructor',
    '__proto__',
    'process.env',
    'window.location',
    'globalThis',
    'eval("1+1")',
    'Function("return 1")()',
    'while(1){}',
    'for(;;){}',
    't.constructor',
    't[0]',
    'a = 5',
  ];
  for (const bad of hostileInputs) {
    const res = validateExpression(bad);
    assert.equal(res.valid, false, `Hostile expression "${bad}" must be rejected`);
  }
});

test('M4: All 21 motion macros with exact numeric expectations at multiple timestamps + overlapping `to` chaining', () => {
  // 1. pop
  const lPop = makeDummyLayer({
    resolvedMotions: [{ m: 'pop', at: 1, atSec: 1, from: 0.4, over: 1.2, dur: 0.4 }],
  });
  assert.equal(evaluateLayerMotions(lPop, 0.5, 1920, 1080).opacityMult, 0);
  assert.ok(evaluateLayerMotions(lPop, 1.252, 1920, 1080).scaleMult > 1.15);
  assert.equal(evaluateLayerMotions(lPop, 1.5, 1920, 1080).scaleMult, 1);

  // 2. slam (with burst ring)
  const lSlam = makeDummyLayer({
    resolvedMotions: [{ m: 'slam', at: 0, atSec: 0, from: 1.8, dur: 0.3, burst: true }],
  });
  assert.ok(evaluateLayerMotions(lSlam, 0.05, 1920, 1080).scaleMult > 1.0);
  assert.equal(evaluateLayerMotions(lSlam, 0.25, 1920, 1080).burstRings.length, 1);
  assert.equal(evaluateLayerMotions(lSlam, 0.4, 1920, 1080).scaleMult, 1);

  // 3. drop
  const lDrop = makeDummyLayer({
    resolvedMotions: [{ m: 'drop', at: 0, atSec: 0, dist: 216, dur: 0.4 }],
  });
  assert.ok(Math.abs(evaluateLayerMotions(lDrop, -0.1, 1920, 1080).dy - -0.2) < 1e-6);
  assert.ok(Math.abs(evaluateLayerMotions(lDrop, 0.28, 1920, 1080).dy - 0.009) < 1e-4);
  assert.equal(evaluateLayerMotions(lDrop, 0.45, 1920, 1080).dy, 0);

  // 4. slide
  const lSlide = makeDummyLayer({
    resolvedMotions: [{ m: 'slide', at: 0, atSec: 0, from: 'L', dist: 192, dur: 0.4 }],
  });
  assert.ok(Math.abs(evaluateLayerMotions(lSlide, -0.1, 1920, 1080).dx - -0.1) < 1e-6);
  assert.ok(evaluateLayerMotions(lSlide, 0.1, 1920, 1080).dx < 0);
  assert.equal(evaluateLayerMotions(lSlide, 0.45, 1920, 1080).dx, 0);

  // 5. rise
  const lRise = makeDummyLayer({
    x: 0.5,
    y: 0.5,
    resolvedMotions: [{ m: 'rise', at: 0, atSec: 0, from: { x: 0.5, y: 0.7 }, dur: 0.4 }],
  });
  assert.ok(Math.abs(evaluateLayerMotions(lRise, -0.1, 1920, 1080).dy - 0.2) < 1e-6);
  assert.ok(evaluateLayerMotions(lRise, 0.26, 1920, 1080).scaleMult > 1.02);
  assert.equal(evaluateLayerMotions(lRise, 0.45, 1920, 1080).dy, 0);

  // 6. bump
  const lBump = makeDummyLayer({
    resolvedMotions: [{ m: 'bump', at: 1, atSec: 1, amt: 1.25, dur: 0.4 }],
  });
  assert.equal(evaluateLayerMotions(lBump, 0.8, 1920, 1080).scaleMult, 1);
  assert.ok(Math.abs(evaluateLayerMotions(lBump, 1.16, 1920, 1080).scaleMult - 1.25) < 1e-4);
  assert.equal(evaluateLayerMotions(lBump, 1.5, 1920, 1080).scaleMult, 1);

  // 7. shake
  const lShake = makeDummyLayer({
    resolvedMotions: [{ m: 'shake', at: 0, atSec: 0, amp: 19.2, sink: 10.8, dur: 0.5 }],
  });
  assert.ok(Math.abs(evaluateLayerMotions(lShake, 0.1, 1920, 1080).dx - 0.01) < 1e-6);
  assert.ok(Math.abs(evaluateLayerMotions(lShake, 0.2, 1920, 1080).dx - -0.01) < 1e-6);
  assert.ok(Math.abs(evaluateLayerMotions(lShake, 0.6, 1920, 1080).dy - 0.01) < 1e-6);

  // 8. grow
  const lGrow = makeDummyLayer({
    w: 400,
    resolvedMotions: [{ m: 'grow', at: 0, atSec: 0, axis: 'w', from: 100, to: 400, dur: 0.5 }],
  });
  assert.equal(evaluateLayerMotions(lGrow, -0.1, 1920, 1080).wOverride, 100);
  assert.ok((evaluateLayerMotions(lGrow, 0.25, 1920, 1080).wOverride ?? 0) > 250);
  assert.equal(evaluateLayerMotions(lGrow, 0.6, 1920, 1080).wOverride, 400);

  // 9. to (including overlapping `to` macros starting from exact value at `tm.atSec`)
  const lTo = makeDummyLayer({
    x: 0.2,
    resolvedMotions: [
      { m: 'to', at: 1.0, atSec: 1.0, dur: 1.0, x: 0.8, ease: 'linear' },
      { m: 'to', at: 1.5, atSec: 1.5, dur: 1.0, x: 0.3, ease: 'linear' },
    ],
  });
  // At t=1.5, first `to` reached x = 0.2 + (0.8 - 0.2)*0.5 = 0.5 (dx = +0.3)
  assert.ok(Math.abs(evaluateLayerMotions(lTo, 1.5, 1920, 1080).dx - 0.3) < 1e-6);
  // At t=2.0 (halfway through second `to` from 0.5 -> 0.3), x must be 0.4 (dx = +0.2)
  assert.ok(Math.abs(evaluateLayerMotions(lTo, 2.0, 1920, 1080).dx - 0.2) < 1e-6);
  // At t=2.5, x reaches 0.3 (dx = +0.1)
  assert.ok(Math.abs(evaluateLayerMotions(lTo, 2.5, 1920, 1080).dx - 0.1) < 1e-6);

  // 10. orbit (in group-local box space)
  const lOrbit = makeDummyLayer({
    groupBox: { x: 0.5, y: 0.5, w: 500, h: 500 },
    resolvedMotions: [{ m: 'orbit', at: 0, atSec: 0, cx: 0.5, cy: 0.5, r: 100, period: 1.0, phase: 0, dur: 2.0 }],
  });
  // At t=0, angle=0 -> absX = 0.5 + 100/500 = 0.7, absY = 0.5
  assert.ok(Math.abs((evaluateLayerMotions(lOrbit, 0, 1920, 1080).absX ?? 0) - 0.7) < 1e-6);
  // At t=0.25, angle=90 -> absX = 0.5, absY = 0.7
  assert.ok(Math.abs((evaluateLayerMotions(lOrbit, 0.25, 1920, 1080).absY ?? 0) - 0.7) < 1e-6);

  // 11. arc
  const lArc = makeDummyLayer({
    resolvedMotions: [
      { m: 'arc', at: 0, atSec: 0, from: { x: 0.2, y: 0.8 }, to: { x: 0.8, y: 0.8 }, h: 108, scaleTo: 0.5, dur: 1.0, ease: 'linear' },
    ],
  });
  const arcMid = evaluateLayerMotions(lArc, 0.5, 1920, 1080);
  assert.ok(Math.abs((arcMid.absX ?? 0) - 0.5) < 1e-6);
  assert.ok(Math.abs((arcMid.absY ?? 0) - 0.7) < 1e-6);
  assert.ok(Math.abs(arcMid.scaleMult - 0.75) < 1e-6);

  // 12. hop
  const lHop = makeDummyLayer({
    x: 0.1,
    y: 0.1,
    resolvedMotions: [
      { m: 'hop', at: 0, atSec: 0, pts: [{ x: 0.5, y: 0.5 }, { x: 0.9, y: 0.9 }], move: 0.2, hold: 0.2 },
    ],
  });
  assert.equal(evaluateLayerMotions(lHop, 0.25, 1920, 1080).absX, 0.5);
  assert.equal(evaluateLayerMotions(lHop, 0.85, 1920, 1080).absX, 0.9);

  // 13. merge
  const lMerge = makeDummyLayer({
    x: 0.2,
    y: 0.5,
    resolvedMotions: [{ m: 'merge', at: 0, atSec: 0, cx: 0.5, cy: 0.5, scale: 0.2, dur: 0.5 }],
  });
  assert.equal(evaluateLayerMotions(lMerge, 0.5, 1920, 1080).opacityMult, 0);
  assert.equal(evaluateLayerMotions(lMerge, 0.45, 1920, 1080).burstRings.length, 1);

  // 14. burst
  const lBurst = makeDummyLayer({
    resolvedMotions: [{ m: 'burst', at: 1, atSec: 1, r: 120, to: 2.0, dur: 0.6 }],
  });
  assert.equal(evaluateLayerMotions(lBurst, 0.5, 1920, 1080).burstRings.length, 0);
  assert.equal(evaluateLayerMotions(lBurst, 1.3, 1920, 1080).burstRings.length, 1);

  // 15. press
  const lPress = makeDummyLayer({
    resolvedMotions: [{ m: 'press', at: 1, atSec: 1, dur: 0.25 }],
  });
  assert.ok(Math.abs(evaluateLayerMotions(lPress, 1.1125, 1920, 1080).scaleMult - 0.9) < 1e-4);
  assert.equal(evaluateLayerMotions(lPress, 1.3, 1920, 1080).scaleMult, 1);

  // 16-21. Analytic loops: pulse, breathe, float, sway, wiggle, blink
  const lPulse = makeDummyLayer({ resolvedMotions: [{ m: 'pulse', at: 0, atSec: 0, amt: 1.1, period: 1.0 }] });
  assert.ok(Math.abs(evaluateLayerMotions(lPulse, 0.5, 1920, 1080).scaleMult - 1.1) < 1e-6);

  const lBreathe = makeDummyLayer({ resolvedMotions: [{ m: 'breathe', at: 0, atSec: 0, amt: 1.04, period: 2.0 }] });
  assert.ok(Math.abs(evaluateLayerMotions(lBreathe, 1.0, 1920, 1080).scaleMult - 1.04) < 1e-6);

  const lFloat = makeDummyLayer({ resolvedMotions: [{ m: 'float', at: 0, atSec: 0, amp: 10.8, period: 2.0 }] });
  assert.ok(Math.abs(evaluateLayerMotions(lFloat, 0.5, 1920, 1080).dy - 0.01) < 1e-6);

  const lSway = makeDummyLayer({ resolvedMotions: [{ m: 'sway', at: 0, atSec: 0, amp: 6, period: 2.0 }] });
  assert.ok(Math.abs(evaluateLayerMotions(lSway, 0.5, 1920, 1080).rotDelta - 6) < 1e-6);

  const lWiggle = makeDummyLayer({ resolvedMotions: [{ m: 'wiggle', at: 0, atSec: 0, amp: 8, period: 0.5 }] });
  const w1 = evaluateLayerMotions(lWiggle, 0.37, 1920, 1080);
  const w2 = evaluateLayerMotions(lWiggle, 0.37, 1920, 1080);
  assert.equal(w1.dx, w2.dx);

  const lBlink = makeDummyLayer({ resolvedMotions: [{ m: 'blink', at: 0, atSec: 0, period: 1.0 }] });
  assert.ok(Math.abs(evaluateLayerMotions(lBlink, 0.5, 1920, 1080).opacityMult - 0.35) < 1e-6);
});

test('M5 & M6 & M7: Theme tokens, all 16 components, flattenRecipeDocument, and group layout / anchor rules', () => {
  const tok = expandThemeTokens({ palette: 1 });
  // Style tokens expansion
  const cardStyled = applyStyleToLayer({ id: 'c', type: 'shape', kind: 'roundRect', style: 'card' });
  assert.equal(cardStyled.stroke, '@cardS');
  assert.equal(cardStyled.radius, 40);

  // Test all 16 built-in components expand into non-empty plain layers with zero `use` leftovers
  const all16 = [
    { def: 'disc', args: { emoji: '🔨', label: 'BUILD', hero: true } },
    { def: 'chip', args: { label: 'Fast', icon: 'zap', tone: 'acc' } },
    { def: 'badge', args: { text: 'LIVE', tone: 'warn', pulse: 1.4 } },
    { def: 'stamp', args: { text: 'SHIPPED', tone: 'acc' } },
    { def: 'button', args: { label: 'Deploy', pressAt: 1.2 } },
    { def: 'cursor', args: { from: { x: 0.8, y: 0.8 }, to: { x: 0.5, y: 0.5 }, click: true } },
    { def: 'meter', args: { from: 0.2, to: 0.9, tone: 'warn', label: 'CPU' } },
    { def: 'bubble', args: { side: 'you', text: 'Hello world' } },
    {
      def: 'chat',
      args: {
        title: 'Support',
        messages: [
          { from: 'you', text: 'How fast is export?', at: 0.6 },
          { from: 'ai', text: 'Deterministic WebCodecs MP4.', at: 1.4 },
        ],
      },
    },
    { def: 'phone', args: { screen: [{ id: 'scr_txt', type: 'text', text: 'App' }] } },
    { def: 'browser', args: { url: 'https://recipestudio.video' } },
    { def: 'toast', args: { text: 'Saved offline', tone: 'warn' } },
    { def: 'kpi', args: { value: '{v}%', count: [0, 99], label: 'ACCURACY' } },
    { def: 'timeline', args: { nodes: ['v1', 'v2', 'Final'], finalTone: 'acc' } },
    { def: 'logo', args: { asset: 'brand_logo', size: 160 } },
    { def: 'photo', args: { asset: 'presenter', side: 'right' } },
  ];

  for (const item of all16) {
    const expanded = expandUseLayer(
      { id: `u_${item.def}`, type: 'use', def: item.def, args: item.args, t: [0, 5] },
      [0, 5],
      undefined,
      tok,
      1920,
      1080
    );
    assert.ok(expanded.length >= 1, `Component "${item.def}" must expand into plain layers`);
    assert.ok(expanded.every((l) => l.type !== 'use'), `Expanded "${item.def}" must not contain raw use layers`);
  }

  // Test flattenRecipeDocument with user defs + nested use
  const docWithDefs: RecipeDocument = {
    recipe: 'v3.1',
    meta: { w: 1920, h: 1080, fps: 60, duration: 5 },
    theme: { palette: 2 },
    defs: {
      featureRow: {
        params: { title: 'Default' },
        layers: [
          { id: 'inner_chip', type: 'use', def: 'chip', args: { label: '$title', icon: 'check' } },
        ],
      },
    },
    scenes: [
      {
        id: 's1',
        t: [0, 5],
        layers: [
          { id: 'my_feat', type: 'use', def: 'featureRow', args: { title: 'Offline Ready' } },
        ],
      },
    ],
  };

  const flattened = flattenRecipeDocument(docWithDefs);
  assert.equal(flattened.defs, undefined);
  const compiled = compileRecipe(flattened);
  assert.ok(compiled.layers.some((l) => l.text === 'Offline Ready'));

  // Test group layout row/column/grid with align and anchor offsets
  const rowLaidOut = applyGroupLayout(
    [
      { id: 'a', type: 'shape', kind: 'rect', w: 100, h: 50 },
      { id: 'b', type: 'shape', kind: 'rect', w: 100, h: 50 },
    ],
    { type: 'row', gap: 20, align: 'start' },
    400,
    200
  );
  assert.equal(rowLaidOut[0].x, 50 / 400);
  assert.equal(rowLaidOut[1].x, 170 / 400);

  assert.deepEqual(getAnchorOffsetFactors('left'), [0, 0.5]);
  assert.deepEqual(getAnchorOffsetFactors('bottom-right'), [1, 1]);

  // Unknown @token is caught as validation error
  const badTokenDoc: RecipeDocument = {
    recipe: 'v3.1',
    meta: { w: 1920, h: 1080, fps: 60, duration: 4 },
    theme: { palette: 1 },
    scenes: [
      {
        id: 's1',
        t: [0, 4],
        layers: [{ id: 'bad', type: 'shape', kind: 'rect', w: 200, h: 100, fill: '@nonExistentToken' }],
      },
    ],
  };
  const valRes = validateRecipe(badTokenDoc);
  assert.ok(valRes.issues.some((i) => i.code === 'INVALID_COLOR_TOKEN'));
});
