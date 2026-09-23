/**
 * Starting the dashboard bundle and the Python runtime early makes the first run
 * fast, but downloads several megabytes. Warm up on clear intent, or while idle
 * only on a fast connection without data saver.
 */
import { prewarmPythonRuntime } from '../engine/pythonRuntime';
import { loadDashboard } from './routes';

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

export function canWarmUpWhileIdle(
  connection: NetworkInformation | undefined = (
    navigator as Navigator & { connection?: NetworkInformation }
  ).connection,
): boolean {
  // Browsers without the Network Information API wait for intent.
  return !!connection && !connection.saveData && connection.effectiveType === '4g';
}

let warmed = false;

export function warmUpDashboard() {
  if (warmed) return;
  warmed = true;
  void loadDashboard();
  prewarmPythonRuntime();
}

/** Props for calls to action that lead into the dashboard. */
export const warmUpOnIntent = {
  onFocus: warmUpDashboard,
  onPointerEnter: warmUpDashboard,
  onTouchStart: warmUpDashboard,
};
