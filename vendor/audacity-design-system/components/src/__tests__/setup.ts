import '@testing-library/jest-dom/vitest';

// Mock canvas context for components that render to canvas
HTMLCanvasElement.prototype.getContext = (() => {
  const noop = () => {};
  return function () {
    return {
      fillRect: noop,
      clearRect: noop,
      getImageData: () => ({ data: new Array(4) }),
      putImageData: noop,
      createImageData: () => ([]),
      setTransform: noop,
      drawImage: noop,
      save: noop,
      fillText: noop,
      restore: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      closePath: noop,
      stroke: noop,
      translate: noop,
      scale: noop,
      rotate: noop,
      arc: noop,
      fill: noop,
      measureText: () => ({ width: 0 }),
      transform: noop,
      rect: noop,
      clip: noop,
      canvas: { width: 100, height: 100 },
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      globalCompositeOperation: 'source-over',
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
    };
  };
})() as any;
