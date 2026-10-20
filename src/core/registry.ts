import type {
  CompiledLayer,
  ComponentDef,
  FigureJoints,
  Layer,
  MotionMacroCall,
  ThemeTokens,
} from './types.ts';

export type MacroExpander = (
  macro: MotionMacroCall,
  layer: CompiledLayer,
  tRel: number,
  canvasW: number,
  canvasH: number
) => MacroDelta;

export interface MacroDelta {
  dx?: number;
  dy?: number;
  scaleMult?: number;
  scaleXMult?: number;
  scaleYMult?: number;
  rotDelta?: number;
  opacityMult?: number;
  wOverride?: number;
  hOverride?: number;
  absX?: number;
  absY?: number;
  burstRing?: {
    progress: number;
    rStart: number;
    rEnd: number;
    color: string;
    opacity: number;
  };
}

export type ComponentExpander = (
  idPrefix: string,
  args: Record<string, any>,
  layerT: [number, number],
  tokens: ThemeTokens,
  canvasW: number,
  canvasH: number
) => Layer[];

export type EasingFn = (u: number) => number;

class RegistryStore<T> {
  private map = new Map<string, T>();

  register(name: string, impl: T): void {
    this.map.set(name, impl);
  }

  get(name: string): T | undefined {
    return this.map.get(name);
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  names(): string[] {
    return Array.from(this.map.keys());
  }

  entries(): [string, T][] {
    return Array.from(this.map.entries());
  }
}

export const macroRegistry = new RegistryStore<MacroExpander>();
export const shapeKindRegistry = new RegistryStore<string>();
export const componentRegistry = new RegistryStore<ComponentExpander>();
export const fxRegistry = new RegistryStore<string>();
export const iconRegistry = new RegistryStore<string[]>();
export const transitionRegistry = new RegistryStore<string>();
export const chartKindRegistry = new RegistryStore<string>();
export const backgroundRegistry = new RegistryStore<string>();
export const poseRegistry = new RegistryStore<FigureJoints>();
export const enterPresetRegistry = new RegistryStore<{ textOnly: boolean }>();
export const exitPresetRegistry = new RegistryStore<string>();
export const easingRegistry = new RegistryStore<EasingFn>();
export const layerTypeRegistry = new RegistryStore<string>();

export function registerMacro(name: string, expander: MacroExpander): void {
  macroRegistry.register(name, expander);
}

export function registerShapeKind(name: string, descriptor = name): void {
  shapeKindRegistry.register(name, descriptor);
}

export function registerComponent(name: string, expander: ComponentExpander): void {
  componentRegistry.register(name, expander);
}

export function registerFx(name: string, descriptor = name): void {
  fxRegistry.register(name, descriptor);
}

export function registerIcon(name: string, paths: string[]): void {
  iconRegistry.register(name, paths);
}

export function registerTransition(name: string, descriptor = name): void {
  transitionRegistry.register(name, descriptor);
}

export function registerChartKind(name: string, descriptor = name): void {
  chartKindRegistry.register(name, descriptor);
}

export function registerBackground(name: string, descriptor = name): void {
  backgroundRegistry.register(name, descriptor);
}

export function registerPose(name: string, joints: FigureJoints): void {
  poseRegistry.register(name, joints);
}

export function registerEnterPreset(name: string, textOnly = false): void {
  enterPresetRegistry.register(name, { textOnly });
}

export function registerExitPreset(name: string): void {
  exitPresetRegistry.register(name, name);
}

export function registerEasing(name: string, fn: EasingFn): void {
  easingRegistry.register(name, fn);
}

export function registerLayerType(name: string): void {
  layerTypeRegistry.register(name, name);
}
