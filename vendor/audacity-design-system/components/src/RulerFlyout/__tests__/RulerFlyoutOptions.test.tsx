import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../ThemeProvider/ThemeProvider';
import { RulerFlyout } from '../RulerFlyout';

afterEach(cleanup);

describe('RulerFlyout waveform formats', () => {
  it('offers only the supported linear formats', () => {
    const { getByText, queryByText } = render(
      <ThemeProvider>
        <RulerFlyout isOpen onClose={() => {}} x={0} y={0} mode="waveform" />
      </ThemeProvider>,
    );

    expect(getByText('Linear (amp)')).toBeInTheDocument();
    expect(getByText('Linear (dB)')).toBeInTheDocument();
    expect(queryByText('Logarithmic (dB)')).not.toBeInTheDocument();
  });
});
