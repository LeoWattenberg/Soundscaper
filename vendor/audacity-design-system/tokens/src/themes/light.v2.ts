/**
 * Audacity Design System - Light Theme
 *
 * Default theme for Audacity 4
 * All colors are pre-computed solid values for performance
 */

import { ThemeTokens } from '../tokens.v2';

export const lightTheme: ThemeTokens = {
  background: {
    surface: {
      default: '#F8F8F9',        // Main toolbar/panel background (track panel active)
      elevated: '#E3E3E8',       // Dialogs, menus, dropdowns, ruler, side panel
      subtle: '#EEEEF1',         // Track headers, subtle containers (track panel idle)
      inset: '#EBEDF0',          // Recessed content areas (project grids, list containers)
      hover: '#F2F2F7',          // Interactive surface hover (track panel hover)
    },

    dialog: {
      header: '#F8F8F9',         // Dialog header background
      body: '#F8F8F9',           // Dialog body/content background
      footer: '#F8F8F9',         // Dialog footer background
    },

    canvas: {
      default: '#252837',        // Main audio canvas (dark even in light theme)
      track: {
        idle: 'rgba(255, 255, 255, 0.05)',   // Track idle (semi-transparent so grid lines show through)
        selected: 'rgba(255, 255, 255, 0.1)', // Track selected
        hover: 'rgba(255, 255, 255, 0.075)', // Track hover
      },
      grid: {
        major: '#31354a',        // Major grid lines
        minor: '#292c40',        // Minor grid lines
      },
    },

    control: {
      button: {
        primary: {
          idle: '#84B5FF',       // Primary button (blue)
          hover: '#66A3FF',      // Darker on hover (depressed)
          active: '#5A91E6',     
          disabled: '#C0C5CE',   // Desaturated gray
        },
        secondary: {
          idle: '#D3D4DC',       // Secondary button (subtle gray)
          hover: '#C8CAD3',      // Darker on hover (depressed)
          active: '#BDC1CC',     
          disabled: '#F2F3F5',   // Very light gray
        },
        ghost: {
          idle: 'transparent',   // No background
          hover: '#E3E3E8',      // More prominent gray on hover
          active: '#D3D4DC',     // Darker when pressed
          disabled: 'transparent', // No background when disabled
        },
      },

      input: {
        idle: '#FFFFFF',         // White input background
        hover: '#F9F9FA',        // Slight tint on hover
        focus: '#FFFFFF',        // White when focused
        disabled: '#F2F3F5',     // Light gray when disabled
        error: '#FEF2F2',        // Light red tint for errors
      },

      checkbox: {
        idle: '#D2D4DC',         // Light gray background
        hover: '#C8CAD3',        // Darker gray on hover
        pressed: '#BEC1CC',      
        checked: '#84B5FF',      // Blue when checked
        checkedHover: '#A2C7FF', // Lighter blue on hover
        disabled: '#F2F3F5',     // Very light gray when disabled
      },

      radio: {
        idle: '#FFFFFF',         // White background
        hover: '#F9F9FA',        // Slight gray on hover
        pressed: '#EBEDF0',      // Darker when pressed
        selected: '#84B5FF',     // Blue when selected
        selectedHover: '#A2C7FF', // Lighter blue on hover
        disabled: '#F2F3F5',     // Light gray when disabled
      },

      toggle: {
        off: {
          idle: '#C0C5CE',       // Gray when off
          hover: '#A9B0BD',      // Darker on hover
          disabled: '#E0E0E5',   // Very light gray
        },
        on: {
          idle: '#84B5FF',       // Blue when on
          hover: '#A2C7FF',      // Lighter blue on hover
          disabled: '#C0D9FF',   // Desaturated blue
        },
      },

      slider: {
        track: '#CFCFD9',        // Light gray track
        thumb: {
          idle: '#84B5FF',       // Blue thumb
          hover: '#A2C7FF',      // Lighter on hover
          drag: '#66A3FF',       // Darker when dragging
          disabled: '#C0C5CE',   // Gray when disabled
        },
        handle: {
          background: '#F8F8F9', // Default surface color
          border: '#5B5B5F',     // Handle stroke
        },
      },

      fader: {
        track: '#CFCFD9',        // Light gray track
        thumb: {
          idle: '#84B5FF',       // Blue thumb
          hover: '#A2C7FF',      // Lighter on hover
          drag: '#66A3FF',       // Darker when dragging
          disabled: '#C0C5CE',   // Gray when disabled
        },
      },

      panKnob: {
        face: '#F8F8F9',         // Default surface color (chrome UI)
        border: '#818185',       // 2px border stroke
        gauge: '#CFCFD9',        // Background gauge track
      },

      scrollbar: {
        track: '#F2F3F5',        // Very light gray track
        thumb: {
          idle: '#C0C5CE',       // Medium gray thumb
          hover: '#A9B0BD',      // Darker on hover
          pressed: '#949CAC',    
        },
      },

      timecode: {
        idle: '#FFFFFF',         // White background
        hover: '#F9F9FA',        // Slight gray on hover
        active: '#84B5FF',       // Blue when active/editing
      },

      meter: {
        background: '#CFCFD9',   // Meter background (from Figma)
        fill: '#677CE4',         // Blue meter fill (active control value)
        peak: '#F08080',         // Red peak indicator
        rms: 'rgba(255, 255, 255, 0.25)', // RMS overlay (white at 25% opacity)
      },
    },

    menu: {
      background: '#F8F8F9',     // Context menu background (matches Figma)
      item: {
        idle: 'transparent',     // No background for items
        hover: '#E9E9ED',        // Context menu hover (matches Figma)
        pressed: '#F0F0F3',      // Context menu pressed (matches Figma)
        active: '#DEEBFF',       // Blue tint for active item
      },
      separator: '#EBEDF0',      // Light gray separator
    },

    table: {
      background: '#F8F8F9',     // Light gray table background
      header: {
        background: '#EBEBEF',   // Light gray header
        text: '#14151A',         // Dark text
        border: '#D4D5D9',       // Border color
      },
      row: {
        idle: 'transparent',     // No background for rows
        hover: '#EDEEF1',        // Light gray on hover
        selected: '#DEEBFF',     // Blue tint when selected
        alternate: '#FAFAFA',    // Very light gray for striped rows
        text: '#14151A',         // Dark text
        border: '#E2E3E6',       // Default border
      },
      cell: {
        idle: 'transparent',     // No background for cells
        hover: '#EDEEF1',        // Light gray on hover
        selected: '#DEEBFF',     // Blue tint when selected
        text: '#14151A',         // Dark text
        textSecondary: '#6F788F', // Muted gray for secondary text
        border: '#E2E3E6',       // Default border
      },
    },

    tab: {
      idle: '#F8F8F9',           // Default surface color
      hover: '#EEEEF1',          // Subtle hover
      selected: '#EBF0FA',       // More visible blue tint
      selectedBorder: '#677CE4', // Accent blue
    },

    trackHeader: {
      idle: '#EEEEF1',           // Matches previous surface.subtle (track-panel idle)
      hover: '#F2F2F7',          // Matches previous surface.hover (track-panel hover)
      selected: '#F8F8F9',       // Matches previous surface.default (track-panel active)
      parent: '#E3E3E8',         // Parent panel that holds the track header rows
    },

    panel: {
      ruler: '#262932',          // Vertical ruler (dark, sits over canvas)
      timeline: '#E3E3E8',       // Horizontal timeline ruler (light)
    },

    toolbar: '#F8F8F9',          // Main + project toolbar surface

    toast: '#14151A',            // Dark background for toast notifications
  },

  foreground: {
    text: {
      primary: '#14151A',        // Dark text for body content
      secondary: '#6F788F',      // Muted gray for labels
      tertiary: '#949CAC',       // Light gray for hints
      disabled: '#C0C5CE',       // Very light gray for disabled
      inverse: '#FFFFFF',        // White text (for dark canvas)
      error: '#D63636',          // Red for errors
      success: '#40821C',        // Green for success
      warning: '#CC5619',        // Orange for warnings
      info: '#305BCC',           // Blue for info
      link: '#305BCC',           // Blue for links
      linkHover: '#1A3FB3',      // Darker blue on hover
      contrastPrimary: '#F4F5F9', // Bright text for dark backgrounds (rulers, canvas)
      contrastSecondary: '#C5C6CD', // Muted text for dark backgrounds
    },

    icon: {
      primary: '#14151A',        // Dark icons
      secondary: '#6F788F',      // Muted gray icons
      disabled: '#C0C5CE',       // Light gray for disabled
      inverse: '#FFFFFF',        // White icons (for dark canvas)
      success: '#40821C',        // Green icons
      warning: '#CC5619',        // Orange icons
      error: '#D63636',          // Red icons
      info: '#305BCC',           // Blue icons
    },
  },

  border: {
    default: '#D4D5D9',          // Standard border color
    subtle: '#EBEDF0',           // Subtle border
    emphasis: '#C0C5CE',         // Emphasized border
    focus: '#84B5FF',            // Blue focus ring
    error: '#F08080',            // Red error border
    success: '#74BE59',          // Green success border
    warning: '#FF9E65',          // Orange warning border
    divider: '#D4D5D9',          // Divider/separator color - matches main border
    onElevated: '#D4D5D9',       // Border on elevated surfaces (ruler, dialogs) - matches Figma
    onSurface: '#E9E9E9',        // Border on default surfaces (toolbars, panels) - same contrast as onElevated
    input: {
      idle: '#D2D6DD',           // Input border default
      hover: '#C0C5CE',          // Darker on hover
      focus: '#84B5FF',          // Blue when focused
      error: '#F08080',          // Red for errors
      disabled: '#EBEDF0',       // Light gray when disabled
    },
    control: {
      radio: '#5B5B5F',          // Radio button border
      checkbox: '#5B5B5F',       // Checkbox border
    },
  },

  accent: {
    primary: '#677CE4',          // Blue - for selected tracks
    secondary: '#CC8800',        // Amber/gold - for master track
  },

  semantic: {
    success: {
      background: '#74BE59',     // Green background
      backgroundSubtle: '#E0F2DD', // Light green tint
      border: '#5AA038',         // Darker green border
      text: '#40821C',           // Dark green text
      icon: '#40821C',           // Dark green icon
    },
    warning: {
      background: '#FF9E65',     // Orange background
      backgroundSubtle: '#FFEADD', // Light orange tint
      border: '#E67A3D',         // Darker orange border
      text: '#CC5619',           // Dark orange text
      icon: '#CC5619',           // Dark orange icon
    },
    error: {
      background: '#F08080',     // Red background
      backgroundSubtle: '#FCE4E4', // Light red tint
      border: '#E85B5B',         // Darker red border
      text: '#D63636',           // Dark red text
      icon: '#D63636',           // Dark red icon
    },
    info: {
      background: '#84B5FF',     // Blue background
      backgroundSubtle: '#DEEBFF', // Light blue tint
      border: '#4A7FE6',         // Darker blue border
      text: '#305BCC',           // Dark blue text
      icon: '#305BCC',           // Dark blue icon
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
      // Cyan clip colors
      cyan: {
        header: '#00C1D2',
        headerHover: '#00A8B8',
        body: '#3FCEDA',
        headerSelected: '#FFFFFF',
        headerSelectedHover: '#ECF9FA',
        waveform: '#0D292C',
        waveformSelected: '#0D292C',
        waveformRms: '#2B6B73', // Subtle but visible - lighter than waveform
        waveformRmsSelected: '#2B6B73',
        // Time selection colors (consistent rule: body L=header+15%, header L=header+5%, S=100%)
        timeSelectionBody: '#7BFFFF',        
        timeSelectionHeader: '#24FFFF',      
        timeSelectionWaveform: '#26424A',    // 10% white added to #0D292C
        timeSelectionWaveformRms: '#5A8C95', // 10% white added to #407378 
      },
      // Blue clip colors
      blue: {
        header: '#50A5FF',
        headerHover: '#3D8FE6',
        body: '#75B7FF',
        headerSelected: '#FFFFFF',
        headerSelectedHover: '#F2F7FF',
        waveform: '#172533',
        waveformSelected: '#172533',
        waveformRms: '#4A6E85', // Subtle but visible
        waveformRmsSelected: '#4A6E85',
        timeSelectionBody: '#B0D4FF',        
        timeSelectionHeader: '#94C4FF',      
        timeSelectionWaveform: '#303E4C',    // 10% white added to #172533
        timeSelectionWaveformRms: '#6C849D', // 10% white added to #536B85 
      },
      // Violet clip colors
      violet: {
        header: '#9A96FF',
        headerHover: '#8681E6',
        body: '#ADABFF',
        headerSelected: '#FFFFFF',
        headerSelectedHover: '#F7F6FF',
        waveform: '#232233',
        waveformSelected: '#232233',
        waveformRms: '#5D5A8A', // Subtle but visible
        waveformRmsSelected: '#5D5A8A',
        timeSelectionBody: '#D2D0FF',        
        timeSelectionHeader: '#BDB8FF',      
        timeSelectionWaveform: '#3C3B4C',    // 10% white added to #232233
        timeSelectionWaveformRms: '#807F9D', // 10% white added to #676685 
      },
      // Magenta clip colors
      magenta: {
        header: '#E787D0',
        headerHover: '#D372B8',
        body: '#ECA0D9',
        headerSelected: '#FFFFFF',
        headerSelectedHover: '#FBF4FC',
        waveform: '#2F202B',
        waveformSelected: '#2F202B',
        waveformRms: '#7F5A72', // Subtle but visible
        waveformRmsSelected: '#7F5A72',
        timeSelectionBody: '#FFE7FF',        
        timeSelectionHeader: '#FFCFFF',      
        timeSelectionWaveform: '#483944',    // 10% white added to #2F202B
        timeSelectionWaveformRms: '#977B8F', // 10% white added to #7E6277 
      },
      // Red clip colors
      red: {
        header: '#FF787C',
        headerHover: '#E66467',
        body: '#FF9496',
        headerSelected: '#FFFFFF',
        headerSelectedHover: '#FEF2F2',
        waveform: '#331E1E',
        waveformSelected: '#331E1E',
        waveformRms: '#8A5555', // Subtle but visible
        waveformRmsSelected: '#8A5555',
        timeSelectionBody: '#FFDCE6',        
        timeSelectionHeader: '#FFC2CC',      
        timeSelectionWaveform: '#4C3737',    // 10% white added to #331E1E
        timeSelectionWaveformRms: '#9E7777', // 10% white added to #855E5F 
      },
      // Orange clip colors
      orange: {
        header: '#FF9857',
        headerHover: '#E68442',
        body: '#FFAD7A',
        headerSelected: '#FFFFFF',
        headerSelectedHover: '#FFF5EE',
        waveform: '#332318',
        waveformSelected: '#332318',
        waveformRms: '#8A5F3F', // Subtle but visible
        waveformRmsSelected: '#8A5F3F',
        timeSelectionBody: '#FFD0A8',        
        timeSelectionHeader: '#FFB88A',      
        timeSelectionWaveform: '#4C3C31',    // 10% white added to #332318
        timeSelectionWaveformRms: '#9E806C', // 10% white added to #856754 
      },
      // Yellow clip colors
      yellow: {
        header: '#F0BE31',
        headerHover: '#D4A828',
        body: '#F2CB63',
        headerSelected: '#FFFFFF',
        headerSelectedHover: '#FCF8EE',
        waveform: '#302914',
        waveformSelected: '#302914',
        waveformRms: '#807039', // Subtle but visible
        waveformRmsSelected: '#807039',
        timeSelectionBody: '#FFFFB8',        
        timeSelectionHeader: '#FFFF8E',      
        timeSelectionWaveform: '#49422D',    // 10% white added to #302914
        timeSelectionWaveformRms: '#998B64', // 10% white added to #80724C 
      },
      // Green clip colors
      green: {
        header: '#58C049',
        headerHover: '#47A43A',
        body: '#7CCD70',
        headerSelected: '#FFFFFF',
        headerSelectedHover: '#F0F9EE',
        waveform: '#192916',
        waveformSelected: '#192916',
        waveformRms: '#446C3A', // Subtle but visible
        waveformRmsSelected: '#446C3A',
        timeSelectionBody: '#B0FFC2',        
        timeSelectionHeader: '#89FF9C',      
        timeSelectionWaveform: '#32422F',    // 10% white added to #192916
        timeSelectionWaveformRms: '#6E8C69', // 10% white added to #557351 
      },
      // Teal clip colors
      teal: {
        header: '#00B792',
        headerHover: '#009B7A',
        body: '#17C6A8',
        headerSelected: '#FFFFFF',
        headerSelectedHover: '#EAF8F4',
        waveform: '#052822',
        waveformSelected: '#052822',
        waveformRms: '#1A6659', // Subtle but visible
        waveformRmsSelected: '#1A6659',
        timeSelectionBody: '#5EFFF7',        
        timeSelectionHeader: '#00FDE1',      
        timeSelectionWaveform: '#1E413B',    // 10% white added to #052822
        timeSelectionWaveformRms: '#4A897E', // 10% white added to #317066 
      },
      // Classic clip colors (for "Classic" clip style preference)
      classic: {
        header: '#CDD2F5',
        headerHover: '#A5ACDB',
        body: '#E4E8FA',
        headerSelected: '#FFFFFF',
        headerSelectedHover: '#B8BEE8',
        waveform: '#5359AD', // Classic uses colored waveform
        waveformSelected: '#5359AD', // Same color when selected
        waveformRms: '#8389D4', // Subtle - lighter than waveform
        waveformRmsSelected: '#8389D4', // Same when selected
        timeSelectionBody: '#A4C4F6',
        timeSelectionHeader: '#89A7EE',
        timeSelectionWaveform: '#6C72C6', 
        timeSelectionWaveformRms: '#929ADB', 
      },
      border: {
        normal: '#000000',       // Black border (normal mode)
        envelope: '#000000',     // Black border (envelope mode)
        selected: '#ffffff',     // White border when selected
      },
    },

    timeline: {
      background: '#262932',     // Dark ruler background
      text: '#949CAC',           // Medium gray text
      tickMajor: '#828387',      // Medium gray major ticks
      tickMinor: '#828387',      // Medium gray minor ticks (same as major for now)
      playhead: '#ef4444',       // Red playhead cursor
      playheadShadow: '#dc2626', // Darker red shadow
      loopRegionFill: 'rgba(0, 255, 0, 0.2)', // Semi-transparent green fill (active)
      loopRegionBorder: 'rgba(0, 255, 0, 0.8)', // Solid green border (active)
      loopRegionFillInactive: 'rgba(130, 131, 135, 0.15)', // Semi-transparent gray fill (inactive)
      loopRegionBorderInactive: 'rgba(130, 131, 135, 0.5)', // Gray border (inactive)
    },

    selection: {
      time: '#647684',           // Empty canvas time selection color (selected tracks)
      timeUnselected: '#313846', // Empty canvas time selection color (unselected tracks)
      timeBorder: '#80ccc0',     // Teal border
      spectral: '#84B5FF40',     // Blue 25% spectral selection (pre-computed from rgba)
      spectralBorder: '#84B5FF', // Blue border
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
      play: '#74BE59',           // Green play button
      record: '#FF2672',         // Pink record button
      stop: '#949CAC',           // Gray stop button
    },

    pianoRoll: {
      laneWhite: '#292d40',        // Match canvas track idle background
      laneBlack: '#252837',        // Match canvas default background
      gridMeasure: 'rgba(255,255,255,0.25)',
      gridBeat: 'rgba(255,255,255,0.12)',
      gridSubdivision: 'rgba(255,255,255,0.05)',
      noteFill: '#66A3FF',         // Blue note body
      noteFillSelected: '#DEEBFF', // Light blue selected
      noteBorder: '#305BCC',       // Dark blue border
      noteBorderSelected: '#ffffff',
      keyWhite: '#F0F0F3',
      keyBlack: '#3a3e50',
      keyBorder: '#D2D6DD',
      keyActive: '#84B5FF',
      background: '#1e2130',
      toolbar: '#262932',
      clipRegionOutside: 'rgba(0,0,0,0.35)',
      clipBoundary: 'rgba(255,255,255,0.2)',
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
      measure: '#3B3E4B',        // Grid line at measure boundaries
      major: '#3B3E4B',          // Major grid lines
      minor: '#323543',          // Minor grid lines
    },
  },

  utility: {
    white: '#FFFFFF',
    black: '#000000',
    transparent: 'transparent',
  },
};
