import type { Language } from '../engine/types';

export type CodeHistoryItem = {
  code: string;
  createdAt: string;
  exampleId: string | null;
  functionName: string | null;
  id: string;
  inputs: string[] | null;
  language: Language;
  lastRunAt: string;
  seed: number | null;
  title: string;
  updatedAt: string;
};

export type SaveCodeHistoryPayload = {
  code: string;
  exampleId?: string | null;
  functionName?: string | null;
  id?: string | null;
  inputs?: string[] | null;
  language: Language;
  seed?: number | null;
  title: string;
};

type HistoryListPayload = {
  items: CodeHistoryItem[];
};

type HistoryItemPayload = {
  item: CodeHistoryItem | null;
};

type ErrorPayload = {
  error?: string;
};

export async function listCodeHistory(): Promise<CodeHistoryItem[]> {
  const payload = await requestJson<HistoryListPayload>('/api/history', { method: 'GET' });
  return payload.items;
}

export async function saveCodeHistory(
  payload: SaveCodeHistoryPayload,
): Promise<CodeHistoryItem | null> {
  const response = await requestJson<HistoryItemPayload>('/api/history', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  return response.item;
}

export async function deleteCodeHistory(id: string): Promise<void> {
  await requestJson(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

async function requestJson<T = unknown>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
  const text = await response.text();
  if (!contentType.includes('application/json')) {
    throw new Error(
      'History is not available from this static host. Use the Cloudflare Worker deployment or wrangler dev.',
    );
  }
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const detail =
      isErrorPayload(payload) && payload.error
        ? payload.error
        : `History request failed (${response.status}).`;
    throw new Error(detail);
  }
  return payload as T;
}

function isErrorPayload(value: unknown): value is ErrorPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    (typeof value.error === 'string' || value.error === undefined)
  );
}
