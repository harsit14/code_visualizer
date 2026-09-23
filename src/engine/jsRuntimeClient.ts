import { ExecutionCancelledError, TimeoutError } from './runtimeClient';
import type { Language, SessionResult } from './types';

type JsLanguage = Extract<Language, 'javascript' | 'typescript'>;

export function runJavaScriptInWorker(
  source: string,
  language: JsLanguage,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SessionResult> {
  if (signal?.aborted) return Promise.reject(new ExecutionCancelledError());
  return new Promise<SessionResult>((resolve, reject) => {
    const worker = new Worker(new URL('./jsTraceWorker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error?: Error, data?: SessionResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      if (error) reject(error);
      else resolve(data!);
    };
    const cancel = () => finish(new ExecutionCancelledError());
    const timeoutId = window.setTimeout(
      () =>
        finish(
          new TimeoutError(timeoutMs, language === 'typescript' ? 'TypeScript' : 'JavaScript'),
        ),
      timeoutMs,
    );
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<SessionResult>) => finish(undefined, event.data);
    worker.onerror = (event) => finish(new Error(event.message || 'JavaScript worker crashed.'));
    worker.onmessageerror = () =>
      finish(new Error('JavaScript worker returned an unreadable message.'));
    try {
      worker.postMessage({ source, language });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
