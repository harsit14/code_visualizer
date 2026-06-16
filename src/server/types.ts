export type AssetBinding = {
  fetch(request: Request): Promise<Response>;
};

export type ServerEnv = {
  ASSETS?: AssetBinding;
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
  ADMIN_EMAILS?: string;
  ANON_USAGE_SALT?: string;
  PASSWORD_PEPPER?: string;
  PBKDF2_VERIFY_ITERATIONS_LIMIT?: string;
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

export type AccountPlan = 'anonymous' | 'free' | 'pro' | 'admin';
