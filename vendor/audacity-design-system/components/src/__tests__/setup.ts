import '@testing-library/jest-dom/vitest';

// --- Web Storage shim ------------------------------------------------------
// Node 22+ ships native `localStorage`/`sessionStorage` globals whose accessors
// take precedence over the ones jsdom installs on `window`, but return
// `undefined` unless Node was started with `--localstorage-file`. On such a
// Node, every test touching storage dies with
// "Cannot read properties of undefined (reading 'clear')".
//
// This can't be solved with a Node flag. Both `--localstorage-file` and
// `--no-experimental-webstorage` are rejected outright by Node 20 — the version
// CI pins — with "is not allowed in NODE_OPTIONS", so setting either globally
// converts a local-only failure into a CI-wide one.
//
// Restoring the globals here is version-agnostic: on Node 20 jsdom's own
// Storage is already in place, so the guard below skips this entirely.
class MemoryStorage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.entries.set(String(key), String(value));
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[name] === 'undefined') {
    Object.defineProperty(globalThis, name, {
      value: new MemoryStorage() as unknown as Storage,
      configurable: true,
      writable: true,
    });
  }
}

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
