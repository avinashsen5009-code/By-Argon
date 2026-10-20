import { compileRecipe } from '../core/layout.ts';
import type { CompiledRecipe, RecipeDocument, TranscriptData } from '../core/types.ts';
import { renderFrame } from '../render/renderer.ts';

let offscreen: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let compiled: CompiledRecipe | null = null;

self.onmessage = (event: MessageEvent) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'INIT_CANVAS' && msg.canvas) {
    offscreen = msg.canvas as OffscreenCanvas;
    ctx = offscreen.getContext('2d');
    self.postMessage({ type: 'READY' });
  } else if (msg.type === 'COMPILE') {
    const doc = msg.doc as RecipeDocument;
    const transcript = msg.transcript as TranscriptData | undefined;
    compiled = compileRecipe(doc, transcript);
    if (offscreen) {
      offscreen.width = compiled.w;
      offscreen.height = compiled.h;
    }
    self.postMessage({ type: 'COMPILED', duration: compiled.duration, w: compiled.w, h: compiled.h });
  } else if (msg.type === 'RENDER_FRAME') {
    if (ctx && compiled) {
      renderFrame(ctx, compiled, Number(msg.t) || 0, msg.options || {});
      self.postMessage({ type: 'FRAME_RENDERED', t: msg.t });
    }
  }
};
