/**
 * Server features available on this deployment. Static hosts (GitHub Pages) have
 * no API, so account, history and AI actions are hidden instead of failing.
 */
import { useEffect, useState } from 'react';

export type HostCapabilities = {
  accounts: boolean;
  history: boolean;
  ai: boolean;
  /** False until the host has answered; features stay visible meanwhile. */
  known: boolean;
};

const STATIC_HOST = import.meta.env.VITE_STATIC_HOST === 'true';
const UNKNOWN: HostCapabilities = { accounts: true, history: true, ai: true, known: false };
const NONE: HostCapabilities = { accounts: false, history: false, ai: false, known: true };

let request: Promise<HostCapabilities> | null = null;

export function fetchHostCapabilities(): Promise<HostCapabilities> {
  if (STATIC_HOST) return Promise.resolve(NONE);
  request ??= fetch('/api/capabilities', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
    .then(async (response) => {
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !type.includes('application/json')) return NONE;
      const data = (await response.json()) as Partial<Record<keyof HostCapabilities, unknown>>;
      return {
        accounts: data.accounts === true,
        history: data.history === true,
        ai: data.ai === true,
        known: true,
      };
    })
    .catch(() => NONE);
  return request;
}

export function useHostCapabilities(): HostCapabilities {
  const [capabilities, setCapabilities] = useState<HostCapabilities>(STATIC_HOST ? NONE : UNKNOWN);
  useEffect(() => {
    let active = true;
    void fetchHostCapabilities().then((next) => {
      if (active) setCapabilities(next);
    });
    return () => {
      active = false;
    };
  }, []);
  return capabilities;
}

/** Test hook: forget the cached answer. */
export function resetHostCapabilities() {
  request = null;
}
