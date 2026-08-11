/**
 * Audacity Design System - Token Taxonomy v2
 *
 * Design Principles:
 * 1. Semantic naming - tokens describe purpose, not appearance
 * 2. Performance-first - all colors are pre-computed solid values (no runtime overlays)
 * 3. Theme-agnostic - same token names work for light/dark/custom themes
 * 4. Complete state coverage - every interactive element has all required states
 * 5. Type-safe - TypeScript enforces all tokens are defined
 */

/**
 * Clip color states
 * All values are pre-computed solid colors for performance
 */
export interface ClipColorStates {
  /** Default header color */
  header: string;
  /** Header hover state */
  headerHover: string;
  /** Header selected state */
  headerSelected: string;
  /** Header selected + hover state */
  headerSelectedHover: string;
  /** Default body color */
  body: string;
  /** Default waveform color */
  waveform: string;
  /** Waveform color when clip is selected */
  waveformSelected: string;
  /** Default RMS waveform color */
  waveformRms: string;
  /** RMS waveform color when clip is selected */
  waveformRmsSelected: string;
  /** Time selection/selected clip - clip body background */
  timeSelectionBody: string;
  /** Time selection overlay - clip header background */
  timeSelectionHeader: string;
  /** Time selection overlay - waveform color */
  timeSelectionWaveform: string;
  /** Time selection overlay - RMS waveform color */
  timeSelectionWaveformRms: string;
}

/**
 * Button color states
 */
export interface ButtonColorStates {
  idle: string;
  hover: string;
  active: string;
  disabled: string;
}

/**
 * Complete theme token structure
 * All colors are solid, pre-computed values (no transparent overlays)
 */
export interface ThemeTokens {
  /** Background colors for surfaces, controls, and audio elements */
  background: {
    /** Surface backgrounds (panels, toolbars, dialogs) */
    surface: {
      /** Default surface (toolbars, panels) */
      default: string;
      /** Elevated surfaces (dialogs, menus, dropdowns) */
      elevated: string;
      /** Subtle/recessed surfaces (track headers, subtle containers) */
      subtle: string;
      /** Inset/recessed content areas (project grids, list containers) */
      inset: string;
      /** Hover state for interactive surfaces */
      hover: string;
    };

    /** Dialog-specific backgrounds */
    dialog: {
      /** Dialog header background */
      header: string;
      /** Dialog body/content background */
      body: string;
      /** Dialog footer background */
      footer: string;
    };

    /** Canvas backgrounds (audio workspace) */
    canvas: {
      /** Main canvas background */
      default: string;
      /** Track states */
      track: {
        idle: string;
        selected: string;
        hover: string;
      };
      /** Grid/ruler backgrounds */
      grid: {
        major: string;
        minor: string;
      };
    };

    /** Control backgrounds (buttons, inputs, etc.) */
    control: {
      /** Button backgrounds */
      button: {
        primary: ButtonColorStates;
        secondary: ButtonColorStates;
        ghost: ButtonColorStates;
      };

      /** Input field backgrounds */
      input: {
        idle: string;
        hover: string;
        focus: string;
        disabled: string;
        error: string;
      };

      /** Checkbox backgrounds */
      checkbox: {
        idle: string;
        hover: string;
        pressed: string;
        checked: string;
        checkedHover: string;
        disabled: string;
      };

      /** Radio button backgrounds */
      radio: {
        idle: string;
        hover: string;
        pressed: string;
        selected: string;
        selectedHover: string;
        disabled: string;
      };

      /** Toggle switch backgrounds */
      toggle: {
        off: {
          idle: string;
          hover: string;
          disabled: string;
        };
        on: {
          idle: string;
          hover: string;
          disabled: string;
        };
      };

      /** Slider backgrounds */
      slider: {
        track: string;
        thumb: {
          idle: string;
          hover: string;
          drag: string;
          disabled: string;
        };
        handle: {
          background: string;
          border: string;
        };
      };

      /** Fader backgrounds */
      fader: {
        track: string;
        thumb: {
          idle: string;
          hover: string;
          drag: string;
          disabled: string;
        };
      };

      /** Pan knob */
      panKnob: {
        face: string;
        border: string;
        gauge: string;
      };

      /** Scrollbar backgrounds */
      scrollbar: {
        track: string;
        thumb: {
          idle: string;
          hover: string;
          pressed: string;
        };
      };

      /** Timecode display backgrounds */
      timecode: {
        idle: string;
        hover: string;
        active: string;
      };

      /** Meter backgrounds */
      meter: {
        background: string;
        fill: string;
        peak: string;
        rms: string;
      };
    };

    /** Menu backgrounds */
    menu: {
      background: string;
      item: {
        idle: string;
        hover: string;
        pressed: string;
        active: string;
      };
      separator: string;
    };

    /** Table backgrounds */
    table: {
      /** Table container background */
      background: string;
      /** Table header background */
      header: {
        background: string;
        text: string;
        border: string;
      };
      /** Table row backgrounds */
      row: {
        idle: string;
        hover: string;
        selected: string;
        /** Alternate row background (for striped tables) */
        alternate: string;
        text: string;
        border: string;
      };
      /** Table cell backgrounds */
      cell: {
        idle: string;
        hover: string;
        selected: string;
        text: string;
        /** Secondary text within cells (smaller, muted) */
        textSecondary: string;
        border: string;
      };
    };

    /** Tab backgrounds */
    tab: {
      idle: string;
      hover: string;
      selected: string;
      selectedBorder: string;
    };

    /** Track header backgrounds */
    trackHeader: {
      idle: string;
      hover: string;
      selected: string;
      /** Background of the parent container that holds the track header rows. */
      parent: string;
    };

    /** Panel backgrounds (rulers, sidebars) */
    panel: {
      /** Vertical (dB / frequency) ruler background — intentionally dark in
       *  both themes so the labels read against the canvas below. */
      ruler: string;
      /** Horizontal timeline ruler background — adapts to the active theme
       *  so it matches surrounding toolbar / panel surfaces. */
      timeline: string;
    };

    /** Toolbar surface (main tool toolbar + project toolbar). Distinct from
     *  `surface.default` so the toolbars can carry a slightly different
     *  shade from generic panels/dialogs without re-skinning everything. */
    toolbar: string;

    /** Toast notification background */
    toast: string;
  };

  /** Foreground colors (text, icons) */
  foreground: {
    /** Text colors */
    text: {
      /** Primary body text */
      primary: string;
      /** Secondary/muted text (labels, captions) */
      secondary: string;
      /** Tertiary/subtle text (hints, placeholders) */
      tertiary: string;
      /** Disabled text */
      disabled: string;
      /** Inverse text (for use on dark backgrounds in light theme, light backgrounds in dark theme) */
      inverse: string;
      /** Error text */
      error: string;
      /** Success text */
      success: string;
      /** Warning text */
      warning: string;
      /** Info text */
      info: string;
      /** Link text */
      link: string;
      /** Link hover text */
      linkHover: string;
      /** Primary contrast text (bright, for dark backgrounds like rulers and canvas) */
      contrastPrimary: string;
      /** Secondary contrast text (muted, for dark backgrounds) */
      contrastSecondary: string;
    };

    /** Icon colors */
    icon: {
      /** Primary icons */
      primary: string;
      /** Secondary/muted icons */
      secondary: string;
      /** Disabled icons */
      disabled: string;
      /** Inverse icons */
      inverse: string;
      /** Success icons */
      success: string;
      /** Warning icons */
      warning: string;
      /** Error icons */
      error: string;
      /** Info icons */
      info: string;
    };
  };

  /** Border and divider colors */
  border: {
    /** Default border color */
    default: string;
    /** Subtle border (less prominent) */
    subtle: string;
    /** Emphasis border (more prominent) */
    emphasis: string;
    /** Focus ring border */
    focus: string;
    /** Error border */
    error: string;
    /** Success border */
    success: string;
    /** Warning border */
    warning: string;
    /** Divider/separator color */
    divider: string;
    /** Border/divider on elevated surfaces (timeline ruler, dialogs, menus) */
    onElevated: string;
    /** Border/divider on default surfaces (toolbars, panels) */
    onSurface: string;
    /** Input border states */
    input: {
      idle: string;
      hover: string;
      focus: string;
      error: string;
      disabled: string;
    };
    /** Control borders (checkboxes, radios) */
    control: {
      radio: string;
      checkbox: string;
    };
  };

  /** Accent colors */
  accent: {
    /** Primary accent color (blue - for selected tracks) */
    primary: string;
    /** Secondary accent color (orange - for master track) */
    secondary: string;
  };

  /** Semantic colors (success, warning, error, info) */
  semantic: {
    success: {
      background: string;
      backgroundSubtle: string;
      border: string;
      text: string;
      icon: string;
    };
    warning: {
      background: string;
      backgroundSubtle: string;
      border: string;
      text: string;
      icon: string;
    };
    error: {
      background: string;
      backgroundSubtle: string;
      border: string;
      text: string;
      icon: string;
    };
    info: {
      background: string;
      backgroundSubtle: string;
      border: string;
      text: string;
      icon: string;
    };
  };

  /** Audio-specific colors */
  audio: {
    /** Envelope colors */
    envelope: {
      /** Envelope line */
      line: string;
      /** Envelope line hover state */
      lineHover: string;
      /** Envelope control point */
      point: string;
      /** Envelope point center (inner dot) */
      pointCenter: string;
      /** Envelope fill (automation overlay) */
      fill: string;
      /** Envelope fill when idle (envelope mode off but has points) */
      fillIdle: string;
      /** Envelope hit zone (for debugging/visual feedback) */
      hitZone: string;
    };

    /** Clip colors - 9 color palette + classic style with 6 states each */
    clip: {
      cyan: ClipColorStates;
      blue: ClipColorStates;
      violet: ClipColorStates;
      magenta: ClipColorStates;
      red: ClipColorStates;
      orange: ClipColorStates;
      yellow: ClipColorStates;
      green: ClipColorStates;
      teal: ClipColorStates;
      classic: ClipColorStates;
      /** Clip border colors */
      border: {
        normal: string;
        envelope: string;
        selected: string;
      };
    };

    /** Timeline/ruler colors */
    timeline: {
      /** Ruler background */
      background: string;
      /** Time marker text */
      text: string;
      /** Major tick marks */
      tickMajor: string;
      /** Minor tick marks */
      tickMinor: string;
      /** Playhead cursor */
      playhead: string;
      /** Playhead shadow/depth */
      playheadShadow: string;
      /** Loop region fill (active/enabled) */
      loopRegionFill: string;
      /** Loop region border (active/enabled) */
      loopRegionBorder: string;
      /** Loop region fill (inactive/disabled) */
      loopRegionFillInactive: string;
      /** Loop region border (inactive/disabled) */
      loopRegionBorderInactive: string;
    };

    /** Selection colors */
    selection: {
      /** Time selection background (selected tracks) */
      time: string;
      /** Time selection background (unselected tracks) */
      timeUnselected: string;
      /** Time selection border */
      timeBorder: string;
      /** Spectral selection background */
      spectral: string;
      /** Spectral selection border */
      spectralBorder: string;
    };

    /** Label colors */
    label: {
      /** Label background (unselected) */
      background: string;
      /** Label background (selected) */
      backgroundSelected: string;
      /** Label background (hover) */
      backgroundHover: string;
      /** Label text color */
      text: string;
      /** Label stalk color (unselected) */
      stalk: string;
      /** Label stalk color (selected) */
      stalkSelected: string;
      /** Label stalk color (hover) */
      stalkHover: string;
      /** Label ear color (unselected) */
      ear: string;
      /** Label ear color (selected) */
      earSelected: string;
      /** Label ear color (hover) */
      earHover: string;
    };

    /** Spectrogram colors */
    spectrogram: {
      /** Low frequency color */
      low: string;
      /** Mid frequency color */
      mid: string;
      /** High frequency color */
      high: string;
      /** Peak color */
      peak: string;
    };

    /** Transport control colors */
    transport: {
      /** Play button color */
      play: string;
      /** Record button color */
      record: string;
      /** Stop button color */
      stop: string;
    };

    /** Piano roll editor colors */
    pianoRoll: {
      /** Lane backgrounds */
      laneWhite: string;
      laneBlack: string;
      /** Grid lines */
      gridMeasure: string;
      gridBeat: string;
      gridSubdivision: string;
      /** Note rendering */
      noteFill: string;
      noteFillSelected: string;
      noteBorder: string;
      noteBorderSelected: string;
      /** Piano keyboard */
      keyWhite: string;
      keyBlack: string;
      keyBorder: string;
      keyActive: string;
      /** Panel background */
      background: string;
      /** Toolbar background */
      toolbar: string;
      /** Dimmed overlay for regions outside the clip bounds */
      clipRegionOutside: string;
      /** Vertical boundary line at clip start/end */
      clipBoundary: string;
    };
  };

  /** Overlay colors (modals, tooltips) */
  overlay: {
    /** Modal backdrop */
    modal: string;
    /** Light overlay */
    light: string;
    /** Tooltip background */
    tooltip: string;
    /** Tooltip text */
    tooltipText: string;
  };

  /** Stroke colors (rulers, ticks, grid lines) */
  stroke: {
    /** Ruler tick marks */
    ruler: {
      /** Primary tick marks (major ticks) */
      primary: string;
      /** Secondary tick marks (minor ticks) */
      secondary: string;
    };
    /** Grid lines */
    grid: {
      /** Measure lines (at 0.0) */
      measure: string;
      /** Major grid lines */
      major: string;
      /** Minor grid lines */
      minor: string;
    };
  };

  /** Special utility colors */
  utility: {
    /** Pure white (for special cases) */
    white: string;
    /** Pure black (for special cases) */
    black: string;
    /** Transparent (for special cases) */
    transparent: string;
  };
}
