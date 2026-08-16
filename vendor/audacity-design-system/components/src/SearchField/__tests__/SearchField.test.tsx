import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { lightTheme, darkTheme, type ThemeTokens } from '@audacity-ui/tokens';
import { ThemeProvider } from '../../ThemeProvider/ThemeProvider';
import { SearchField } from '../SearchField';

afterEach(cleanup);

function renderSearchField(theme: ThemeTokens) {
  return render(
    <ThemeProvider theme={theme}>
      <SearchField value="" onChange={() => {}} />
    </ThemeProvider>
  );
}

describe('SearchField — themed background', () => {
  // Bug: --search-field-bg was hardcoded '#FFFFFF' while text/icon/border are
  // themed, so the input was a white box in dark mode. Source it from the
  // input-control token, whose light value is #FFFFFF (website unchanged).
  it('dark theme: background follows the dark input token, not white', () => {
    const { container } = renderSearchField(darkTheme);
    const root = container.querySelector('.search-field') as HTMLElement;
    expect(root.style.getPropertyValue('--search-field-bg')).toBe(
      darkTheme.background.control.input.idle,
    );
    expect(root.style.getPropertyValue('--search-field-bg')).not.toBe('#FFFFFF');
  });

  it('light theme: background stays white — website must not change', () => {
    const { container } = renderSearchField(lightTheme);
    const root = container.querySelector('.search-field') as HTMLElement;
    expect(root.style.getPropertyValue('--search-field-bg')).toBe('#FFFFFF');
  });
});
