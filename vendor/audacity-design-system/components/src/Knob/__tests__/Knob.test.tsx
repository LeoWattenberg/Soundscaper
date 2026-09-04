import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Knob } from '../Knob';
import { ThemeProvider } from '../../ThemeProvider/ThemeProvider';

describe('Knob', () => {
  it('uses the dominant drag axis to adjust its value', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <ThemeProvider>
        <Knob value={50} min={0} max={100} onChange={onChange} />
      </ThemeProvider>,
    );

    const knob = getByRole('slider');
    fireEvent.mouseDown(knob, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 140, clientY: 90 });
    fireEvent.mouseUp(document);

    expect(onChange).toHaveBeenLastCalledWith(70);
  });
});
