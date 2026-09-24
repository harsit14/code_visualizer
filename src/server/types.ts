export type AssetBinding = {
  fetch(request: Request): Promise<Response>;
};

export type ServerEnv = {
  ASSETS?: AssetBinding;
  MANAGED_AUTH_ENABLED?: string;
  AUTH_RATE_LIMIT_MODE?: string;
  SUPABASE_ANON_KEY?: string;
  RUNNER_URL?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  DISABLE_USAGE_GATE?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SCHEMA?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  ANON_DAILY_EXPLAIN_LIMIT?: string;
  FREE_DAILY_EXPLAIN_LIMIT?: string;
  PRO_DAILY_EXPLAIN_LIMIT?: string;
  /** Explanations per UTC day across all non-admin users (default 2000). */
  EXPLAIN_GLOBAL_DAILY_LIMIT?: string;
  /** Legacy configuration is ignored; email ownership is not yet verified. */
  ADMIN_EMAILS?: string;
  ADMIN_USER_IDS?: string;
  ANON_USAGE_SALT?: string;
  PASSWORD_PEPPER?: string;
  PBKDF2_VERIFY_ITERATIONS_LIMIT?: string;
};

export type AuthUser = {
  authMethod?: 'legacy' | 'supabase';
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

export type AccountPlan = 'anonymous' | 'free' | 'pro' | 'admin';
