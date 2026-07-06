// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useMenuDismiss } from './useMenuDismiss';

function Harness() {
  useMenuDismiss();
  return (
    <div>
      <button type="button">Outside</button>
      <details className="panel-menu" data-testid="menu-a" open>
        <summary>Menu A</summary>
        <div>
          <button className="panel-menu-action" type="button">
            One-shot action
          </button>
          <label className="panel-menu-item">
            <input type="checkbox" /> Keep open
          </label>
        </div>
      </details>
      <details className="account-menu" data-testid="menu-b" open>
        <summary>Menu B</summary>
        <div>Account content</div>
      </details>
    </div>
  );
}

function setup() {
  const view = render(<Harness />);
  const menuA = view.getByTestId('menu-a') as HTMLDetailsElement;
  const menuB = view.getByTestId('menu-b') as HTMLDetailsElement;
  return { menuA, menuB, view };
}

afterEach(cleanup);

describe('useMenuDismiss', () => {
  it('closes open menus on pointerdown outside', () => {
    const { menuA, menuB, view } = setup();
    fireEvent.pointerDown(view.getByText('Outside'));
    expect(menuA.open).toBe(false);
    expect(menuB.open).toBe(false);
  });

  it('keeps a menu open when the pointerdown lands inside it', () => {
    const { menuA, menuB, view } = setup();
    fireEvent.pointerDown(view.getByText('Keep open'));
    expect(menuA.open).toBe(true);
    expect(menuB.open).toBe(false);
  });

  it('closes open menus on Escape', () => {
    const { menuA, menuB } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menuA.open).toBe(false);
    expect(menuB.open).toBe(false);
  });

  it('closes the containing menu after a one-shot action click', () => {
    const { menuA, view } = setup();
    fireEvent.click(view.getByText('One-shot action'));
    expect(menuA.open).toBe(false);
  });

  it('leaves the menu open when toggling a checkbox row', () => {
    const { menuA, view } = setup();
    fireEvent.click(view.getByText('Keep open'));
    expect(menuA.open).toBe(true);
  });
});
