import { cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../ThemeProvider/ThemeProvider';
import { Flyout } from '../Flyout';

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  vi.useRealTimers();
});

function renderFlyout(direction: 'down' | 'up' | 'left' | 'right' = 'down') {
  HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 80,
    height: 40,
    top: 0,
    right: 80,
    bottom: 40,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  return render(
    <ThemeProvider>
      <Flyout isOpen onClose={vi.fn()} x={100} y={50} direction={direction}>
        <button type="button">Action</button>
      </Flyout>
    </ThemeProvider>,
  );
}

describe('Flyout', () => {
  it.each([
    ['down', '60px', '58px'],
    ['up', '60px', '10px'],
    ['left', '12px', '30px'],
    ['right', '108px', '30px'],
  ] as const)('expands %s from its anchor', (direction, left, top) => {
    const { getByRole } = renderFlyout(direction);
    const flyout = getByRole('dialog');

    expect(flyout).toHaveStyle({ left, top });
    expect(flyout).toHaveClass(`flyout--${direction}`);
  });

  it('closes on Escape and restores focus to its trigger', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    const triggerRef = { current: trigger } as React.RefObject<HTMLElement>;

    const { getByRole } = render(
      <ThemeProvider>
        <Flyout isOpen onClose={onClose} x={100} y={50} triggerRef={triggerRef}>
          Content
        </Flyout>
      </ThemeProvider>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    vi.runAllTimers();

    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    expect(getByRole('dialog')).toBeInTheDocument();
    trigger.remove();
  });

  it('closes when a pointer press occurs outside the flyout', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <ThemeProvider>
        <Flyout isOpen onClose={onClose} x={100} y={50}>Content</Flyout>
      </ThemeProvider>,
    );

    vi.runAllTimers();
    fireEvent.pointerDown(document.body);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
