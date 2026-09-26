export type AccountUsage = {
  day: string;
  limit: number;
  plan: 'anonymous' | 'free' | 'pro' | 'admin';
  remaining: number;
  used: number;
};

export type AccountState = {
  authMode?: 'password' | 'email-code';
  accountConfigured: boolean;
  billingConfigured: boolean;
  subscription: {
    currentPeriodEnd: string | null;
    priceId: string | null;
    status: string;
  } | null;
  usage: AccountUsage | null;
  user: {
    authMethod?: 'legacy' | 'supabase';
    createdAt: string;
    email: string;
    id: string;
  } | null;
};

export type AccountSession = {
  createdAt: string;
  current: boolean;
  /** Coarse label such as "Firefox on Windows"; null until the session is used. */
  device: string | null;
  expiresAt: string;
  id: string;
  lastUsedAt: string | null;
};

export type DeleteAccountPayload = {
  code?: string;
  confirmEmail: string;
  password?: string;
};

type AuthPayload = {
  email: string;
  password: string;
};

type UrlPayload = {
  url: string;
};

type ErrorPayload = {
  error?: string;
};

export async function fetchAccount(): Promise<AccountState> {
  return requestJson<AccountState>('/api/me', { method: 'GET' });
}

export async function signUp(payload: AuthPayload): Promise<AccountState> {
  return requestJson<AccountState>('/api/auth/signup', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

export async function signIn(payload: AuthPayload): Promise<AccountState> {
  return requestJson<AccountState>('/api/auth/login', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

export async function signOut(): Promise<void> {
  await requestJson('/api/auth/logout', { method: 'POST' });
}

export async function createCheckoutSession(): Promise<string> {
  const payload = await requestJson<UrlPayload>('/api/billing/checkout', { method: 'POST' });
  return payload.url;
}

export async function createPortalSession(): Promise<string> {
  const payload = await requestJson<UrlPayload>('/api/billing/portal', { method: 'POST' });
  return payload.url;
}

export async function listSessions(): Promise<AccountSession[]> {
  const payload = await requestJson<{ sessions: AccountSession[] }>('/api/account/sessions', {
    method: 'GET',
  });
  return payload.sessions;
}

export async function revokeSession(id: string): Promise<void> {
  await requestJson(`/api/account/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Signs out every session except this one; returns how many ended. */
export async function revokeOtherSessions(): Promise<number> {
  const payload = await requestJson<{ revoked: number }>('/api/account/sessions/revoke-others', {
    method: 'POST',
  });
  return payload.revoked;
}

/** Saves the account export as a JSON download and returns its file name. */
export async function downloadAccountData(): Promise<string> {
  const payload = await requestJson('/api/account/export', { method: 'GET' });
  const filename = `code-visualizer-account-${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export async function deleteAccount(payload: DeleteAccountPayload): Promise<void> {
  await requestJson('/api/account/delete', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

async function requestJson<T = unknown>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
  const text = await response.text();
  if (!contentType.includes('application/json')) {
    if (response.status >= 500) {
      throw new Error(
        `Account API returned a server error (${response.status}). Check the Worker logs for /api/auth/signup.`,
      );
    }
    throw new Error(
      'Account API is not available from this static host. Use the Cloudflare Worker deployment or wrangler dev.',
    );
  }
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const detail =
      isErrorPayload(payload) && payload.error
        ? payload.error
        : `Request failed (${response.status}).`;
    throw new Error(detail);
  }
  if (
    ((url.startsWith('/api/auth/') && url !== '/api/auth/email-code') ||
      url === '/api/account/delete') &&
    typeof window !== 'undefined'
  ) {
    window.dispatchEvent(new Event('cv-account-changed'));
    try {
      window.localStorage.setItem('cv-account-change', crypto.randomUUID());
    } catch {
      /* current tab is still notified */
    }
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

export async function requestEmailCode(email: string, link: boolean): Promise<{ message: string }> {
  return requestJson('/api/auth/email-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, link }),
  });
}
export async function verifyAccountCode(
  email: string,
  code: string,
  link: boolean,
): Promise<AccountState> {
  return requestJson('/api/auth/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, link }),
  });
}
