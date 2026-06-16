import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  PasswordHashUpgradeRequiredError,
  verifyPassword,
} from './auth';

describe('password hashing', () => {
  it('creates Worker-friendly hashes that verify with the same pepper', async () => {
    const env = { PASSWORD_PEPPER: 'test-pepper' };
    const hash = await hashPassword(env, 'correct horse battery staple');

    expect(hash.startsWith('hmac_sha256_v1$')).toBe(true);
    await expect(verifyPassword(env, 'correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyPassword(env, 'wrong password', hash)).resolves.toBe(false);
  });

  it('requires the same password pepper to verify HMAC hashes', async () => {
    const hash = await hashPassword({ PASSWORD_PEPPER: 'first-pepper' }, 'correct password');

    await expect(
      verifyPassword({ PASSWORD_PEPPER: 'second-pepper' }, 'correct password', hash),
    ).resolves.toBe(false);
  });

  it('refuses expensive legacy PBKDF2 hashes before spending Worker CPU', async () => {
    const legacyHash = 'pbkdf2_sha256$60000$c2FsdA==$aGFzaA==';

    await expect(verifyPassword({}, 'password', legacyHash)).rejects.toBeInstanceOf(
      PasswordHashUpgradeRequiredError,
    );
  });
});
