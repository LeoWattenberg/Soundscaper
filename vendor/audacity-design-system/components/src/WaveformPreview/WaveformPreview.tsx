import React from 'react';

export interface WaveformPreviewProps {
  /** Normalized audio samples in the range -1 to 1 */
  samples: number[];
  /** Fill colour for the waveform bars */
  color?: string;
  /** Width in pixels (CSS) */
  width?: number | string;
  /** Height in pixels (CSS) */
  height?: number | string;
  className?: string;
}

/**
 * Lightweight canvas waveform renderer.
 * Uses the same min/max per-pixel algorithm as ClipBody but with no
 * envelope, selection, or spectrogram overhead.
 */
export function WaveformPreview({
  samples,
  color = '#677CE4',
  width = '100%',
  height = 40,
  className = '',
}: WaveformPreviewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || samples.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = container.clientWidth;
    const cssHeight = container.clientHeight;

    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = color;

    const totalSamples = samples.length;
    const samplesPerPixel = totalSamples / cssWidth;
    const centerY = cssHeight / 2;
    const amplitude = cssHeight / 2;

    for (let px = 0; px < cssWidth; px++) {
      const start = Math.floor(px * samplesPerPixel);
      const end = Math.min(Math.floor((px + 1) * samplesPerPixel), totalSamples);

      let min = 0;
      let max = 0;
      for (let i = start; i < end; i++) {
        const s = samples[i];
        if (s > max) max = s;
        if (s < min) min = s;
      }

      const yTop = centerY - max * amplitude;
      const barHeight = Math.max(1, (max - min) * amplitude);
      ctx.fillRect(px, yTop, 1, barHeight);
    }
  }, [samples, color]);

  // Re-render on resize
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas || samples.length === 0) return;
      // Re-trigger the draw effect by dispatching a synthetic resize
      canvas.dispatchEvent(new Event('resize'));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [samples]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width, height, overflow: 'hidden', position: 'relative' }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
