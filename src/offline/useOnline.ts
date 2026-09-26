import { useSyncExternalStore } from 'react';

function subscribe(listener: () => void) {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** Browser connectivity; account, history and AI actions need the network. */
export function useOnline() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
