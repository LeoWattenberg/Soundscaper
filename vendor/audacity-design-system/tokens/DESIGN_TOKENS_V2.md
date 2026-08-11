# Audacity Design System - Design Tokens v2

## Overview

This is the new token system for Audacity 4, designed to replace the current opacity-based implementation with a robust, performance-optimized, and themeable foundation.

## Design Principles

1. **Semantic Naming** - Token names describe purpose, not appearance
2. **Performance-First** - All colors are pre-computed solid values (no runtime overlays)
3. **Theme-Agnostic** - Same token names work for light/dark/custom themes
4. **Complete State Coverage** - Every interactive element has all required states
5. **Type-Safe** - TypeScript enforces all tokens are defined
6. **Custom Theme Support** - Easy for users to create their own themes

## Token Structure

### 1. Background Tokens

**Surface** - UI chrome (toolbars, panels, dialogs)
```typescript
background.surface.default       // Main toolbar/panel background
background.surface.elevated      // Dialogs, menus, dropdowns
background.surface.subtle        // Track headers, subtle containers
background.surface.hover         // Interactive surface hover
```

**Canvas** - Audio workspace
```typescript
background.canvas.default        // Main audio canvas
background.canvas.track.idle     // Track idle state
background.canvas.track.selected // Track selected state
background.canvas.track.hover    // Track hover state
background.canvas.grid.major     // Major grid lines
background.canvas.grid.minor     // Minor grid lines
```

**Control** - Buttons, inputs, and interactive elements
```typescript
background.control.button.primary.idle
background.control.button.primary.hover
background.control.button.primary.active
background.control.button.primary.disabled

background.control.input.idle
background.control.input.hover
background.control.input.focus
background.control.input.disabled
background.control.input.error

// ... complete state sets for all controls
```

### 2. Foreground Tokens

**Text** - All text colors
```typescript
foreground.text.primary          // Body text
foreground.text.secondary        // Labels, captions
foreground.text.tertiary         // Hints, placeholders
foreground.text.disabled         // Disabled text
foreground.text.inverse          // Inverse text (for dark canvas in light theme)
foreground.text.error            // Error messages
foreground.text.success          // Success messages
foreground.text.warning          // Warning messages
foreground.text.info             // Info messages
foreground.text.link             // Links
foreground.text.linkHover        // Link hover
```

**Icon** - Icon colors
```typescript
foreground.icon.primary
foreground.icon.secondary
foreground.icon.disabled
foreground.icon.inverse
foreground.icon.success
foreground.icon.warning
foreground.icon.error
foreground.icon.info
```

### 3. Border Tokens

```typescript
border.default                   // Standard borders
border.subtle                    // Subtle borders
border.emphasis                  // Emphasized borders
border.focus                     // Focus rings
border.error                     // Error borders
border.success                   // Success borders
border.warning                   // Warning borders
border.divider                   // Dividers/separators

border.input.idle
border.input.hover
border.input.focus
border.input.error
border.input.disabled
```

### 4. Semantic Tokens

```typescript
semantic.success.background
semantic.success.backgroundSubtle
semantic.success.border
semantic.success.text
semantic.success.icon

// Same structure for warning, error, info
```

### 5. Audio-Specific Tokens

**Waveform**
```typescript
audio.waveform.default
audio.waveform.muted
audio.waveform.rms
audio.waveform.centerLine
```

**Envelope**
```typescript
audio.envelope.line
audio.envelope.lineHover
audio.envelope.point
audio.envelope.pointCenter
audio.envelope.fill
audio.envelope.fillIdle
audio.envelope.hitZone
```

**Clip Colors** - 9 colors × 6 states each = 54 pre-computed colors
```typescript
audio.clip.blue.header
audio.clip.blue.headerHover
audio.clip.blue.body
audio.clip.blue.headerSelected
audio.clip.blue.headerSelectedHover
audio.clip.blue.bodySelected

// × 9 colors: cyan, blue, violet, magenta, red, orange, yellow, green, teal
```

**Timeline**
```typescript
audio.timeline.background
audio.timeline.text
audio.timeline.tickMajor
audio.timeline.tickMinor
audio.timeline.playhead
audio.timeline.playheadShadow
```

**Selection**
```typescript
audio.selection.time
audio.selection.timeBorder
audio.selection.spectral
audio.selection.spectralBorder
```

**Spectrogram**
```typescript
audio.spectrogram.low
audio.spectrogram.mid
audio.spectrogram.high
audio.spectrogram.peak
```

**Transport**
```typescript
audio.transport.play
audio.transport.record
audio.transport.stop
```

## Usage

### Using Themes in Code

```typescript
import { lightTheme, darkTheme } from '@audacity-ui/tokens';

// In your component
const theme = lightTheme; // or darkTheme

// Access tokens
<div style={{
  backgroundColor: theme.background.surface.default,
  color: theme.foreground.text.primary,
  borderColor: theme.border.default
}}>
  Content
</div>
```

### Creating Custom Themes

**Method 1: Manual (Full Control)**

```typescript
import { ThemeTokens } from '@audacity-ui/tokens';

export const myCustomTheme: ThemeTokens = {
  background: {
    surface: {
      default: '#FFF5F7',      // Custom pink tint
      elevated: '#FFFFFF',
      subtle: '#FFE4E9',
      hover: '#FFD1DA',
    },
    // ... define all other tokens
  },
  // ... etc
};
```

**Method 2: Using Helpers (Easier)**

```typescript
import { lightTheme, generateClipColorStates, adjustLightness } from '@audacity-ui/tokens';

export const roseTheme: ThemeTokens = {
  ...lightTheme,
  background: {
    ...lightTheme.background,
    surface: {
      default: '#FFF5F7',
      elevated: '#FFFFFF',
      subtle: '#FFE4E9',
      hover: '#FFD1DA',
    },
  },
  audio: {
    ...lightTheme.audio,
    clip: {
      ...lightTheme.audio.clip,
      blue: generateClipColorStates('#FF1493'),  // Custom hot pink clips
    },
  },
};
```

## Helper Utilities

### `adjustLightness(color, amount)`

Adjust the lightness of a color by a percentage.

```typescript
adjustLightness('#84B5FF', 10)  // Returns lighter blue
adjustLightness('#84B5FF', -10) // Returns darker blue
```

### `generateClipColorStates(baseColor)`

Generate all 6 clip color states from a single base color.

```typescript
const pinkClip = generateClipColorStates('#FF1493');
// Returns:
// {
//   header: '#FF1493',
//   headerHover: '#E50082',      (10% darker)
//   body: '#FF4DB8',             (15% lighter)
//   headerSelected: '#FFAAE0',   (40% lighter)
//   headerSelectedHover: '#FFC9EB', (50% lighter)
//   bodySelected: '#FF80CB'      (30% lighter)
// }
```

### `generateButtonColorStates(baseColor)`

Generate button color states from a base color.

```typescript
const greenButton = generateButtonColorStates('#22c55e');
// Returns:
// {
//   idle: '#22c55e',
//   hover: '#4ade80',      (15% lighter)
//   active: '#16a34a',     (10% darker)
//   disabled: '#86efac'    (30% lighter, -20% saturation)
// }
```

### `mixColors(color1, color2, weight)`

Mix two colors together.

```typescript
mixColors('#FF0000', '#0000FF', 50) // Returns #800080 (purple)
mixColors('#FF0000', '#0000FF', 75) // Returns #BF0040 (more red)
```

### `addAlpha(color, alpha)`

Add transparency to a hex color.

```typescript
addAlpha('#84B5FF', 0.5) // Returns '#84B5FF80' (50% opacity)
```

## Migration from Current System

### Current System Issues

❌ **Opacity-based colors**
```typescript
// Current (bad)
background-secondary-color: white @ 5% opacity
background-tertiary-color: white @ 10% opacity
```
**Problem:** Color depends on what's underneath. Can't predict final appearance.

❌ **Vague naming**
```typescript
// Current (confusing)
background-quaternary-color
button-secondary-color...  // (truncated, which state?)
```
**Problem:** Developers don't know when to use each token.

❌ **Incomplete states**
```typescript
// Current (missing states)
bg-slider              // Where's hover, active, disabled?
bg-toggle-inactive     // Where's hover?
```
**Problem:** Forces developers to make up colors ad-hoc.

### New System Improvements

✅ **Pre-computed solid colors**
```typescript
// New (good)
background.surface.default: '#F9F9FA'
background.surface.elevated: '#FFFFFF'
```
**Benefit:** Predictable, themeable, performant.

✅ **Semantic naming**
```typescript
// New (clear)
background.surface.default
background.control.button.primary.hover
```
**Benefit:** Self-documenting, IDE autocomplete works.

✅ **Complete state coverage**
```typescript
// New (complete)
background.control.slider.thumb.idle
background.control.slider.thumb.hover
background.control.slider.thumb.drag
background.control.slider.thumb.disabled
```
**Benefit:** No missing states, consistent UX.

### Migration Steps

1. **Update tokens package**
   - ✅ `tokens.v2.ts` - Token interface
   - ✅ `themes/light.v2.ts` - Light theme
   - ✅ `themes/dark.v2.ts` - Dark theme
   - ✅ `utils/theme-helpers.ts` - Helper functions

2. **Update Figma variables** (Designer)
   - Export new token structure to Figma
   - Replace opacity-based variables with solid colors
   - Use hierarchical naming: `background/surface/default`

3. **Update components** (Developer)
   ```typescript
   // Before
   <div style={{ backgroundColor: theme.toolbar }}>

   // After
   <div style={{ backgroundColor: theme.background.surface.default }}>
   ```

4. **Test theming**
   - Verify light theme looks correct
   - Verify dark theme looks correct
   - Test custom theme creation

## Performance Benefits

### Current System (Slow)
```css
/* Runtime color calculation */
.clip-body {
  background: var(--clip-color);
}
.clip-body--selected {
  background: var(--clip-color);
  /* Add overlay */
  box-shadow: inset 0 0 0 9999px rgba(255, 255, 255, 0.2);
}
```
**Problem:** Browser must composite multiple layers for every clip.

### New System (Fast)
```css
/* Pre-computed colors */
.clip-body {
  background: #A2C7FF; /* Solid color */
}
.clip-body--selected {
  background: #C0D9FF; /* Different solid color */
}
```
**Benefit:** Single paint operation per clip. Much faster with hundreds of clips.

## File Structure

```
packages/tokens/src/
├── tokens.v2.ts                 # TypeScript interface
├── themes/
│   ├── light.v2.ts              # Light theme (default)
│   └── dark.v2.ts               # Dark theme
├── utils/
│   └── theme-helpers.ts         # Helper functions
└── DESIGN_TOKENS_V2.md          # This file
```

## Token Count

- **Total tokens:** ~200
- **Clip colors:** 54 (9 colors × 6 states)
- **Button states:** 12 (3 variants × 4 states)
- **Input states:** 5
- **Checkbox states:** 6
- **Radio states:** 6
- **Toggle states:** 6
- **Slider states:** 5
- **Semantic:** 20 (4 types × 5 properties)

## Examples

### Example 1: Using Button Tokens

```typescript
import { lightTheme } from '@audacity-ui/tokens';

function Button({ variant = 'primary', disabled = false, ...props }) {
  const getBackgroundColor = () => {
    if (disabled) {
      return lightTheme.background.control.button[variant].disabled;
    }
    // In real implementation, handle hover/active states
    return lightTheme.background.control.button[variant].idle;
  };

  return (
    <button
      style={{
        backgroundColor: getBackgroundColor(),
        color: lightTheme.foreground.text.primary,
        border: `1px solid ${lightTheme.border.default}`,
      }}
      disabled={disabled}
      {...props}
    />
  );
}
```

### Example 2: Using Clip Colors

```typescript
import { lightTheme } from '@audacity-ui/tokens';

function ClipHeader({ color, selected, isHovering }) {
  const clipColor = lightTheme.audio.clip[color];

  let backgroundColor = clipColor.header;
  if (selected && isHovering) {
    backgroundColor = clipColor.headerSelectedHover;
  } else if (selected) {
    backgroundColor = clipColor.headerSelected;
  } else if (isHovering) {
    backgroundColor = clipColor.headerHover;
  }

  return (
    <div style={{
      backgroundColor,
      borderColor: selected
        ? lightTheme.audio.clip.border.selected
        : lightTheme.audio.clip.border.normal
    }}>
      Clip Header
    </div>
  );
}
```

### Example 3: Creating a Custom "Rosé" Theme

```typescript
import { lightTheme, generateClipColorStates, ThemeTokens } from '@audacity-ui/tokens';

export const roseTheme: ThemeTokens = {
  ...lightTheme,
  background: {
    ...lightTheme.background,
    surface: {
      default: '#FFF5F7',        // Soft pink
      elevated: '#FFFFFF',
      subtle: '#FFE4E9',
      hover: '#FFD1DA',
    },
  },
  foreground: {
    ...lightTheme.foreground,
    text: {
      ...lightTheme.foreground.text,
      primary: '#4A0E0E',        // Dark rose text
    },
  },
  audio: {
    ...lightTheme.audio,
    clip: {
      ...lightTheme.audio.clip,
      blue: generateClipColorStates('#FF1493'),    // Hot pink
      violet: generateClipColorStates('#DA70D6'),  // Orchid
      magenta: generateClipColorStates('#E91E63'), // Rose
    },
  },
};
```

## Next Steps

1. **Design Review** - Get designer approval on token structure
2. **Figma Sync** - Export tokens to Figma variables
3. **Component Migration** - Update components to use new tokens
4. **Documentation** - Document migration path for developers
5. **Release** - Publish `@audacity-ui/tokens@2.0.0`

## Questions?

For questions about the new token system, contact the design system team or file an issue in the repository.
