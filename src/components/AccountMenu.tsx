import { AccountSettings } from './AccountSettings';
import { EmailCodeForm } from './EmailCodeForm';
import { LogOut, UserRound } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchAccount, signIn, signOut, signUp, type AccountState } from '../app/accountClient';

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
  const [legacyLogin, setLegacyLogin] = useState(false);
  const [linking, setLinking] = useState(false);
  const [mode, setMode] = useState<AuthMode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Settings (and their sessions request) mount only while the menu is open.
  const [menuOpen, setMenuOpen] = useState(false);
  const summaryRef = useRef<HTMLElement | null>(null);

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
    if (!account.user) {
      return 'Guest';
    }
    if (account.usage?.plan === 'admin') {
      return 'Admin account';
    }
    if (account.usage?.plan === 'pro') {
      return 'Pro account';
    }
    return 'Free account';
  }, [account]);
  const compactPlanLabel = useMemo(() => {
    if (!account.user) {
      return 'Account';
    }
    if (account.usage?.plan === 'admin') {
      return 'Admin';
    }
    if (account.usage?.plan === 'pro') {
      return 'Pro';
    }
    return 'Free';
  }, [account]);
  const summaryLabel = compact ? compactPlanLabel : account.user ? planLabel : 'Account';
  const summaryTitle = account.user ? planLabel : 'Account';

  const submitAuth = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const nextAccount =
          mode === 'signup' && account.authMode !== 'email-code'
            ? await signUp({ email, password })
            : await signIn({ email, password });
        setAccount({
          ...EMPTY_ACCOUNT,
          ...nextAccount,
          accountConfigured: true,
        });
        setPassword('');
        setMessage(
          mode === 'signup' && account.authMode !== 'email-code'
            ? 'Account created.'
            : 'Signed in.',
        );
      } catch (requestError) {
        setError(errorMessage(requestError));
      } finally {
        setBusy(false);
      }
    },
    [email, mode, password, account.authMode],
  );

  const handleSignOut = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await signOut();
      setAccount((current) => ({
        ...EMPTY_ACCOUNT,
        accountConfigured: true,
        authMode: current.authMode,
      }));
      setLegacyLogin(false);
      setLinking(false);
      setMessage('Signed out.');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDeleted = useCallback(() => {
    setAccount((current) => ({
      ...EMPTY_ACCOUNT,
      accountConfigured: true,
      authMode: current.authMode,
    }));
    setLegacyLogin(false);
    setLinking(false);
    setEmail('');
    setPassword('');
    setError(null);
    setMessage('Account deleted. Its saved history, sessions and usage records were removed.');
    summaryRef.current?.focus();
  }, []);

  return (
    <details
      className={`account-menu${compact ? ' account-menu-compact' : ''}`}
      onToggle={(event) => setMenuOpen(event.currentTarget.open)}
    >
      <summary aria-label={summaryTitle} ref={summaryRef} title={summaryTitle}>
        <UserRound size={14} />
        <span className="account-summary-label">{summaryLabel}</span>
      </summary>
      <div className="account-popover">
        <header className="account-popover-header">
          <strong>
            {account.user
              ? account.user.email
              : account.accountConfigured
                ? account.authMode === 'email-code'
                  ? 'Sign in with email'
                  : 'Create your account'
                : 'Accounts unavailable'}
          </strong>
          <span>{account.accountConfigured ? planLabel : 'Static host'}</span>
        </header>

        {!account.accountConfigured ? (
          <p className="account-note">
            Accounts require the Cloudflare Worker API and Supabase database. This host is serving
            the static app only.
          </p>
        ) : null}

        {account.accountConfigured &&
        account.authMode === 'email-code' &&
        ((!account.user && !legacyLogin) || linking) ? (
          <EmailCodeForm
            linkEmail={linking ? account.user?.email : undefined}
            onCancel={() => {
              setLegacyLogin(true);
              setLinking(false);
              setMode('signin');
            }}
            onAuthenticated={(next) => {
              setAccount(next);
              setLinking(false);
              setLegacyLogin(false);
              setError(null);
              setMessage('Signed in with verified email.');
              void refresh();
            }}
          />
        ) : account.user ? (
          <div className="account-signed-in">
            {account.usage ? (
              <div className="account-usage">
                <span>AI explanations today</span>
                <strong>
                  {account.usage.used} / {usageLimitLabel(account.usage.limit)}
                </strong>
              </div>
            ) : null}
            {account.authMode === 'email-code' && account.user.authMethod !== 'supabase' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setLinking(true);
                  setMessage(null);
                }}
              >
                Enable email sign-in
              </button>
            )}
            <button disabled={busy} onClick={handleSignOut} type="button">
              <LogOut size={14} />
              Sign out
            </button>
            {menuOpen ? (
              <AccountSettings
                authMethod={account.user.authMethod}
                email={account.user.email}
                onDeleted={handleDeleted}
              />
            ) : null}
          </div>
        ) : account.accountConfigured ? (
          <form className="account-form" onSubmit={(event) => void submitAuth(event)}>
            <label>
              Email
              <input
                autoComplete="email"
                id="account-email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <label>
              Password
              <input
                autoComplete={
                  mode === 'signup' && account.authMode !== 'email-code'
                    ? 'new-password'
                    : 'current-password'
                }
                id="account-password"
                minLength={10}
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            <button disabled={busy || !account.accountConfigured} type="submit">
              {busy
                ? 'Working...'
                : mode === 'signup' && account.authMode !== 'email-code'
                  ? 'Create account'
                  : 'Sign in'}
            </button>
            <button
              className="account-mode-button"
              disabled={busy}
              onClick={() =>
                account.authMode === 'email-code'
                  ? setLegacyLogin(false)
                  : setMode((current) => (current === 'signup' ? 'signin' : 'signup'))
              }
              type="button"
            >
              {account.authMode === 'email-code'
                ? 'Use email code instead'
                : mode === 'signup'
                  ? 'I already have an account'
                  : 'Create a new account'}
            </button>
          </form>
        ) : null}

        {message ? (
          <p className="account-message" role="status">
            {message}
          </p>
        ) : null}
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

function usageLimitLabel(limit: number): string {
  return limit >= Number.MAX_SAFE_INTEGER ? 'Unlimited' : String(limit);
}
