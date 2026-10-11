# Motionscaper release preparation

Motionscaper has an independent release identity, package inventory and Pages
project. The committed register still selects its candidate channel. Adding a
stable workflow does not activate that channel or publish a release.

## Own tag and package admission

The authority is `config/product-release-lines.json`. A release must use the
exact active `motionscaper-v<version>` tag, with matching application and release
channels. The checkout, the tag's commit and the independently supplied workflow
SHA must agree. Tracked changes and nonignored untracked source refuse admission;
ignored generated output is permitted. Soundscaper's version preparer is not
part of this route, and dependency metadata is unchanged.

The reusable `motionscaper-desktop-preview.yml` workflow defaults to `candidate`.
The stable caller must explicitly select `stable`, which both the package job
and final assembler verify. Existing five-target packaging, native source/build
verification, smoke qualification, signing configuration, corresponding source,
notices and checksum inventory remain required. The internal artifact names
retain `motionscaper-preview-*` for compatibility with the candidate caller.

## Stable ordering

An own stable tag starts `motionscaper-stable.yml`. It first verifies the active
register and source, then waits for the **entire** reusable Quality workflow:
static checks, all Node partitions and coverage union, Chromium, Firefox,
WebKit, composition-link and dual-origin cases, and handbook checks. Packaging
also completes before draft creation. Quality's existing main-only Soundscaper
deployment does not run for an own Motion tag.

The production web job uses `SCAPE_PRODUCT=motionscaper` and
`MOTIONSCAPER_SITE=https://motionscaper.org`. Its build operation checks the clean
tag, removes old generated `dist/`, runs the maintained `npm run build:pages`
(including the own handbook and deployment preflight), then checks the source
again. It captures every output path, length and SHA-256 beside the artifact,
and rechecks the full inventory. Loopback browser-test sites are not inputs to
this operation. A cold start requires the explicit owner variable
`MOTIONSCAPER_PAGES_COLD_START`; the existing preflight refuses an inappropriate
or stale cold-start declaration.

Only after quality, packages and production artifact preparation succeed does
the workflow create a draft release. The deployment job downloads the exact
artifact and its receipt, independently verifies the tag, version, product,
origin, source and complete file inventory, then rechecks the predecessor. It
deploys those bytes to the `motionscaper` Pages project without rebuilding.
The existing deployment verifier requires the live offline-shell bytes to match
the admitted artifact and verifies the product routes. Deployment identity and
log evidence are attached before the draft becomes public. A failure leaves
the workflow without a successful publish step; it does not bypass the failed
gate or automatically roll back a deployed site.

## Guarded direct Pages deployment

`npm run deploy` preserves the empty or omitted `SCAPE_PRODUCT` Soundscaper
default. An explicit Frame or Motion selection chooses its own Pages project.
For example, `npm run deploy -- --product=motionscaper` selects `motionscaper`;
this command performs an actual deployment and must only be run by its owner.

The direct entry uses the existing product web routing, including the selected
product's configured HTTPS site origin. It refuses product/project conflicts,
peer product origins, a conflicting audit origin, credentials and the Frame
successor development line. It checks the emitted product/canonical origin
before upload, then binds verification to the exact local offline shell.
Commands invoke the installed npm 12.0.1 JavaScript entry through Node, including
on Windows, without a shell or an `npm.cmd` executable assumption.

## Qualification boundaries

Local contract tests validate admission, workflow dependencies and refusal
behavior; they are not signing, installation, hosted Pages, stable publication
or installed After Effects receipts. No tag, register activation, dispatch,
deployment or publication is part of preparing these changes. The bounded
[platform qualification](../development/motionscaper-platform-qualification.md)
and [After Effects bridge](../development/motionscaper-after-effects-bridge.md)
records remain authoritative, including their unqualified external platforms
and host behavior. Full Adobe parity is not claimed. The runtime source pins,
assistance closure and dependency lockfile are unchanged, so this preparation
does not require a manual **Update AI assets** run.
