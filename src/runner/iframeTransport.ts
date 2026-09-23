import type { Language } from '../engine/types';
import {
  MAX_MESSAGE_CHARS,
  parseMessage,
  RUNNER_PROTOCOL,
  runnerUrl,
  validateRequest,
  validateResponse,
  type RequestKind,
} from './protocol';

export interface ExecutionTransport {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

/** No account/UI capabilities cross this channel. A configured runner never falls back. */
export class IframeTransport implements ExecutionTransport {
  onmessage: ExecutionTransport['onmessage'] = null;
  onerror: ExecutionTransport['onerror'] = null;
  onmessageerror: ExecutionTransport['onmessageerror'] = null;
  private frame: HTMLIFrameElement;
  private channel = new MessageChannel();
  private nonce = crypto.randomUUID();
  private ready = false;
  private closed = false;
  private queue: string[] = [];
  private seq = 0;
  private op: RequestKind = 'analyze';
  private timer: number;

  constructor(
    rawUrl: string,
    private language: Language,
  ) {
    const url = runnerUrl(rawUrl, window.location.origin);
    this.frame = document.createElement('iframe');
    this.frame.hidden = true;
    this.frame.title = 'Isolated code runner';
    this.frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    this.frame.referrerPolicy = 'no-referrer';
    this.frame.src = url.href;
    this.channel.port1.onmessage = (event) => this.receive(event.data);
    this.channel.port1.onmessageerror = () => this.fail('Runner sent an unreadable message.');
    this.timer = window.setTimeout(
      () =>
        this.fail(
          'Isolated runner did not connect. Check its URL, allowed app origin and deployment headers, then retry.',
        ),
      15_000,
    );
    let initialized = false;
    this.frame.onload = () => {
      if (this.closed) return;
      if (initialized) {
        this.fail('Runner navigated after initialization.');
        return;
      }
      initialized = true;
      this.frame.contentWindow?.postMessage(
        { type: 'initialize', version: RUNNER_PROTOCOL, nonce: this.nonce, language },
        url.origin,
        [this.channel.port2],
      );
    };
    this.frame.onerror = () => this.fail('Isolated runner could not be loaded.');
    document.body.append(this.frame);
  }
  postMessage(message: unknown) {
    if (this.closed) throw new Error('Runner is closed.');
    this.op = validateRequest(message, this.language);
    const encoded = JSON.stringify({
      version: RUNNER_PROTOCOL,
      nonce: this.nonce,
      seq: ++this.seq,
      type: 'send',
      payload: message,
    });
    if (encoded.length > MAX_MESSAGE_CHARS) throw new Error('Runner request is too large.');
    if (this.ready) this.channel.port1.postMessage(encoded);
    else {
      if (this.queue.length >= 4) throw new Error('Runner initialization queue is full.');
      this.queue.push(encoded);
    }
  }
  terminate() {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.timer);
    // Tell the bootstrap to terminate explicitly before its browsing context is removed.
    try {
      this.channel.port1.postMessage(
        JSON.stringify({ version: RUNNER_PROTOCOL, nonce: this.nonce, type: 'dispose' }),
      );
    } catch {
      /* disconnected */
    }
    this.channel.port1.close();
    this.channel.port2.close();
    this.frame.remove();
    this.queue = [];
  }
  private receive(raw: unknown) {
    if (this.closed) return;
    try {
      const msg = parseMessage(raw);
      if (msg.version !== RUNNER_PROTOCOL || msg.nonce !== this.nonce)
        throw new Error('Runner protocol or session mismatch.');
      if (msg.type === 'ready' && !this.ready) {
        this.ready = true;
        window.clearTimeout(this.timer);
        for (const queued of this.queue) this.channel.port1.postMessage(queued);
        this.queue = [];
      } else if (
        msg.type === 'failure' &&
        typeof msg.message === 'string' &&
        msg.message.length <= 2000
      )
        this.fail(msg.message);
      else if (msg.type === 'message' && this.ready) {
        const data = validateResponse(msg.payload, this.language, this.op);
        this.onmessage?.(new MessageEvent('message', { data }));
      } else throw new Error('Unexpected runner message.');
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Invalid runner response.');
    }
  }
  private fail(message: string) {
    if (this.closed) return;
    this.terminate();
    this.onerror?.(new ErrorEvent('error', { message }));
  }
}

export function configuredRunnerUrl(): string | undefined {
  return import.meta.env.VITE_RUNNER_URL?.trim() || undefined;
}
export function createExecutionTransport(language: Language): ExecutionTransport {
  const configured = configuredRunnerUrl();
  if (configured) return new IframeTransport(configured, language);
  return language === 'python'
    ? new Worker(new URL('../engine/pyodideWorker.ts', import.meta.url), { type: 'module' })
    : new Worker(new URL('../engine/jsTraceWorker.ts', import.meta.url), { type: 'module' });
}
