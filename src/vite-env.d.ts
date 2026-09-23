/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" for static deployments without the API (GitHub Pages). */
  readonly VITE_STATIC_HOST?: string;
}
