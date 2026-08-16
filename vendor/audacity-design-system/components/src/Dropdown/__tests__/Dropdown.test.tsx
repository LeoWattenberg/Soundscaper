import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { lightTheme, darkTheme, type ThemeTokens } from '@audacity-ui/tokens';
import { ThemeProvider } from '../../ThemeProvider/ThemeProvider';
import { Dropdown } from '../Dropdown';

afterEach(cleanup);

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

function renderDropdown(theme: ThemeTokens) {
  return render(
    <ThemeProvider theme={theme}>
      <Dropdown options={OPTIONS} value="a" />
    </ThemeProvider>
  );
}

describe('Dropdown — themed backgrounds', () => {
  // The bug: --dropdown-bg / --dropdown-menu-bg were hardcoded '#FFFFFF'
  // while --dropdown-text is themed, so in dark mode light text sat on a
  // white box. The fix sources both from background.control.input.idle.

  it('dark theme: trigger background follows the dark input token, not white', () => {
    const { container } = renderDropdown(darkTheme);
    const root = container.querySelector('.dropdown') as HTMLElement;
    expect(root.style.getPropertyValue('--dropdown-bg')).toBe(
      darkTheme.background.control.input.idle,
    );
    expect(root.style.getPropertyValue('--dropdown-bg')).not.toBe('#FFFFFF');
  });

  it('light theme: trigger background stays white — website must not change', () => {
    const { container } = renderDropdown(lightTheme);
    const root = container.querySelector('.dropdown') as HTMLElement;
    expect(root.style.getPropertyValue('--dropdown-bg')).toBe('#FFFFFF');
  });

  it('light background.control.input.idle is white — the invariant this fix leans on', () => {
    // If this ever changes, the light-mode dropdown would shift off white
    // and the website appearance would regress; catch it here.
    expect(lightTheme.background.control.input.idle).toBe('#FFFFFF');
  });

  it('dark theme: open menu background follows the dark input token', () => {
    const { getByRole } = renderDropdown(darkTheme);
    fireEvent.click(getByRole('button'));
    const menu = document.querySelector('.dropdown__menu') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.style.getPropertyValue('--dropdown-menu-bg')).toBe(
      darkTheme.background.control.input.idle,
    );
  });

  it('light theme: open menu background stays white', () => {
    const { getByRole } = renderDropdown(lightTheme);
    fireEvent.click(getByRole('button'));
    const menu = document.querySelector('.dropdown__menu') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.style.getPropertyValue('--dropdown-menu-bg')).toBe('#FFFFFF');
  });
});
