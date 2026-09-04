import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../ThemeProvider/ThemeProvider';
import { MixerPanel } from '../MixerPanel';

afterEach(cleanup);

describe('MixerPanel', () => {
  it('labels and aligns an optional row below the effects stack', () => {
    const { container, getByText } = render(
      <ThemeProvider>
        <MixerPanel
          effectFooterLabel="Output"
          channels={[{
            id: 'track-1',
            channelProps: { trackName: 'Track 1', effectFooter: <span>Bus A</span> },
          }]}
        />
      </ThemeProvider>,
    );

    expect(getByText('Output')).toBeInTheDocument();
    expect(getByText('Bus A')).toBeInTheDocument();
    expect(container.querySelector('.mixer-channel__effect-footer')).toBeInTheDocument();
  });
});
