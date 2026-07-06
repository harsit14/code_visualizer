import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
// Self-hosted fonts: same-origin woff2 so the production CSP
// (default-src 'self', no font-src) and COEP require-corp are satisfied.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/outfit/800.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/italiana/400.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/components/top-bar.css';
import './styles/components/dashboard-onboarding.css';
import './styles/components/editor.css';
import './styles/components/variables-watch.css';
import './styles/components/controls-bar.css';
import './styles/components/visual-refresh.css';
import './styles/components/traced-light.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
