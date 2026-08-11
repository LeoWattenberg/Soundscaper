/**
 * @audacity-ui/tokens
 *
 * Design tokens for Audacity Design System
 * Contains colors, spacing, and theme definitions
 */

// Export v2 token system
export * from './tokens.v2';
export * from './themes/light.v2';
export * from './themes/dark.v2';
export * from './utils/theme-helpers';

// Legacy exports (v1)

/**
 * Color Scale - Complete color system from Figma
 * Each color has a scale from 100 (lightest) to 900 (darkest)
 */
export const colors = {
  shade: {
    100: '#FFFFFF',
    900: '#000000',
  },
  slate: {
    50: '#F9F9FA',
    100: '#F9F9FA',
    200: '#EBEDF0',
    300: '#DFE2E7',
    400: '#D2D6DD',
    500: '#C0C5CE',
    600: '#A9B0BD',
    700: '#949CAC',
    800: '#838B9D',
    900: '#6F788F',
  },
  midnight: {
    100: '#191B22',
    200: '#262932',
    300: '#30323C',
    400: '#41444F',
    500: '#4D515C',
    600: '#5A5E69',
    700: '#676B77',
    800: '#747884',
    900: '#828591',
  },
  blue: {
    100: '#F2F7FF',
    200: '#DEEBFF',
    300: '#C0D9FF',
    400: '#A2C7FF',
    500: '#84B5FF',
    600: '#66A3FF',
    700: '#4A7FE6',
    800: '#305BCC',
    900: '#1A3FB3',
  },
  violet: {
    100: '#F7F6FF',
    200: '#E9E8FF',
    300: '#D5D3FE',
    400: '#C1BFFE',
    500: '#ADABFC',
    600: '#9996FC',
    700: '#7E7BE6',
    800: '#6360D0',
    900: '#4845BA',
  },
  magenta: {
    100: '#FBF4FC',
    200: '#F6E8F4',
    300: '#EFD1EA',
    400: '#E8BAE0',
    500: '#E1A3D6',
    600: '#DA8CCC',
    700: '#C866B3',
    800: '#B0449A',
    900: '#982681',
  },
  red: {
    100: '#FEF2F2',
    200: '#FCE4E4',
    300: '#F9CBCB',
    400: '#F6B2B2',
    500: '#F39999',
    600: '#F08080',
    700: '#E85B5B',
    800: '#D63636',
    900: '#B91818',
  },
  orange: {
    100: '#FFF5EE',
    200: '#FFEADD',
    300: '#FFD7BF',
    400: '#FFC4A1',
    500: '#FFB183',
    600: '#FF9E65',
    700: '#E67A3D',
    800: '#CC5619',
    900: '#B33600',
  },
  yellow: {
    100: '#FCF8EE',
    200: '#F8F0DC',
    300: '#F4E4B9',
    400: '#F0D896',
    500: '#ECCC73',
    600: '#E8C050',
    700: '#D4A830',
    800: '#B8901A',
    900: '#9C7808',
  },
  green: {
    100: '#F0F9EE',
    200: '#E0F2DD',
    300: '#C5E5BC',
    400: '#AAD89B',
    500: '#8FCB7A',
    600: '#74BE59',
    700: '#5AA038',
    800: '#40821C',
    900: '#2A6408',
  },
  teal: {
    100: '#EAF8F4',
    200: '#D4F0E8',
    300: '#ACE1D3',
    400: '#84D2BE',
    500: '#5CC3A9',
    600: '#34B494',
    700: '#1E9378',
    800: '#0F725C',
    900: '#055140',
  },
  cyan: {
    100: '#ECF9FA',
    200: '#D8F2F3',
    300: '#B4E5EA',
    400: '#90D8E1',
    500: '#6CCBD8',
    600: '#48BECF',
    700: '#2A9BB8',
    800: '#13789E',
    900: '#055584',
  },
} as const;

/**
 * Typography Tokens
 */
export interface TypographyStyle {
  fontFamily: string;
  fontSize: string;
  fontWeight: number;
  lineHeight: string;
}

export const typography = {
  titleBoldFont: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '32px',
    fontWeight: 700,
    lineHeight: '48px',
  },
  tabFont: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '16px',
    fontWeight: 600,
    lineHeight: '24px',
  },
  bodyBold: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '12px',
    fontWeight: 600,
    lineHeight: '16px',
  },
  body: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '12px',
    fontWeight: 400,
    lineHeight: '16px',
  },
} as const;

/** @deprecated Use ThemeTokens from v2 instead */
export interface ThemeV1 {
  // Main backgrounds
  canvas: string;
  toolbar: string;
  trackHeaderPanel: string;
  ruler: string;

  // Borders
  toolbarBorder: string;
  trackHeaderBorder: string;
  rulerBorder: string;

  // Track backgrounds (overlays on canvas)
  trackIdle: string;
  trackSelected: string;

  // Clip colors - New 9-color palette from Figma
  clipColors: {
  };

  clipBorder: {
    normal: string;
    envelope: string;
  };

  clipBorderSelected: string;

  // Waveform
  waveform: string;
  waveformCenterLine: string;

  // Envelope
  envelopeLine: string;
  envelopeLineHover: string;
  envelopeFill: string;
  envelopeFillIdle: string; // When envelope mode is off
  envelopeHitZone: string;
  envelopePoint: string;
  envelopePointCenter: string;

  // Time selection
  timeSelection: string;
  timeSelectionBorder: string;

  // Text
  text: string;
  textInverted: string;

  // Icons
  iconPrimary: string;

  // UI elements
  buttonBg: string;
  buttonBorder: string;
  buttonHoverBg: string;
  buttonHoverBorder: string;
  buttonActiveBg: string;
  buttonActiveBorder: string;
  buttonText: string;
  buttonActiveText: string;

  // Focus states
  focusBorder: string;
}

/** @deprecated Use lightTheme from v2 instead */
export const lightThemeV1: ThemeV1 = {
  // Main backgrounds
  canvas: '#212433',
  toolbar: '#F9F9FA',
  trackHeaderPanel: '#E3E3E8',
  ruler: '#262932',

  // Borders
  toolbarBorder: '#e0e0e5',
  trackHeaderBorder: '#d0d0d5',
  rulerBorder: '#3B3E4B',

  // Track backgrounds (overlays on canvas)
  trackIdle: 'rgba(255, 255, 255, 0.05)',
  trackSelected: 'rgba(255, 255, 255, 0.1)',

  // Clip colors - New 9-color palette from Figma
  clipColors: {
    cyan: {
      header: '#6CCBD8',
      headerHover: '#48BECF',
      body: '#90D8E1',
      headerSelected: '#D8F2F3',
      headerSelectedHover: '#ECF9FA',
    },
    blue: {
      header: '#84B5FF',
      headerHover: '#66A3FF',
      body: '#A2C7FF',
      headerSelected: '#DEEBFF',
      headerSelectedHover: '#F2F7FF',
    },
    violet: {
      header: '#ADABFC',
      headerHover: '#9996FC',
      body: '#C1BFFE',
      headerSelected: '#E9E8FF',
      headerSelectedHover: '#F7F6FF',
    },
    magenta: {
      header: '#E1A3D6',
      headerHover: '#DA8CCC',
      body: '#E8BAE0',
      headerSelected: '#F6E8F4',
      headerSelectedHover: '#FBF4FC',
    },
    red: {
      header: '#F39999',
      headerHover: '#F08080',
      body: '#F6B2B2',
      headerSelected: '#FCE4E4',
      headerSelectedHover: '#FEF2F2',
    },
    orange: {
      header: '#FFB183',
      headerHover: '#FF9E65',
      body: '#FFC4A1',
      headerSelected: '#FFEADD',
      headerSelectedHover: '#FFF5EE',
    },
    yellow: {
      header: '#ECCC73',
      headerHover: '#E8C050',
      body: '#F0D896',
      headerSelected: '#F8F0DC',
      headerSelectedHover: '#FCF8EE',
    },
    green: {
      header: '#8FCB7A',
      headerHover: '#74BE59',
      body: '#AAD89B',
      headerSelected: '#E0F2DD',
      headerSelectedHover: '#F0F9EE',
    },
    teal: {
      header: '#5CC3A9',
      headerHover: '#34B494',
      body: '#84D2BE',
      headerSelected: '#D4F0E8',
      headerSelectedHover: '#EAF8F4',
    },
  },

  clipBorder: {
    normal: '#000000',
    envelope: '#000000',
  },

  clipBorderSelected: '#ffffff',

  // Waveform
  waveform: 'rgba(0, 0, 0, 0.7)',
  waveformCenterLine: '#4a4a4a',

  // Envelope
  envelopeLine: '#ff6600',
  envelopeLineHover: '#ffaa00',
  envelopeFill: 'rgba(255, 255, 255, 0.5)',
  envelopeFillIdle: 'rgba(255, 255, 255, 0.6)',
  envelopeHitZone: 'rgba(255, 102, 0, 0.15)',
  envelopePoint: '#ff6600',
  envelopePointCenter: '#fff',

  // Time selection
  timeSelection: 'rgba(255, 255, 255, 0.2)',
  timeSelectionBorder: '#ffffff',

  // Text
  text: '#14151A',
  textInverted: '#ffffff',

  // Icons
  iconPrimary: '#14151A',

  // UI elements
  buttonBg: '#e0e0e5',
  buttonBorder: '#c0c0c5',
  buttonHoverBg: '#d0d0d5',
  buttonHoverBorder: '#b0b0b5',
  buttonActiveBg: '#4a7a9a',
  buttonActiveBorder: '#5a8aba',
  buttonText: '#333',
  buttonActiveText: '#fff',

  // Focus states
  focusBorder: '#84B5FF',
};

/** @deprecated Use darkTheme from v2 instead */
export const darkThemeV1: ThemeV1 = {
  // Main backgrounds
  canvas: '#1a1a1a',
  toolbar: '#2a2a2a',
  trackHeaderPanel: '#2e2e2e',
  ruler: '#252525',

  // Borders
  toolbarBorder: '#3a3a3a',
  trackHeaderBorder: '#3a3a3a',
  rulerBorder: '#3a3a3a',

  // Track backgrounds (overlays on canvas)
  trackIdle: 'rgba(255, 255, 255, 0.03)',
  trackSelected: 'rgba(255, 255, 255, 0.08)',

  // Clip colors - Same 9-color palette (dark theme uses same colors)
  clipColors: {
    cyan: {
      header: '#6CCBD8',
      headerHover: '#48BECF',
      body: '#90D8E1',
      headerSelected: '#D8F2F3',
      headerSelectedHover: '#ECF9FA',
    },
    blue: {
      header: '#84B5FF',
      headerHover: '#66A3FF',
      body: '#A2C7FF',
      headerSelected: '#DEEBFF',
      headerSelectedHover: '#F2F7FF',
    },
    violet: {
      header: '#ADABFC',
      headerHover: '#9996FC',
      body: '#C1BFFE',
      headerSelected: '#E9E8FF',
      headerSelectedHover: '#F7F6FF',
    },
    magenta: {
      header: '#E1A3D6',
      headerHover: '#DA8CCC',
      body: '#E8BAE0',
      headerSelected: '#F6E8F4',
      headerSelectedHover: '#FBF4FC',
    },
    red: {
      header: '#F39999',
      headerHover: '#F08080',
      body: '#F6B2B2',
      headerSelected: '#FCE4E4',
      headerSelectedHover: '#FEF2F2',
    },
    orange: {
      header: '#FFB183',
      headerHover: '#FF9E65',
      body: '#FFC4A1',
      headerSelected: '#FFEADD',
      headerSelectedHover: '#FFF5EE',
    },
    yellow: {
      header: '#ECCC73',
      headerHover: '#E8C050',
      body: '#F0D896',
      headerSelected: '#F8F0DC',
      headerSelectedHover: '#FCF8EE',
    },
    green: {
      header: '#8FCB7A',
      headerHover: '#74BE59',
      body: '#AAD89B',
      headerSelected: '#E0F2DD',
      headerSelectedHover: '#F0F9EE',
    },
    teal: {
      header: '#5CC3A9',
      headerHover: '#34B494',
      body: '#84D2BE',
      headerSelected: '#D4F0E8',
      headerSelectedHover: '#EAF8F4',
    },
  },

  clipBorder: {
    normal: '#5a8aba',
    envelope: '#6a6a8a',
  },

  clipBorderSelected: '#ffffff',

  // Waveform
  waveform: 'rgba(255, 255, 255, 0.7)',
  waveformCenterLine: '#4a4a4a',

  // Envelope
  envelopeLine: '#ff6600',
  envelopeLineHover: '#ffaa00',
  envelopeFill: 'rgba(255, 255, 255, 0.5)',
  envelopeFillIdle: 'rgba(255, 255, 255, 0.6)',
  envelopeHitZone: 'rgba(255, 102, 0, 0.15)',
  envelopePoint: '#ff6600',
  envelopePointCenter: '#fff',

  // Time selection
  timeSelection: 'rgba(255, 255, 255, 0.2)',
  timeSelectionBorder: '#ffffff',

  // Text
  text: '#e0e0e0',
  textInverted: '#1a1a1a',

  // Icons
  iconPrimary: '#e0e0e0',

  // UI elements
  buttonBg: '#3a3a3a',
  buttonBorder: '#4a4a4a',
  buttonHoverBg: '#4a4a4a',
  buttonHoverBorder: '#5a5a5a',
  buttonActiveBg: '#4a7a9a',
  buttonActiveBorder: '#5a8aba',
  buttonText: '#ccc',
  buttonActiveText: '#fff',

  // Focus states
  focusBorder: '#84B5FF',
};

// Default theme (v1 - deprecated, use lightTheme from v2)
/** @deprecated Use lightTheme from v2 instead */
export const theme = lightThemeV1;
