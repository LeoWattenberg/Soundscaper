/**
 * Theme Helper Utilities
 *
 * Functions to help create custom themes by computing color variations
 * from base colors (lightness adjustments, state variations, etc.)
 */

import { ClipColorStates, ButtonColorStates } from '../tokens.v2';

/**
 * Convert hex color to HSL
 */
function hexToHSL(hex: string): { h: number; s: number; l: number } {
  // Remove # if present
  hex = hex.replace('#', '');

  // Parse hex to RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Convert HSL to hex color
 */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h >= 180 && h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h >= 240 && h < 300) {
    r = x;
    g = 0;
    b = c;
  } else if (h >= 300 && h < 360) {
    r = c;
    g = 0;
    b = x;
  }

  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Adjust lightness of a color by a percentage
 * @param color - Hex color (e.g. '#84B5FF')
 * @param amount - Percentage to adjust lightness (-100 to +100)
 * @returns Adjusted hex color
 *
 * @example
 * adjustLightness('#84B5FF', 10)  // Lighter
 * adjustLightness('#84B5FF', -10) // Darker
 */
export function adjustLightness(color: string, amount: number): string {
  const hsl = hexToHSL(color);
  const newL = Math.max(0, Math.min(100, hsl.l + amount));
  return hslToHex(hsl.h, hsl.s, newL);
}

/**
 * Adjust saturation of a color by a percentage
 * @param color - Hex color (e.g. '#84B5FF')
 * @param amount - Percentage to adjust saturation (-100 to +100)
 * @returns Adjusted hex color
 */
export function adjustSaturation(color: string, amount: number): string {
  const hsl = hexToHSL(color);
  const newS = Math.max(0, Math.min(100, hsl.s + amount));
  return hslToHex(hsl.h, newS, hsl.l);
}

/**
 * Generate all 6 clip color states from a single base color
 * Follows Audacity's clip color pattern
 *
 * @param baseColor - Base clip color (e.g. '#84B5FF')
 * @returns Complete ClipColorStates object
 *
 * @example
 * const blueClip = generateClipColorStates('#84B5FF');
 * // Returns:
 * // {
 * //   header: '#84B5FF',
 * //   headerHover: '#66A3FF',      (10% darker)
 * //   body: '#A2C7FF',             (15% lighter)
 * //   headerSelected: '#DEEBFF',   (40% lighter)
 * //   headerSelectedHover: '#F2F7FF', (50% lighter)
 * // }
 */
export function generateClipColorStates(baseColor: string): ClipColorStates {
  return {
    header: baseColor,
    headerHover: adjustLightness(baseColor, -10),
    body: adjustLightness(baseColor, 15),
    headerSelected: adjustLightness(baseColor, 40),
    headerSelectedHover: adjustLightness(baseColor, 50),
    waveform: 'rgba(0, 0, 0, 0.7)', // Default dark waveform
    waveformSelected: adjustLightness(baseColor, -70), // Dark colored waveform when selected
    waveformRms: 'rgba(0, 0, 0, 0.4)', // Default RMS waveform (lighter than peak)
    waveformRmsSelected: adjustLightness(baseColor, -60), // Lighter RMS when selected
    // Time selection colors - placeholder values (should be overridden in themes)
    timeSelectionBody: adjustLightness(baseColor, 60),
    timeSelectionHeader: adjustLightness(baseColor, 55),
    timeSelectionWaveform: adjustLightness(baseColor, -70),
    timeSelectionWaveformRms: adjustLightness(baseColor, -60),
  };
}

/**
 * Generate button color states from a base color
 *
 * @param baseColor - Base button color (e.g. '#84B5FF')
 * @returns Complete ButtonColorStates object
 *
 * @example
 * const primaryButton = generateButtonColorStates('#84B5FF');
 * // Returns:
 * // {
 * //   idle: '#84B5FF',
 * //   hover: '#A2C7FF',    (15% lighter)
 * //   active: '#66A3FF',   (10% darker)
 * //   disabled: '#C0D9FF'  (30% lighter, -20% saturation)
 * // }
 */
export function generateButtonColorStates(baseColor: string): ButtonColorStates {
  return {
    idle: baseColor,
    hover: adjustLightness(baseColor, 15),
    active: adjustLightness(baseColor, -10),
    disabled: adjustSaturation(adjustLightness(baseColor, 30), -20),
  };
}

/**
 * Mix two colors together by a given percentage
 * @param color1 - First hex color
 * @param color2 - Second hex color
 * @param weight - Percentage of color1 (0-100, default 50)
 * @returns Mixed hex color
 *
 * @example
 * mixColors('#FF0000', '#0000FF', 50) // Purple (#800080)
 * mixColors('#FF0000', '#0000FF', 75) // More red (#BF0040)
 */
export function mixColors(color1: string, color2: string, weight: number = 50): string {
  // Remove # if present
  color1 = color1.replace('#', '');
  color2 = color2.replace('#', '');

  // Parse hex to RGB
  const r1 = parseInt(color1.substring(0, 2), 16);
  const g1 = parseInt(color1.substring(2, 4), 16);
  const b1 = parseInt(color1.substring(4, 6), 16);

  const r2 = parseInt(color2.substring(0, 2), 16);
  const g2 = parseInt(color2.substring(2, 4), 16);
  const b2 = parseInt(color2.substring(4, 6), 16);

  // Mix
  const w = weight / 100;
  const r = Math.round(r1 * w + r2 * (1 - w));
  const g = Math.round(g1 * w + g2 * (1 - w));
  const b = Math.round(b1 * w + b2 * (1 - w));

  // Convert back to hex
  const toHex = (n: number) => {
    const hex = n.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Add alpha transparency to a hex color
 * @param color - Hex color (e.g. '#84B5FF')
 * @param alpha - Alpha value (0-1)
 * @returns Hex color with alpha (8-digit hex)
 *
 * @example
 * addAlpha('#84B5FF', 0.5) // '#84B5FF80' (50% opacity)
 */
export function addAlpha(color: string, alpha: number): string {
  // Remove # if present
  color = color.replace('#', '');

  // Clamp alpha between 0 and 1
  alpha = Math.max(0, Math.min(1, alpha));

  // Convert alpha to hex (00-FF)
  const alphaHex = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');

  return `#${color}${alphaHex}`;
}

/**
 * Generate a complete set of surface colors from a base color
 * Useful for creating consistent UI chrome colors
 *
 * @param baseColor - Base surface color (e.g. '#F9F9FA')
 * @returns Object with default, elevated, subtle, hover surface colors
 */
export function generateSurfaceColors(baseColor: string) {
  return {
    default: baseColor,
    elevated: adjustLightness(baseColor, 5),  // Slightly lighter
    subtle: adjustLightness(baseColor, -5),   // Slightly darker
    hover: adjustLightness(baseColor, -3),    // Subtle darker for hover
  };
}

/**
 * Example: Create a custom theme by extending light theme
 */
export function createCustomTheme(baseTheme: any, overrides: any) {
  return {
    ...baseTheme,
    ...overrides,
    // Deep merge for nested objects
    background: {
      ...baseTheme.background,
      ...overrides.background,
      surface: {
        ...baseTheme.background.surface,
        ...(overrides.background?.surface || {}),
      },
      canvas: {
        ...baseTheme.background.canvas,
        ...(overrides.background?.canvas || {}),
      },
      control: {
        ...baseTheme.background.control,
        ...(overrides.background?.control || {}),
      },
    },
    foreground: {
      ...baseTheme.foreground,
      ...overrides.foreground,
      text: {
        ...baseTheme.foreground.text,
        ...(overrides.foreground?.text || {}),
      },
      icon: {
        ...baseTheme.foreground.icon,
        ...(overrides.foreground?.icon || {}),
      },
    },
    audio: {
      ...baseTheme.audio,
      ...overrides.audio,
      clip: {
        ...baseTheme.audio.clip,
        ...(overrides.audio?.clip || {}),
      },
    },
  };
}
