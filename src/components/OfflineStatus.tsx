/**
 * Connectivity and update notices for the landing page and dashboard. Offline,
 * everything that runs in the browser keeps working; a new version waits for
 * the learner to reload.
 */
import { RefreshCw, WifiOff, X } from 'lucide-react';
import { useState } from 'react';
import { applyUpdate, useUpdateReady } from '../offline/registration';
import { useOnline } from '../offline/useOnline';

export function OfflineStatus() {
  const online = useOnline();
  const updateReady = useUpdateReady();
  const [offlineHidden, setOfflineHidden] = useState(false);
  const [updateHidden, setUpdateHidden] = useState(false);
  // Going offline again shows the notice again.
  if (online && offlineHidden) setOfflineHidden(false);

  return (
    <div aria-live="polite" className="offline-notices" role="status">
      {!online && !offlineHidden ? (
        <div className="offline-notice">
          <WifiOff size={14} />
          <span>
            Offline — saved workspaces, imported traces and lessons still work; Python runs if the
            runtime was cached.
          </span>
          <button
            aria-label="Dismiss offline notice"
            className="offline-notice-dismiss"
            onClick={() => setOfflineHidden(true)}
            type="button"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
      {updateReady && !updateHidden ? (
        <div className="offline-notice offline-notice-update">
          <RefreshCw size={14} />
          <span>Update available — reload to use the new version.</span>
          <button className="offline-notice-action" onClick={() => applyUpdate()} type="button">
            Reload
          </button>
          <button onClick={() => setUpdateHidden(true)} type="button">
            Later
          </button>
        </div>
      ) : null}
    </div>
  );
}
