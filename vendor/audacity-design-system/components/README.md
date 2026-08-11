# @dilsonspickles/components

React component library for the Audacity Design System.

## Install

This package is published to the **private** GitHub Packages registry under
the `@dilsonspickles` scope. Consuming projects need an `.npmrc` that
points the scope at npm.pkg.github.com with a `GITHUB_TOKEN` that has
`read:packages` permission.

```ini
# .npmrc
@dilsonspickles:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then:

```bash
bun add @dilsonspickles/components
# or
pnpm add @dilsonspickles/components
# or
npm install @dilsonspickles/components
```

React 18 or newer is a **peer dependency** — the package does not bundle it.

## Required CSS import

Components ship their styles + the embedded `MusescoreIcon` font file in a
single stylesheet. Import it once at your app entry point:

```ts
import '@dilsonspickles/components/style.css';
```

After this, `<Icon>` (and anything that uses it — `TransportButton`,
`ToolButton`, etc.) renders without any further setup.

## Two usage modes

### Standalone (marketing site, manual, docs)

Components render with sensible defaults out of the box. No provider
wrapping needed — perfect for static sites that don't have a runtime
context to plug into.

```tsx
import { Toolbar, TransportButton } from '@dilsonspickles/components';
import '@dilsonspickles/components/style.css';

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
} from '@dilsonspickles/components';

<ThemeProvider theme={darkTheme}>
  <AccessibilityProfileProvider initialProfileId="au4">
    <YourApp />
  </AccessibilityProfileProvider>
</ThemeProvider>
```

## Component reference

### Icon

```tsx
import { Icon, type IconName } from '@dilsonspickles/components';

<Icon name="record" size={20} />
```

### Toolbar + ToolbarDivider + ToolbarButtonGroup

```tsx
import {
  Toolbar,
  ToolbarDivider,
  ToolbarButtonGroup,
} from '@dilsonspickles/components';

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
import { TransportButton } from '@dilsonspickles/components';

<TransportButton icon="record" />
<TransportButton icon="play" active />
<TransportButton icon="loop" disabled />
```

### ToolButton

```tsx
import { ToolButton } from '@dilsonspickles/components';

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
pnpm --filter @dilsonspickles/components build

# Watch mode for development
pnpm --filter @dilsonspickles/components dev

# Run tests
pnpm --filter @dilsonspickles/components test
```

## License

MIT
