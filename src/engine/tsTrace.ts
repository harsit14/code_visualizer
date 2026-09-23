/**
 * TypeScript tracing: Sucrase removes type syntax while keeping every statement
 * on its original line, then the JavaScript tracer runs the result. Kept in its
 * own module so the worker loads Sucrase only for TypeScript runs.
 */
import { transform } from 'sucrase';
import { JsSourceError } from './jsInstrument';
import { runJavaScriptTrace } from './jsTraceEngine';
import type { SessionResult } from './types';

const NAMESPACE = /^[ \t]*(?:export[ \t]+)?(?:namespace|module)[ \t]+[A-Za-z_$][\w$.]*[ \t]*\{/m;

export function stripTypeScript(source: string): string {
  const namespace = NAMESPACE.exec(source);
  if (namespace) {
    // Sucrase drops namespace bodies, which would silently remove user code.
    throw new JsSourceError(
      'NotSupportedError',
      'TypeScript namespaces are not supported by the tracer yet.',
      source.slice(0, namespace.index + namespace[0].search(/\S/)).split('\n').length,
    );
  }
  try {
    return transform(source, { transforms: ['typescript'], disableESTransforms: true }).code;
  } catch (error) {
    const loc = (error as { loc?: { line: number; column: number } }).loc;
    const message = String((error as Error).message ?? error).replace(/\s*\(\d+:\d+\)$/, '');
    throw new JsSourceError('SyntaxError', message, loc?.line ?? 1, loc?.column ?? null);
  }
}

export function runTypeScriptTrace(source: string): SessionResult {
  return runJavaScriptTrace(source, 'typescript', stripTypeScript);
}
