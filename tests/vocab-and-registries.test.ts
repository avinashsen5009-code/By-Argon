import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKGROUND_KINDS,
  CHART_KINDS,
  COMPONENT_NAMES,
  EASING_NAMES,
  ENTER_PRESETS,
  EXIT_PRESETS,
  FX_NAMES,
  ICON_NAMES,
  LAYER_TYPES,
  MACRO_NAMES,
  POSE_NAMES,
  SHAPE_KINDS,
  STYLE_TOKENS,
  THEME_TOKENS,
  TRANSITION_NAMES,
} from '../src/core/vocab.ts';

test('SPEC Part A vocabulary is 100% registered in registries', () => {
  const specLayerTypes = [
    'text', 'shape', 'path', 'svg', 'icon', 'image', 'video', 'figure',
    'group', 'use', 'highlight', 'particles', 'chart', 'background', 'captions', 'code',
  ];
  for (const name of specLayerTypes) {
    assert.ok(LAYER_TYPES.includes(name), `Missing layer type: ${name}`);
  }

  const specShapeKinds = [
    'rect', 'roundRect', 'pill', 'ellipse', 'ring', 'triangle', 'diamond',
    'pentagon', 'hexagon', 'octagon', 'star', 'burst', 'arrow', 'chevron',
    'plus', 'check', 'heart', 'bubble', 'line', 'polygon', 'blob', 'card',
  ];
  for (const name of specShapeKinds) {
    assert.ok(SHAPE_KINDS.includes(name), `Missing shape kind: ${name}`);
  }

  const specIcons = [
    'check', 'cross', 'plus', 'minus', 'arrow-right', 'arrow-up', 'arrow-down',
    'heart', 'star', 'bolt', 'fire', 'clock', 'calendar', 'lock', 'unlock',
    'key', 'bulb', 'brain', 'target', 'flag', 'trophy', 'coin', 'wallet',
    'bank', 'chart-up', 'chart-down', 'book', 'pencil', 'phone', 'mic',
    'speaker', 'eye', 'hand', 'thumbs-up', 'warning', 'question', 'gear',
    'rocket', 'shield', 'user', 'users', 'home', 'cart', 'mail', 'search',
    'play', 'pause', 'bell', 'camera', 'cloud', 'sun', 'moon', 'leaf',
    'map-pin', 'link', 'trash', 'download', 'upload', 'chat', 'file',
    'folder', 'code', 'globe', 'wifi', 'battery', 'cursor',
  ];
  assert.equal(specIcons.length, 66);
  for (const name of specIcons) {
    assert.ok(ICON_NAMES.includes(name), `Missing icon name: ${name}`);
  }

  const specPoses = [
    'idle', 'walk', 'run', 'jump', 'wave', 'point', 'think', 'shrug',
    'sit', 'fall', 'celebrate', 'push', 'pull', 'carry', 'climb', 'lookup', 'reach',
  ];
  for (const name of specPoses) {
    assert.ok(POSE_NAMES.includes(name), `Missing figure pose: ${name}`);
  }

  const specCharts = [
    'bar', 'hbar', 'line', 'pie', 'donut', 'progress', 'gauge', 'counter', 'timeline',
  ];
  for (const name of specCharts) {
    assert.ok(CHART_KINDS.includes(name), `Missing chart kind: ${name}`);
  }

  const specBackgrounds = [
    'solid', 'gradient', 'mesh', 'grid', 'dots', 'noise', 'waves', 'rays', 'stars', 'aurora', 'lines',
  ];
  for (const name of specBackgrounds) {
    assert.ok(BACKGROUND_KINDS.includes(name), `Missing background kind: ${name}`);
  }

  const specComponents = [
    'chip', 'disc', 'badge', 'stamp', 'button', 'cursor', 'meter', 'bubble',
    'chat', 'phone', 'browser', 'toast', 'kpi', 'timeline', 'logo', 'photo',
  ];
  for (const name of specComponents) {
    assert.ok(COMPONENT_NAMES.includes(name), `Missing built-in component: ${name}`);
  }

  const specMacros = [
    'pop', 'slam', 'drop', 'slide', 'rise', 'bump', 'shake', 'grow', 'to',
    'orbit', 'arc', 'hop', 'merge', 'burst', 'press', 'pulse', 'breathe',
    'float', 'sway', 'wiggle', 'blink',
  ];
  for (const name of specMacros) {
    assert.ok(MACRO_NAMES.includes(name), `Missing motion macro: ${name}`);
  }

  const specEnters = [
    'fade', 'fadeUp', 'slideL', 'slideR', 'slideU', 'slideD', 'riseIn', 'dropIn',
    'flyIn', 'scaleIn', 'popIn', 'zoomIn', 'blurIn', 'spinIn', 'swingIn', 'none',
    'typeOn', 'charIn', 'charFade', 'charPop', 'wordIn', 'wordFade', 'wordPop', 'lineIn',
  ];
  for (const name of specEnters) {
    assert.ok(ENTER_PRESETS.includes(name), `Missing enter preset: ${name}`);
  }

  const specExits = [
    'fadeOut', 'slideOut', 'slideLOut', 'slideUOut', 'slideDOut', 'dropOut',
    'flyOut', 'scaleDown', 'popOut', 'zoomOut', 'blurOut', 'spinOut', 'none',
  ];
  for (const name of specExits) {
    assert.ok(EXIT_PRESETS.includes(name), `Missing exit preset: ${name}`);
  }

  const specEasings = [
    'linear', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic',
    'inExpo', 'outExpo', 'inOutExpo', 'inSine', 'outSine', 'inOutSine', 'inBack',
    'outBack', 'inOutBack', 'outBounce', 'outElastic', 'step', 'bezier', 'spring',
  ];
  for (const name of specEasings) {
    assert.ok(EASING_NAMES.includes(name), `Missing easing: ${name}`);
  }

  const specFx = [
    'glow', 'shadow', 'blur', 'outline', 'glitch', 'chroma', 'pixelate',
    'tint', 'duotone', 'mirror', 'trail', 'wiggle', 'scanlines',
  ];
  for (const name of specFx) {
    assert.ok(FX_NAMES.includes(name), `Missing fx: ${name}`);
  }

  const specTransitions = [
    'cut', 'fade', 'dissolve', 'slideL', 'slideR', 'slideU', 'slideD',
    'push', 'zoomThrough', 'whip', 'wipe', 'iris', 'glitch', 'flash', 'blurThrough',
  ];
  for (const name of specTransitions) {
    assert.ok(TRANSITION_NAMES.includes(name), `Missing transition: ${name}`);
  }

  assert.deepEqual(STYLE_TOKENS, ['card', 'hero', 'disc', 'hdisc', 'warnp']);
  assert.ok(THEME_TOKENS.includes('acc') && THEME_TOKENS.includes('warnpHi'));
});
