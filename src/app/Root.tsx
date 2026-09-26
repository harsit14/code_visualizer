/**
 * Top-level router. The landing page ships in the entry bundle; the dashboard,
 * with the editor and runtimes, loads only when it is opened.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { LandingPage } from '../components/LandingPage';
import { OfflineStatus } from '../components/OfflineStatus';
import { prefersSavingData, startServiceWorker } from '../offline/registration';
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

  useEffect(() => {
    // Installing the offline shell downloads the dashboard too; on data saver
    // the landing page leaves that until the dashboard is opened.
    if (showDashboard || !prefersSavingData()) startServiceWorker();
  }, [showDashboard]);

  return (
    <>
      {showDashboard ? (
        <Suspense fallback={<DashboardLoading />}>
          <DashboardApp onOpenLanding={openLanding} />
        </Suspense>
      ) : (
        <LandingPage />
      )}
      <OfflineStatus />
    </>
  );
}
