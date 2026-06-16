import { findUserByStripeCustomerId, getSessionContext } from './auth';
import { getDatabase, type AppDatabase } from './database';
import { isRecord, isoFromEpochSeconds, jsonResponse, nowIso } from './http';
import type { AuthUser, ServerEnv } from './types';

type StripeCheckoutSession = {
  client_reference_id?: string | null;
  customer?: string | null;
  id: string;
  metadata?: Record<string, string>;
  mode?: string;
  payment_status?: string;
  subscription?: string | null;
  url?: string | null;
};

type StripeSubscription = {
  customer?: string | null;
  current_period_end?: number;
  id: string;
  items?: {
    data?: Array<{
      price?: {
        id?: string;
      };
    }>;
  };
  metadata?: Record<string, string>;
  status?: string;
};

type StripeEvent = {
  data?: {
    object?: unknown;
  };
  id?: string;
  type?: string;
};

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SECONDS = 300;
const textEncoder = new TextEncoder();

export async function createCheckoutSession(env: ServerEnv, request: Request): Promise<Response> {
  const configured = requireBillingConfig(env);
  if (configured) {
    return configured;
  }
  const session = await getSessionContext(env, request);
  if (!session) {
    return jsonResponse({ error: 'Sign in before choosing a subscription.' }, 401);
  }

  const origin = new URL(request.url).origin;
  const params: Record<string, string> = {
    allow_promotion_codes: 'true',
    client_reference_id: session.user.id,
    'line_items[0][price]': env.STRIPE_PRICE_ID!,
    'line_items[0][quantity]': '1',
    'metadata[user_id]': session.user.id,
    mode: 'subscription',
    'subscription_data[metadata][user_id]': session.user.id,
    success_url: `${origin}/app?billing=success`,
    cancel_url: `${origin}/app?billing=cancelled`,
  };

  if (session.user.stripeCustomerId) {
    params.customer = session.user.stripeCustomerId;
  } else {
    params.customer_email = session.user.email;
  }

  const payload = await stripeRequest(env, 'checkout/sessions', params);
  const url = isRecord(payload) && typeof payload.url === 'string' ? payload.url : null;
  if (!url) {
    return jsonResponse({ error: 'Stripe did not return a Checkout URL.' }, 502);
  }

  return jsonResponse({ url });
}

export async function createPortalSession(env: ServerEnv, request: Request): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ error: 'Stripe is not configured.' }, 503);
  }
  if (!getDatabase(env)) {
    return jsonResponse({ error: 'Account database is not configured.' }, 503);
  }
  const session = await getSessionContext(env, request);
  if (!session) {
    return jsonResponse({ error: 'Sign in before managing billing.' }, 401);
  }
  if (!session.user.stripeCustomerId) {
    return jsonResponse({ error: 'No Stripe customer is linked to this account yet.' }, 400);
  }

  const origin = new URL(request.url).origin;
  const payload = await stripeRequest(env, 'billing_portal/sessions', {
    customer: session.user.stripeCustomerId,
    return_url: `${origin}/app`,
  });
  const url = isRecord(payload) && typeof payload.url === 'string' ? payload.url : null;
  if (!url) {
    return jsonResponse({ error: 'Stripe did not return a billing portal URL.' }, 502);
  }

  return jsonResponse({ url });
}

export async function handleStripeWebhook(env: ServerEnv, request: Request): Promise<Response> {
  const db = getDatabase(env);
  if (!db) {
    return jsonResponse({ error: 'Account database is not configured.' }, 503);
  }
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({ error: 'Stripe webhook secret is not configured.' }, 503);
  }

  const signature = request.headers.get('Stripe-Signature');
  const body = await request.text();
  if (!signature || !(await verifyStripeSignature(body, signature, env.STRIPE_WEBHOOK_SECRET))) {
    return jsonResponse({ error: 'Invalid Stripe webhook signature.' }, 400);
  }

  const event = JSON.parse(body) as StripeEvent;
  if (event.id) {
    if (await db.billingEventExists(event.id)) {
      return jsonResponse({ received: true, duplicate: true });
    }
  }

  if (event.type === 'checkout.session.completed') {
    await handleCheckoutCompleted(db, event.data?.object);
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    await handleSubscriptionChanged(db, event.data?.object);
  }

  if (event.id) {
    await db.insertBillingEvent({
      created_at: nowIso(),
      id: event.id,
      type: event.type ?? 'unknown',
    });
  }

  return jsonResponse({ received: true });
}

export async function stripeRequest(
  env: ServerEnv,
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe secret key is not configured.');
  }
  const response = await fetch(`${STRIPE_API_BASE}/${path}`, {
    body: new URLSearchParams(params),
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const detail =
      isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string'
        ? payload.error.message
        : response.statusText;
    throw new Error(`Stripe request failed: ${detail}`);
  }
  return payload;
}

function requireBillingConfig(env: ServerEnv): Response | null {
  if (!getDatabase(env)) {
    return jsonResponse({ error: 'Account database is not configured.' }, 503);
  }
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) {
    return jsonResponse({ error: 'Stripe subscription checkout is not configured.' }, 503);
  }
  return null;
}

async function handleCheckoutCompleted(db: AppDatabase, value: unknown): Promise<void> {
  if (!isCheckoutSession(value)) {
    return;
  }
  const userId = value.client_reference_id ?? value.metadata?.user_id ?? null;
  if (!userId) {
    return;
  }

  if (value.customer) {
    await db.updateUserStripeCustomerId(userId, value.customer);
  }

  if (value.subscription && value.payment_status === 'paid') {
    await upsertSubscription(db, {
      currentPeriodEnd: null,
      priceId: null,
      status: 'active',
      stripeCustomerId: value.customer ?? null,
      stripeSubscriptionId: value.subscription,
      userId,
    });
  }
}

async function handleSubscriptionChanged(db: AppDatabase, value: unknown): Promise<void> {
  if (!isStripeSubscription(value)) {
    return;
  }

  const customerId = value.customer ?? null;
  const userIdFromMetadata = value.metadata?.user_id ?? null;
  const user: AuthUser | null = userIdFromMetadata
    ? null
    : customerId
      ? await findUserByStripeCustomerId(db, customerId)
      : null;
  const userId = userIdFromMetadata ?? user?.id ?? null;
  if (!userId) {
    return;
  }

  if (customerId) {
    await db.updateUserStripeCustomerId(userId, customerId);
  }

  await upsertSubscription(db, {
    currentPeriodEnd: isoFromEpochSeconds(value.current_period_end),
    priceId: value.items?.data?.[0]?.price?.id ?? null,
    status: value.status ?? 'incomplete',
    stripeCustomerId: customerId,
    stripeSubscriptionId: value.id,
    userId,
  });
}

async function upsertSubscription(
  db: AppDatabase,
  subscription: {
    currentPeriodEnd: string | null;
    priceId: string | null;
    status: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string;
    userId: string;
  },
): Promise<void> {
  await db.upsertSubscription({
    current_period_end: subscription.currentPeriodEnd,
    price_id: subscription.priceId,
    status: subscription.status,
    stripe_customer_id: subscription.stripeCustomerId,
    stripe_subscription_id: subscription.stripeSubscriptionId,
    updated_at: nowIso(),
    user_id: subscription.userId,
  });
}

async function verifyStripeSignature(
  body: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  const age = Math.abs(Date.now() / 1000 - timestamp);
  if (age > WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }

  const expected = await hmacSha256Hex(secret, `${parts.t}.${body}`);
  const signatures = signatureHeader
    .split(',')
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3));

  return signatures.some((signature) => timingSafeHexEqual(signature, expected));
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function isCheckoutSession(value: unknown): value is StripeCheckoutSession {
  return isRecord(value) && typeof value.id === 'string';
}

function isStripeSubscription(value: unknown): value is StripeSubscription {
  return isRecord(value) && typeof value.id === 'string';
}
