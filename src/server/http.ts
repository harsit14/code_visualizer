const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
};

const textDecoder = new TextDecoder();

export class RequestBodyTooLargeError extends Error {
  readonly limitBytes: number;

  constructor(limitBytes: number) {
    super(`Request body exceeds the ${limitBytes} byte limit.`);
    this.name = 'RequestBodyTooLargeError';
    this.limitBytes = limitBytes;
  }
}

export function jsonResponse(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    headers: { ...JSON_HEADERS, ...headers },
    status,
  });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function readLimitedJson(request: Request, limitBytes: number): Promise<unknown> {
  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    throw new RequestBodyTooLargeError(limitBytes);
  }

  try {
    const text = await readLimitedText(request, limitBytes);
    return text ? (JSON.parse(text) as unknown) : null;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      throw error;
    }
    return null;
  }
}

export function isRequestBodyTooLargeError(error: unknown): error is RequestBodyTooLargeError {
  return error instanceof RequestBodyTooLargeError;
}

export function requestBodyTooLargeResponse(error: RequestBodyTooLargeError): Response {
  return jsonResponse(
    { error: `Request body is too large. Limit is ${error.limitBytes} bytes.` },
    413,
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function methodNotAllowed(methods: string[]): Response {
  return jsonResponse({ error: 'Method not allowed.' }, 405, {
    Allow: methods.join(', '),
  });
}

export function rejectCrossOriginStateChange(request: Request): Response | null {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return null;
  }

  const origin = request.headers.get('Origin');
  if (!origin) {
    return null;
  }

  return origin === new URL(request.url).origin
    ? null
    : jsonResponse({ error: 'Cross-origin requests are not allowed.' }, 403);
}

async function readLimitedText(request: Request, limitBytes: number): Promise<string> {
  const body = request.body;
  if (!body) {
    return '';
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > limitBytes) {
      await reader.cancel().catch(() => {});
      throw new RequestBodyTooLargeError(limitBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return textDecoder.decode(bytes);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoFromEpochSeconds(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;
}
