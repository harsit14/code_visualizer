import { Download, MonitorSmartphone, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  deleteAccount,
  downloadAccountData,
  listSessions,
  requestEmailCode,
  revokeOtherSessions,
  revokeSession,
  type AccountSession,
} from '../app/accountClient';

type AccountSettingsProps = {
  authMethod?: 'legacy' | 'supabase';
  email: string;
  onDeleted: () => void;
};

type Status = { kind: 'error' | 'message'; text: string } | null;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Sessions, data download and account deletion for the signed-in account menu. */
export function AccountSettings({ authMethod, email, onDeleted }: AccountSettingsProps) {
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionsStatus, setSessionsStatus] = useState<Status>(null);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataStatus, setDataStatus] = useState<Status>(null);
  const ids = useId();

  const loadSessions = useCallback(async () => {
    setSessionsBusy(true);
    try {
      setSessions(await listSessions());
    } catch (error) {
      setSessionsStatus({ kind: 'error', text: errorMessage(error) });
    } finally {
      setSessionsBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const handleRevoke = useCallback(async (session: AccountSession) => {
    setSessionsBusy(true);
    setSessionsStatus(null);
    try {
      await revokeSession(session.id);
      setSessions((current) => current?.filter((item) => item.id !== session.id) ?? null);
      setSessionsStatus({ kind: 'message', text: `Signed out ${sessionName(session)}.` });
    } catch (error) {
      setSessionsStatus({ kind: 'error', text: errorMessage(error) });
    } finally {
      setSessionsBusy(false);
    }
  }, []);

  const handleRevokeOthers = useCallback(async () => {
    setSessionsBusy(true);
    setSessionsStatus(null);
    try {
      const revoked = await revokeOtherSessions();
      setSessions((current) => current?.filter((item) => item.current) ?? null);
      setSessionsStatus({
        kind: 'message',
        text:
          revoked === 0
            ? 'No other sessions were signed in.'
            : `Signed out ${revoked} other ${revoked === 1 ? 'session' : 'sessions'}.`,
      });
    } catch (error) {
      setSessionsStatus({ kind: 'error', text: errorMessage(error) });
    } finally {
      setSessionsBusy(false);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    setDataBusy(true);
    setDataStatus(null);
    try {
      const filename = await downloadAccountData();
      setDataStatus({
        kind: 'message',
        text: `Download started: ${filename}. It contains your email, saved code and usage history.`,
      });
    } catch (error) {
      setDataStatus({ kind: 'error', text: errorMessage(error) });
    } finally {
      setDataBusy(false);
    }
  }, []);

  const hasOtherSessions = sessions?.some((session) => !session.current) ?? false;

  return (
    <div className="account-settings">
      <section className="account-settings-section" aria-labelledby={`${ids}-sessions`}>
        <h3 id={`${ids}-sessions`}>Sessions</h3>
        {sessions === null && sessionsBusy ? (
          <p className="account-note">Loading sessions…</p>
        ) : null}
        {sessions && sessions.length > 0 ? (
          <ul className="account-session-list">
            {sessions.map((session) => (
              <li className="account-session" key={session.id}>
                <MonitorSmartphone aria-hidden="true" size={14} />
                <div className="account-session-meta">
                  <strong>
                    {session.device ?? 'Unknown device'}
                    {session.current ? (
                      <span className="account-session-current">This device</span>
                    ) : null}
                  </strong>
                  <span>Signed in {formatDate(session.createdAt)}</span>
                  {session.lastUsedAt ? (
                    <span>Last active {formatDate(session.lastUsedAt)}</span>
                  ) : null}
                </div>
                {session.current ? null : (
                  <button
                    aria-label={`Sign out ${sessionName(session)}`}
                    disabled={sessionsBusy}
                    onClick={() => void handleRevoke(session)}
                    type="button"
                  >
                    Sign out
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <button
          disabled={sessionsBusy || !hasOtherSessions}
          onClick={() => void handleRevokeOthers()}
          type="button"
        >
          Sign out everywhere else
        </button>
        <StatusLine status={sessionsStatus} />
      </section>

      <section className="account-settings-section" aria-labelledby={`${ids}-data`}>
        <h3 id={`${ids}-data`}>Your data</h3>
        <button disabled={dataBusy} onClick={() => void handleDownload()} type="button">
          <Download aria-hidden="true" size={14} />
          {dataBusy ? 'Preparing download…' : 'Download my data'}
        </button>
        <StatusLine status={dataStatus} />
      </section>

      <DeleteAccountSection authMethod={authMethod} email={email} onDeleted={onDeleted} />
    </div>
  );
}

function DeleteAccountSection({ authMethod, email, onDeleted }: AccountSettingsProps) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLInputElement | null>(null);
  const restoreFocus = useRef(false);
  const emailCode = authMethod === 'supabase';
  const emailMatches = confirmEmail.trim().toLowerCase() === email.toLowerCase();
  const ready = emailMatches && (emailCode ? code.trim().length >= 6 : password.length > 0);

  useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      toggleRef.current?.focus();
    }
  }, [open]);

  const close = () => {
    restoreFocus.current = true;
    setOpen(false);
    setConfirmEmail('');
    setPassword('');
    setCode('');
    setCodeSent(false);
    setStatus(null);
  };

  const sendCode = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await requestEmailCode(email, false);
      setCodeSent(true);
      setCode('');
      setStatus({ kind: 'message', text: result.message });
    } catch (error) {
      setStatus({ kind: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) {
      setStatus({
        kind: 'error',
        text: emailMatches
          ? emailCode
            ? 'Enter the code from your email.'
            : 'Enter your current password.'
          : 'Type your account email exactly to confirm.',
      });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await deleteAccount(
        emailCode
          ? { code: code.trim(), confirmEmail: confirmEmail.trim() }
          : { confirmEmail: confirmEmail.trim(), password },
      );
      onDeleted();
    } catch (error) {
      setPassword('');
      setStatus({ kind: 'error', text: errorMessage(error) });
      setBusy(false);
    }
  };

  return (
    <section className="account-settings-section" aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`}>Delete account</h3>
      {open ? (
        <form
          aria-describedby={`${ids}-warning`}
          aria-labelledby={`${ids}-title`}
          className="account-delete-form"
          id={`${ids}-form`}
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <p className="account-note" id={`${ids}-warning`}>
            This permanently deletes the account, its saved history, sessions and usage records. It
            cannot be undone. Code, drafts and workspaces kept in this browser stay here. Download
            your data first if you want a copy.
          </p>
          <label>
            Type {email} to confirm
            <input
              autoCapitalize="none"
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setConfirmEmail(event.target.value)}
              ref={confirmRef}
              spellCheck={false}
              type="email"
              value={confirmEmail}
            />
          </label>
          {emailCode ? (
            <>
              {codeSent ? (
                <label>
                  Email code
                  <input
                    autoComplete="one-time-code"
                    disabled={busy}
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) => setCode(event.target.value)}
                    pattern="[0-9]{6,10}"
                    type="text"
                    value={code}
                  />
                </label>
              ) : (
                <p className="account-note">
                  To confirm it is you, we will email a code to {email}.
                </p>
              )}
              <button disabled={busy} onClick={() => void sendCode()} type="button">
                {codeSent ? 'Resend code' : 'Email me a code'}
              </button>
            </>
          ) : (
            <label>
              Current password
              <input
                autoComplete="current-password"
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </label>
          )}
          <button
            aria-disabled={!ready}
            className="account-danger-button"
            disabled={busy}
            type="submit"
          >
            <Trash2 aria-hidden="true" size={14} />
            {busy ? 'Working…' : 'Delete account permanently'}
          </button>
          <button disabled={busy} onClick={close} type="button">
            Cancel
          </button>
          <StatusLine status={status} />
        </form>
      ) : (
        <button
          aria-controls={`${ids}-form`}
          aria-expanded={false}
          className="account-danger-button"
          onClick={() => setOpen(true)}
          ref={toggleRef}
          type="button"
        >
          <Trash2 aria-hidden="true" size={14} />
          Delete account…
        </button>
      )}
    </section>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return status.kind === 'error' ? (
    <p className="account-error" role="alert">
      {status.text}
    </p>
  ) : (
    <p className="account-message" role="status">
      {status.text}
    </p>
  );
}

function sessionName(session: AccountSession): string {
  return `${session.device ?? 'unknown device'} (signed in ${formatDate(session.createdAt)})`;
}

function formatDate(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? dateFormat.format(time) : 'at an unknown time';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Account request failed.';
}
