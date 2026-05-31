import { useCallback, useEffect, useRef, useState } from 'react';
import { PythonRuntimeClient } from './pythonRuntimeClient';
import type { PythonRunOptions, PythonRuntimeStatus } from './runtimeTypes';

const INITIAL_STATUS: PythonRuntimeStatus = {
  phase: 'idle',
  message: 'Python runtime has not loaded yet',
  interruptSupported: false,
};

export function usePythonRuntime() {
  const [runtimeStatus, setRuntimeStatus] = useState<PythonRuntimeStatus>(INITIAL_STATUS);
  const runtimeRef = useRef<PythonRuntimeClient | null>(null);

  useEffect(() => {
    runtimeRef.current = new PythonRuntimeClient({
      onStatus: setRuntimeStatus,
    });

    return () => {
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, []);

  const runPython = useCallback((source: string, options?: PythonRunOptions) => {
    if (!runtimeRef.current) {
      return Promise.reject(new Error('Python runtime client is not ready.'));
    }

    return runtimeRef.current.run(source, options);
  }, []);

  return {
    runPython,
    runtimeStatus,
  };
}
