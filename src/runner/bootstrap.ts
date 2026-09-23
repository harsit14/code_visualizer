import {
  appOrigin,
  isLanguage,
  MAX_MESSAGE_CHARS,
  parseMessage,
  record,
  RUNNER_PROTOCOL,
  validateRequest,
} from './protocol';

// Build-time allowlist; never trust an origin supplied by an embedding page.
const allowedOrigin = appOrigin(import.meta.env.VITE_RUNNER_APP_ORIGIN);
let accepted = false;
window.addEventListener('message', (event) => {
  const init = event.data;
  if (
    accepted ||
    event.source !== parent ||
    event.origin !== allowedOrigin ||
    !record(init) ||
    init.type !== 'initialize' ||
    init.version !== RUNNER_PROTOCOL ||
    !isLanguage(init.language) ||
    typeof init.nonce !== 'string' ||
    init.nonce.length < 16 ||
    init.nonce.length > 128 ||
    event.ports.length !== 1
  )
    return;
  accepted = true;
  const nonce = init.nonce;
  const language = init.language;
  const port = event.ports[0];
  let worker: Worker | null = null;
  let closed = false;
  let seq = 0;
  let pendingId: string | null = null;
  const send = (message: Record<string, unknown>) => {
    if (closed) return;
    const encoded = JSON.stringify({ version: RUNNER_PROTOCOL, nonce, ...message });
    if (encoded.length > MAX_MESSAGE_CHARS)
      throw new Error('Runner output exceeds the 20 MB transport limit.');
    port.postMessage(encoded);
  };
  const dispose = () => {
    closed = true;
    worker?.terminate();
    worker = null;
    port.close();
  };
  const fail = (message: string) => {
    try {
      send({ type: 'failure', message: message.slice(0, 2000) });
    } finally {
      dispose();
    }
  };
  port.onmessage = (event) => {
    if (closed) return;
    try {
      const msg = parseMessage(event.data);
      if (msg.version !== RUNNER_PROTOCOL || msg.nonce !== nonce)
        throw new Error('Runner session mismatch.');
      if (msg.type === 'dispose') {
        dispose();
        return;
      }
      if (msg.type !== 'send' || msg.seq !== seq + 1)
        throw new Error('Invalid runner request sequence.');
      seq++;
      validateRequest(msg.payload, language);
      const payload = msg.payload as Record<string, unknown>;
      if (language !== 'python' || payload.type === 'request') {
        if (pendingId !== null) throw new Error('Runner is busy.');
        pendingId = language === 'python' ? (payload.requestId as string) : 'javascript';
      }
      worker!.postMessage(payload);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Invalid runner request.');
    }
  };
  port.onmessageerror = () => fail('Unreadable runner request.');
  window.addEventListener('pagehide', dispose, { once: true });
  try {
    worker =
      language === 'python'
        ? new Worker(new URL('../engine/pyodideWorker.ts', import.meta.url), { type: 'module' })
        : new Worker(new URL('../engine/jsTraceWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      try {
        if (
          language !== 'python' ||
          (record(event.data) &&
            event.data.type === 'response' &&
            event.data.requestId === pendingId)
        )
          pendingId = null;
        send({ type: 'message', payload: event.data });
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Invalid worker response.');
      }
    };
    worker.onerror = (event) => fail(event.message || 'Isolated worker failed.');
    worker.onmessageerror = () => fail('Unreadable worker response.');
    send({ type: 'ready' });
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Could not create isolated worker.');
  }
});
