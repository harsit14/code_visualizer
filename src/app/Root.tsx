/**
 * Top-level router. The landing page ships in the entry bundle; the dashboard,
 * with the editor and runtimes, loads only when it is opened.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { LandingPage } from '../components/LandingPage';
import { isDashboardLocation, loadDashboard, openLanding } from './routes';

const DashboardApp = lazy(() =>
  loadDashboard().then((module) => ({ default: module.DashboardApp })),
);

function DashboardLoading() {
  return (
    <div className="app-loading" role="status">
      Loading the workspace…
    </div>
  );
}

export function Root() {
  const [showDashboard, setShowDashboard] = useState(() => isDashboardLocation());

  useEffect(() => {
    const syncRoute = () => setShowDashboard(isDashboardLocation());
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  if (!showDashboard) return <LandingPage />;
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardApp onOpenLanding={openLanding} />
    </Suspense>
  );
}
