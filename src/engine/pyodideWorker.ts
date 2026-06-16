/**
 * Pyodide Web Worker.
 *
 * Loads the Python engine package (engine/codeviz/*.py, bundled as raw
 * text) into the Pyodide virtual filesystem and dispatches JSON requests
 * to `codeviz.api.handle_request`.
 */
import { loadPyodide, version as pyodideVersion, type PyodideAPI } from 'pyodide';
import type { RuntimeStatus, WorkerInbound, WorkerOutbound } from './types';

import enginInitPy from '../../engine/codeviz/__init__.py?raw';
import structuresPy from '../../engine/codeviz/structures.py?raw';
import serializePy from '../../engine/codeviz/serialize.py?raw';
import analyzerPy from '../../engine/codeviz/analyzer.py?raw';
import inputgenPy from '../../engine/codeviz/inputgen.py?raw';
import tracerPy from '../../engine/codeviz/tracer.py?raw';
import runnerPy from '../../engine/codeviz/runner.py?raw';
import apiPy from '../../engine/codeviz/api.py?raw';

const ENGINE_FILES: Record<string, string> = {
  '__init__.py': enginInitPy,
  'structures.py': structuresPy,
  'serialize.py': serializePy,
  'analyzer.py': analyzerPy,
  'inputgen.py': inputgenPy,
  'tracer.py': tracerPy,
  'runner.py': runnerPy,
  'api.py': apiPy,
};

let pyodidePromise: Promise<PyodideAPI> | null = null;
let interruptBuffer: Uint8Array | undefined;

function post(message: WorkerOutbound) {
  self.postMessage(message);
}

function emitStatus(phase: RuntimeStatus['phase'], message: string) {
  post({
    type: 'status',
    status: { phase, message, interruptSupported: Boolean(interruptBuffer) },
  });
}

function getPyodideBaseUrl() {
  const assetPath = import.meta.env.DEV
    ? '/node_modules/pyodide/'
    : `${import.meta.env.BASE_URL}assets/pyodide/`;

  return new URL(assetPath, self.location.origin).toString();
}

async function ensurePyodide(): Promise<PyodideAPI> {
  if (!pyodidePromise) {
    emitStatus('loading', 'Loading Python runtime');
    pyodidePromise = loadPyodide({ indexURL: getPyodideBaseUrl() }).then((pyodide) => {
      if (interruptBuffer) {
        pyodide.setInterruptBuffer(interruptBuffer);
      }

      pyodide.FS.mkdirTree('/codeviz_engine/codeviz');
      for (const [name, contents] of Object.entries(ENGINE_FILES)) {
        pyodide.FS.writeFile(`/codeviz_engine/codeviz/${name}`, contents);
      }
      pyodide.runPython(
        [
          'import sys',
          "sys.path.insert(0, '/codeviz_engine')",
          'import codeviz.api as _codeviz_api',
        ].join('\n'),
      );

      emitStatus('ready', 'ready');
      return pyodide;
    });
  }

  return pyodidePromise;
}

async function handleRequest(requestId: string, request: unknown) {
  const startedAt = performance.now();

  try {
    const pyodide = await ensurePyodide();
    emitStatus('running', 'Running Python code');
    pyodide.globals.set('_codeviz_request_json', JSON.stringify(request));
    const responseJson = pyodide.runPython(
      '_codeviz_api.handle_request(_codeviz_request_json)',
    ) as string;
    pyodide.runPython('del _codeviz_request_json');
    const data = JSON.parse(responseJson) as Record<string, unknown>;
    data.pyodideVersion = pyodideVersion;

    post({
      type: 'response',
      requestId,
      data,
      durationMs: performance.now() - startedAt,
    });
    emitStatus('ready', 'ready');
  } catch (error) {
    // handle_request never throws for Python-level errors, so anything here
    // is a worker/runtime failure (including interrupt during dispatch).
    const name = error instanceof Error ? error.name : 'WorkerError';
    const message = error instanceof Error ? error.message : String(error);
    post({
      type: 'response',
      requestId,
      data: {
        error: {
          type: message.includes('KeyboardInterrupt') ? 'KeyboardInterrupt' : name,
          msg: message,
        },
      },
      durationMs: performance.now() - startedAt,
    });
    emitStatus('ready', 'ready');
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerInbound>) => {
  const message = event.data;

  if (message.type === 'setInterruptBuffer') {
    interruptBuffer = message.interruptBuffer;
    if (pyodidePromise) {
      void pyodidePromise.then((pyodide) => pyodide.setInterruptBuffer(message.interruptBuffer));
    }
    return;
  }

  if (message.type === 'request') {
    void handleRequest(message.requestId, message.request);
  }
});
