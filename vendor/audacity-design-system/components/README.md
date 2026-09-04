# @audacity-ui/components

React component library for the Audacity Design System.

## Install

This package is published publicly to npmjs.com under the `@audacity-ui`
scope (moved from the private `@dilsonspickles` GitHub Packages registry
on 4 Sep 2026, so consumers no longer need a token or an `.npmrc`).

```bash
bun add @audacity-ui/components
# or
pnpm add @audacity-ui/components
# or
npm install @audacity-ui/components
```

React 18 or newer is a **peer dependency** — the package does not bundle it.

## Required CSS import

Components ship their styles + the embedded `MusescoreIcon` font file in a
single stylesheet. Import it once at your app entry point:

```ts
import '@audacity-ui/components/style.css';
```

After this, `<Icon>` (and anything that uses it — `TransportButton`,
`ToolButton`, etc.) renders without any further setup.

## Two usage modes

### Standalone (marketing site, manual, docs)

Components render with sensible defaults out of the box. No provider
wrapping needed — perfect for static sites that don't have a runtime
context to plug into.

```tsx
import { Toolbar, TransportButton } from '@audacity-ui/components';
import '@audacity-ui/components/style.css';

<Toolbar>
  <TransportButton icon="play" ariaLabel="Play" />
</Toolbar>
```

Internally, `useTheme()` falls back to the bundled `lightTheme` and
`useAccessibilityProfile()` falls back to the default `au4` profile when
no providers are present.

### App usage with runtime theming + accessibility profiles

For apps that need to switch themes at runtime, persist accessibility
preferences, or coordinate keyboard navigation across the chrome (like
the Audacity sandbox), wrap the tree:

```tsx
import {
  ThemeProvider,
  AccessibilityProfileProvider,
  darkTheme,
} from '@audacity-ui/components';

<ThemeProvider theme={darkTheme}>
  <AccessibilityProfileProvider initialProfileId="au4">
    <YourApp />
  </AccessibilityProfileProvider>
</ThemeProvider>
```

## Component reference

### Icon

```tsx
import { Icon, type IconName } from '@audacity-ui/components';

<Icon name="record" size={20} />
```

### Toolbar + ToolbarDivider + ToolbarButtonGroup

```tsx
import {
  Toolbar,
  ToolbarDivider,
  ToolbarButtonGroup,
} from '@audacity-ui/components';

<Toolbar height={48}>
  <ToolbarButtonGroup>
    {/* buttons here */}
  </ToolbarButtonGroup>
  <ToolbarDivider />
  <ToolbarButtonGroup>
    {/* more buttons */}
  </ToolbarButtonGroup>
</Toolbar>
```

> **Keyboard navigation:** `Toolbar` supports arrow-key navigation via the
> `enableTabGroup` prop, which defaults to **`false`**. Apps that want
> arrow-key navigation across the toolbar set `enableTabGroup={true}`.

### TransportButton

```tsx
import { TransportButton } from '@audacity-ui/components';

<TransportButton icon="record" />
<TransportButton icon="play" active />
<TransportButton icon="loop" disabled />
```

### ToolButton

```tsx
import { ToolButton } from '@audacity-ui/components';

<ToolButton icon="cog" ariaLabel="Settings" />
<ToolButton icon="trim" label="Trim" />
```

## What's exported

The package is a barrel of every component in `src/`. The surface most
external consumers reach for first:

| Export | Notes |
| --- | --- |
| `Icon`, `IconName` | Glyph component + name union |
| `Toolbar`, `ToolbarDivider`, `ToolbarButtonGroup` | Top-level toolbar primitives |
| `TransportButton` | Transport-style icon button (play / record / etc.) |
| `ToolButton` | General-purpose tool button with optional label |
| `ThemeProvider`, `lightTheme`, `darkTheme`, `ThemeTokens` | Theming surface |

Other components (`ToggleButton`, `Tooltip`, `Knob`, `Clip`, label & track
primitives, dialogs, etc.) are exported but not yet considered stable for
external use.

## Versioning

The package follows semver. While the version is `0.x`, minor bumps may
contain breaking changes — pin to an exact version in production.

## Development

```bash
# Build the package
pnpm --filter @audacity-ui/components build

# Watch mode for development
pnpm --filter @audacity-ui/components dev

# Run tests
pnpm --filter @audacity-ui/components test
```

## License

MIT
