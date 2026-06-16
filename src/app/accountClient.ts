export type AccountUsage = {
  day: string;
  limit: number;
  plan: 'anonymous' | 'free' | 'pro';
  remaining: number;
  used: number;
};

export type AccountState = {
  accountConfigured: boolean;
  billingConfigured: boolean;
  subscription: {
    currentPeriodEnd: string | null;
    priceId: string | null;
    status: string;
  } | null;
  usage: AccountUsage | null;
  user: {
    createdAt: string;
    email: string;
    id: string;
  } | null;
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
