// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class Port {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  emit(payload: object) {
    this.onmessage?.({ data: JSON.stringify({ version: 1, nonce, ...payload }) });
  }
}
class ExecutionWorker {
  static instances: ExecutionWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror = null;
  onmessageerror = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    ExecutionWorker.instances.push(this);
  }
}
const nonce = 'a-fresh-test-session-nonce';
let listeners: Array<[string, EventListenerOrEventListenerObject]>;
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_RUNNER_APP_ORIGIN', 'https://app.example');
  vi.stubGlobal('Worker', ExecutionWorker);
  ExecutionWorker.instances = [];
  listeners = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    listeners.push([type, listener]);
    add(type, listener, options);
  });
  await import('./bootstrap');
});
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  for (const [type, listener] of listeners) window.removeEventListener(type, listener);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function initialize(port: Port, origin = 'https://app.example', source: Window | null = window) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source,
      origin,
      ports: [port as unknown as MessagePort],
      data: { type: 'initialize', version: 1, nonce, language: 'python' },
    }),
  );
}
const run = (requestId: string) => ({
  type: 'request',
  requestId,
  request: { op: 'run', source: 'print(1)' },
});
describe('runner bootstrap boundary', () => {
  it('accepts only the configured parent and initializes once', () => {
    const rejected = new Port();
    initialize(rejected, 'https://attacker.example');
    initialize(rejected, 'https://app.example', null);
    expect(ExecutionWorker.instances).toHaveLength(0);
    const port = new Port();
    initialize(port);
    initialize(rejected);
    expect(ExecutionWorker.instances).toHaveLength(1);
    expect(JSON.parse(port.postMessage.mock.calls[0][0])).toMatchObject({
      type: 'ready',
      nonce,
      version: 1,
    });
    expect(rejected.postMessage).not.toHaveBeenCalled();
  });
  it('rejects replayed request sequences and terminates the worker', () => {
    const port = new Port();
    initialize(port);
    const worker = ExecutionWorker.instances[0];
    port.emit({ type: 'send', seq: 1, payload: run('one') });
    worker.onmessage?.({ data: { type: 'response', requestId: 'one', data: {} } });
    port.emit({ type: 'send', seq: 1, payload: run('two') });
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(JSON.parse(port.postMessage.mock.calls.at(-1)![0])).toMatchObject({
      type: 'failure',
      message: 'Invalid runner request sequence.',
    });
    port.emit({ type: 'send', seq: 2, payload: run('three') });
    expect(worker.postMessage).toHaveBeenCalledOnce();
  });
  it('rejects overlapping work and honors explicit disposal', () => {
    const port = new Port();
    initialize(port);
    const worker = ExecutionWorker.instances[0];
    port.emit({ type: 'send', seq: 1, payload: run('one') });
    port.emit({ type: 'send', seq: 2, payload: run('two') });
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(port.close).toHaveBeenCalledOnce();
  });
  it('terminates on disposal without forwarding it as executable work', () => {
    const port = new Port();
    initialize(port);
    const worker = ExecutionWorker.instances[0];
    port.emit({ type: 'dispose' });
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(port.close).toHaveBeenCalledOnce();
  });
});
