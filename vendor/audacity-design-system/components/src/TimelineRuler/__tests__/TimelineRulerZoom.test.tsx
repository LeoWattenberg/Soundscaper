import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../ThemeProvider/ThemeProvider';
import { TimelineRuler } from '../TimelineRuler';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TimelineRuler zoom labels', () => {
  it('draws fractional seconds at high zoom levels', () => {
    const labels: string[] = [];
    const noop = () => {};
    const context = {
      fillRect: noop,
      clearRect: noop,
      save: noop,
      restore: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      stroke: noop,
      fill: noop,
      scale: noop,
      fillText: (label: string) => labels.push(label),
      createLinearGradient: () => ({ addColorStop: noop }),
      setTransform: noop,
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      font: '',
      globalAlpha: 1,
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);

    render(
      <ThemeProvider>
        <TimelineRuler pixelsPerSecond={1000} totalDuration={1} width={500} />
      </ThemeProvider>,
    );

    expect(labels).toContain('0:00.1');
  });
});
