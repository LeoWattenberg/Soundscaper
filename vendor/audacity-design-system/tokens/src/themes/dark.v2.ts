/**
 * Audacity Design System - Dark Theme
 *
 * Optional dark theme for Audacity 4
 * All colors are pre-computed solid values for performance
 */

import { ThemeTokens } from '../tokens.v2';

export const darkTheme: ThemeTokens = {
  background: {
    surface: {
      default: '#25262b',        // Main toolbar/panel background (dark gray)
      elevated: '#2c2e33',       // Dialogs, menus, dropdowns (slightly lighter)
      subtle: '#1a1b1e',         // Track headers, subtle containers (darker)
      inset: '#1f2024',          // Recessed content areas (project grids, list containers)
      hover: '#2e3035',          // Interactive surface hover
    },

    dialog: {
      header: '#25262b',         // Dialog header background
      body: '#25262b',           // Dialog body/content background
      footer: '#25262b',         // Dialog footer background
    },

    canvas: {
      default: '#171F25',        // Main audio canvas (very dark)
      track: {
        idle: 'rgba(255, 255, 255, 0.03)',   // Track idle (semi-transparent so grid lines show through)
        selected: 'rgba(255, 255, 255, 0.08)', // Track selected
        hover: 'rgba(255, 255, 255, 0.05)',  // Track hover
      },
      grid: {
        major: '#2d2f34',        // Major grid lines
        minor: '#22232',         // Minor grid lines
      },
    },

    control: {
      button: {
        primary: {
          idle: '#4a90e2',       // Primary button (blue, slightly darker than light theme)
          hover: '#5ba3ff',      // Lighter on hover
          active: '#3a7bc8',     // Darker when pressed
          disabled: '#4b5563',   // Desaturated gray
        },
        secondary: {
          idle: '#515A63',       // Secondary button (medium gray)
          hover: '#5B656F',      // Lighter on hover
          active: '#46505A',     // Darker when pressed
          disabled: '#2e3035',   // Very dark gray
        },
        ghost: {
          idle: 'transparent',   // No background
          hover: '#2e3035',      // Subtle gray on hover
          active: '#373a40',     // Slightly lighter when pressed
          disabled: 'transparent', // No background when disabled
        },
      },

      input: {
        idle: '#25262b',         // Dark input background
        hover: '#2c2e33',        // Slightly lighter on hover
        focus: '#2c2e33',        // Slightly lighter when focused
        disabled: '#1a1b1e',     // Very dark when disabled
        error: '#3d1f1f',        // Dark red tint for errors
      },

      checkbox: {
        idle: '#25262b',         // Dark background
        hover: '#2c2e33',        // Slightly lighter on hover
        pressed: '#373a40',      // Even lighter when pressed
        checked: '#4a90e2',      // Blue when checked
        checkedHover: '#5ba3ff', // Lighter blue on hover
        disabled: '#1a1b1e',     // Very dark when disabled
      },

      radio: {
        idle: '#25262b',         // Dark background
        hover: '#2c2e33',        // Slightly lighter on hover
        pressed: '#373a40',      // Even lighter when pressed
        selected: '#4a90e2',     // Blue when selected
        selectedHover: '#5ba3ff', // Lighter blue on hover
        disabled: '#1a1b1e',     // Very dark when disabled
      },

      toggle: {
        off: {
          idle: '#4b5563',       // Medium gray when off
          hover: '#5f6369',      // Lighter on hover
          disabled: '#2e3035',   // Very dark gray
        },
        on: {
          idle: '#4a90e2',       // Blue when on
          hover: '#5ba3ff',      // Lighter blue on hover
          disabled: '#2563eb60', // Desaturated blue
        },
      },

      slider: {
        track: '#171F25',        // Track background
        thumb: {
          idle: '#4a90e2',       // Blue thumb
          hover: '#5ba3ff',      // Lighter on hover
          drag: '#3a7bc8',       // Darker when dragging
          disabled: '#4b5563',   // Gray when disabled
        },
        handle: {
          background: '#2a2d32', // Elevated surface color
          border: '#6b6f76',     // Handle stroke (contrast-matched to light theme)
        },
      },

      fader: {
        track: '#373a40',        // Medium gray track
        thumb: {
          idle: '#4a90e2',       // Blue thumb
          hover: '#5ba3ff',      // Lighter on hover
          drag: '#3a7bc8',       // Darker when dragging
          disabled: '#4b5563',   // Gray when disabled
        },
      },

      panKnob: {
        face: '#2a2d32',         // Elevated surface color (chrome UI)
        border: '#6b6f76',       // Border stroke
        gauge: '#373a40',        // Background gauge track
      },

      scrollbar: {
        track: '#1a1b1e',        // Very dark track
        thumb: {
          idle: '#4b5563',       // Medium gray thumb
          hover: '#5f6369',      // Lighter on hover
          pressed: '#6b7280',    // Even lighter when pressed
        },
      },

      timecode: {
        idle: '#25262b',         // Dark background
        hover: '#2c2e33',        // Slightly lighter on hover
        active: '#4a90e2',       // Blue when active/editing
      },

      meter: {
        background: '#1a1b1e',   // Very dark background
        fill: '#22c55e',         // Green fill (brighter in dark theme)
        peak: '#ef4444',         // Red peak indicator
        rms: 'rgba(255, 255, 255, 0.25)', // RMS overlay (white at 25% opacity)
      },
    },

    menu: {
      background: '#2c2e33',     // Dark menu background
      item: {
        idle: 'transparent',     // No background for items
        hover: '#373a40',        // Medium gray on hover
        pressed: '#4c5058',      // Lighter when pressed
        active: '#1e3a5f',       // Dark blue tint for active item
      },
      separator: '#373a40',      // Medium gray separator
    },

    table: {
      background: '#25262b',     // Dark table background
      header: {
        background: '#2c2e33',   // Slightly lighter header
        text: '#e4e5e7',         // Light text
        border: '#373a40',       // Border color
      },
      row: {
        idle: 'transparent',     // No background for rows
        hover: '#2c2e33',        // Slightly lighter on hover
        selected: '#1e3a5f',     // Dark blue tint when selected
        alternate: '#282930',    // Slightly lighter for striped rows
        text: '#e4e5e7',         // Light text
        border: '#373a40',       // Medium gray border
      },
      cell: {
        idle: 'transparent',     // No background for cells
        hover: '#2c2e33',        // Slightly lighter on hover
        selected: '#1e3a5f',     // Dark blue tint when selected
        text: '#e4e5e7',         // Light text
        textSecondary: '#9ca3af', // Medium gray for secondary text
        border: '#373a40',       // Medium gray border
      },
    },

    tab: {
      idle: '#25262b',           // Default surface color
      hover: '#2c2e33',          // Slightly lighter hover
      selected: '#2a3447',       // Subtle blue tint
      selectedBorder: '#677CE4', // Accent blue
    },

    trackHeader: {
      idle: '#32383E',           // Dark gray idle state
      hover: '#373E45',          // Slightly lighter on hover
      selected: '#3D444B',       // Lighter still when selected/active
      parent: '#252B31',         // Parent panel that holds the track header rows
    },

    panel: {
      ruler: '#1f2024',          // Vertical ruler (dark, sits over canvas)
      timeline: '#252B31',       // Horizontal timeline ruler
    },

    toolbar: '#2E353C',          // Main + project toolbar surface

    toast: '#e4e5e7',            // Light background for toast notifications
  },

  foreground: {
    text: {
      primary: '#e4e5e7',        // Light text for body content
      secondary: '#9ca3af',      // Medium gray for labels
      tertiary: '#6b7280',       // Dark gray for hints
      disabled: '#4b5563',       // Very dark gray for disabled
      inverse: '#1a1b1e',        // Dark text (for light backgrounds)
      error: '#ef4444',          // Red for errors
      success: '#22c55e',        // Green for success
      warning: '#f59e0b',        // Amber for warnings
      info: '#3b82f6',           // Blue for info
      link: '#60a5fa',           // Light blue for links
      linkHover: '#93c5fd',      // Lighter blue on hover
      contrastPrimary: '#F4F5F9', // Bright text for dark backgrounds
      contrastSecondary: '#C5C6CD', // Muted text for dark backgrounds
    },

    icon: {
      primary: '#e4e5e7',        // Light icons
      secondary: '#9ca3af',      // Medium gray icons
      disabled: '#4b5563',       // Dark gray for disabled
      inverse: '#1a1b1e',        // Dark icons (for light backgrounds)
      success: '#22c55e',        // Green icons
      warning: '#f59e0b',        // Amber icons
      error: '#ef4444',          // Red icons
      info: '#3b82f6',           // Blue icons
    },
  },

  border: {
    default: '#373a40',          // Standard border color
    subtle: '#2d2f34',           // Subtle border
    emphasis: '#4c5058',         // Emphasized border
    focus: '#60a5fa',            // Light blue focus ring
    error: '#ef4444',            // Red error border
    success: '#22c55e',          // Green success border
    warning: '#f59e0b',          // Amber warning border
    divider: '#2d2f34',          // Divider/separator color
    onElevated: '#373E44',       // Border on elevated surfaces (timeline ruler, dialogs)
    onSurface: '#434A50',        // Border on default surfaces (toolbars, panels)
    input: {
      idle: '#4c5058',           // Input border default
      hover: '#5f6369',          // Lighter on hover
      focus: '#60a5fa',          // Light blue when focused
      error: '#ef4444',          // Red for errors
      disabled: '#2d2f34',       // Dark gray when disabled
    },
    control: {
      radio: '#9ca3af',          // Radio button border (lighter in dark theme)
      checkbox: '#9ca3af',       // Checkbox border (lighter in dark theme)
    },
  },

  accent: {
    primary: '#677CE4',          // Blue - for selected tracks
    secondary: '#CC8800',        // Amber/gold - for master track
  },

  semantic: {
    success: {
      background: '#22c55e',     // Green background
      backgroundSubtle: '#14532d', // Dark green tint
      border: '#16a34a',         // Darker green border
      text: '#4ade80',           // Light green text
      icon: '#4ade80',           // Light green icon
    },
    warning: {
      background: '#f59e0b',     // Amber background
      backgroundSubtle: '#451a03', // Dark amber tint
      border: '#d97706',         // Darker amber border
      text: '#fbbf24',           // Light amber text
      icon: '#fbbf24',           // Light amber icon
    },
    error: {
      background: '#ef4444',     // Red background
      backgroundSubtle: '#7f1d1d', // Dark red tint
      border: '#dc2626',         // Darker red border
      text: '#f87171',           // Light red text
      icon: '#f87171',           // Light red icon
    },
    info: {
      background: '#3b82f6',     // Blue background
      backgroundSubtle: '#1e3a8a', // Dark blue tint
      border: '#2563eb',         // Darker blue border
      text: '#60a5fa',           // Light blue text
      icon: '#60a5fa',           // Light blue icon
    },
  },

  audio: {
    envelope: {
      line: '#b8ff00',           // Yellow-green envelope line
      lineHover: '#d4ff33',      // Lighter yellow-green on hover
      point: '#b8ff00',          // Yellow-green control point
      pointCenter: 'transparent', // Transparent center (allows waveform to show through)
      fill: '#ffffff80',         // White fill 50% (pre-computed from rgba)
      fillIdle: '#ffffff99',     // White fill 60% when idle (pre-computed from rgba)
      hitZone: '#b8ff0026',      // Yellow-green hit zone 15% (pre-computed from rgba)
    },

    clip: {
      // Same vibrant clip colors work well in dark theme
      cyan: {
        header: '#6CCBD8',
        headerHover: '#48BECF',
        body: '#90D8E1',
        headerSelected: '#D8F2F3',
        headerSelectedHover: '#ECF9FA',
        waveform: '#0D292C',
        waveformSelected: '#0D292C',
        waveformRms: '#2B6B73', // Subtle but visible - lighter than waveform
        waveformRmsSelected: '#2B6B73',
        timeSelectionBody: '#B3F6FF',        
        timeSelectionHeader: '#80F0FF',      
        timeSelectionWaveform: '#26424A',    // 10% white added to #0D292C
        timeSelectionWaveformRms: '#5A8C95', // 10% white added to #407378
      },
      blue: {
        header: '#84B5FF',
        headerHover: '#66A3FF',
        body: '#A2C7FF',
        headerSelected: '#DEEBFF',
        headerSelectedHover: '#F2F7FF',
        waveform: '#172533',
        waveformSelected: '#172533',
        waveformRms: '#4A6E85', // Subtle but visible
        waveformRmsSelected: '#4A6E85',
        timeSelectionBody: '#D0E3FF',        
        timeSelectionHeader: '#9DC4FF',      
        timeSelectionWaveform: '#303E4C',    // 10% white added to #172533
        timeSelectionWaveformRms: '#6C849D', // 10% white added to #536B85
      },
      violet: {
        header: '#ADABFC',
        headerHover: '#9996FC',
        body: '#C1BFFE',
        headerSelected: '#E9E8FF',
        headerSelectedHover: '#F7F6FF',
        waveform: '#232233',
        waveformSelected: '#232233',
        waveformRms: '#5D5A8A', // Subtle but visible
        waveformRmsSelected: '#5D5A8A',
        timeSelectionBody: '#E6E5FF',        
        timeSelectionHeader: '#C3C2FF',      
        timeSelectionWaveform: '#3C3B4C',    // 10% white added to #232233
        timeSelectionWaveformRms: '#807F9D', // 10% white added to #676685
      },
      magenta: {
        header: '#E1A3D6',
        headerHover: '#DA8CCC',
        body: '#E8BAE0',
        headerSelected: '#F6E8F4',
        headerSelectedHover: '#FBF4FC',
        waveform: '#2F202B',
        waveformSelected: '#2F202B',
        waveformRms: '#7F5A72', // Subtle but visible
        waveformRmsSelected: '#7F5A72',
        timeSelectionBody: '#FFD2F7',        
        timeSelectionHeader: '#FF9FEE',      
        timeSelectionWaveform: '#483944',    // 10% white added to #2F202B
        timeSelectionWaveformRms: '#977B8F', // 10% white added to #7E6277
      },
      red: {
        header: '#F39999',
        headerHover: '#F08080',
        body: '#F6B2B2',
        headerSelected: '#FCE4E4',
        headerSelectedHover: '#FEF2F2',
        waveform: '#331E1E',
        waveformSelected: '#331E1E',
        waveformRms: '#8A5555', // Subtle but visible
        waveformRmsSelected: '#8A5555',
        timeSelectionBody: '#FFDADA',        
        timeSelectionHeader: '#FFA6A6',      
        timeSelectionWaveform: '#4C3737',    // 10% white added to #331E1E
        timeSelectionWaveformRms: '#9E7777', // 10% white added to #855E5F
      },
      orange: {
        header: '#FFB183',
        headerHover: '#FF9E65',
        body: '#FFC4A1',
        headerSelected: '#FFEADD',
        headerSelectedHover: '#FFF5EE',
        waveform: '#332318',
        waveformSelected: '#332318',
        waveformRms: '#8A5F3F', // Subtle but visible
        waveformRmsSelected: '#8A5F3F',
        timeSelectionBody: '#FFE1D0',        
        timeSelectionHeader: '#FFC19D',      
        timeSelectionWaveform: '#4C3C31',    // 10% white added to #332318
        timeSelectionWaveformRms: '#9E806C', // 10% white added to #856754
      },
      yellow: {
        header: '#ECCC73',
        headerHover: '#E8C050',
        body: '#F0D896',
        headerSelected: '#F8F0DC',
        headerSelectedHover: '#FCF8EE',
        waveform: '#302914',
        waveformSelected: '#302914',
        waveformRms: '#807039', // Subtle but visible
        waveformRmsSelected: '#807039',
        timeSelectionBody: '#FFEBB3',        
        timeSelectionHeader: '#FFDD80',      
        timeSelectionWaveform: '#49422D',    // 10% white added to #302914
        timeSelectionWaveformRms: '#998B64', // 10% white added to #80724C
      },
      green: {
        header: '#8FCB7A',
        headerHover: '#74BE59',
        body: '#AAD89B',
        headerSelected: '#E0F2DD',
        headerSelectedHover: '#F0F9EE',
        waveform: '#192916',
        waveformSelected: '#192916',
        waveformRms: '#446C3A', // Subtle but visible
        waveformRmsSelected: '#446C3A',
        timeSelectionBody: '#C6FFB3',        
        timeSelectionHeader: '#A1FF80',      
        timeSelectionWaveform: '#32422F',    // 10% white added to #192916
        timeSelectionWaveformRms: '#6E8C69', // 10% white added to #557351
      },
      teal: {
        header: '#5CC3A9',
        headerHover: '#34B494',
        body: '#84D2BE',
        headerSelected: '#D4F0E8',
        headerSelectedHover: '#EAF8F4',
        waveform: '#052822',
        waveformSelected: '#052822',
        waveformRms: '#1A6659', // Subtle but visible
        waveformRmsSelected: '#1A6659',
        timeSelectionBody: '#B3FFEC',        
        timeSelectionHeader: '#80FFDF',      
        timeSelectionWaveform: '#1E413B',    // 10% white added to #052822
        timeSelectionWaveformRms: '#4A897E', // 10% white added to #317066
      },
      // Classic clip colors (for "Classic" clip style preference)
      classic: {
        header: '#CDD2F5',
        headerHover: '#B8BEE8',
        body: '#E4E8FA',
        headerSelected: '#CDD2F5',
        headerSelectedHover: '#B8BEE8',
        waveform: '#5359AD', // Classic uses colored waveform
        waveformSelected: '#5359AD', // Same color when selected
        waveformRms: '#8389D4', // Subtle - lighter than waveform
        waveformRmsSelected: '#8389D4', // Same when selected
        timeSelectionBody: '#A4C4F6',
        timeSelectionHeader: '#CDD2F5',
        timeSelectionWaveform: '#6C72C6', 
        timeSelectionWaveformRms: '#929ADB', 
      },
      border: {
        normal: '#4c5058',       // Medium gray border (normal mode)
        envelope: '#6a6a8a',     // Purple-gray border (envelope mode)
        selected: '#ffffff',     // White border when selected
      },
    },

    timeline: {
      background: '#1a1b1e',     // Very dark ruler background
      text: '#9ca3af',           // Medium gray text
      tickMajor: '#4b5563',      // Medium gray major ticks
      tickMinor: '#373a40',      // Darker gray minor ticks
      playhead: '#ef4444',       // Red playhead cursor
      playheadShadow: '#dc2626', // Darker red shadow
      loopRegionFill: 'rgba(0, 255, 0, 0.2)', // Semi-transparent green fill (active)
      loopRegionBorder: 'rgba(0, 255, 0, 0.8)', // Solid green border (active)
      loopRegionFillInactive: 'rgba(75, 85, 99, 0.2)', // Semi-transparent gray fill (inactive)
      loopRegionBorderInactive: 'rgba(75, 85, 99, 0.6)', // Gray border (inactive)
    },

    selection: {
      time: '#647684',           // Empty canvas time selection color (selected tracks)
      timeUnselected: '#313846', // Empty canvas time selection color (unselected tracks)
      timeBorder: '#80ccc0',     // Teal border
      spectral: '#4a90e240',     // Blue 25% spectral selection (pre-computed from rgba)
      spectralBorder: '#4a90e2', // Blue border
    },

    label: {
      background: '#7EB1FF',           // Light blue background (unselected)
      backgroundSelected: '#3399FF',   // Darker blue background (selected)
      backgroundHover: '#0066CC',      // Dark blue background (hover)
      text: 'rgba(0, 0, 0, 0.8)',      // Black text with 80% opacity
      stalk: '#7EB1FF',                // Light blue stalk (unselected)
      stalkSelected: '#3399FF',        // Darker blue stalk (selected)
      stalkHover: '#0066CC',           // Dark blue stalk (hover)
      ear: '#7EB1FF',                  // Light blue ear (unselected)
      earSelected: '#3399FF',          // Darker blue ear (selected)
      earHover: '#0066CC',             // Dark blue ear (hover)
    },

    spectrogram: {
      low: '#1e3a8a',            // Dark blue for low frequencies
      mid: '#22c55e',            // Green for mid frequencies
      high: '#eab308',           // Yellow for high frequencies
      peak: '#ef4444',           // Red for peaks
    },

    transport: {
      play: '#22c55e',           // Green play button (brighter in dark)
      record: '#FF2672',         // Pink record button
      stop: '#9ca3af',           // Gray stop button
    },

    pianoRoll: {
      laneWhite: '#1d1e21',          // Match canvas track idle background
      laneBlack: '#1a1b1e',          // Match canvas default background
      gridMeasure: 'rgba(255,255,255,0.20)',
      gridBeat: 'rgba(255,255,255,0.10)',
      gridSubdivision: 'rgba(255,255,255,0.04)',
      noteFill: '#4a90e2',
      noteFillSelected: '#93c5fd',
      noteBorder: '#2563eb',
      noteBorderSelected: '#ffffff',
      keyWhite: '#d4d4d8',
      keyBlack: '#3f3f46',
      keyBorder: '#52525b',
      keyActive: '#4a90e2',
      background: '#18181b',
      toolbar: '#1f1f23',
      clipRegionOutside: 'rgba(0,0,0,0.4)',
      clipBoundary: 'rgba(255,255,255,0.25)',
    },
  },

  overlay: {
    modal: '#000000cc',          // Black 80% modal backdrop (pre-computed from rgba)
    light: '#00000066',          // Black 40% light overlay (pre-computed from rgba)
    tooltip: '#18181b',          // Near-black tooltip background
    tooltipText: '#fafafa',      // Off-white tooltip text
  },

  stroke: {
    ruler: {
      primary: '#F4F5F9',        // Bright tick marks (major ticks)
      secondary: '#8B8C96',      // Muted tick marks (minor ticks)
    },
    grid: {
      measure: '#2F3539',        // Grid line at measure boundaries
      major: '#262C32',          // Major grid lines (beats — Canvas maps tier 'beat' here)
      minor: '#323543',          // Minor grid lines (subdivision)
    },
  },

  utility: {
    white: '#FFFFFF',
    black: '#000000',
    transparent: 'transparent',
  },
};
