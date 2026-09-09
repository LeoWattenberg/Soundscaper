# Audacity appearance previews

Source: Audacity commit `16f2713979809abe7308b4e1e0d487afeece84f2`
(<https://github.com/audacity/audacity/tree/16f2713979809abe7308b4e1e0d487afeece84f2>).

- `Classic.svg` and `Colorful.svg` are unmodified copies of
  `src/appshell/resources/Classic.svg` and `Colorful.svg`.
  Copyright the Audacity contributors; distributed under GPL-3.0-only.
- `../appearance-previews.ts` adapts
  `src/appshell/qml/Audacity/AppShell/shared/internal/ThemeSample.qml`,
  copyright (C) 2021 MuseScore BVBA and others, GPL-3.0-only.
  On 2026-09-09 its QML illustration was translated to SVG and connected to
  Soundscaper's theme tokens. Interaction remains owned by the existing
  preference controls.

Upstream SHA-256 digests:

| Source | SHA-256 |
| --- | --- |
| Classic.svg | `09340ee36969ef076fa7984e907486b21c40ea3ff42d330da1762ec2517fb26f` |
| Colorful.svg | `4ebae20c1b460fe55fe5cb7ec6e066fa1982b326932e8887ab854a193a32af41` |
| ThemeSample.qml | `1cdfd99389a128bfa113c86b7dd43a025db608c366d9e0aaaa66adb481a4b36a` |

These portions remain GPLv3, combined with the AGPLv3 application under
section 13 of both licenses. Full terms: [GPLv3](../../../../../../LICENSES/GPL-3.0.txt).
