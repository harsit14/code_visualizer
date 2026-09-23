import { describe, expect, it } from 'vitest';
import { isAdminUserId, limitForPlan, planForUser } from './usage';
import type { AuthUser, ServerEnv } from './types';

const user = (email: string): AuthUser => ({
  createdAt: '2026-06-16T00:00:00.000Z',
  email,
  id: `user-${email}`,
  stripeCustomerId: null,
});

describe('admin usage plan', () => {
  it('grants admin only to explicitly provisioned account IDs', () => {
    const env: ServerEnv = { ADMIN_USER_IDS: 'user-owner@example.com, teammate-id\nsecond-id' };
    expect(planForUser(env, user('owner@example.com'))).toBe('admin');
    expect(planForUser(env, user('student@example.com'))).toBe('free');
    expect(planForUser(env, null)).toBe('anonymous');
    expect(isAdminUserId(env, 'teammate-id')).toBe(true);
    expect(isAdminUserId(env, 'TEAMMATE-ID')).toBe(false);
    expect(isAdminUserId(env, 'teammate-id.evil')).toBe(false);
  });

  it('never promotes an account based on its unverified email', () => {
    expect(planForUser({ ADMIN_EMAILS: 'owner@example.com' }, user('owner@example.com'))).toBe(
      'free',
    );
    expect(planForUser({ ADMIN_USER_IDS: 'verified-owner-id' }, user('owner@example.com'))).toBe(
      'free',
    );
  });

  it('gives admins an unlimited explainer quota without changing free users', () => {
    expect(limitForPlan({}, 'admin')).toBe(Number.MAX_SAFE_INTEGER);
    expect(limitForPlan({}, 'free')).toBe(5);
    expect(limitForPlan({}, 'anonymous')).toBe(3);
  });
});
