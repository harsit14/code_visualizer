export type D1Result = {
  success: boolean;
  meta?: {
    changes?: number;
    last_row_id?: number;
  };
};

export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

export type D1Database = {
  prepare(query: string): D1PreparedStatement;
};

export type AssetBinding = {
  fetch(request: Request): Promise<Response>;
};

export type ServerEnv = {
  ASSETS?: AssetBinding;
  DB?: D1Database;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  DISABLE_USAGE_GATE?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  ANON_DAILY_EXPLAIN_LIMIT?: string;
  FREE_DAILY_EXPLAIN_LIMIT?: string;
  PRO_DAILY_EXPLAIN_LIMIT?: string;
  ANON_USAGE_SALT?: string;
};

export type AuthUser = {
  createdAt: string;
  email: string;
  id: string;
  stripeCustomerId: string | null;
};

export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'paused'
  | 'trialing'
  | 'unpaid';

export type UserSubscription = {
  currentPeriodEnd: string | null;
  priceId: string | null;
  status: SubscriptionStatus | string;
  stripeSubscriptionId: string | null;
  updatedAt: string;
  userId: string;
};

export type AccountPlan = 'anonymous' | 'free' | 'pro';
