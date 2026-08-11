import { describe, it, expect } from 'vitest';
import {
  adjustLightness,
  mixColors,
  addAlpha,
  adjustSaturation,
  generateClipColorStates,
  generateButtonColorStates,
  generateSurfaceColors,
  createCustomTheme,
} from '../theme-helpers';

describe('adjustLightness', () => {
  it('returns a hex color string', () => {
    const result = adjustLightness('#808080', 10);
    expect(result).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('lightens a color with positive amount', () => {
    const original = '#808080';
    const lighter = adjustLightness(original, 20);
    // Lighter color should have higher RGB values
    const parseR = (hex: string) => parseInt(hex.slice(1, 3), 16);
    expect(parseR(lighter)).toBeGreaterThan(parseR(original));
  });

  it('darkens a color with negative amount', () => {
    const original = '#808080';
    const darker = adjustLightness(original, -20);
    const parseR = (hex: string) => parseInt(hex.slice(1, 3), 16);
    expect(parseR(darker)).toBeLessThan(parseR(original));
  });

  it('clamps at 0 lightness (black)', () => {
    const result = adjustLightness('#333333', -200);
    expect(result).toBe('#000000');
  });

  it('clamps at 100 lightness (white)', () => {
    const result = adjustLightness('#cccccc', 200);
    expect(result).toBe('#ffffff');
  });
});

describe('adjustSaturation', () => {
  it('returns a hex color string', () => {
    const result = adjustSaturation('#ff0000', -10);
    expect(result).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('desaturates with negative amount', () => {
    // Pure red desaturated should move toward gray
    const result = adjustSaturation('#ff0000', -50);
    const g = parseInt(result.slice(3, 5), 16);
    // Green channel should increase as we desaturate red
    expect(g).toBeGreaterThan(0);
  });
});

describe('mixColors', () => {
  it('returns first color at weight 100', () => {
    expect(mixColors('#ff0000', '#0000ff', 100)).toBe('#ff0000');
  });

  it('returns second color at weight 0', () => {
    expect(mixColors('#ff0000', '#0000ff', 0)).toBe('#0000ff');
  });

  it('returns midpoint at weight 50', () => {
    const result = mixColors('#ff0000', '#0000ff', 50);
    const r = parseInt(result.slice(1, 3), 16);
    const b = parseInt(result.slice(5, 7), 16);
    // Red and blue should be roughly equal at 50/50 mix
    expect(r).toBeCloseTo(128, -1);
    expect(b).toBeCloseTo(128, -1);
  });

  it('handles colors without # prefix', () => {
    expect(mixColors('ff0000', '0000ff', 100)).toBe('#ff0000');
  });
});

describe('addAlpha', () => {
  it('appends alpha channel to hex color', () => {
    const result = addAlpha('#84B5FF', 1);
    expect(result).toBe('#84B5FFff');
  });

  it('converts 50% alpha correctly', () => {
    const result = addAlpha('#84B5FF', 0.5);
    // 0.5 * 255 = 127.5 → rounds to 128 = 0x80
    expect(result).toBe('#84B5FF80');
  });

  it('handles 0 alpha', () => {
    const result = addAlpha('#84B5FF', 0);
    expect(result).toBe('#84B5FF00');
  });

  it('clamps alpha above 1', () => {
    const result = addAlpha('#84B5FF', 2);
    expect(result).toBe('#84B5FFff');
  });

  it('clamps alpha below 0', () => {
    const result = addAlpha('#84B5FF', -1);
    expect(result).toBe('#84B5FF00');
  });
});

describe('generateClipColorStates', () => {
  const states = generateClipColorStates('#84B5FF');

  it('uses base color as header', () => {
    expect(states.header).toBe('#84B5FF');
  });

  it('returns darker header hover', () => {
    const baseR = parseInt('84', 16);
    const hoverR = parseInt(states.headerHover.slice(1, 3), 16);
    expect(hoverR).toBeLessThan(baseR);
  });

  it('returns lighter body', () => {
    const baseR = parseInt('84', 16);
    const bodyR = parseInt(states.body.slice(1, 3), 16);
    expect(bodyR).toBeGreaterThan(baseR);
  });

  it('returns all required state keys', () => {
    expect(states).toHaveProperty('header');
    expect(states).toHaveProperty('headerHover');
    expect(states).toHaveProperty('body');
    expect(states).toHaveProperty('headerSelected');
    expect(states).toHaveProperty('headerSelectedHover');
    expect(states).toHaveProperty('waveform');
    expect(states).toHaveProperty('waveformSelected');
  });
});

describe('generateButtonColorStates', () => {
  const states = generateButtonColorStates('#84B5FF');

  it('uses base color as idle', () => {
    expect(states.idle).toBe('#84B5FF');
  });

  it('hover is lighter than idle', () => {
    const idleR = parseInt(states.idle.slice(1, 3), 16);
    const hoverR = parseInt(states.hover.slice(1, 3), 16);
    expect(hoverR).toBeGreaterThan(idleR);
  });

  it('active is darker than idle', () => {
    const idleR = parseInt(states.idle.slice(1, 3), 16);
    const activeR = parseInt(states.active.slice(1, 3), 16);
    expect(activeR).toBeLessThan(idleR);
  });

  it('returns all 4 states', () => {
    expect(states).toHaveProperty('idle');
    expect(states).toHaveProperty('hover');
    expect(states).toHaveProperty('active');
    expect(states).toHaveProperty('disabled');
  });
});

describe('generateSurfaceColors', () => {
  const surfaces = generateSurfaceColors('#808080');

  it('uses base color as default', () => {
    expect(surfaces.default).toBe('#808080');
  });

  it('elevated is lighter than default', () => {
    const defaultR = parseInt(surfaces.default.slice(1, 3), 16);
    const elevatedR = parseInt(surfaces.elevated.slice(1, 3), 16);
    expect(elevatedR).toBeGreaterThan(defaultR);
  });

  it('subtle is darker than default', () => {
    const defaultR = parseInt(surfaces.default.slice(1, 3), 16);
    const subtleR = parseInt(surfaces.subtle.slice(1, 3), 16);
    expect(subtleR).toBeLessThan(defaultR);
  });
});

describe('createCustomTheme', () => {
  const baseTheme = {
    background: {
      surface: { default: '#fff' },
      canvas: { default: '#eee' },
      control: { default: '#ddd' },
    },
    foreground: {
      text: { primary: '#000' },
      icon: { primary: '#333' },
    },
    audio: {
      clip: { header: '#84B5FF' },
    },
  };

  it('overrides top-level properties', () => {
    const custom = createCustomTheme(baseTheme, { name: 'custom' });
    expect(custom.name).toBe('custom');
  });

  it('deep merges nested background properties', () => {
    const custom = createCustomTheme(baseTheme, {
      background: { surface: { default: '#000' } },
    });
    expect(custom.background.surface.default).toBe('#000');
    // canvas should be preserved from base
    expect(custom.background.canvas.default).toBe('#eee');
  });

  it('deep merges foreground properties', () => {
    const custom = createCustomTheme(baseTheme, {
      foreground: { text: { primary: '#fff' } },
    });
    expect(custom.foreground.text.primary).toBe('#fff');
    expect(custom.foreground.icon.primary).toBe('#333');
  });

  it('deep merges audio properties', () => {
    const custom = createCustomTheme(baseTheme, {
      audio: { clip: { header: '#ff0000' } },
    });
    expect(custom.audio.clip.header).toBe('#ff0000');
  });
});
