import { CreditCard, LogOut, UserRound } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  createCheckoutSession,
  createPortalSession,
  fetchAccount,
  signIn,
  signOut,
  signUp,
  type AccountState,
} from '../app/accountClient';

type AccountMenuProps = {
  compact?: boolean;
};

type AuthMode = 'signin' | 'signup';

const EMPTY_ACCOUNT: AccountState = {
  accountConfigured: false,
  billingConfigured: false,
  subscription: null,
  usage: null,
  user: null,
};

export function AccountMenu({ compact = false }: AccountMenuProps) {
  const [account, setAccount] = useState<AccountState>(EMPTY_ACCOUNT);
  const [mode, setMode] = useState<AuthMode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAccount(await fetchAccount());
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const planLabel = useMemo(() => {
    if (account.subscription?.status === 'active' || account.subscription?.status === 'trialing') {
      return 'Pro';
    }
    return account.user ? 'Free' : 'Guest';
  }, [account]);

  const submitAuth = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const nextAccount =
          mode === 'signup' ? await signUp({ email, password }) : await signIn({ email, password });
        setAccount({
          ...EMPTY_ACCOUNT,
          ...nextAccount,
          accountConfigured: true,
        });
        setPassword('');
        setMessage(mode === 'signup' ? 'Account created.' : 'Signed in.');
      } catch (requestError) {
        setError(errorMessage(requestError));
      } finally {
        setBusy(false);
      }
    },
    [email, mode, password],
  );

  const startCheckout = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      window.location.href = await createCheckoutSession();
    } catch (requestError) {
      setError(errorMessage(requestError));
      setBusy(false);
    }
  }, []);

  const openPortal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      window.location.href = await createPortalSession();
    } catch (requestError) {
      setError(errorMessage(requestError));
      setBusy(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await signOut();
      setAccount({ ...EMPTY_ACCOUNT, accountConfigured: true });
      setMessage('Signed out.');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <details className={`account-menu${compact ? ' account-menu-compact' : ''}`}>
      <summary title="Account and subscription">
        <UserRound size={14} />
        {account.user ? planLabel : 'Account'}
      </summary>
      <div className="account-popover">
        <header className="account-popover-header">
          <strong>{account.user ? account.user.email : 'Create your account'}</strong>
          <span>{planLabel}</span>
        </header>

        {!account.accountConfigured ? (
          <p className="account-note">
            Account storage is not configured yet. Add the Cloudflare D1 binding before launch.
          </p>
        ) : null}

        {account.user ? (
          <div className="account-signed-in">
            {account.usage ? (
              <div className="account-usage">
                <span>AI explanations today</span>
                <strong>
                  {account.usage.used} / {account.usage.limit}
                </strong>
              </div>
            ) : null}
            <button
              disabled={busy || !account.billingConfigured}
              onClick={account.subscription ? openPortal : startCheckout}
              type="button"
            >
              <CreditCard size={14} />
              {account.subscription ? 'Manage billing' : 'Upgrade to Pro'}
            </button>
            <button disabled={busy} onClick={handleSignOut} type="button">
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        ) : (
          <form className="account-form" onSubmit={(event) => void submitAuth(event)}>
            <label>
              Email
              <input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <label>
              Password
              <input
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={10}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            <button disabled={busy || !account.accountConfigured} type="submit">
              {busy ? 'Working...' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
            <button
              className="account-mode-button"
              onClick={() => setMode((current) => (current === 'signup' ? 'signin' : 'signup'))}
              type="button"
            >
              {mode === 'signup' ? 'I already have an account' : 'Create a new account'}
            </button>
          </form>
        )}

        {message ? <p className="account-message">{message}</p> : null}
        {error ? (
          <p className="account-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Account request failed.';
}
