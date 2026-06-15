import { runJavaScriptTrace } from './jsTraceEngine';
import type { Language } from './types';

type WorkerRequest = {
  language: Extract<Language, 'javascript' | 'typescript'>;
  source: string;
};

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  self.postMessage(runJavaScriptTrace(event.data.source, event.data.language));
});
