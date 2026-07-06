/**
 * Native <details> menus stay open until their summary is clicked again.
 * This hook adds the dropdown behavior users expect, for every menu on the
 * page at once (.panel-menu and .account-menu):
 *
 * - pointerdown outside an open menu closes it (opening one menu therefore
 *   also closes the others),
 * - Escape closes open menus and returns focus to the last menu's summary,
 * - clicking a one-shot action (.panel-menu-action, e.g. Export JSON) closes
 *   its menu, while multi-select rows like the Panels checkboxes stay open.
 *
 * Mount once per page (TopBar on the dashboard, LandingPage for its account
 * menu).
 */
import { useEffect } from 'react';

const OPEN_MENU_SELECTOR = 'details.panel-menu[open], details.account-menu[open]';

export function useMenuDismiss() {
  useEffect(() => {
    const openMenus = () => [
      ...document.querySelectorAll<HTMLDetailsElement>(OPEN_MENU_SELECTOR),
    ];

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      openMenus().forEach((menu) => {
        if (!target || !menu.contains(target)) {
          menu.open = false;
        }
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      const menus = openMenus();
      if (menus.length === 0) {
        return;
      }
      menus.forEach((menu) => {
        menu.open = false;
      });
      menus[menus.length - 1].querySelector('summary')?.focus();
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const action = target?.closest('.panel-menu-action');
      if (action) {
        action.closest('details')?.removeAttribute('open');
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClick);
    };
  }, []);
}
