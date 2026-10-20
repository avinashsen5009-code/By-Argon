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

const FORBIDDEN_IDENTIFIERS = new Set([
  'constructor',
  '__proto__',
  'prototype',
  'process',
  'window',
  'globalThis',
  'self',
  'document',
  'Function',
  'eval',
  'setTimeout',
  'setInterval',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'import',
  'require',
  'while',
  'for',
  'do',
]);

type Token =
  | { type: 'num'; val: number }
  | { type: 'str'; val: string }
  | { type: 'id'; val: string }
  | { type: 'op'; val: string }
  | { type: 'paren'; val: '(' | ')' }
  | { type: 'question' }
  | { type: 'colon' }
  | { type: 'comma' }
  | { type: 'eof' };

export type CompiledExprFn = (ctx: ExprContext) => number;

const compiledClosureCache = new Map<string, CompiledExprFn>();

export function tokenizeExpr(src: string): Token[] {
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
    if (ch === '?') {
      tokens.push({ type: 'question' });
      idx++;
      continue;
    }
    if (ch === ':') {
      tokens.push({ type: 'colon' });
      idx++;
      continue;
    }
    // Two-character comparison operators
    const twoChar = src.slice(idx, idx + 2);
    if (twoChar === '<=' || twoChar === '>=' || twoChar === '==' || twoChar === '!=') {
      tokens.push({ type: 'op', val: twoChar });
      idx += 2;
      continue;
    }
    if ('+-*/%^<>'.includes(ch)) {
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
      if (idx >= src.length) {
        throw new Error(`Unterminated string literal in expression "${src}"`);
      }
      idx++; // skip closing quote
      tokens.push({ type: 'str', val: str });
      continue;
    }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(src[idx + 1] ?? ''))) {
      let numStr = '';
      let dotCount = 0;
      while (idx < src.length && /[\d.]/.test(src[idx])) {
        if (src[idx] === '.') dotCount++;
        if (dotCount > 1) {
          throw new Error(`Invalid number literal or member access in expression "${src}"`);
        }
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
      if (FORBIDDEN_IDENTIFIERS.has(id)) {
        throw new Error(`Forbidden identifier "${id}" in expression`);
      }
      tokens.push({ type: 'id', val: id });
      continue;
    }
    throw new Error(`Unexpected character "${ch}" in expression "${src}"`);
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

function leftBindingPower(tok: Token): number {
  if (tok.type === 'question') return 10;
  if (tok.type === 'op') {
    switch (tok.val) {
      case '==':
      case '!=':
        return 20;
      case '<':
      case '>':
      case '<=':
      case '>=':
        return 30;
      case '+':
      case '-':
        return 40;
      case '*':
      case '/':
      case '%':
        return 50;
      case '^':
        return 60;
    }
  }
  return 0;
}

/**
 * Pratt parser that compiles a SPEC 8d expression into a pure closure `(ctx: ExprContext) => number`.
 * Never uses `eval` or `new Function`.
 */
export function compileExpression(expr: string): CompiledExprFn {
  const cached = compiledClosureCache.get(expr);
  if (cached) return cached;

  const tokens = tokenizeExpr(expr);
  let pos = 0;

  function peek(): Token {
    return tokens[pos] ?? { type: 'eof' };
  }

  function consume(): Token {
    return tokens[pos++] ?? { type: 'eof' };
  }

  function parseExpr(rbp = 0): CompiledExprFn {
    const t = consume();
    let left = nud(t);

    while (rbp < leftBindingPower(peek())) {
      const opTok = consume();
      left = led(opTok, left);
    }

    return left;
  }

  function nud(tok: Token): CompiledExprFn {
    if (tok.type === 'num') {
      const v = tok.val;
      return () => v;
    }

    if (tok.type === 'op' && (tok.val === '-' || tok.val === '+')) {
      const operand = parseExpr(70);
      return tok.val === '-' ? (ctx) => -operand(ctx) : operand;
    }

    if (tok.type === 'paren' && tok.val === '(') {
      const inner = parseExpr(0);
      const next = consume();
      if (next.type !== 'paren' || next.val !== ')') {
        throw new Error(`Expected closing ")" in expression "${expr}"`);
      }
      return inner;
    }

    if (tok.type === 'id') {
      const name = tok.val;
      const next = peek();
      if (next.type === 'paren' && next.val === '(') {
        if (!ALLOWED_FUNCS.has(name)) {
          throw new Error(`Unknown function "${name}" in expression`);
        }
        consume(); // consume '('
        const argClosures: ((ctx: ExprContext) => number | string)[] = [];
        while (peek().type !== 'eof') {
          const pk = peek();
          if (pk.type === 'paren' && pk.val === ')') {
            consume();
            break;
          }
          if (pk.type === 'str') {
            consume();
            const s = pk.val;
            argClosures.push(() => s);
          } else if (pk.type === 'id' && name === 'ease' && argClosures.length === 0) {
            consume();
            const s = pk.val;
            argClosures.push(() => s);
          } else {
            const sub = parseExpr(0);
            argClosures.push(sub);
          }
          if (peek().type === 'comma') {
            consume();
          } else if (peek().type !== 'paren' || (peek() as any).val !== ')') {
            throw new Error(`Expected "," or ")" in function "${name}" call`);
          }
        }
        return (ctx) => {
          const evaluatedArgs = argClosures.map((fn) => fn(ctx));
          return callFunc(name, evaluatedArgs, ctx);
        };
      }

      if (!ALLOWED_VARS.has(name)) {
        throw new Error(`Unknown variable "${name}" in expression`);
      }
      return (ctx) => lookupVar(name, ctx);
    }

    throw new Error(`Unexpected token in expression "${expr}"`);
  }

  function led(tok: Token, left: CompiledExprFn): CompiledExprFn {
    if (tok.type === 'question') {
      const thenBranch = parseExpr(0);
      const colonTok = consume();
      if (colonTok.type !== 'colon') {
        throw new Error(`Expected ":" in ternary expression "${expr}"`);
      }
      const elseBranch = parseExpr(9);
      return (ctx) => (left(ctx) !== 0 ? thenBranch(ctx) : elseBranch(ctx));
    }

    if (tok.type === 'op') {
      const op = tok.val;
      const lbp = leftBindingPower(tok);
      // Right-associative for exponentiation `^`
      const right = parseExpr(op === '^' ? lbp - 1 : lbp);
      switch (op) {
        case '+':
          return (ctx) => left(ctx) + right(ctx);
        case '-':
          return (ctx) => left(ctx) - right(ctx);
        case '*':
          return (ctx) => left(ctx) * right(ctx);
        case '/':
          return (ctx) => {
            const r = right(ctx);
            return Math.abs(r) < 1e-12 ? 0 : left(ctx) / r;
          };
        case '%':
          return (ctx) => {
            const r = right(ctx);
            return Math.abs(r) < 1e-12 ? 0 : left(ctx) % r;
          };
        case '^':
          return (ctx) => Math.pow(left(ctx), right(ctx));
        case '<':
          return (ctx) => (left(ctx) < right(ctx) ? 1 : 0);
        case '>':
          return (ctx) => (left(ctx) > right(ctx) ? 1 : 0);
        case '<=':
          return (ctx) => (left(ctx) <= right(ctx) ? 1 : 0);
        case '>=':
          return (ctx) => (left(ctx) >= right(ctx) ? 1 : 0);
        case '==':
          return (ctx) => (Math.abs(left(ctx) - right(ctx)) < 1e-9 ? 1 : 0);
        case '!=':
          return (ctx) => (Math.abs(left(ctx) - right(ctx)) >= 1e-9 ? 1 : 0);
      }
    }

    throw new Error(`Unexpected infix token in expression "${expr}"`);
  }

  const rootFn = parseExpr(0);
  if (peek().type !== 'eof') {
    throw new Error(`Unexpected trailing tokens in expression "${expr}"`);
  }

  const safeClosure: CompiledExprFn = (ctx) => {
    const val = rootFn(ctx);
    return Number.isFinite(val) ? val : 0;
  };

  compiledClosureCache.set(expr, safeClosure);
  return safeClosure;
}

export function validateExpression(expr: string): { valid: boolean; error?: string } {
  try {
    compileExpression(expr);
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err?.message ?? 'Invalid expression syntax' };
  }
}

export function evaluateExpression(expr: string, ctx: ExprContext): number {
  try {
    const fn = compileExpression(expr);
    return fn(ctx);
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
