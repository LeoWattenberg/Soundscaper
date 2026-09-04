import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../ThemeProvider/ThemeProvider';
import { EffectSlot } from '../EffectSlot';
import { EffectsStackHeader } from '../EffectsStackHeader';

afterEach(cleanup);

describe('Soundscaper effects patches', () => {
  it('exposes the stack-options callback as a menu button', () => {
    const onContextMenu = vi.fn();
    const { getByRole } = render(
      <ThemeProvider>
        <EffectsStackHeader name="Track 1" allEnabled onContextMenu={onContextMenu} />
      </ThemeProvider>,
    );

    fireEvent.click(getByRole('button', { name: 'Effect stack options' }));
    expect(onContextMenu).toHaveBeenCalledOnce();
  });

  it('shows remove first and installed effects in a flat replacement menu', () => {
    const { getAllByRole, getByRole, queryByText } = render(
      <ThemeProvider>
        <EffectSlot effectName="Limiter" purchasedEffects={[{ id: 'paid', name: 'Paid Reverb', vendor: 'Vendor' }]} />
      </ThemeProvider>,
    );

    fireEvent.click(getByRole('button', { name: 'Effect settings' }));
    const items = getAllByRole('menuitem');

    expect(items[0]).toHaveTextContent('Remove effect');
    expect(getByRole('menuitem', { name: 'Compressor' })).toBeInTheDocument();
    expect(getByRole('menuitem', { name: 'Paid Reverb' })).toBeInTheDocument();
    expect(queryByText('Get effects…')).not.toBeInTheDocument();
  });
});
