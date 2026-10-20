import { validateExpression } from '../core/expr.ts';

const FORBIDDEN = [
  'Math.random',
  'Date',
  'window',
  'document',
  'fetch',
  'eval',
  'Function',
  'import',
  'XMLHttpRequest',
  'localStorage',
  'setTimeout',
  'requestAnimationFrame',
];

self.onmessage = (event: MessageEvent) => {
  const { id, code, expr } = event.data || {};
  if (expr !== undefined) {
    const res = validateExpression(String(expr));
    self.postMessage({ id, ...res });
    return;
  }

  const body = String(code || '');
  for (const ident of FORBIDDEN) {
    const re = new RegExp(`\\b${ident.replace('.', '\\.')}\\b`);
    if (re.test(body)) {
      self.postMessage({
        id,
        valid: false,
        error: `Forbidden identifier "${ident}" in code layer`,
      });
      return;
    }
  }

  try {
    new Function('ctx', 't', 'p', 'w', 'h', 'api', body);
    self.postMessage({ id, valid: true });
  } catch (err: any) {
    self.postMessage({
      id,
      valid: false,
      error: err?.message ?? 'Syntax error in code layer',
    });
  }
};
