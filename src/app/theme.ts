/**
 * Single source of truth for the color theme. Must stay in sync with the
 * inline pre-hydration script in index.html, which applies the same
 * stored-value-then-system-preference logic before React loads to avoid a
 * flash of the wrong theme.
 */
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'cv-theme';

export function initialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    /* local storage unavailable */
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Applies the theme to the document and persists the choice. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* local storage unavailable */
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, setTheme, toggleTheme };
}
