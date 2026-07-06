import { RuntimeClient } from './runtimeClient';
import type { RuntimeStatus } from './types';

let sharedClient: RuntimeClient | null = null;

export function getPythonRuntimeClient(onStatus?: (status: RuntimeStatus) => void): RuntimeClient {
  if (!sharedClient) {
    sharedClient = new RuntimeClient({ onStatus });
  } else {
    sharedClient.setStatusHandler(onStatus, true);
  }
  return sharedClient;
}

export function prewarmPythonRuntime() {
  getPythonRuntimeClient().prewarm();
}

export function clearPythonRuntimeStatusHandler(client: RuntimeClient | null | undefined) {
  if (client && client === sharedClient) {
    client.setStatusHandler(undefined);
  }
}
