# Override audit — 2026-09-09

Compared the application's component overrides and vendored source with both
the installed [0.10.3 pin](https://github.com/DilsonsPickles/audacity-design-system/tree/f5a0e9ee9e9c1ea59a3a13adb516ef0cc3f89447)
and [upstream master](https://github.com/DilsonsPickles/audacity-design-system/tree/216c399f5c74620065e3dd1910a478f5a15ee116).
Master was [24 commits ahead](https://github.com/DilsonsPickles/audacity-design-system/compare/f5a0e9ee9e9c1ea59a3a13adb516ef0cc3f89447...216c399f5c74620065e3dd1910a478f5a15ee116).
This audit does not update the vendored revision.

## Removed application overrides

| Override | Why it can go |
| --- | --- |
| Play/record CSS icon colors (preceding cleanup) | The pinned `TransportButton` already accepts `iconColor`; callers now supply the idle colors through that prop, preserving the component's white recording icon. |
| Dark dropdown trigger background and text | `Dropdown` already reads the active theme's input background and text colors. |
| Dark dropdown portal palette | `Dropdown` already passes the themed background, border, shadow, text and hover colors into its body portal. Our `!important` palette was replacing those values. |
| Repeated tool, toggle and transport button state backgrounds | The component theme already supplies these values. Keep the editor's blue pressed-tool state and solid disabled-toggle surface, which differ from upstream. |
| TimeCode format-button DOM relabeling | The existing **local** `formatAriaLabel` prop expresses the same label directly, including server rendering. This is adapter cleanup, not an upstream merge. |

The dropdown cleanup intentionally changes the dark palette to upstream's theme.
The browser parity test checks portal token values in both themes as well as its
appearance. The TimeCode test checks the accessible name in rendered markup.

## Overrides still required

These gaps remain at both revisions inspected:

| Area | Reason to retain the adaptation |
| --- | --- |
| Checkbox/checkable menu borders | The upstream checkbox has no border; the editor needs an outline against similarly colored surfaces. |
| Primary button label contrast | Upstream uses the primary text color on the primary button fill; the editor supplies its contrasting label color. |
| Tooltip palette | `Tooltip` still uses light CSS/SVG colors without consuming the theme. A themed `Flyout` does not fix this separate component. |
| Footer theme aliases | `Footer.css` still references legacy token names with literal fallbacks. Wrapping and forced-color behavior also remain application adaptations. |
| Add-track flyout skin/layout | Its background remains hardcoded white, its option state uses literal colors, and the editor requires a column layout. The merged add-new-button changes concern another component. |
| Dropdown placement and keyboard bridge | The component does not implement the host's viewport bounds/flip behavior and portal keyboard routing. |
| Menu keyboard priority and submenu styling | Capture ordering still matters with upstream `ContextMenu.stopImmediatePropagation`; disabled submenu opacity and shortcut contrast still need the host rules. |
| Layout, responsive, RTL and stacking rules | These implement the editor's composition, not a duplicate upstream component theme. |

## Vendored source patches

A byte comparison of the three packages found 37 differing source/assets files
and three package manifests (`type: module`). No patched source file matches
current upstream in full. Review of the local hunks and the intervening upstream
changes found no source patch that can be dropped in this cleanup.

The remaining differences fall into these groups; the detailed rationale and
regression test references are in [README.md](README.md#local-deviations-from-upstream):

- React 19 nullable refs, context purity annotations and WOFF2 delivery.
- Host clip colors, shortcut routing, selection scope, rename requests/focus,
  pitch badges and focused-clip stacking.
- Gesture lifetime callbacks, live meter slots, armed reorder listeners and
  context-menu listener cleanup.
- Checkbox state/descriptions, stepper labels, TimeCode accessibility and format
  domains, announcement rounding, and focus/escape handling.
- Host effect replacement catalogues and optional rack autofocus.
- Import glyph mapping, playhead icon class, flyout IDs and portable dialog
  window-control icons.

Upstream already incorporated the earlier effects, mixer, ruler, search-field,
dropdown, timecode-background and transport-color improvements into our pin.
The remaining effect catalogue and meter APIs extend those merged changes.
The upstream portable window-control fix is in `ApplicationHeader`; our
`DialogHeader` still needs its separate patch. Recent sandbox behavior does not
replace the editor's audio-engine and interaction adapters.
