import { accountDatabaseMissing, getSessionContext } from './auth';
import { isRecord, jsonResponse, methodNotAllowed, nowIso, readJson } from './http';
import type { D1Database, ServerEnv } from './types';

const HISTORY_LIMIT = 50;
const LIST_LIMIT = 30;
const MAX_CODE_LENGTH = 200_000;
const MAX_TITLE_LENGTH = 120;
const MAX_INPUT_COUNT = 24;
const MAX_INPUT_LENGTH = 10_000;
const ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;

type Language = 'python' | 'javascript' | 'typescript';

type HistoryRow = {
  code: string;
  created_at: string;
  example_id: string | null;
  function_name: string | null;
  id: string;
  inputs_json: string | null;
  language: Language;
  last_run_at: string;
  seed: number | null;
  title: string;
  updated_at: string;
  user_id: string;
};

type HistoryPayload = {
  code: string;
  exampleId: string | null;
  functionName: string | null;
  id: string | null;
  inputs: string[] | null;
  language: Language;
  seed: number | null;
  title: string;
};

export async function handleHistoryApi(
  request: Request,
  env: ServerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/history') {
    if (request.method === 'GET') {
      return listHistory(env, request);
    }
    if (request.method === 'POST') {
      return saveHistory(env, request);
    }
    return methodNotAllowed(['GET', 'POST']);
  }

  const match = url.pathname.match(/^\/api\/history\/([^/]+)$/);
  if (!match) {
    return null;
  }

  if (request.method === 'GET') {
    return getHistoryItem(env, request, match[1]);
  }
  if (request.method === 'DELETE') {
    return deleteHistoryItem(env, request, match[1]);
  }
  return methodNotAllowed(['GET', 'DELETE']);
}

async function listHistory(env: ServerEnv, request: Request): Promise<Response> {
  const auth = await requireHistoryAuth(env, request);
  if (auth instanceof Response) {
    return auth;
  }

  const rows = await auth.db
    .prepare(
      `SELECT id, user_id, title, language, code, inputs_json, function_name, seed, example_id,
              created_at, updated_at, last_run_at
       FROM code_history
       WHERE user_id = ?
       ORDER BY last_run_at DESC
       LIMIT ?`,
    )
    .bind(auth.userId, LIST_LIMIT)
    .all<HistoryRow>();

  return jsonResponse({ items: rows.results.map(rowToHistoryItem) });
}

async function getHistoryItem(env: ServerEnv, request: Request, id: string): Promise<Response> {
  const auth = await requireHistoryAuth(env, request);
  if (auth instanceof Response) {
    return auth;
  }
  if (!isHistoryId(id)) {
    return jsonResponse({ error: 'History item not found.' }, 404);
  }

  const row = await auth.db
    .prepare(
      `SELECT id, user_id, title, language, code, inputs_json, function_name, seed, example_id,
              created_at, updated_at, last_run_at
       FROM code_history
       WHERE id = ? AND user_id = ?`,
    )
    .bind(id, auth.userId)
    .first<HistoryRow>();

  return row ? jsonResponse({ item: rowToHistoryItem(row) }) : jsonResponse({ error: 'History item not found.' }, 404);
}

async function saveHistory(env: ServerEnv, request: Request): Promise<Response> {
  const auth = await requireHistoryAuth(env, request);
  if (auth instanceof Response) {
    return auth;
  }

  const payload = readHistoryPayload(await readJson(request));
  if (!payload) {
    return jsonResponse({ error: 'History item is invalid.' }, 400);
  }

  const now = nowIso();
  const existingId = payload.id
    ? await findOwnedHistoryId(auth.db, auth.userId, payload.id)
    : null;
  const id = existingId ?? crypto.randomUUID();

  if (existingId) {
    await auth.db
      .prepare(
        `UPDATE code_history
         SET title = ?, language = ?, code = ?, inputs_json = ?, function_name = ?,
             seed = ?, example_id = ?, updated_at = ?, last_run_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .bind(
        payload.title,
        payload.language,
        payload.code,
        inputsToJson(payload.inputs),
        payload.functionName,
        payload.seed,
        payload.exampleId,
        now,
        now,
        id,
        auth.userId,
      )
      .run();
  } else {
    await auth.db
      .prepare(
        `INSERT INTO code_history (
           id, user_id, title, language, code, inputs_json, function_name, seed, example_id,
           created_at, updated_at, last_run_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        auth.userId,
        payload.title,
        payload.language,
        payload.code,
        inputsToJson(payload.inputs),
        payload.functionName,
        payload.seed,
        payload.exampleId,
        now,
        now,
        now,
      )
      .run();
    await pruneHistory(auth.db, auth.userId);
  }

  const row = await auth.db
    .prepare(
      `SELECT id, user_id, title, language, code, inputs_json, function_name, seed, example_id,
              created_at, updated_at, last_run_at
       FROM code_history
       WHERE id = ? AND user_id = ?`,
    )
    .bind(id, auth.userId)
    .first<HistoryRow>();

  return jsonResponse({ item: row ? rowToHistoryItem(row) : null }, existingId ? 200 : 201);
}

async function deleteHistoryItem(env: ServerEnv, request: Request, id: string): Promise<Response> {
  const auth = await requireHistoryAuth(env, request);
  if (auth instanceof Response) {
    return auth;
  }
  if (!isHistoryId(id)) {
    return jsonResponse({ error: 'History item not found.' }, 404);
  }

  await auth.db
    .prepare('DELETE FROM code_history WHERE id = ? AND user_id = ?')
    .bind(id, auth.userId)
    .run();
  return jsonResponse({ ok: true });
}

async function requireHistoryAuth(env: ServerEnv, request: Request) {
  if (!env.DB) {
    return accountDatabaseMissing();
  }

  const context = await getSessionContext(env, request);
  if (!context) {
    return jsonResponse({ error: 'Sign in to use history.' }, 401);
  }

  return { db: env.DB, userId: context.user.id };
}

async function findOwnedHistoryId(
  db: D1Database,
  userId: string,
  id: string,
): Promise<string | null> {
  if (!isHistoryId(id)) {
    return null;
  }
  const row = await db
    .prepare('SELECT id FROM code_history WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

async function pruneHistory(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      `DELETE FROM code_history
       WHERE user_id = ?
         AND id NOT IN (
           SELECT id FROM code_history
           WHERE user_id = ?
           ORDER BY last_run_at DESC
           LIMIT ?
         )`,
    )
    .bind(userId, userId, HISTORY_LIMIT)
    .run();
}

function readHistoryPayload(value: unknown): HistoryPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = cleanString(value.title, MAX_TITLE_LENGTH);
  const language = readLanguage(value.language);
  const code = typeof value.code === 'string' ? value.code : null;
  if (!title || !language || code === null || code.length > MAX_CODE_LENGTH) {
    return null;
  }

  return {
    code,
    exampleId: cleanOptionalString(value.exampleId, 160),
    functionName: cleanOptionalString(value.functionName, 200),
    id: cleanOptionalId(value.id),
    inputs: readInputs(value.inputs),
    language,
    seed: readSeed(value.seed),
    title,
  };
}

function rowToHistoryItem(row: HistoryRow) {
  return {
    code: row.code,
    createdAt: row.created_at,
    exampleId: row.example_id,
    functionName: row.function_name,
    id: row.id,
    inputs: parseInputs(row.inputs_json),
    language: row.language,
    lastRunAt: row.last_run_at,
    seed: row.seed,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

function readLanguage(value: unknown): Language | null {
  return value === 'python' || value === 'javascript' || value === 'typescript' ? value : null;
}

function readInputs(value: unknown): string[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Array.isArray(value) || value.length > MAX_INPUT_COUNT) {
    return null;
  }
  const inputs = value.map((input) => (typeof input === 'string' ? input : null));
  return inputs.every((input): input is string => input !== null && input.length <= MAX_INPUT_LENGTH)
    ? inputs
    : null;
}

function readSeed(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

function cleanOptionalString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return cleanString(value, maxLength);
}

function cleanOptionalId(value: unknown): string | null {
  return typeof value === 'string' && isHistoryId(value) ? value : null;
}

function isHistoryId(value: string): boolean {
  return ID_PATTERN.test(value);
}

function inputsToJson(inputs: string[] | null): string | null {
  return inputs ? JSON.stringify(inputs) : null;
}

function parseInputs(value: string | null): string[] | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return readInputs(parsed);
  } catch {
    return null;
  }
}
