export const APP_NAME = 'Recipe Studio';
export const APP_ID = 'app.recipestudio.video';
export const RECIPE_VERSION = 'v3.1';

export type TimeValue = number | string;

export interface ExpressionValue {
  expr: string;
}

export type NumericProp = number | ExpressionValue;
export type SizeProp = number | string | ExpressionValue;

export type AnchorType =
  | 'center'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export type BlendMode = 'normal' | 'add' | 'screen' | 'multiply';
export type StyleToken = 'card' | 'hero' | 'disc' | 'hdisc' | 'warnp';
export type ScreenLang = 'en' | 'hi' | 'same-as-voice';

export interface GradientFillObject {
  type: 'linear' | 'radial';
  angle?: number;
  stops: [number, string][];
}

export type FillValue = string | GradientFillObject;

export interface EnterExitObject {
  type: string;
  dur?: number;
  ease?: string;
}

export type EnterExitPreset = string | EnterExitObject;

export interface MotionMacroCall {
  m: string;
  at?: TimeValue;
  dur?: number;
  ease?: string;
  from?: any;
  to?: any;
  over?: number;
  burst?: boolean;
  dist?: number;
  amt?: number;
  amp?: number;
  sink?: number;
  axis?: 'w' | 'h';
  x?: number;
  y?: number;
  scale?: number;
  rot?: number;
  opacity?: number;
  cx?: number;
  cy?: number;
  r?: number;
  period?: number;
  phase?: number;
  h?: number;
  scaleTo?: number;
  pts?: { x: number; y: number }[];
  move?: number;
  hold?: number;
  color?: string;
  until?: TimeValue;
  [key: string]: any;
}

export interface KeyframeItem<T = any> {
  t: number;
  v: T;
  e?: string;
}

export type AnimTrackValue = string | KeyframeItem[];
export type AnimMap = Record<string, AnimTrackValue>;

export interface FxItem {
  type?: string;
  color?: string;
  radius?: number;
  strength?: number;
  x?: number;
  y?: number;
  blur?: number;
  width?: number;
  amount?: number;
  slices?: number;
  size?: number;
  a?: string;
  b?: string;
  axis?: 'x' | 'y';
  count?: number;
  decay?: number;
  amp?: number;
  freq?: number;
  seed?: number;
  gap?: number;
  opacity?: number;
  [key: string]: any;
}

export interface TextHighlightWord {
  word: string;
  color: string;
}

export interface TextPlate {
  fill?: FillValue;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  pad?: [number, number];
}

export interface TextAnimSpec {
  split: 'char' | 'word' | 'line';
  stagger?: number;
  dur?: number;
  from?: {
    x?: number;
    y?: number;
    opacity?: number;
    blur?: number;
    scale?: number;
    rot?: number;
  };
  ease?: string;
}

export interface FigureJoints {
  armR?: number;
  armL?: number;
  legR?: number;
  legL?: number;
  torso?: number;
  head?: number;
}

export interface FigurePoseKey {
  t: TimeValue;
  pose: string | { joints: FigureJoints };
  e?: string;
}

export interface FigureProp {
  hold: string;
  hand: 'L' | 'R';
}

export interface GroupLayout {
  type: 'row' | 'column' | 'grid';
  gap?: number;
  cols?: number;
  align?: 'center' | 'left' | 'right' | 'top' | 'bottom';
}

export interface ParticleEmitter {
  shape?: 'circle' | 'rect' | 'point' | 'ring';
  count?: number;
  life?: [number, number] | number;
  speed?: [number, number] | number;
  angle?: [number, number] | number;
  gravity?: number;
  size?: [number, number] | number;
  sizeEnd?: number;
  colors?: string[];
  opacityEnd?: number;
  spin?: number;
  blend?: BlendMode;
}

export interface LayerPatch {
  patch: string;
  motion?: MotionMacroCall[];
  t?: [TimeValue | null, TimeValue | null];
  exit?: EnterExitPreset;
  anim?: AnimMap;
}

export interface Layer {
  id: string;
  type: string;
  t?: [TimeValue, TimeValue];
  x?: NumericProp;
  y?: NumericProp;
  w?: SizeProp;
  h?: SizeProp;
  anchor?: AnchorType;
  rot?: NumericProp;
  scale?: NumericProp;
  scaleX?: NumericProp;
  scaleY?: NumericProp;
  opacity?: NumericProp;
  z?: number;
  parent?: string;
  depth?: number;
  blend?: BlendMode;
  mask?: string;
  onPath?: string;
  style?: StyleToken | string;
  fill?: FillValue;
  stroke?: any;
  strokeWidth?: NumericProp;
  radius?: NumericProp;
  shadow?: NumericProp;
  glow?: NumericProp;
  blur?: NumericProp;
  fx?: (FxItem | Record<string, any>)[];
  enter?: EnterExitPreset;
  exit?: EnterExitPreset;
  emph?: string;
  motion?: MotionMacroCall[];
  anim?: AnimMap;

  // Text properties
  text?: string;
  size?: NumericProp;
  weight?: number;
  font?: 'display' | 'sans' | 'hindi' | string;
  color?: string;
  align?: 'center' | 'left' | 'right';
  lineHeight?: number;
  letterSpacing?: NumericProp;
  fit?: 'shrink' | 'contain' | 'cover';
  maxLines?: number;
  highlight?: TextHighlightWord[];
  plate?: TextPlate;
  textAnim?: TextAnimSpec;

  // Shape properties
  kind?: string;
  sides?: number;
  points?: number;
  inner?: number;
  thickness?: NumericProp;
  dash?: [number, number];
  seed?: number;
  wobble?: number;

  // Path & SVG properties
  d?: string;
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
  trimStart?: NumericProp;
  trimEnd?: NumericProp;
  markup?: string;

  // Icon properties
  name?: string;

  // Image / Video properties
  asset?: string;
  kenburns?: {
    from: { zoom: number; x: number; y: number };
    to: { zoom: number; x: number; y: number };
  };
  crop?: { x: number; y: number; w: number; h: number };

  // Figure properties
  pose?: string | { joints: FigureJoints };
  poseKeys?: FigurePoseKey[];
  props?: FigureProp[];

  // Group properties
  children?: Layer[];
  clip?: boolean;
  layout?: GroupLayout;
  stagger?: number;

  // Use / Component properties
  def?: string;
  args?: Record<string, any>;

  // Highlight layer properties
  target?: string;
  word?: string;
  at?: TimeValue;
  dur?: number;

  // Particles properties
  emitter?: ParticleEmitter;
  burst?: boolean;

  // Chart properties
  data?: number[];
  labels?: string[];
  colors?: string[];
  animate?: { stagger?: number; ease?: string; dur?: number };
  from?: any;
  to?: any;
  format?: string;
  decimals?: number;
  count?: [TimeValue, TimeValue];
  ease?: string;

  // Background properties
  speed?: number;

  // Captions properties
  activeColor?: string;
  maxWords?: number;

  // Code layer properties
  draw?: string;

  [key: string]: any;
}

export interface SceneTransition {
  type: string;
  dur?: number;
  angle?: number;
  x?: number;
  y?: number;
}

export interface Scene {
  id: string;
  t: [TimeValue, TimeValue];
  transition?: SceneTransition;
  layers: (Layer | LayerPatch)[];
}

export interface CameraKeyframe {
  t?: TimeValue;
  x?: number;
  y?: number;
  zoom?: number;
  rot?: number;
  shake?: number;
  e?: string;
  follow?: string;
  lag?: number;
}

export interface AssetDef {
  id: string;
  type: 'image' | 'video' | 'audio' | 'svg';
  file: string;
  prompt?: string;
  dataUrl?: string;
}

export interface AudioTrack {
  src: string;
  start?: number;
  volume?: number;
}

export interface ComponentDef {
  params?: Record<string, any>;
  layers: Layer[];
}

export interface CarryState {
  persist?: { id: string; until: 'open' | number }[];
  last?: string[];
  hero?: string;
  notes?: string;
}

export interface PartMeta {
  n: number;
  of: number;
  from: number;
  to: number;
}

export interface RecipeMeta {
  w?: number;
  h?: number;
  fps?: number;
  duration?: number;
  lang?: ScreenLang;
  part: PartMeta;
}

export interface ThemeSpec {
  palette?: number;
  hex?: string;
}

export interface GlobalFxSpec {
  vignette?: number;
  bloom?: number;
  grain?: number;
  chroma?: number;
}

export interface RecipeDocument {
  recipe: string;
  meta: RecipeMeta;
  theme?: ThemeSpec;
  global?: GlobalFxSpec;
  assets?: AssetDef[];
  audio?: AudioTrack[];
  defs?: Record<string, ComponentDef>;
  camera?: CameraKeyframe[];
  scenes: Scene[];
  carry?: CarryState;
}

export interface SentenceItem {
  i: number;
  text: string;
  s: number;
  e: number;
}

export interface WordItem {
  i: number;
  w: string;
  s: number;
  e: number;
}

export interface TranscriptData {
  rawText: string;
  duration: number;
  sentences: SentenceItem[];
  words: WordItem[];
}

export type ThemeTokens = Record<string, string>;

export interface CompiledLayer extends Omit<Layer, 't' | 'motion' | 'children'> {
  t0: number;
  t1: number;
  sceneId: string;
  sceneT0: number;
  sceneT1: number;
  orderIndex: number;
  zIndex: number;
  groupId?: string;
  groupBox?: { x: number; y: number; w: number; h: number; clip?: boolean };
  resolvedMotions: Array<MotionMacroCall & { atSec: number; untilSec?: number }>;
  resolvedCount?: [number, number];
  resolvedAt?: number;
  resolvedPressAt?: number;
  resolvedPoseKeys?: Array<{ t: number; pose: string | { joints: FigureJoints }; e?: string }>;
  staggerIndex?: number;
  staggerTotal?: number;
  numericSeed: number;
}

export interface CompiledScene {
  id: string;
  t0: number;
  t1: number;
  transition: SceneTransition;
  layerIds: string[];
}

export interface CompiledCameraKey {
  t: number;
  x: number;
  y: number;
  zoom: number;
  rot: number;
  shake: number;
  e: string;
  follow?: string;
  lag?: number;
}

export interface CompiledRecipe {
  w: number;
  h: number;
  fps: number;
  duration: number;
  lang: ScreenLang;
  part: PartMeta;
  tokens: ThemeTokens;
  global: GlobalFxSpec;
  assets: Map<string, AssetDef>;
  camera: CompiledCameraKey[];
  scenes: CompiledScene[];
  layers: CompiledLayer[];
  layersById: Map<string, CompiledLayer>;
  intervalSorted: CompiledLayer[]; // sorted by t0 for binary search
  transcript?: TranscriptData;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  layerId?: string;
  sceneId?: string;
  path?: string;
}
