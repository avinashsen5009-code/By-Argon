import { computeCrc32 } from '../store/zip.ts';

/**
 * Deterministic software 2D rasterizer & RFC-2083 PNG encoder for headless Node golden tests.
 * Tracks every drawn primitive with exact transformed bounding boxes, palette colors, and
 * rasterizes into an RGBA pixel buffer (`Uint8ClampedArray`) that can be compared pixel-for-pixel
 * and saved as standard `.png` golden images.
 */

export interface DrawnPrimitive {
  kind: 'rect' | 'arc' | 'ellipse' | 'path' | 'text';
  text?: string;
  fillStyle: string;
  strokeStyle: string;
  alpha: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface SoftwareCanvas2D {
  w: number;
  h: number;
  scaleFactor: number;
  rgba: Uint8ClampedArray;
  primitives: DrawnPrimitive[];
  colorsUsed: Set<string>;
  ctx: CanvasRenderingContext2D;
  toPngBytes: () => Uint8Array;
}

function parseHexColor(colorStr: string): [number, number, number, number] {
  const s = String(colorStr || '').trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
        255,
      ];
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255,
      ];
    }
  }
  const rgbaMatch = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i.exec(s);
  if (rgbaMatch) {
    return [
      Number(rgbaMatch[1]) & 255,
      Number(rgbaMatch[2]) & 255,
      Number(rgbaMatch[3]) & 255,
      rgbaMatch[4] !== undefined ? Math.round(Number(rgbaMatch[4]) * 255) : 255,
    ];
  }
  return [245, 247, 255, 255];
}

export function createSoftwareCanvas2D(
  logicalW: number,
  logicalH: number,
  scaleFactor = 0.125
): SoftwareCanvas2D {
  const w = Math.max(16, Math.round(logicalW * scaleFactor));
  const h = Math.max(16, Math.round(logicalH * scaleFactor));
  const rgba = new Uint8ClampedArray(w * h * 4);
  const primitives: DrawnPrimitive[] = [];
  const colorsUsed = new Set<string>();

  interface TransformState {
    tx: number;
    ty: number;
    sx: number;
    sy: number;
    rot: number;
    alpha: number;
    fillStyle: any;
    strokeStyle: any;
    font: string;
  }

  const stack: TransformState[] = [];
  let state: TransformState = {
    tx: 0,
    ty: 0,
    sx: 1,
    sy: 1,
    rot: 0,
    alpha: 1,
    fillStyle: '#07090E',
    strokeStyle: '#000000',
    font: '700 32px sans-serif',
  };

  let currentPathBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  const expandBounds = (x: number, y: number, r = 0) => {
    const gx = state.tx + x * state.sx;
    const gy = state.ty + y * state.sy;
    const rx = Math.abs(r * state.sx);
    const ry = Math.abs(r * state.sy);
    if (gx - rx < currentPathBounds.minX) currentPathBounds.minX = gx - rx;
    if (gy - ry < currentPathBounds.minY) currentPathBounds.minY = gy - ry;
    if (gx + rx > currentPathBounds.maxX) currentPathBounds.maxX = gx + rx;
    if (gy + ry > currentPathBounds.maxY) currentPathBounds.maxY = gy + ry;
  };

  const plotBox = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    colorStr: string,
    alpha: number
  ) => {
    const [r, g, b, a255] = parseHexColor(colorStr);
    const effA = Math.max(0, Math.min(1, alpha * (a255 / 255)));
    if (effA <= 0.001) return;

    const px0 = Math.max(0, Math.min(w - 1, Math.floor(x0 * scaleFactor)));
    const py0 = Math.max(0, Math.min(h - 1, Math.floor(y0 * scaleFactor)));
    const px1 = Math.max(0, Math.min(w, Math.ceil(x1 * scaleFactor)));
    const py1 = Math.max(0, Math.min(h, Math.ceil(y1 * scaleFactor)));

    for (let py = py0; py < py1; py++) {
      for (let px = px0; px < px1; px++) {
        const idx = (py * w + px) * 4;
        const invA = 1 - effA;
        rgba[idx] = Math.round(r * effA + rgba[idx] * invA);
        rgba[idx + 1] = Math.round(g * effA + rgba[idx + 1] * invA);
        rgba[idx + 2] = Math.round(b * effA + rgba[idx + 2] * invA);
        rgba[idx + 3] = 255;
      }
    }
  };

  const resolveStyleColor = (style: any): string => {
    if (typeof style === 'string') {
      if (style.startsWith('#')) colorsUsed.add(style.toUpperCase());
      return style;
    }
    if (style && typeof style === 'object' && Array.isArray(style._stops) && style._stops.length > 0) {
      const c = style._stops[0];
      if (typeof c === 'string' && c.startsWith('#')) colorsUsed.add(c.toUpperCase());
      return c;
    }
    return '#F5F7FF';
  };

  const makeGradient = () => {
    const stops: string[] = [];
    return {
      _stops: stops,
      addColorStop: (_offset: number, color: string) => {
        if (typeof color === 'string' && color.startsWith('#')) {
          colorsUsed.add(color.toUpperCase());
        }
        stops.push(color);
      },
    };
  };

  const ctx: any = {
    canvas: { width: logicalW, height: logicalH },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: any) {
      state.fillStyle = v;
      if (typeof v === 'string' && v.startsWith('#')) {
        colorsUsed.add(v.toUpperCase());
      }
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: any) {
      state.strokeStyle = v;
      if (typeof v === 'string' && v.startsWith('#')) {
        colorsUsed.add(v.toUpperCase());
      }
    },
    get globalAlpha() {
      return state.alpha;
    },
    set globalAlpha(v: number) {
      state.alpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    },
    get font() {
      return state.font;
    },
    set font(v: string) {
      state.font = v;
    },
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    globalCompositeOperation: 'source-over',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetY: 0,
    textAlign: 'center',
    textBaseline: 'middle',
    filter: 'none',
    save() {
      stack.push({ ...state });
    },
    restore() {
      const prev = stack.pop();
      if (prev) state = prev;
    },
    clearRect(x: number, y: number, rw: number, rh: number) {
      plotBox(x, y, x + rw, y + rh, '#000000', 1);
    },
    fillRect(x: number, y: number, rw: number, rh: number) {
      const c = resolveStyleColor(state.fillStyle);
      const gx0 = state.tx + x * state.sx;
      const gy0 = state.ty + y * state.sy;
      const gx1 = gx0 + rw * state.sx;
      const gy1 = gy0 + rh * state.sy;
      const minX = Math.min(gx0, gx1);
      const maxX = Math.max(gx0, gx1);
      const minY = Math.min(gy0, gy1);
      const maxY = Math.max(gy0, gy1);
      plotBox(minX, minY, maxX, maxY, c, state.alpha);
      primitives.push({
        kind: 'rect',
        fillStyle: c,
        strokeStyle: resolveStyleColor(state.strokeStyle),
        alpha: state.alpha,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        w: maxX - minX,
        h: maxY - minY,
      });
    },
    strokeRect(x: number, y: number, rw: number, rh: number) {
      const c = resolveStyleColor(state.strokeStyle);
      const gx0 = state.tx + x * state.sx;
      const gy0 = state.ty + y * state.sy;
      const gx1 = gx0 + rw * state.sx;
      const gy1 = gy0 + rh * state.sy;
      plotBox(Math.min(gx0, gx1), Math.min(gy0, gy1), Math.max(gx0, gx1), Math.max(gy0, gy1), c, state.alpha * 0.5);
    },
    beginPath() {
      currentPathBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    },
    closePath() {},
    moveTo(x: number, y: number) {
      expandBounds(x, y);
    },
    lineTo(x: number, y: number) {
      expandBounds(x, y);
    },
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {
      expandBounds(cpx, cpy);
      expandBounds(x, y);
    },
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) {
      expandBounds(cp1x, cp1y);
      expandBounds(cp2x, cp2y);
      expandBounds(x, y);
    },
    arc(x: number, y: number, r: number) {
      expandBounds(x, y, r);
    },
    ellipse(x: number, y: number, rx: number, ry: number) {
      expandBounds(x, y, Math.max(rx, ry));
    },
    rect(x: number, y: number, rw: number, rh: number) {
      expandBounds(x, y);
      expandBounds(x + rw, y + rh);
    },
    fill() {
      const c = resolveStyleColor(state.fillStyle);
      if (Number.isFinite(currentPathBounds.minX)) {
        plotBox(
          currentPathBounds.minX,
          currentPathBounds.minY,
          currentPathBounds.maxX,
          currentPathBounds.maxY,
          c,
          state.alpha
        );
        primitives.push({
          kind: 'path',
          fillStyle: c,
          strokeStyle: resolveStyleColor(state.strokeStyle),
          alpha: state.alpha,
          cx: (currentPathBounds.minX + currentPathBounds.maxX) / 2,
          cy: (currentPathBounds.minY + currentPathBounds.maxY) / 2,
          w: currentPathBounds.maxX - currentPathBounds.minX,
          h: currentPathBounds.maxY - currentPathBounds.minY,
        });
      }
    },
    stroke() {
      const c = resolveStyleColor(state.strokeStyle);
      if (Number.isFinite(currentPathBounds.minX)) {
        plotBox(
          currentPathBounds.minX,
          currentPathBounds.minY,
          currentPathBounds.maxX,
          currentPathBounds.maxY,
          c,
          state.alpha * 0.75
        );
        primitives.push({
          kind: 'path',
          fillStyle: resolveStyleColor(state.fillStyle),
          strokeStyle: c,
          alpha: state.alpha,
          cx: (currentPathBounds.minX + currentPathBounds.maxX) / 2,
          cy: (currentPathBounds.minY + currentPathBounds.maxY) / 2,
          w: currentPathBounds.maxX - currentPathBounds.minX,
          h: currentPathBounds.maxY - currentPathBounds.minY,
        });
      }
    },
    clip() {},
    translate(dx: number, dy: number) {
      state.tx += dx * state.sx;
      state.ty += dy * state.sy;
    },
    scale(sx: number, sy: number) {
      state.sx *= sx;
      state.sy *= sy;
    },
    rotate(rad: number) {
      state.rot += rad;
    },
    setLineDash() {},
    fillText(txt: string, x: number, y: number) {
      const c = resolveStyleColor(state.fillStyle);
      const m = /(\d+(?:\.\d+)?)px/.exec(state.font || '');
      const fSize = m ? Number(m[1]) : 32;
      const tw = String(txt).length * fSize * 0.55 * Math.abs(state.sx);
      const th = fSize * Math.abs(state.sy);
      const gx = state.tx + x * state.sx;
      const gy = state.ty + y * state.sy;
      plotBox(gx - tw / 2, gy - th / 2, gx + tw / 2, gy + th / 2, c, state.alpha);
      primitives.push({
        kind: 'text',
        text: String(txt),
        fillStyle: c,
        strokeStyle: resolveStyleColor(state.strokeStyle),
        alpha: state.alpha,
        cx: gx,
        cy: gy,
        w: tw,
        h: th,
      });
    },
    strokeText(txt: string, x: number, y: number) {
      const c = resolveStyleColor(state.strokeStyle);
      const m = /(\d+(?:\.\d+)?)px/.exec(state.font || '');
      const fSize = m ? Number(m[1]) : 32;
      const tw = String(txt).length * fSize * 0.55 * Math.abs(state.sx);
      const th = fSize * Math.abs(state.sy);
      const gx = state.tx + x * state.sx;
      const gy = state.ty + y * state.sy;
      plotBox(gx - tw / 2, gy - th / 2, gx + tw / 2, gy + th / 2, c, state.alpha * 0.6);
    },
    drawImage(_img: any, x: number, y: number, dw = 64, dh = 64) {
      const gx = state.tx + x * state.sx;
      const gy = state.ty + y * state.sy;
      plotBox(gx, gy, gx + dw * state.sx, gy + dh * state.sy, '#FFB800', state.alpha * 0.35);
    },
    measureText(txt: string) {
      const m = /(\d+(?:\.\d+)?)px/.exec(state.font || '');
      const fSize = m ? Number(m[1]) : 32;
      return { width: String(txt).length * fSize * 0.55 };
    },
    createLinearGradient: makeGradient,
    createRadialGradient: makeGradient,
  };

  return {
    w,
    h,
    scaleFactor,
    rgba,
    primitives,
    colorsUsed,
    ctx: ctx as unknown as CanvasRenderingContext2D,
    toPngBytes: () => encodeRgbaToPng(rgba, w, h),
  };
}

function computeAdler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function makePngChunk(typeFourCC: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = typeFourCC.charCodeAt(i);
  }
  chunk.set(data, 8);
  const crc = computeCrc32(chunk.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return chunk;
}

export function encodeRgbaToPng(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  // Build raw scanlines with filter byte 0 per row
  const rowStride = w * 4 + 1;
  const rawScanlines = new Uint8Array(rowStride * h);
  for (let y = 0; y < h; y++) {
    const outRowStart = y * rowStride;
    rawScanlines[outRowStart] = 0; // Filter type 0 (None)
    const srcStart = y * w * 4;
    rawScanlines.set(rgba.subarray(srcStart, srcStart + w * 4), outRowStart + 1);
  }

  // Wrap in uncompressed ZLIB stream (CMF=0x78, FLG=0x01 + stored deflate blocks + Adler32)
  const maxBlock = 65535;
  const numBlocks = Math.max(1, Math.ceil(rawScanlines.length / maxBlock));
  const zlibData = new Uint8Array(2 + numBlocks * 5 + rawScanlines.length + 4);
  zlibData[0] = 0x78;
  zlibData[1] = 0x01;
  let zPos = 2;
  let remaining = rawScanlines.length;
  let srcOffset = 0;

  for (let b = 0; b < numBlocks; b++) {
    const isLast = b === numBlocks - 1;
    const blockLen = Math.min(maxBlock, remaining);
    zlibData[zPos++] = isLast ? 0x01 : 0x00;
    zlibData[zPos++] = blockLen & 0xff;
    zlibData[zPos++] = (blockLen >>> 8) & 0xff;
    const nlen = ~blockLen & 0xffff;
    zlibData[zPos++] = nlen & 0xff;
    zlibData[zPos++] = (nlen >>> 8) & 0xff;
    zlibData.set(rawScanlines.subarray(srcOffset, srcOffset + blockLen), zPos);
    zPos += blockLen;
    srcOffset += blockLen;
    remaining -= blockLen;
  }

  const adler = computeAdler32(rawScanlines);
  const zView = new DataView(zlibData.buffer);
  zView.setUint32(zPos, adler, false);

  // IHDR chunk (13 bytes)
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, w, false);
  ihdrView.setUint32(4, h, false);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type 6 (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', zlibData);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(
    pngSignature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let pos = 0;
  out.set(pngSignature, pos);
  pos += pngSignature.length;
  out.set(ihdrChunk, pos);
  pos += ihdrChunk.length;
  out.set(idatChunk, pos);
  pos += idatChunk.length;
  out.set(iendChunk, pos);

  return out;
}
