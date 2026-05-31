import {
  CUSTOM_SNIPPET_ID,
  DEFAULT_EXAMPLE_ID,
  isPythonExampleId,
} from '../examples/pythonExamples';

export const SHARE_HASH_PREFIX = '#cv=';

export type SharedCodeState = {
  code: string;
  exampleId: string;
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToString(value: string) {
  const paddedValue = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = globalThis.atob(paddedValue);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

export function encodeShareState(state: SharedCodeState) {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, ...state }));
  return `${SHARE_HASH_PREFIX}${bytesToBase64Url(bytes)}`;
}

export function decodeShareHash(hash: string): SharedCodeState | null {
  if (!hash.startsWith(SHARE_HASH_PREFIX)) {
    return null;
  }

  try {
    const rawState = JSON.parse(
      base64UrlToString(hash.slice(SHARE_HASH_PREFIX.length)),
    ) as Partial<SharedCodeState>;

    if (typeof rawState.code !== 'string') {
      return null;
    }

    return {
      code: rawState.code,
      exampleId:
        typeof rawState.exampleId === 'string' &&
        (rawState.exampleId === CUSTOM_SNIPPET_ID || isPythonExampleId(rawState.exampleId))
          ? rawState.exampleId
          : DEFAULT_EXAMPLE_ID,
    };
  } catch {
    return null;
  }
}
