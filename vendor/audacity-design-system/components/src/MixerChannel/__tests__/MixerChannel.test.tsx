import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../ThemeProvider/ThemeProvider';
import { MixerChannel } from '../MixerChannel';

afterEach(cleanup);

describe('MixerChannel', () => {
  it('renders optional input and effect-footer controls', () => {
    const { container, getByText } = render(
      <ThemeProvider>
        <MixerChannel
          inputControls={<button type="button">Input route</button>}
          effectFooter={<button type="button">Bus route</button>}
          effectFooterVisible
        />
      </ThemeProvider>,
    );

    expect(getByText('Input route')).toBeInTheDocument();
    expect(getByText('Bus route')).toBeInTheDocument();
    expect(container.querySelector('.mixer-channel__input-controls')).toBeInTheDocument();
    expect(container.querySelector('.mixer-channel__effect-footer')).toBeInTheDocument();
  });

  it('can reserve an empty effect-footer row', () => {
    const { container } = render(
      <ThemeProvider><MixerChannel effectFooterVisible /></ThemeProvider>,
    );

    expect(container.querySelector('.mixer-channel__effect-footer')).toBeEmptyDOMElement();
  });
});
