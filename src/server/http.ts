const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function methodNotAllowed(methods: string[]): Response {
  return jsonResponse({ error: 'Method not allowed.' }, 405, {
    Allow: methods.join(', '),
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoFromEpochSeconds(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;
}
