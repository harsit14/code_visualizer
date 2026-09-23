// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IframeTransport } from './iframeTransport';
import { runJavaScriptTrace } from '../engine/jsTraceEngine';
class Port {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  emit(data: unknown) {
    this.onmessage?.({ data });
  }
}
class Channel {
  static instances: Channel[] = [];
  port1 = new Port();
  port2 = new Port();
  constructor() {
    Channel.instances.push(this);
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('MessageChannel', Channel);
  Channel.instances = [];
});
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup() {
  const transport = new IframeTransport('https://runner.example/runner.html', 'javascript');
  const frame = document.querySelector('iframe')!;
  const init = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  frame.dispatchEvent(new Event('load'));
  const args = init.mock.calls[0];
  const nonce = (args[0] as { nonce: string }).nonce;
  const port = Channel.instances.at(-1)!.port1;
  return { transport, frame, port, nonce, args };
}
describe('isolated iframe transport', () => {
  it('handshakes with the exact target origin and queues code until ready', () => {
    const { transport, frame, port, nonce, args } = setup();
    expect(args[1]).toBe('https://runner.example');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame.referrerPolicy).toBe('no-referrer');
    transport.postMessage({ language: 'javascript', source: 'const n = 1;' });
    expect(port.postMessage).not.toHaveBeenCalled();
    port.emit(JSON.stringify({ type: 'ready', version: 1, nonce }));
    expect(JSON.parse(port.postMessage.mock.calls[0][0])).toMatchObject({
      seq: 1,
      payload: { source: 'const n = 1;' },
    });
    const received = vi.fn();
    transport.onmessage = received;
    port.emit(
      JSON.stringify({
        type: 'message',
        version: 1,
        nonce,
        payload: runJavaScriptTrace('const n = 1;', 'javascript'),
      }),
    );
    expect(received).toHaveBeenCalledOnce();
    transport.terminate();
    expect(document.querySelector('iframe')).toBeNull();
    expect(port.close).toHaveBeenCalledOnce();
  });
  it.each(['version', 'nonce', 'payload'])('fails closed on a bad %s', (field) => {
    const { transport, port, nonce } = setup();
    const error = vi.fn();
    transport.onerror = error;
    port.emit(JSON.stringify({ type: 'ready', version: 1, nonce }));
    const msg: Record<string, unknown> = {
      type: 'message',
      version: 1,
      nonce,
      payload: runJavaScriptTrace('', 'javascript'),
    };
    msg[field] = 'invalid';
    port.emit(JSON.stringify(msg));
    expect(error).toHaveBeenCalledOnce();
    expect(document.querySelector('iframe')).toBeNull();
    expect(() => transport.postMessage({})).toThrow('closed');
  });
  it('bounds handshake time and ignores late messages after cancellation', () => {
    const { transport, port, nonce } = setup();
    const error = vi.fn();
    const message = vi.fn();
    transport.onerror = error;
    transport.onmessage = message;
    vi.advanceTimersByTime(15000);
    expect(error).toHaveBeenCalledOnce();
    port.emit(JSON.stringify({ type: 'ready', version: 1, nonce }));
    expect(message).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
  });
  it('does not accept navigation to a replacement document', () => {
    const { transport, frame } = setup();
    const error = vi.fn();
    transport.onerror = error;
    frame.dispatchEvent(new Event('load'));
    expect(error).toHaveBeenCalledOnce();
  });
});
