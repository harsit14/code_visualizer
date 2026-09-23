// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EmailCodeForm } from './EmailCodeForm';
import { requestEmailCode, verifyAccountCode } from '../app/accountClient';
vi.mock('../app/accountClient', () => ({ requestEmailCode: vi.fn(), verifyAccountCode: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe('email code form', () => {
  it('locks the destination after sending and recovers from an expired code', async () => {
    vi.mocked(requestEmailCode).mockResolvedValue({ message: 'Check your inbox.' });
    vi.mocked(verifyAccountCode).mockRejectedValueOnce(new Error('Expired code'));
    const onAuthenticated = vi.fn();
    render(<EmailCodeForm onAuthenticated={onAuthenticated} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'person@example.com' } });
    fireEvent.click(screen.getByText('Send email code'));
    await screen.findByLabelText('Email code');
    expect((screen.getByLabelText('Email') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.change(screen.getByLabelText('Email code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Verify and sign in'));
    await screen.findByText('Expired code');
    expect(onAuthenticated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Resend code'));
    await waitFor(() => expect(vi.mocked(requestEmailCode)).toHaveBeenCalledTimes(2));
    await screen.findByText('Check your inbox.');
    expect((screen.getByLabelText('Email code') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByText('Use a different email'));
    expect((screen.getByLabelText('Email') as HTMLInputElement).readOnly).toBe(false);
  });
  it('requires an explicit verify-and-link action and passes the link intent', async () => {
    vi.mocked(requestEmailCode).mockResolvedValue({ message: 'Check email.' });
    vi.mocked(verifyAccountCode).mockResolvedValue({
      accountConfigured: true,
      billingConfigured: false,
      subscription: null,
      usage: null,
      user: { id: 'same-id', email: 'person@example.com', createdAt: '', authMethod: 'supabase' },
    });
    const onAuthenticated = vi.fn();
    render(
      <EmailCodeForm
        linkEmail="person@example.com"
        onAuthenticated={onAuthenticated}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/disables its old password/)).toBeTruthy();
    fireEvent.click(screen.getByText('Send email code'));
    await screen.findByLabelText('Email code');
    expect(vi.mocked(requestEmailCode)).toHaveBeenCalledWith('person@example.com', true);
    expect(onAuthenticated).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Email code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Verify and link account'));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(vi.mocked(verifyAccountCode)).toHaveBeenCalledWith('person@example.com', '123456', true);
  });
});
