# Motionscaper candidate package route

The Motion candidate route prepares reviewable artifacts without publishing a
release. `.github/workflows/desktop-preview.yml` accepts `motionscaper-v` alpha,
beta and release-candidate tags, validates the exact active version in
`config/product-release-lines.json`, and calls
`.github/workflows/motionscaper-desktop-preview.yml` after the existing quality,
Node, coverage and browser gates. Untagged builds retain the Soundscaper and
Framescaper default selection. Motion tags do not enter their native source,
assistance runtime or project-library lease jobs.

## Native target authority

The called workflow first runs the existing Motion helper build for Linux
x64/arm64, Windows x64/arm64 and macOS arm64. Each package job downloads only its
target result, verifies its source pins, executable and receipt, then stages the
Motion renderer with that result. Missing or altered helper bytes prevent
packaging; there is no helper-free candidate fallback.

`scripts/motionscaper-release-target.ts` verifies the exact checkout revision,
product version, stage inventory and packaged resources. It launches the real
packaged executable on its native architecture and requires the own-origin
renderer, project-file capability and native ProRes picture/PCM smoke results.
The smoke uses software rendering and does not establish hardware GPU or
matching-quality evidence on every target. Its private profile is removed.

Each target artifact contains only its expected packages, the stage and helper
receipts, native payload manifest, smoke output and a digest-pinned target
receipt. The aggregate step independently verifies the five downloaded native
results, checks their source identity against the target evidence, and refuses
missing, extra, replaced or cross-product package files.

## Candidate inventory

The `motionscaper-preview-inventory` artifact contains nine own installers:

- Linux x64 and arm64: AppImage and Debian package per architecture.
- Windows x64 and arm64: installer executable and ZIP per architecture.
- macOS arm64: DMG.

It also contains mandatory `sources.zip`, `THIRD_PARTY_LICENSES.md` and
`SHA256SUMS`. `motionscaper-preview-evidence` separately retains the five target
receipts and aggregate inventory. No workflow step invokes a release publisher;
Electron Builder receives `--publish never` and workflow permissions remain
read-only. A Motion Flatpak or macOS x64 artifact is not part of this route.

Source assembly retains the exact committed repository plus authenticated
original FFmpeg, Boost, x264, x265, libvpx, Opus and zlib archives. Source URLs,
byte lengths and hashes come from the existing pinned native manifests. Each
download is bounded and verified before assembly; incomplete downloads are
removed. The existing source assembler retains inner archives unchanged and
writes their digests in `SOURCE_MANIFEST.json`. Assembly is mandatory: a source
download or digest failure prevents the final inventory artifact.

## Local checks and remaining receipts

```sh
node --import tsx --test tests/motionscaper-preview-release.test.ts tests/motionscaper-release-inventory.test.ts tests/motionscaper-release-lines.test.ts
npm run lint:changed
```

The focused checks cover route isolation, required workflow dependencies, exact
package inventories, source identity, corrupted inputs and cleanup, and refusal
of foreign tags or non-native smoke execution. Both workflow files are also
parsed locally with unique YAML keys and every job dependency resolved. These
checks do not substitute for executing the five-target workflow.

Public-release readiness still needs current-revision target build/package
receipts, credentialed Developer ID/notarization and Windows signing receipts,
installed application/file-association/update workflows, and the remaining
reference and platform gates. Signing follows the existing explicit repository
configuration; an unsigned or ad-hoc candidate does not satisfy those gates.
Nothing was tagged, dispatched, uploaded or published during implementation.
The assistance runtime closure is unchanged; no manual **Update AI assets** run
is required.
