import { describe, expect, it } from 'vitest';
import { isAdminEmail, limitForPlan, planForUser } from './usage';
import type { AuthUser, ServerEnv } from './types';

const user = (email: string): AuthUser => ({
  createdAt: '2026-06-16T00:00:00.000Z',
  email,
  id: `user-${email}`,
  stripeCustomerId: null,
});

describe('admin usage plan', () => {
  it('promotes only allowlisted emails to admin', () => {
    const env: ServerEnv = {
      ADMIN_EMAILS: 'owner@example.com, teammate@example.com\nADMIN@CODEMAPPER.WIN',
    };

    expect(planForUser(env, user('owner@example.com'))).toBe('admin');
    expect(planForUser(env, user(' admin@codemapper.win '))).toBe('admin');
    expect(planForUser(env, user('student@example.com'))).toBe('free');
    expect(planForUser(env, null)).toBe('anonymous');
  });

  it('keeps admin matching exact after normalization', () => {
    const env: ServerEnv = {
      ADMIN_EMAILS: 'admin@example.com',
    };

    expect(isAdminEmail(env, 'ADMIN@example.com')).toBe(true);
    expect(isAdminEmail(env, 'not-admin@example.com')).toBe(false);
    expect(isAdminEmail(env, 'admin@example.com.evil.test')).toBe(false);
  });

  it('gives admins an unlimited explainer quota without changing free users', () => {
    expect(limitForPlan({}, 'admin')).toBe(Number.MAX_SAFE_INTEGER);
    expect(limitForPlan({}, 'free')).toBe(5);
    expect(limitForPlan({}, 'anonymous')).toBe(3);
  });
});
