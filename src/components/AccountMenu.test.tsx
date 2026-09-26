// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AccountMenu } from './AccountMenu';
import { deleteAccount, fetchAccount, listSessions } from '../app/accountClient';

vi.mock('../app/accountClient', () => ({
  deleteAccount: vi.fn(),
  downloadAccountData: vi.fn(),
  fetchAccount: vi.fn(),
  listSessions: vi.fn(),
  requestEmailCode: vi.fn(),
  revokeOtherSessions: vi.fn(),
  revokeSession: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
  verifyAccountCode: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('account menu', () => {
  it('loads account settings only when opened and signs out after deletion', async () => {
    vi.mocked(fetchAccount).mockResolvedValue({
      accountConfigured: true,
      authMode: 'password',
      billingConfigured: false,
      subscription: null,
      usage: null,
      user: { createdAt: '', email: 'person@example.com', id: 'user-1', authMethod: 'legacy' },
    });
    vi.mocked(listSessions).mockResolvedValue([]);
    vi.mocked(deleteAccount).mockResolvedValue();
    const { container } = render(<AccountMenu />);
    await screen.findByText('person@example.com');
    expect(listSessions).not.toHaveBeenCalled();

    const menu = container.querySelector('details')!;
    act(() => {
      menu.open = true;
      fireEvent(menu, new Event('toggle'));
    });
    await waitFor(() => expect(listSessions).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: 'Delete account…' }));
    const form = screen.getByRole('form', { name: 'Delete account' });
    fireEvent.change(within(form).getByLabelText(/to confirm/), {
      target: { value: 'person@example.com' },
    });
    fireEvent.change(within(form).getByLabelText('Current password'), {
      target: { value: 'correct password' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Delete account permanently' }));

    expect((await screen.findByRole('status')).textContent).toContain('Account deleted.');
    expect(screen.queryByText('person@example.com')).toBeNull();
    expect(screen.getByText('Create your account')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete account…' })).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('summary'));
  });
});
