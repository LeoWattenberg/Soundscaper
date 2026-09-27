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

  it('delegates the settings button to a host-owned effect picker', () => {
    const onOpenEffectPicker = vi.fn();
    const { getByRole, queryByRole } = render(
      <ThemeProvider>
        <EffectSlot effectName="Limiter" onOpenEffectPicker={onOpenEffectPicker} />
      </ThemeProvider>,
    );

    const settings = getByRole('button', { name: 'Effect settings' });
    fireEvent.click(settings);

    expect(onOpenEffectPicker).toHaveBeenCalledWith(settings);
    expect(queryByRole('menu')).not.toBeInTheDocument();
  });
});
