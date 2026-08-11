# Audacity Design Tokens v2

Complete token system for Audacity 4 with semantic naming, performance optimization, and custom theme support.

## Quick Start

```typescript
import { lightTheme, darkTheme } from '@audacity-ui/tokens';

// Use light theme (Audacity 4 default)
const theme = lightTheme;

// Apply to component
<button style={{
  backgroundColor: theme.background.control.button.primary.idle,
  color: theme.foreground.text.primary
}}>
  Click me
</button>
```

## What's New

✅ **~200 semantic tokens** - Complete coverage of all UI states
✅ **Pre-computed solid colors** - No runtime opacity calculations
✅ **Light + Dark themes** - Both fully implemented
✅ **Custom theme support** - Helper functions to create your own themes
✅ **Performance optimized** - 54 clip colors pre-computed for fast rendering
✅ **Type-safe** - TypeScript ensures all tokens are defined

## Files

- `tokens.v2.ts` - Complete TypeScript interface (~200 tokens)
- `themes/light.v2.ts` - Light theme implementation
- `themes/dark.v2.ts` - Dark theme implementation
- `utils/theme-helpers.ts` - Helper functions for custom themes
- `DESIGN_TOKENS_V2.md` - Complete documentation

## Key Features

### 1. Semantic Naming

```typescript
// ❌ Old (vague)
background-quaternary-color

// ✅ New (clear)
background.surface.elevated
```

### 2. Complete State Coverage

```typescript
// ❌ Old (missing states)
bg-slider

// ✅ New (all states)
background.control.slider.thumb.idle
background.control.slider.thumb.hover
background.control.slider.thumb.drag
background.control.slider.thumb.disabled
```

### 3. Performance

```typescript
// ❌ Old (slow - runtime compositing)
background: rgba(255, 255, 255, 0.05)

// ✅ New (fast - pre-computed solid color)
background: '#242637'
```

### 4. Custom Themes

```typescript
import { lightTheme, generateClipColorStates } from '@audacity-ui/tokens';

export const myTheme = {
  ...lightTheme,
  audio: {
    ...lightTheme.audio,
    clip: {
      ...lightTheme.audio.clip,
      blue: generateClipColorStates('#FF1493'), // Custom color
    },
  },
};
```

## Token Categories

- **Background** - Surface, canvas, controls (100+ tokens)
- **Foreground** - Text, icons (18 tokens)
- **Border** - Borders, dividers, focus rings (13 tokens)
- **Semantic** - Success, warning, error, info (20 tokens)
- **Audio** - Waveform, envelope, clips, timeline, selection (80+ tokens)
- **Overlay** - Modals, tooltips (4 tokens)
- **Utility** - White, black, transparent (3 tokens)

## Documentation

See [DESIGN_TOKENS_V2.md](./DESIGN_TOKENS_V2.md) for complete documentation including:
- Full token reference
- Usage examples
- Migration guide
- Helper utilities
- Performance benefits

## Next Steps

1. Review token structure
2. Export to Figma variables
3. Migrate components
4. Test light/dark themes
5. Release v2.0.0
