import { useState, type FormEvent } from 'react';
import { requestEmailCode, verifyAccountCode, type AccountState } from '../app/accountClient';

type Props = {
  linkEmail?: string;
  onAuthenticated: (account: AccountState) => void;
  onCancel: () => void;
};
export function EmailCodeForm({ linkEmail, onAuthenticated, onCancel }: Props) {
  const [email, setEmail] = useState(linkEmail ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function send() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await requestEmailCode(email.trim(), !!linkEmail);
      setSent(true);
      setCode('');
      setMessage(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send a code.');
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!sent) {
      await send();
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      onAuthenticated(await verifyAccountCode(email.trim(), code.trim(), !!linkEmail));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify the code.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="account-form" onSubmit={(event) => void submit(event)}>
      <p className="account-note">
        {linkEmail
          ? 'Link this account to verified email sign-in. Your history stays with this account. This disables its old password and signs out other sessions. Sign in with your password within the last 10 minutes first.'
          : 'Use a code from your email to sign in or create an account. No password to remember. Existing password accounts must be linked after signing in with their password.'}
      </p>
      <label>
        Email
        <input
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          readOnly={sent || !!linkEmail}
          disabled={busy}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {sent && (
        <label>
          Email code
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6,10}"
            minLength={6}
            maxLength={10}
            required
            value={code}
            disabled={busy}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
      )}
      <button type="submit" disabled={busy}>
        {busy
          ? 'Working...'
          : sent
            ? linkEmail
              ? 'Verify and link account'
              : 'Verify and sign in'
            : 'Send email code'}
      </button>
      {sent && (
        <button type="button" disabled={busy} onClick={() => void send()}>
          Resend code
        </button>
      )}
      {sent && !linkEmail && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setSent(false);
            setCode('');
            setMessage('');
            setError('');
          }}
        >
          Use a different email
        </button>
      )}
      <button type="button" className="account-mode-button" disabled={busy} onClick={onCancel}>
        {linkEmail ? 'Cancel linking' : 'Use existing password'}
      </button>
      {message && (
        <p className="account-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
