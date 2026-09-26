/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" for static deployments without the API (GitHub Pages). */
  readonly VITE_STATIC_HOST?: string;
  /** "false" ships a service worker that removes itself instead of caching the app. */
  readonly VITE_SERVICE_WORKER?: string;
}
