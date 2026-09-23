import { useState, useSyncExternalStore } from 'react';
import type { PanelId } from './layoutState';
export const mobileTabs = ['Code', 'Visualize', 'Inputs', 'Inspect'] as const;
export type MobileTab = (typeof mobileTabs)[number];
export const panelMobileTab: Record<PanelId, MobileTab> = {
  code: 'Code',
  inputs: 'Inputs',
  data: 'Visualize',
  console: 'Visualize',
  variables: 'Inspect',
  watch: 'Inspect',
  callStack: 'Inspect',
  explainer: 'Inspect',
};
const query = '(max-width: 720px)';
function subscribe(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
export function useMobileWorkspace() {
  const mobile = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>('Code');
  return { mobile, mobileTab, setMobileTab };
}
