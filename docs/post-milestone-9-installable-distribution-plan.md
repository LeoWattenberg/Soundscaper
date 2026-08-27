# Post-milestone-9 plan: installable distribution (PWA and Trusted Web Activity)

> Owning source for installable-distribution sequencing, the vehicle
> decision, and the bounded work packets for the progressive web app and its
> optional Google Play Trusted Web Activity. The
> [roadmap](../roadmap.md#9-installable-distribution-pwa-and-trusted-web-activity)
> owns scope and status; the release policy, quality budgets, threat model
> and licensing matrix own their claims. Grounded against the repository on
> 2026-08-27 at commit `707be3e5` with file:line verification, and against
> live responses from `soundscaper.org` and `assets.soundscaper.org` on the
> same date. This is post-milestone-9 scope. It depends on milestone 9 and,
> separately, on the whole of extension 8+C — the topology decision and, if
> separate origins were chosen, the second origin — which is a distinct
> earlier milestone owned by the
> [product origins plan](post-milestone-8c-product-origins-plan.md), not a
> sibling track of this one. Re-ground every citation at pickup, and
> re-measure every live claim.

## Goals and ordering principle

1. **Primary: the vehicle is Chrome, not a WebView.** The deployed origin
   already serves `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: credentialless` (public/_headers:3-4,
   confirmed live 2026-08-27), so Chrome for Android provides
   `crossOriginIsolated` and `SharedArrayBuffer`, and the existing keyed
   video paths work with no shell code at all. Every WebView-based wrapper —
   Capacitor, Cordova, Tauri v2 — permanently forfeits `SharedArrayBuffer`,
   because Android System WebView has no site isolation and cannot grant
   cross-origin-isolated capabilities regardless of response headers. This
   plan therefore builds an installable web app and, optionally, a Trusted
   Web Activity around it. **No packet introduces a WebView shell.**
2. **Secondary: installability is nearly free; usefulness is the work.**
   Both manifests already carry every field Chrome requires, and a service
   worker fetch handler has not been an installability requirement since
   Chrome 108. The work is touch, device survival, offline completeness and
   durability — not "make it a PWA". Do not sell any of it as an install
   blocker.
3. **Tertiary: nothing ships that the device has not proven.** Roughly ten
   load-bearing questions here are empirical. Phase 0 answers them on real
   hardware before any packet that depends on them starts.

## What already exists (do not re-plan)

- **Both manifests clear Chrome's hard bar.** `id`, `name`, `short_name`,
  `start_url`, `scope`, `display: standalone` and 192/512 PNG icons are all
  generated (scripts/lib/offline-application-shell.mjs:235-280). The stable
  per-product `id`, decoupled from `start_url`, is what makes a later scope
  change a re-mint rather than two orphaned apps.
- **The manifest link, the service worker, the offline shell and the
  digest-pinned install inventory all exist and are test-guarded**
  (scripts/generate-static-routes.mjs:71, src/common/offline/application-shell.ts,
  scripts/lib/offline-application-shell.mjs, tests/offline-*.test.js,
  tests/offline-static-route-install.test.js).
- **Timeline touch is done, including two-finger pinch-zoom with midpoint
  anchoring.** The timeline pointer router handles `pointerdown` with
  `setPointerCapture` and an explicit touch branch, and clip move, trim,
  stretch, slip/slide, roll/ripple, selection, loop drag, split and row
  resize all run through it. The gap is a bounded set of other drag
  surfaces, not the editor.
- **`navigator.storage.persist()` is already called on the startup path.**
  The work is to act on its result, not to add the call.
- **Offline navigation already reconstructs and prefers the localized
  document**, and locale routes are cached on first online use. The gap is a
  cold install for a locale never visited online.
- **Quota preflight is wired into the write paths** with a headroom rule,
  export already streams into OPFS rather than buffering, device hot-plug is
  observed, and the recording path already reacts to AudioContext
  interruption — which is the pattern the transport and export paths must
  copy.
- **A small-viewport accessibility baseline exists**
  (config/accessibility-wcag-baseline.json) and a mobile Playwright project
  shape already exists for the handbook (playwright.docs.config.mjs).

## Verified gaps this plan must close

- **The two product scopes are nested.** Soundscaper's scope is `/` and
  Framescaper's is `/framescaper/`, so the second is inside the first and
  Chrome is unlikely to mint two independent WebAPKs. Disjoint scopes are
  delivered by extension 8+C, which lands before milestone 9; this plan
  inherits the result and re-decides nothing. If 8+C has not closed at
  pickup, this plan does not start.
- **Icons are `purpose: "any"` only**, so Android renders a launcher icon
  inside a white disc rather than a masked adaptive icon.
- **The manifest is English-only** — `lang`, `dir`, `name` and `start_url`
  are fixed at build time regardless of the seventeen shipped locales.
- **Compressed and video export depend on an unpublished runtime.** Import
  runs through `decodeAudioData` and PCM export through the direct offline
  PCM path, neither of which touches FFmpeg; compressed audio export routes
  through `FfmpegOutputSink` and both products' video export muxes through
  `VideoKeyframeEncoderFfmpegPort` (src/common/editor/video-keyframe-encoder-stream.ts:71-89),
  which do. The runtime objects are not published, and
  `FfmpegCoreUnavailableError` is defined and re-exported but caught nowhere
  in `src/`, so absence throws rather than narrowing the offered formats.
- **No page-lifecycle, wake-lock or media-session handling exists** in
  `src/`, and only the recording path observes AudioContext `statechange`.
  A realtime export dies at screen lock with no defence.
- **No CSS media query anywhere in `src/` tests height or orientation**, and
  the small-viewport sheet never reaches the outer shell containers.
- **`classifyMobile()` mis-tiers tablets**, because it returns
  `navigator.userAgentData.mobile`, which Chrome reports as `false` on
  tablets — the most plausible target device.
- **The video preview mounts an uncapped set of `HTMLVideoElement`s**, while
  Android's hardware decoder budget is small and device-wide.
- **`/.well-known/assetlinks.json` returns the SPA fallback**, so a TWA
  would fail Digital Asset Links verification silently and degrade to a
  Custom Tab with a visible URL bar.
- **`_headers` and the deployed zone disagree on document cache policy.**
  The long TTL is the intended tradeoff for a large shell; the file saying
  otherwise is what will mislead the next reader.

## Campaign decisions

### Chrome-backed only

Recorded once so it is not revisited: no Capacitor, no Cordova, no Tauri, and
`fallbackType` pinned to `customtabs` and asserted in a test rather than left
a convention. The reason is `SharedArrayBuffer`, and it is not a preference.

### Tablet-first

A ten-inch tablet in landscape sits above every breakpoint in the codebase; a
phone sits inside the small-viewport sheet. Targeting tablet first makes the
UI work an affordance pass; targeting phone first makes it a second shell.
Phone support is a later, separately-scoped decision.

### The export-format offer follows the runtime

Rather than gating this plan on the licensing review that governs FFmpeg
publication, the offered export formats follow what the runtime can actually
do. An installed app with no runtime offers PCM targets and says why the
others are unavailable. This is a one-packet change that also fixes the
uncaught-error path on the web today.

### Durability is a milestone-9 dependency, not a packet here

The IndexedDB backend drops every object store on a version bump, which is
policy until the first-release baseline freeze
(docs/milestone-9-plan.md:165-178). A website may do that because the user
chose to load it; an app that updates itself on a device may not. **No
installable release ships before WP-9.0.0 closes**, and that ordering is the
single hardest constraint in this plan.

## Phase structure

- **Phase 0** measures the device. No code.
- **Phase 1** is installability: scopes, icons, localization.
- **Phase 2** is usefulness: touch, device survival, offline.
- **Phase 3** is the optional Play track.

## Work packets

### WP-9+B.0 — Device reconnaissance

- **Outcome:** Dated, device-attributed answers to the empirical questions
  the rest of the plan branches on, recorded in-tree: whether a debug TWA
  preserves `crossOriginIsolated` and `SharedArrayBuffer` (including on a
  device whose default provider is not Chrome); whether Chrome mints
  WebAPKs for these manifests; whether installing suppresses the second
  product's install offer; whether clearing Chrome data destroys an
  installed app's projects; whether a zero-gain graph keeps a realtime
  export alive with the screen off; the concurrent decoder ceiling; and
  which File System Access defects survive.
- **Invariants:** Every measurement carries device model, Android version,
  Chrome version and date; a result is valid only at or above the recorded
  Chrome version; no product code changes.
- **Acceptance:** The record exists in `docs/`, and the TWA isolation
  readback is `[true, 'function']` on a Chrome-default device or the Play
  track is re-scoped before Phase 3 begins.
- **Non-goals:** No shipping artifact; no Play account work.
- **Stop condition:** Stop the Play track — not the PWA track — if
  cross-origin isolation does not survive a TWA. The installable web app is
  unaffected either way.

### WP-9+B.1 — Two installable, branded, localized apps

- **Outcome:** Each product installs from Chrome for Android as its own
  WebAPK, with maskable and themed launcher icons, and an install from a
  non-English route launches that locale.
- **Invariants:** The two scopes are disjoint — neither a prefix of the
  other — per the topology decision; each product's manifest `id` stays
  byte-identical across locales so installs do not fork per language; the
  manifests stay generated from the product table.
- **Acceptance:** Both products appear in `chrome://webapks` with distinct
  package names and the intended scopes; a link to one product's
  `start_url` is not captured by the other's app; both icons render
  correctly under circular, squircle and themed masks; a build assertion
  covers scope disjointness, the presence of `any` and `maskable` icons at
  192 and 512, and per-locale `lang`/`dir`/`start_url` with a stable `id`.
- **Depends on:** WP-8+C.0 (topology) and, if separate origins were chosen,
  WP-8+C.3 (the second origin served correctly). Both are extension-8+C
  packets that close before milestone 9.
- **Non-goals:** No `protocol_handlers` (unsupported on Chrome for Android),
  no `file_handlers` (desktop-only), no store metadata yet.
- **Stop condition:** Stop if Chrome will not mint two WebAPKs under the
  chosen topology — that is a topology error, and it belongs back in
  extension 8+C's WP-8+C.0 rather than being patched here.

### WP-9+B.2 — Export offers follow the runtime

- **Outcome:** `FfmpegCoreUnavailableError` is handled rather than thrown to
  the user: the export surface offers the targets the available runtime can
  actually produce and explains the absence of the rest. PCM targets and
  import are unaffected because neither uses the runtime.
- **Invariants:** No format is offered that cannot complete; the explanation
  names the reason rather than showing a raw error; desktop behaviour is
  unchanged.
- **Acceptance:** A test with the runtime absent asserts the offered target
  list, a completed WAV export, and a surfaced explanation rather than a
  thrown `DOMException`; a test with it present asserts the full list.
- **Non-goals:** No licensing decision, no runtime publication, and no
  change to the WebCodecs migration's direction. This packet makes the
  product honest in either state.
- **Stop condition:** None; this packet is independently shippable and
  improves the web product today.

### WP-9+B.3 — Touch and viewport

- **Outcome:** Every editor control is operable with a finger at tablet
  sizes in both orientations, with a mobile Playwright configuration that
  keeps it that way.
- **Invariants:** The vendored design system's route is decided before any
  component is edited — a patch to a tree that is lint-ignored and outside
  the file-size roots is silently reverted by the next upstream sync, and
  the notices check pins the upstream tag as a provenance claim; a
  coarse-pointer hit-target layer uses one target-size number, chosen and
  recorded, not three competing ones; the existing pointer-based timeline is
  not rewritten.
- **Acceptance:** A separate mobile configuration with a curated `testMatch`
  — not a fourth project on the default config, which runs every spec —
  green after being shown red against the pre-fix tree; no horizontal page
  overflow at the recorded tablet and phone viewports; one touch drive per
  drag family asserting the model changed; `crossOriginIsolated === true` on
  every route in the mobile project.
- **Non-goals:** No pixel screenshot baselines across three viewports, two
  products and seventeen locales; no phone-shaped second shell.
- **Stop condition:** Stop if the vendored route cannot be settled — an
  unrecorded divergence in the vendored tree is a provenance defect, not a
  shortcut.

### WP-9+B.4 — Survive the device

- **Outcome:** A long export finishes unattended instead of dying at screen
  lock; playback stops on headphone unplug and Bluetooth route change rather
  than broadcasting the monitor mix; the back gesture closes a dialog rather
  than the app; the preview stops asking Android for more decoders than it
  has.
- **Invariants:** Background export is either proven by WP-9+B.0's
  measurement or explicitly declared unsupported and prevented — never
  silently attempted; a rejected wake-lock request never throws; the
  decoder cap uses the measured ceiling, with the existing poster and
  filmstrip path as the fallback; the mobile export threshold reflects the
  corrected device tier.
- **Acceptance:** Node tests per controller with injected fakes (a
  wake-lock rejection does not throw; a hidden document flushes and cancels
  the pending autosave; a suspended context lands the transport in paused
  with position preserved; a removed output pauses exactly once); a
  ten-minute export completed on a device with the screen untouched, or the
  unsupported declaration enforced.
- **Depends on:** WP-9+B.0 for the decoder ceiling and the screen-off
  result; WP-9+B.3 for the mobile regression gate.
- **Non-goals:** No background-execution shell; no resumable export unless
  the measurement demands it.
- **Stop condition:** Stop if the screen-off behaviour cannot be measured —
  shipping an export that silently dies is the failure mode this packet
  exists to prevent.

### WP-9+B.5 — Offline completeness

- **Outcome:** An installed app in airplane mode opens a project, applies an
  effect that needs a wasm runtime, and exports — in the user's locale. Plus
  a service-worker update lifecycle with an explicit, user-triggered
  activation.
- **Invariants:** A worker upgrade never activates on install while a
  project is open; a shell-served navigation still reports
  `crossOriginIsolated === true`; the deliberate document cache TTL is
  respected rather than circumvented, with shell-install fetches bypassing
  the HTTP cache so the TTL does not gate the install inventory; the
  digest-pinned install inventory stays pinned.
- **Acceptance:** A spec per product that installs the shell, warms the
  offline set, goes offline, imports a bundled fixture, applies a
  wasm-backed effect and exports; a non-English route reloaded offline
  renders that locale.
- **Non-goals:** No bundling of the FFmpeg core into `dist` — the 25 MiB
  platform guard is real, the build refuses the relocation environment
  variable outright, and the bound is compiled into the worker template so
  changing it rotates every release id.
- **Stop condition:** None; each half is independently useful.

### WP-9+B.6 — Durability, gated on the baseline

- **Outcome:** A project survives a product-version bump and a browser
  restart; the app reports storage protection honestly rather than
  discarding the `persist()` result; a device-full failure explains itself
  instead of surfacing a raw `DOMException`.
- **Invariants:** The drop-every-store branch is replaced by a real upgrade
  path for the schemas that exist at the baseline, or this plan does not
  ship; the honest unprotected-storage advisory stays distinct from the
  existing memory-fallback banner, because the remedies differ.
- **Acceptance:** A durability spec creates a project, reboots with the next
  storage profile mounted, and asserts the project, its track count and its
  source bytes survive — red today; an injected quota error produces the
  explanatory copy.
- **Depends on:** WP-9.0.0. This packet may not close before it.
- **Non-goals:** No telemetry; no server-side backup.
- **Stop condition:** Stop if the baseline has not frozen. Shipping an
  auto-updating app over a store-dropping upgrade path is the one outcome
  this plan must not produce.

### WP-9+B.7 — Trusted Web Activity packaging (optional track)

- **Outcome:** A debug APK per product that launches fullscreen on a real
  device with no URL bar, with Digital Asset Links verifying against the
  live origin.
- **Invariants:** `/.well-known/assetlinks.json` is emitted by the build and
  served as `application/json` with a 200 and no redirect; the fingerprint
  published is the Play App Signing certificate and not the upload key —
  which means the order is upload, read from the console, publish
  assetlinks, install, with an expected URL-bar window in between;
  `fallbackType` is `customtabs`, asserted in a test; the intent-filter host
  collision between two products on one host is resolved deliberately.
- **Acceptance:** Both APKs launch fullscreen with no URL bar — the only
  end-to-end proof the fingerprint is right; the deploy preflight asserts
  the live assetlinks response; Google's statement-list parser returns both
  application ids with no errors.
- **Depends on:** WP-9+B.0's isolation measurement and WP-9+B.1's scopes.
- **Non-goals:** No WebView fallback; no in-app purchase; no notifications.
- **Stop condition:** Stop if a TWA does not preserve cross-origin
  isolation. The PWA track continues regardless.

### WP-9+B.8 — Play listing and release (optional track)

- **Outcome:** Both apps on an internal testing track, then production, with
  a release workflow that refuses to upload a duplicate version or a wrong
  fingerprint.
- **Invariants:** The target API level deadline is met; the account's
  testing obligations are known before scheduling, because a personal
  account created on or after 13 November 2023 carries a multi-week floor; a
  real privacy policy and an honest Data safety declaration exist as
  artifacts; the licensing matrix records the new distribution surface with
  its pinned surface-id test edited in the same commit; the generated
  shell's licence is decided deliberately.
- **Acceptance:** Every Play Console declaration complete; a rerun of the
  release workflow fails at the version check rather than uploading; a
  deliberately wrong fingerprint fails before any upload; the device
  acceptance run passes on a build installed from the track.
- **Non-goals:** No advertising of capabilities the Android build does not
  have — display capture, system-audio capture, plug-in hosting and
  output-device routing are unavailable on the platform in any vehicle.
- **Stop condition:** Stop if the listing would have to claim a capability
  the build does not ship.

## Known constraints this plan absorbs

- Display capture, system-audio capture, per-stream output routing and
  VST3/CLAP/AU/LV2/OpenFX hosting do not exist for web code on Android in
  any vehicle, including a TWA. They are scoped out, not deferred.
- A TWA shares Chrome's storage jar for the origin, so clearing browsing
  data destroys an installed app's projects and `persist()` gives no
  protection against user-initiated clearing. This makes WP-9+B.6 more
  load-bearing on the Play track, not less.
- Android's own guideline target size, WCAG 2.5.8 and WCAG 2.5.5 disagree.
  One number is chosen in WP-9+B.3 and recorded.
- The device-lab matrix that milestone 9 gates release on is unprovisioned
  today (config/quality-budgets.json). Adding Android multiplies an empty
  matrix; whether Android is held to the same regime is a scope decision
  recorded in the roadmap §9+ status line — which now covers this plan
  alone, the origin move having moved to §8+C.
- Any Android detection code that lands in the static entry graph fails the
  build against the startup-graph budgets, inside every pull request. Budget
  each new module before writing it.

## Non-goals and fences

- No WebView shell, in any packet, for any reason.
- No native Android port of `native/`, and no Node runtime on the device.
- No telemetry, crash reporting to a third party, or notifications.
- No relaxation of COOP, COEP or the CSP on a route that renders an editor.
- No bundling of the FFmpeg core into the deployed asset set.
- No phone-shaped second shell in this plan; tablet-first is the recorded
  scope.
