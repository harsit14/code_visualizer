import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
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
