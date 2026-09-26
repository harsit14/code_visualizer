// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTransportShortcuts } from './useTransportShortcuts';

function setup(active: boolean, totalSteps = 10) {
  const options = {
    jumpToStep: vi.fn(),
    run: vi.fn(),
    stepBack: vi.fn(),
    stepForward: vi.fn(),
    togglePlay: vi.fn(),
    totalSteps,
    toggleBookmark: vi.fn(),
    openSearch: vi.fn(),
    presentation: { active, toggle: vi.fn() },
    previousCheckpoint: vi.fn(),
    nextCheckpoint: vi.fn(),
  };
  const hook = renderHook(() => useTransportShortcuts(options));
  return { options, unmount: hook.unmount };
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('presentation shortcuts', () => {
  it('enters presentation with P once a trace exists', () => {
    const empty = setup(false, 0);
    press('p');
    expect(empty.options.presentation.toggle).not.toHaveBeenCalled();
    empty.unmount();

    const { options, unmount } = setup(false);
    expect(press('P').defaultPrevented).toBe(true);
    expect(options.presentation.toggle).toHaveBeenCalledTimes(1);
    press('Escape');
    expect(options.presentation.toggle).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('leaves with Escape or P, even from the scrubber', () => {
    const { options, unmount } = setup(true);
    const slider = document.createElement('input');
    slider.type = 'range';
    document.body.append(slider);
    press('Escape', {}, slider);
    press('p');
    expect(options.presentation.toggle).toHaveBeenCalledTimes(2);
    slider.remove();
    unmount();
  });

  it('pauses editing shortcuts while presenting but keeps the transport', () => {
    const { options, unmount } = setup(true);
    press('Enter', { metaKey: true });
    press('b');
    press('/');
    expect(options.run).not.toHaveBeenCalled();
    expect(options.toggleBookmark).not.toHaveBeenCalled();
    expect(options.openSearch).not.toHaveBeenCalled();
    press('ArrowRight');
    press(' ');
    expect(options.stepForward).toHaveBeenCalledTimes(1);
    expect(options.togglePlay).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('jumps between checkpoints with brackets, and with Page Up/Down while presenting', () => {
    const editing = setup(false);
    press('PageDown');
    press('PageUp');
    expect(editing.options.nextCheckpoint).not.toHaveBeenCalled();
    press(']');
    press('[');
    expect(editing.options.nextCheckpoint).toHaveBeenCalledTimes(1);
    expect(editing.options.previousCheckpoint).toHaveBeenCalledTimes(1);
    editing.unmount();

    const presenting = setup(true);
    press('PageDown');
    press('PageUp');
    expect(presenting.options.nextCheckpoint).toHaveBeenCalledTimes(1);
    expect(presenting.options.previousCheckpoint).toHaveBeenCalledTimes(1);
    presenting.unmount();
  });
});
