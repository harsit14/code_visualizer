import { TimeoutError } from './runtimeClient';
import type { Language, SessionResult } from './types';

type JsLanguage = Extract<Language, 'javascript' | 'typescript'>;

export function runJavaScriptInWorker(
  source: string,
  language: JsLanguage,
  timeoutMs: number,
): Promise<SessionResult> {
  const worker = new Worker(new URL('./jsTraceWorker.ts', import.meta.url), {
    type: 'module',
  });

  return new Promise<SessionResult>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      worker.terminate();
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent<SessionResult>) => {
      window.clearTimeout(timeoutId);
      worker.terminate();
      resolve(event.data);
    };

    worker.onerror = (event) => {
      window.clearTimeout(timeoutId);
      worker.terminate();
      reject(new Error(event.message || 'JavaScript worker crashed.'));
    };

    worker.postMessage({ source, language });
  });
}
