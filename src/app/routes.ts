/**
 * Client routes that respect the deployment base path: Cloudflare serves the app
 * at `/`, GitHub Pages under `/<repository>/`.
 */
const base = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

export const landingPath = base;
export const dashboardPath = `${base}app`;

export function isDashboardLocation(
  location: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
) {
  return (
    new URLSearchParams(location.search).get('embed') === '1' ||
    location.pathname === dashboardPath ||
    location.pathname.startsWith(`${dashboardPath}/`) ||
    location.hash.startsWith('#cv=')
  );
}

function navigate(path: string) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function openDashboard(hash = '') {
  navigate(`${dashboardPath}${hash}`);
}

export function openLanding() {
  navigate(landingPath);
}

let dashboardModule: Promise<typeof import('./App')> | null = null;

/** Loads the dashboard bundle (editor, panels, runtimes) once. */
export function loadDashboard() {
  dashboardModule ??= import('./App');
  return dashboardModule;
}
