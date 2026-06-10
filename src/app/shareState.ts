/**
 * Shareable session state encoded into the URL hash as `#cv=<base64url>`.
 */

export type SharedState = {
  code: string;
  exampleId?: string;
  seed?: number;
  functionName?: string;
  inputs?: string[];
};

const HASH_PREFIX = '#cv=';

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeShareState(state: SharedState): string {
  return HASH_PREFIX + toBase64Url(JSON.stringify(state));
}

export function decodeShareHash(hash: string): SharedState | null {
  if (!hash.startsWith(HASH_PREFIX)) {
    return null;
  }

  try {
    const decoded = JSON.parse(fromBase64Url(hash.slice(HASH_PREFIX.length))) as SharedState;
    if (typeof decoded.code !== 'string') {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}
