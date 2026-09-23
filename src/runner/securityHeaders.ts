import { appOrigin } from './protocol';

export function runnerHeaders(allowedApp: string, document = false): Record<string, string> {
  const origin = appOrigin(allowedApp);
  return {
    'Content-Security-Policy': `default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self'; worker-src ${document ? "'self'" : "'none'"}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${origin}`,
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': document ? 'cross-origin' : 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': document ? 'no-store' : 'public, max-age=3600',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
}
