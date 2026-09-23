import { JsSourceError } from './jsInstrument';
import { runJavaScriptTrace, sourceErrorResult } from './jsTraceEngine';
import type { Language, SessionResult } from './types';

type WorkerRequest = {
  language: Extract<Language, 'javascript' | 'typescript'>;
  source: string;
};

async function trace({ language, source }: WorkerRequest): Promise<SessionResult> {
  if (language !== 'typescript') return runJavaScriptTrace(source, language);
  try {
    // Sucrase is only needed for TypeScript, so it loads on first use.
    const { runTypeScriptTrace } = await import('./tsTrace');
    return runTypeScriptTrace(source);
  } catch {
    return sourceErrorResult(
      new JsSourceError(
        'LoadError',
        'The TypeScript transform could not be loaded. Check your connection and run again.',
        1,
      ),
    );
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  void trace(event.data).then((result) => self.postMessage(result));
});
