import type { Language } from '../engine/types';

/**
 * Shareable session state encoded into the URL hash as `#cv=<base64url>`.
 */

export type SharedState = {
  code: string;
  exampleId?: string;
  language?: Language;
  seed?: number;
  functionName?: string;
  inputs?: string[];
};

const HASH_PREFIX = '#cv=';
const MAX_HASH_CHARS = 300_000;

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
  const hash = HASH_PREFIX + toBase64Url(JSON.stringify(state));
  if (hash.length > MAX_HASH_CHARS)
    throw new Error('This code is too large for a share link. Export a trace file instead.');
  if (!decodeShareHash(hash))
    throw new Error('This session cannot fit in a valid share link. Export a trace file instead.');
  return hash;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function buildIframeEmbedCode(src: string): string {
  const safeSrc = escapeAttribute(src);
  return `<iframe src="${safeSrc}" title="Code Visualizer" width="100%" height="640" loading="lazy" style="border:0;max-width:100%;"></iframe>`;
}

export function decodeShareHash(hash: string): SharedState | null {
  if (!hash.startsWith(HASH_PREFIX) || hash.length > MAX_HASH_CHARS) {
    return null;
  }

  try {
    const decoded = JSON.parse(fromBase64Url(hash.slice(HASH_PREFIX.length))) as SharedState;
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      Array.isArray(decoded) ||
      typeof decoded.code !== 'string' ||
      decoded.code.length > 200_000 ||
      (decoded.language !== undefined &&
        !['python', 'javascript', 'typescript'].includes(decoded.language)) ||
      (decoded.seed !== undefined && !Number.isSafeInteger(decoded.seed)) ||
      (decoded.inputs !== undefined &&
        (!Array.isArray(decoded.inputs) ||
          decoded.inputs.length > 24 ||
          !decoded.inputs.every((input) => typeof input === 'string' && input.length <= 10_000))) ||
      (decoded.functionName !== undefined && typeof decoded.functionName !== 'string') ||
      (decoded.exampleId !== undefined && typeof decoded.exampleId !== 'string')
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}
