import iconsJson from '../assets/icons.json' with { type: 'json' };
import { registerBuiltInComponents } from './components/index.ts';
import { registerBuiltInEasings } from './ease.ts';
import { registerBuiltInPresets } from './keyframes.ts';
import { registerBuiltInMacros } from './macros.ts';
import { THEME_TOKEN_NAMES } from './palette.ts';
import {
  backgroundRegistry,
  chartKindRegistry,
  componentRegistry,
  easingRegistry,
  enterPresetRegistry,
  exitPresetRegistry,
  fxRegistry,
  iconRegistry,
  layerTypeRegistry,
  macroRegistry,
  poseRegistry,
  registerBackground,
  registerChartKind,
  registerFx,
  registerIcon,
  registerLayerType,
  registerPose,
  registerShapeKind,
  registerTransition,
  shapeKindRegistry,
  transitionRegistry,
} from './registry.ts';
import { STYLE_TOKEN_NAMES } from './styles.ts';
import type { FigureJoints } from './types.ts';

export function registerAllBuiltInVocab(): void {
  registerBuiltInEasings();
  registerBuiltInPresets();
  registerBuiltInMacros();
  registerBuiltInComponents();

  // Layer types (SPEC Section 5)
  const layerTypes = [
    'text',
    'shape',
    'path',
    'svg',
    'icon',
    'image',
    'video',
    'figure',
    'group',
    'use',
    'highlight',
    'particles',
    'chart',
    'background',
    'captions',
    'code',
  ];
  for (const lt of layerTypes) registerLayerType(lt);

  // Shape kinds (SPEC Section 5)
  const shapeKinds = [
    'rect',
    'roundRect',
    'pill',
    'ellipse',
    'ring',
    'triangle',
    'diamond',
    'pentagon',
    'hexagon',
    'octagon',
    'star',
    'burst',
    'arrow',
    'chevron',
    'plus',
    'check',
    'heart',
    'bubble',
    'line',
    'polygon',
    'blob',
    'card',
  ];
  for (const sk of shapeKinds) registerShapeKind(sk);

  // Icons (SPEC Section 5: 66 icons from icons.json)
  for (const [iconName, paths] of Object.entries(iconsJson as Record<string, string[]>)) {
    registerIcon(iconName, paths);
  }

  // Figure poses (SPEC Section 5: 17 poses)
  const poses: Record<string, FigureJoints> = {
    idle: { armR: 15, armL: -15, legR: 8, legL: -8, torso: 0, head: 0 },
    walk: { armR: -30, armL: 30, legR: 28, legL: -28, torso: 4, head: 2 },
    run: { armR: -55, armL: 55, legR: 48, legL: -48, torso: 14, head: 6 },
    jump: { armR: -135, armL: 135, legR: 35, legL: -35, torso: -4, head: -8 },
    wave: { armR: -145, armL: -18, legR: 8, legL: -8, torso: -3, head: 5 },
    point: { armR: -85, armL: -15, legR: 10, legL: -10, torso: 3, head: 4 },
    think: { armR: -115, armL: 25, legR: 6, legL: -6, torso: 2, head: 12 },
    shrug: { armR: -65, armL: 65, legR: 10, legL: -10, torso: 0, head: 8 },
    sit: { armR: -20, armL: 15, legR: 75, legL: 75, torso: 6, head: 0 },
    fall: { armR: -110, armL: 95, legR: 50, legL: -40, torso: 55, head: 25 },
    celebrate: { armR: -145, armL: 145, legR: 18, legL: -18, torso: -5, head: -6 },
    push: { armR: -75, armL: -70, legR: 35, legL: -25, torso: 22, head: 8 },
    pull: { armR: -45, armL: -40, legR: -25, legL: 35, torso: -20, head: -6 },
    carry: { armR: -60, armL: -55, legR: 15, legL: -15, torso: -8, head: 4 },
    climb: { armR: -130, armL: -45, legR: 45, legL: -20, torso: 8, head: -10 },
    lookup: { armR: 12, armL: -12, legR: 8, legL: -8, torso: -6, head: -25 },
    reach: { armR: -120, armL: -100, legR: 12, legL: -12, torso: 10, head: -12 },
  };
  for (const [poseName, joints] of Object.entries(poses)) {
    registerPose(poseName, joints);
  }

  // Chart kinds (SPEC Section 5: 9 chart kinds)
  const chartKinds = [
    'bar',
    'hbar',
    'line',
    'pie',
    'donut',
    'progress',
    'gauge',
    'counter',
    'timeline',
  ];
  for (const ck of chartKinds) registerChartKind(ck);

  // Background kinds (SPEC Section 5: 11 background kinds)
  const bgKinds = [
    'solid',
    'gradient',
    'mesh',
    'grid',
    'dots',
    'noise',
    'waves',
    'rays',
    'stars',
    'aurora',
    'lines',
  ];
  for (const bk of bgKinds) registerBackground(bk);

  // FX names (SPEC Section 8e: 13 layer fx)
  const fxNames = [
    'glow',
    'shadow',
    'blur',
    'outline',
    'glitch',
    'chroma',
    'pixelate',
    'tint',
    'duotone',
    'mirror',
    'trail',
    'wiggle',
    'scanlines',
  ];
  for (const fx of fxNames) registerFx(fx);

  // Scene transitions (SPEC Section 8g: 15 transitions)
  const transitions = [
    'cut',
    'fade',
    'dissolve',
    'slideL',
    'slideR',
    'slideU',
    'slideD',
    'push',
    'zoomThrough',
    'whip',
    'wipe',
    'iris',
    'glitch',
    'flash',
    'blurThrough',
  ];
  for (const tr of transitions) registerTransition(tr);
}

registerAllBuiltInVocab();

export const LAYER_TYPES = layerTypeRegistry.names();
export const SHAPE_KINDS = shapeKindRegistry.names();
export const ICON_NAMES = iconRegistry.names();
export const MACRO_NAMES = macroRegistry.names();
export const COMPONENT_NAMES = componentRegistry.names();
export const FX_NAMES = fxRegistry.names();
export const TRANSITION_NAMES = transitionRegistry.names();
export const CHART_KINDS = chartKindRegistry.names();
export const BACKGROUND_KINDS = backgroundRegistry.names();
export const POSE_NAMES = poseRegistry.names();
export const ENTER_PRESETS = enterPresetRegistry.names();
export const EXIT_PRESETS = exitPresetRegistry.names();
export const EASING_NAMES = easingRegistry.names();
export const STYLE_TOKENS = [...STYLE_TOKEN_NAMES];
export const THEME_TOKENS = [...THEME_TOKEN_NAMES];
export const EMPH_NAMES = ['pulse', 'shake', 'float', 'sway', 'breathe'];
export const CAPTION_STYLES = ['word-pop', 'karaoke', 'line', 'box'];
export const HIGHLIGHT_KINDS = ['underline', 'box', 'marker'];
