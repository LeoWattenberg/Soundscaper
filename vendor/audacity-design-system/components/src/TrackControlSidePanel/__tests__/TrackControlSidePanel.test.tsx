import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { lightTheme, darkTheme, type ThemeTokens } from '@audacity-ui/tokens';
import { ThemeProvider } from '../../ThemeProvider/ThemeProvider';
import { AccessibilityProfileProvider } from '../../contexts/AccessibilityProfileContext';
import { TrackControlSidePanel } from '../TrackControlSidePanel';

afterEach(cleanup);

function renderPanel(theme: ThemeTokens) {
  return render(
    <ThemeProvider theme={theme}>
      <AccessibilityProfileProvider initialProfileId="au4-tab-groups">
        <TrackControlSidePanel>{[]}</TrackControlSidePanel>
      </AccessibilityProfileProvider>
    </ThemeProvider>
  );
}

describe('TrackControlSidePanel — Add-new button rail override', () => {
  // The header's Add-new button carries a scoped !important background
  // (TrackControlSidePanel.css) because the shared secondary button token
  // has no contrast against the recessed rail. Those CSS rules read
  // --tcsp-add-btn-bg-* vars; if the component stops wiring them from the
  // theme, the hardcoded light-grey CSS fallbacks win in EVERY theme —
  // which is exactly the dark-mode bug this suite pins down.
  it('wires --tcsp-add-btn-bg-* from the dark theme tokens', () => {
    const { container } = renderPanel(darkTheme);
    const panel = container.querySelector('.track-control-side-panel') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.style.getPropertyValue('--tcsp-add-btn-bg-idle')).toBe(
      darkTheme.background.trackHeader.addButton.idle,
    );
    expect(panel.style.getPropertyValue('--tcsp-add-btn-bg-hover')).toBe(
      darkTheme.background.trackHeader.addButton.hover,
    );
    expect(panel.style.getPropertyValue('--tcsp-add-btn-bg-active')).toBe(
      darkTheme.background.trackHeader.addButton.active,
    );
  });

  it('wires --tcsp-add-btn-bg-* from the light theme tokens', () => {
    const { container } = renderPanel(lightTheme);
    const panel = container.querySelector('.track-control-side-panel') as HTMLElement;
    expect(panel.style.getPropertyValue('--tcsp-add-btn-bg-idle')).toBe(
      lightTheme.background.trackHeader.addButton.idle,
    );
  });

  // Locks the approved light-mode design: the token values must equal the
  // hexes that used to live only as CSS fallbacks.
  it('light addButton tokens preserve the original approved greys', () => {
    expect(lightTheme.background.trackHeader.addButton).toEqual({
      idle: '#C0C1C9',
      hover: '#B4B5BE',
      active: '#A8AAB3',
    });
  });

  it('dark addButton tokens differ from the light greys', () => {
    expect(darkTheme.background.trackHeader.addButton.idle).not.toBe(
      lightTheme.background.trackHeader.addButton.idle,
    );
  });
});
