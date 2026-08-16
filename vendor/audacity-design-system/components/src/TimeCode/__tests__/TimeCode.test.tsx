import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { lightTheme, darkTheme, type ThemeTokens } from '@audacity-ui/tokens';
import { ThemeProvider } from '../../ThemeProvider/ThemeProvider';
import { TimeCode } from '../TimeCode';

afterEach(cleanup);

function renderTimeCode(theme: ThemeTokens) {
  // Default variant is 'dark' (the transport-toolbar chip), which is what
  // renders on both the light and dark app toolbars.
  return render(
    <ThemeProvider theme={theme}>
      <TimeCode value={0} format="hh:mm:ss" />
    </ThemeProvider>
  );
}

describe('TimeCode — theme-aware dark-variant background', () => {
  it('dark theme: the timecode chip background is #171F25', () => {
    const { container } = renderTimeCode(darkTheme);
    const root = container.querySelector('.timecode') as HTMLElement;
    expect(root.style.getPropertyValue('--timecode-bg')).toBe('#171F25');
    expect(root.style.getPropertyValue('--timecode-bg')).toBe(
      darkTheme.background.control.timecode.idle,
    );
    // Unit segments share the chip background so it reads as one surface.
    expect(root.style.getPropertyValue('--timecode-unit-bg')).toBe('#171F25');
  });

  it('light theme: chip background stays #212433 — light mode / website unchanged', () => {
    const { container } = renderTimeCode(lightTheme);
    const root = container.querySelector('.timecode') as HTMLElement;
    expect(root.style.getPropertyValue('--timecode-bg')).toBe('#212433');
    expect(root.style.getPropertyValue('--timecode-unit-bg')).toBe('#212433');
  });

  it('token values: dark #171F25, light preserves the original #212433', () => {
    expect(darkTheme.background.control.timecode.idle).toBe('#171F25');
    expect(lightTheme.background.control.timecode.idle).toBe('#212433');
  });
});
