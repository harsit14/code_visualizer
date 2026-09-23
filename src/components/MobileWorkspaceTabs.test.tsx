// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MobileWorkspaceTabs } from './MobileWorkspaceTabs';
import { panelMobileTab } from '../app/useMobileWorkspace';
afterEach(cleanup);
it('offers all phone workspaces and keyboard navigation without changing desktop panels', () => {
  const changed = vi.fn();
  render(<MobileWorkspaceTabs active="Code" onChange={changed} />);
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  const code = screen.getByRole('tab', { name: 'Code' });
  expect(code.getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(code, { key: 'ArrowRight' });
  expect(changed).toHaveBeenCalledWith('Visualize');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Visualize' }));
  expect(panelMobileTab.console).toBe('Visualize');
  expect(panelMobileTab.variables).toBe('Inspect');
});
