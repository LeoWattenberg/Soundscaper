# Retained script-font fixtures

These unmodified WOFF2 files are **test-only imported media**, never application
fonts or runtime fallback assets. Tests import them through `prepareMotionFont`
and the normal Text and Appearance workflow. Rendering supplies only retained
asset bytes to CanvasKit; installed system fonts are not consulted.

- `arabic.woff2`: Noto Sans Arabic regular, Arabic subset, from
  `@fontsource/noto-sans-arabic` 5.2.10 (Google Fonts distribution v33).
  Copyright 2022 The Noto Project Authors. Upstream:
  <https://github.com/notofonts/arabic>.
- `cjk.woff2`: Noto Sans SC regular, Simplified Chinese subset, from
  `@fontsource/noto-sans-sc` 5.2.8 (Google Fonts distribution v39).
  Its embedded family name is `Noto Sans SC Thin`; the distributed face is
  the pinned 400-normal file. Google Inc. Upstream: <https://github.com/notofonts/noto-cjk>.

Both distributions include the SIL Open Font License 1.1. Their complete,
byte-identical package licenses are `arabic-OFL.txt` and `cjk-OFL.txt`.
`sources.json` pins exact package URLs, archive SHA-256 and SHA-512 integrity,
entry paths, retained font lengths/hashes, and license hashes. File renaming
does not alter internal font names or font bytes. No local subsetting occurs.

To reproduce, download each `archiveUrl`, verify its `archiveSha256` and
`archiveIntegrity`, extract exactly its `sourceEntry` into `file`, and extract
`package/LICENSE` into `license`. Verify both file hashes from the register.
Do not install these packages or add them to production runtime inventories.

`tests/motionscaper-imported-script-fonts.test.ts` verifies fixture provenance,
real Arabic joining/RTL clusters, and CJK wrapping. The browser fixture verifies
menu import, exact CPU/browser pixels, saved archive font custody, and reopen.
These fixtures establish those font/script combinations; they do not claim
complete language, writing-mode, or font coverage.
