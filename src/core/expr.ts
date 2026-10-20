import { clamp, ease, lerp, seededNoise, seededRand, seededWiggle, smoothstep } from './ease.ts';

export interface ExprContext {
  t: number;    // seconds since layer start
  p: number;    // 0-1 progress
  T: number;    // global time
  d: number;    // layer duration
  i: number;    // index in stagger/group
  n: number;    // count in stagger/group
  w: number;    // layer or canvas width
  h: number;    // layer or canvas height
  seed: number; // deterministic seed
}

const ALLOWED_VARS = new Set(['t', 'p', 'T', 'd', 'i', 'n', 'w', 'h', 'seed', 'PI', 'TAU']);
const ALLOWED_FUNCS = new Set([
  'sin',
  'cos',
  'abs',
  'min',
  'max',
  'pow',
  'sqrt',
  'floor',
  'mod',
  'clamp',
  'lerp',
  'smooth',
  'noise',
  'rand',
  'wiggle',
  'ease',
]);

type Token =
  | { type: 'num'; val: number }
  | { type: 'str'; val: string }
  | { type: 'id'; val: string }
  | { type: 'op'; val: string }
  | { type: 'paren'; val: '(' | ')' }
  | { type: 'comma' };

function tokenizeExpr(src: string): Token[] {
  const tokens: Token[] = [];
  let idx = 0;
  while (idx < src.length) {
    const ch = src[idx];
    if (/\s/.test(ch)) {
      idx++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', val: ch });
      idx++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma' });
      idx++;
      continue;
    }
    if ('+-*/%^'.includes(ch)) {
      tokens.push({ type: 'op', val: ch });
      idx++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      idx++;
      let str = '';
      while (idx < src.length && src[idx] !== quote) {
        str += src[idx++];
      }
      idx++; // skip closing quote
      tokens.push({ type: 'str', val: str });
      continue;
    }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(src[idx + 1] ?? ''))) {
      let numStr = '';
      while (idx < src.length && /[\d.]/.test(src[idx])) {
        numStr += src[idx++];
      }
      tokens.push({ type: 'num', val: parseFloat(numStr) });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = '';
      while (idx < src.length && /[a-zA-Z0-9_]/.test(src[idx])) {
        id += src[idx++];
      }
      tokens.push({ type: 'id', val: id });
      continue;
    }
    throw new Error(`Unexpected character "${ch}" in expression "${src}"`);
  }
  return tokens;
}

export function validateExpression(expr: string): { valid: boolean; error?: string } {
  try {
    const tokens = tokenizeExpr(expr);
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.type === 'id') {
        const next = tokens[i + 1];
        if (next && next.type === 'paren' && next.val === '(') {
          if (!ALLOWED_FUNCS.has(tok.val)) {
            return { valid: false, error: `Unknown function "${tok.val}" in expression` };
          }
        } else {
          if (!ALLOWED_VARS.has(tok.val)) {
            return { valid: false, error: `Unknown variable "${tok.val}" in expression` };
          }
        }
      }
    }
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err?.message ?? 'Invalid expression syntax' };
  }
}

export function evaluateExpression(expr: string, ctx: ExprContext): number {
  try {
    const tokens = tokenizeExpr(expr);
    let pos = 0;

    function parseAddSub(): number {
      let left = parseMulDiv();
      while (pos < tokens.length) {
        const tok = tokens[pos];
        if (tok.type === 'op' && (tok.val === '+' || tok.val === '-')) {
          pos++;
          const right = parseMulDiv();
          left = tok.val === '+' ? left + right : left - right;
        } else {
          break;
        }
      }
      return left;
    }

    function parseMulDiv(): number {
      let left = parseUnary();
      while (pos < tokens.length) {
        const tok = tokens[pos];
        if (tok.type === 'op' && (tok.val === '*' || tok.val === '/' || tok.val === '%' || tok.val === '^')) {
          pos++;
          const right = parseUnary();
          if (tok.val === '*') left *= right;
          else if (tok.val === '/') left = Math.abs(right) < 1e-12 ? 0 : left / right;
          else if (tok.val === '%') left = Math.abs(right) < 1e-12 ? 0 : left % right;
          else if (tok.val === '^') left = Math.pow(left, right);
        } else {
          break;
        }
      }
      return left;
    }

    function parseUnary(): number {
      const tok = tokens[pos];
      if (tok && tok.type === 'op' && (tok.val === '+' || tok.val === '-')) {
        pos++;
        const v = parseUnary();
        return tok.val === '-' ? -v : v;
      }
      return parsePrimary();
    }

    function parsePrimary(): number {
      const tok = tokens[pos];
      if (!tok) return 0;

      if (tok.type === 'num') {
        pos++;
        return tok.val;
      }

      if (tok.type === 'paren' && tok.val === '(') {
        pos++;
        const val = parseAddSub();
        if (tokens[pos]?.type === 'paren' && (tokens[pos] as any).val === ')') {
          pos++;
        }
        return val;
      }

      if (tok.type === 'id') {
        pos++;
        const next = tokens[pos];
        if (next && next.type === 'paren' && next.val === '(') {
          pos++; // consume '('
          const args: (number | string)[] = [];
          while (pos < tokens.length) {
            const peek = tokens[pos];
            if (peek.type === 'paren' && peek.val === ')') {
              pos++;
              break;
            }
            if (peek.type === 'str') {
              args.push(peek.val);
              pos++;
            } else if (peek.type === 'id' && tok.val === 'ease' && args.length === 0) {
              args.push(peek.val);
              pos++;
            } else {
              args.push(parseAddSub());
            }
            if (tokens[pos]?.type === 'comma') {
              pos++;
            }
          }
          return callFunc(tok.val, args, ctx);
        } else {
          return lookupVar(tok.val, ctx);
        }
      }

      pos++;
      return 0;
    }

    const res = parseAddSub();
    return Number.isFinite(res) ? res : 0;
  } catch {
    return 0;
  }
}

function lookupVar(name: string, ctx: ExprContext): number {
  switch (name) {
    case 't':
      return ctx.t;
    case 'p':
      return ctx.p;
    case 'T':
      return ctx.T;
    case 'd':
      return ctx.d;
    case 'i':
      return ctx.i;
    case 'n':
      return ctx.n;
    case 'w':
      return ctx.w;
    case 'h':
      return ctx.h;
    case 'seed':
      return ctx.seed;
    case 'PI':
      return Math.PI;
    case 'TAU':
      return Math.PI * 2;
    default:
      return 0;
  }
}

function callFunc(name: string, args: (number | string)[], ctx: ExprContext): number {
  const num = (idx: number, def = 0): number => {
    const v = args[idx];
    return typeof v === 'number' && Number.isFinite(v) ? v : def;
  };
  switch (name) {
    case 'sin':
      return Math.sin(num(0));
    case 'cos':
      return Math.cos(num(0));
    case 'abs':
      return Math.abs(num(0));
    case 'min':
      return Math.min(num(0), num(1));
    case 'max':
      return Math.max(num(0), num(1));
    case 'pow':
      return Math.pow(num(0), num(1, 1));
    case 'sqrt':
      return Math.sqrt(Math.max(0, num(0)));
    case 'floor':
      return Math.floor(num(0));
    case 'mod': {
      const b = num(1, 1);
      return Math.abs(b) < 1e-12 ? 0 : ((num(0) % b) + b) % b;
    }
    case 'clamp':
      return clamp(num(0), num(1, 0), num(2, 1));
    case 'lerp':
      return lerp(num(0), num(1), num(2));
    case 'smooth':
      return smoothstep(num(0, 0), num(1, 1), num(2, ctx.p));
    case 'noise':
      return seededNoise(num(0, ctx.t), num(1, ctx.seed));
    case 'rand':
      return seededRand(num(0, ctx.seed));
    case 'wiggle':
      return seededWiggle(ctx.t, num(0, 2), num(1, 1), num(2, ctx.seed));
    case 'ease': {
      const easeName = typeof args[0] === 'string' ? args[0] : 'outCubic';
      return ease(easeName, num(1, ctx.p));
    }
    default:
      return 0;
  }
}
