// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AccountSettings } from './AccountSettings';
import {
  deleteAccount,
  downloadAccountData,
  listSessions,
  requestEmailCode,
  revokeOtherSessions,
  revokeSession,
  type AccountSession,
} from '../app/accountClient';

vi.mock('../app/accountClient', () => ({
  deleteAccount: vi.fn(),
  downloadAccountData: vi.fn(),
  listSessions: vi.fn(),
  requestEmailCode: vi.fn(),
  revokeOtherSessions: vi.fn(),
  revokeSession: vi.fn(),
}));

const sessions: AccountSession[] = [
  {
    createdAt: '2026-09-20T10:00:00.000Z',
    current: true,
    device: 'Chrome on macOS',
    expiresAt: '2026-10-20T10:00:00.000Z',
    id: 'a'.repeat(32),
    lastUsedAt: '2026-09-25T10:00:00.000Z',
  },
  {
    createdAt: '2026-09-10T10:00:00.000Z',
    current: false,
    device: 'Firefox on Windows',
    expiresAt: '2026-10-10T10:00:00.000Z',
    id: 'b'.repeat(32),
    lastUsedAt: null,
  },
  {
    createdAt: '2026-09-01T10:00:00.000Z',
    current: false,
    device: null,
    expiresAt: '2026-10-01T10:00:00.000Z',
    id: 'c'.repeat(32),
    lastUsedAt: null,
  },
];

beforeEach(() => {
  vi.mocked(listSessions).mockResolvedValue(sessions);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderSettings(authMethod: 'legacy' | 'supabase' = 'legacy') {
  const onDeleted = vi.fn();
  render(
    <AccountSettings authMethod={authMethod} email="person@example.com" onDeleted={onDeleted} />,
  );
  return onDeleted;
}

describe('account settings', () => {
  it('lists sessions, marks this device and revokes another one', async () => {
    renderSettings();
    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('This device')).toBeTruthy();
    expect(within(list).getByText('Unknown device')).toBeTruthy();
    // Only other sessions can be signed out here.
    const buttons = within(list).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    vi.mocked(revokeSession).mockResolvedValue();
    fireEvent.click(within(list).getByRole('button', { name: /Sign out Firefox on Windows/ }));
    await screen.findByText(/^Signed out Firefox on Windows/);
    expect(revokeSession).toHaveBeenCalledWith('b'.repeat(32));
    expect(screen.queryByText('Firefox on Windows')).toBeNull();
  });

  it('signs out everywhere else and reports failures', async () => {
    renderSettings();
    await screen.findByRole('list');
    vi.mocked(revokeOtherSessions).mockRejectedValueOnce(new Error('Network down'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere else' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Network down');
    vi.mocked(revokeOtherSessions).mockResolvedValueOnce(2);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere else' }));
    expect((await screen.findByRole('status')).textContent).toBe('Signed out 2 other sessions.');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(
      (screen.getByRole('button', { name: 'Sign out everywhere else' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('shows the session list error when it cannot load', async () => {
    vi.mocked(listSessions).mockRejectedValueOnce(new Error('Sign in to manage your account.'));
    renderSettings();
    expect((await screen.findByRole('alert')).textContent).toBe('Sign in to manage your account.');
  });

  it('downloads account data with visible success and failure states', async () => {
    renderSettings();
    vi.mocked(downloadAccountData).mockRejectedValueOnce(new Error('Too many attempts.'));
    fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts.');
    vi.mocked(downloadAccountData).mockResolvedValueOnce('code-visualizer-account-2026-09-25.json');
    fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));
    expect((await screen.findByRole('status')).textContent).toContain(
      'code-visualizer-account-2026-09-25.json',
    );
  });

  it('requires the typed email and password before deleting, and restores focus on cancel', async () => {
    const onDeleted = renderSettings();
    const toggle = screen.getByRole('button', { name: 'Delete account…' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const form = screen.getByRole('form', { name: 'Delete account' });
    const confirm = within(form).getByLabelText('Type person@example.com to confirm');
    expect(document.activeElement).toBe(confirm);
    expect(form.getAttribute('aria-describedby')).toBeTruthy();

    const submit = within(form).getByRole('button', { name: 'Delete account permanently' });
    fireEvent.change(confirm, { target: { value: 'someone@example.com' } });
    fireEvent.change(within(form).getByLabelText('Current password'), {
      target: { value: 'secret password' },
    });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(submit);
    expect((await within(form).findByRole('alert')).textContent).toBe(
      'Type your account email exactly to confirm.',
    );
    expect(deleteAccount).not.toHaveBeenCalled();

    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete account…' })),
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('deletes a password account and reports a wrong password', async () => {
    const onDeleted = renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account…' }));
    const form = screen.getByRole('form', { name: 'Delete account' });
    const password = within(form).getByLabelText('Current password') as HTMLInputElement;
    fireEvent.change(within(form).getByLabelText(/to confirm/), {
      target: { value: ' Person@Example.com ' },
    });
    fireEvent.change(password, { target: { value: 'wrong password' } });
    vi.mocked(deleteAccount).mockRejectedValueOnce(new Error('That password is incorrect.'));
    fireEvent.click(within(form).getByRole('button', { name: 'Delete account permanently' }));
    expect((await within(form).findByRole('alert')).textContent).toBe(
      'That password is incorrect.',
    );
    expect(password.value).toBe('');
    fireEvent.change(password, { target: { value: 'correct password' } });
    vi.mocked(deleteAccount).mockResolvedValueOnce();
    fireEvent.click(within(form).getByRole('button', { name: 'Delete account permanently' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(deleteAccount).toHaveBeenLastCalledWith({
      confirmEmail: 'Person@Example.com',
      password: 'correct password',
    });
  });

  it('asks email-code accounts for a fresh code instead of a password', async () => {
    const onDeleted = renderSettings('supabase');
    fireEvent.click(screen.getByRole('button', { name: 'Delete account…' }));
    const form = screen.getByRole('form', { name: 'Delete account' });
    expect(within(form).queryByLabelText('Current password')).toBeNull();
    vi.mocked(requestEmailCode).mockResolvedValue({ message: 'Check your inbox.' });
    fireEvent.click(within(form).getByRole('button', { name: 'Email me a code' }));
    const code = await within(form).findByLabelText('Email code');
    expect(requestEmailCode).toHaveBeenCalledWith('person@example.com', false);
    expect(within(form).getByRole('status').textContent).toBe('Check your inbox.');
    fireEvent.change(within(form).getByLabelText(/to confirm/), {
      target: { value: 'person@example.com' },
    });
    fireEvent.change(code, { target: { value: '123456' } });
    vi.mocked(deleteAccount).mockResolvedValueOnce();
    fireEvent.click(within(form).getByRole('button', { name: 'Delete account permanently' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(deleteAccount).toHaveBeenCalledWith({
      code: '123456',
      confirmEmail: 'person@example.com',
    });
  });
});
