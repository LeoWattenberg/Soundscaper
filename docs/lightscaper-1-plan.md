# Lightscaper milestone L1 plan: product registration and platform seam

> **Current release-policy note (2026-08-31):** qualification ledgers, cohorts,
> and release-admission commands retained below are historical planning context.
> Future implementation uses ordinary CI, disposable diagnostics, and optional
> owner QA as described by the current release and quality policies.

> Owning source for L1 sequencing, the product-registry and platform-seam
> decisions, their invariants, and the bounded work packets. The
> [Lightscaper roadmap](../roadmap-lightscaper.md#l1-product-registration-and-platform-seam)
> owns scope and status; the capability inventory, the maintainability
> allowlist, and the Cloudflare header policy own their own claims.
> Grounded against the repository on 2026-08-25 at commit `3d1e908c` with
> file:line verification. L1 depends on nothing outside the tree and blocks
> every later Lightscaper milestone, `lightscaper-2-plan.md` through
> `lightscaper-9-plan.md`. Re-ground every citation at pickup — earlier
> milestones will have moved the tree.

## Goals and ordering principle

1. **Primary: users must not hit trouble.** Registering a third product must not
   change one byte of Soundscaper or Framescaper behaviour. The two existing
   shards keep passing unchanged (`npm test -- --shard=soundscaper`,
   `npm test -- --shard=framescaper`), the two existing routes keep their exact
   Permissions-Policy (`public/_headers:10-23`), their manifests and icons keep
   their exact identity (`scripts/lib/offline-application-shell.mjs:67-117`),
   and no Lightscaper claim appears in any capability block that lacks evidence
   on disk (`tests/production-capability-inventory.test.js:185-203`).
2. **Secondary: one registry, no ternaries.** Every place that today asks "is
   this framescaper?" becomes a lookup in `src/common/products.js`. The binary
   `otherProductId` (`src/common/products.js:30-32`) is deleted rather than
   extended, because a singular "other product" cannot be right once three
   products exist and a retained singular silently picks a wrong destination.

Work is ordered by registration risk: `PRODUCT_IDS` gaining a third entry
(`src/common/products.js:4`) simultaneously drives route generation
(`scripts/generate-static-routes.mjs:15`), route verification
(`scripts/check-i18n-build.mjs:15-20`), inventory identity
(`tests/production-capability-inventory.test.js:25`), the OPFS evidence loop
(`tests/production-opfs-worker-policy.test.js:57-66`), and the generated
handbook reference (`scripts/lib/docs-reference-generator.mjs:418`). Everything
that switch needs lands *before* it is thrown, so the tree is never red between
packets.

## What already exists (do not re-plan)

- **A two-entry frozen registry with per-product profiles.** `PRODUCT_IDS` is
  `['soundscaper', 'framescaper']` (`src/common/products.js:4`);
  `normalizeProductId` throws `RangeError` on anything else (`:13-17`);
  `productLocalePath` composes `basePath` + optional `/embed` + locale
  (`:23-28`), and Soundscaper's `basePath` is the empty string
  (`src/soundscaper/product.js:7`), so it is the root product while Framescaper
  is prefixed (`src/framescaper/product.js:7`).
- **A closed capability-key registry.** `PROJECT_FEATURE_CAPABILITY_IDS` holds
  52 keys mapped to `org.soundscaper.capability.*` ids
  (`src/common/editor/project-feature-capabilities.ts:3-55`). Ten of them are
  the all-`true` `SHARED_CAPABILITIES` both profiles spread
  (`src/common/product-capabilities.js:1-12`; `src/framescaper/product.js:16`;
  `src/soundscaper/product.js:16`). Two independent tests assert that each
  profile's capability key set deep-equals the registry's
  (`tests/audio-editor-project-feature-capabilities.test.ts:31-36`;
  `tests/audio-editor-foundation-feature-registration.test.ts:73-76`).
- **A capability inventory bound to the profiles and to disk.**
  `config/production-capabilities.json` carries `schemaVersion`, `groundedAt`,
  `platformTiers`, `browserTargets`, `desktopTargets`, and a `products` block
  whose keys must equal `PRODUCT_IDS`
  (`tests/production-capability-inventory.test.js:25`) and whose
  `importFamilies`, `exportFamilies`, `projectFeatures`, and
  `applicationFeatures` must deep-equal the profile (`:31-34`). Every tier's
  evidence must exist (`:185-203`); `groundedAt` is pinned to the literal
  `'2026-08-24'` (`:23`).
- **Product-sharded Node tests with a workflow cross-check.**
  `NODE_TEST_SHARD_IDS` is `['common', 'framescaper', 'soundscaper']`
  (`scripts/lib/node-test-shards.mjs:12`); classification is by reference into
  `src|desktop|native/<product>` or by filename (`:21-27, :42-48`).
  `tests/node-test-shards.test.js:123-134` extracts the `shard: [...]` matrix
  from both workflows and deep-equals it against the ids, sorted.
- **Static routes, PWA artifacts, and an offline shell.**
  `scripts/generate-static-routes.mjs` writes one document per product per
  committed locale (`:15-23`) — 17 locales (`src/common/i18n/locales.js:82-100`,
  `:110-114`) — and injects a per-product manifest link and apple-touch icon
  (`:59-64`). `scripts/lib/offline-application-shell.mjs:67-117` renders
  180/192/512 PNGs and a `manifest-<id>.webmanifest` from a hardcoded two-entry
  list, then digests every emitted asset into `offline-shell.json` (`:19-31`).
- **A route parser, a bootstrap switch, and a branded head.**
  `resolveApplicationRoute` decides the desktop product from `__SCAPE_PRODUCT__`
  (`src/common/site/route.js:3-5`) and the web product from the first path
  segment (`:18-19`). `App.jsx` lazily selects one of two bootstraps
  (`src/common/site/App.jsx:8-9`, `:14-16`), picks intro copy by ternary
  (`:17-21`), and rewrites title and icon links per product (`:68-91`).
- **A single "other product" destination.** `BrandSidebar` renders one link to
  `otherProductId(productId)` (`src/common/site/BrandSidebar.jsx:13`,
  `:111-112`) and hardcodes each product's workspace list (`:153-160`); the File
  menu carries one `switch-product` item whose label is a ternary
  (`src/common/editor/ui/application-menus.js:196-202`) and whose handler
  navigates to `otherProductId`
  (`src/common/editor/ui/workspace/workspace-application-menu-runtime.js:236-240`).
- **Cross-product project handoff is gated off on the web.**
  `crossProductHandoffAvailable` defaults to `false`
  (`src/common/editor/ui/application-menus.js:56`); Soundscaper passes `false`
  unconditionally
  (`src/soundscaper/ui/SoundscaperAudioEditorBootstrapV29.tsx:150`) and
  Framescaper passes `runtime.fileService.isDesktop`
  (`src/framescaper/ui/FramescaperAudioEditorBootstrapV28.tsx:150`). The browser
  evidence asserts the disabled state and its reason
  (`tests/browser/editor-products.spec.js:114-137`).
- **Generated handbook reference derived from the registry.**
  `renderReferenceDocuments` maps `PRODUCT_IDS` to profiles
  (`scripts/lib/docs-reference-generator.mjs:418`) and renders three documents;
  `reviewedLabel` throws for any capability, application feature, or format
  family without a label (`:279-283`, `:11-78`).

## Verified gaps this plan closes (grounded 2026-08-25)

- **Nothing exists under `src/lightscaper/`.** There is no profile, no
  bootstrap, no icon (`public/logo/` holds only the Framescaper icon and the
  four kw.media marks), and no i18n copy.
- **Six independent hardcoded two-product lists.**
  `desktop/direct-wav-smoke.js:42`, `desktop/project-library-contract.ts:14`,
  `scripts/desktop-release-assets.mjs:19`,
  `scripts/desktop-nightly-tests-products.mjs:27`,
  `scripts/lib/offline-application-shell.mjs:70-85`, and
  `scripts/lib/node-test-shards.mjs:12, :24-27`. Four are desktop-owned and stay
  two-product in L1; two become registry-derived.
- **Nine binary env/route/branding ternaries.** `vite.config.mjs:14` (with its
  `__SCAPE_PRODUCT__` define at `:69`), `electron-builder.config.cjs:1-2`,
  `scripts/desktop-prepare.mjs:74-76`, `desktop/constants.js:3-6`,
  `desktop/main.mjs:216-217`, `src/common/site/route.js:3-5` and `:18-19`,
  `src/common/site/App.jsx:14-21` and `:68-75`,
  `scripts/generate-static-routes.mjs:34` and `:40-45`. The five desktop ones
  stay; the four web ones become lookups.
- **The Permissions-Policy table has no Lightscaper shape.** `public/_headers`
  names `/`, `/:locale/`, `/embed/:locale/`, `/framescaper/:locale/`, and
  `/framescaper/embed/:locale/` (`:10-23`), and
  `tests/framescaper-capture-cloudflare-policy.test.js:17-20` deep-equals that
  exact ordered list. A Lightscaper route added without a row would receive no
  Permissions-Policy at all.
- **The catalog is at its maintainability ratchet.**
  `src/common/i18n/catalogs.js` is exactly 2037 lines and is allowlisted at 2037
  (`config/maintainability-allowlist.json:27`), so the file cannot grow by a
  single line. Only two bundled catalogs exist — `de`
  (`src/common/i18n/catalogs.js:16`) and `en` (`:1021`) — and every other locale
  resolves to English (`:2030-2032`), while `tests/i18n-runtime.test.js:18` pins
  the two key sets equal.
- **A shard id cannot be added alone.** `npm run test:shard` throws when a shard
  selects zero files (`scripts/run-node-tests.mjs:19-21`), and
  `scripts/check-shard-coverage.mjs:17-28` fails the coverage job when any id in
  `NODE_TEST_SHARD_IDS` has not uploaded a profile. Both workflow matrices read
  `shard: [common, framescaper, soundscaper]`
  (`.github/workflows/quality.yml:78`;
  `.github/workflows/desktop-preview.yml:113`).
- **Three fail-open product ternaries in shared UI.**
  `src/common/editor/ui/application-menu-product-filter.js:12` hides the whole
  Effect menu — where L4 and L6 land their develop and mask entries — from any
  non-Framescaper product without `audioEffects`, and `:64` filters the
  workspace list by the same literal;
  `src/common/editor/ui/meter-settings.ts:89-90` hands every non-Framescaper
  product Soundscaper's raw storage key; and
  `src/common/editor/ui/workspace/useAudioEditorWorkspaceLifecycle.js:107-112`
  falls through to Framescaper's `video-editor` workspace for every
  non-Soundscaper product.
- **No architecture rule separates the product trees.**
  `.dependency-cruiser.cjs:3-32` forbids cycles, editor-core→UI, facade
  re-entry, and `src/`→`tests/`, and nothing else. No product↔product import
  exists today, so the rule can be introduced green.
- **`documentationUrl` resolves to a 404 for Lightscaper.** It is already
  registry-derived (`src/common/editor/documentation-links.ts:12-18`) and the
  Help menu calls it per product
  (`src/common/editor/ui/workspace/workspace-application-menu-runtime.js:381-382`),
  but the handbook has only `framescaper/` and `soundscaper/` sections.
- **The boot progress bar waits for an editor-bound element.**
  `src/main.jsx:15-20` removes the first-paint progress bar only once
  `[data-audio-editor-bound]` or `[role="alert"]` appears — emitted by the
  workspace view
  (`src/common/editor/ui/workspace/AudioEditorWorkspaceView.jsx:147`) and the
  error shell (`src/common/editor/ui/AudioEditorApp.jsx:53`). A Lightscaper
  shell that renders neither leaves a permanent progress bar.

## Decisions

### "The other product" becomes a registry-derived destination list

`otherProductId` (`src/common/products.js:30-32`) is **deleted** and replaced by
`otherProductIds(productId)`, which returns the frozen, registry-ordered array
of the other N−1 ids. Both call sites enumerate it: `BrandSidebar` renders one
sidebar link per other product (`src/common/site/BrandSidebar.jsx:111-112`
becomes a `.map`), and the File menu's `switch-product` entry becomes a
**submenu** whose items are `switch-product:<destinationId>`, one per other
product, each carrying the existing per-destination label key.

Deletion, not extension, is the decision. A retained singular helper compiles,
type-checks, and returns a plausible product id forever, so the first consumer
nobody remembers to migrate silently sends Lightscaper users to Soundscaper.
`tests/editor-products.test.js:18-19` is rewritten to assert the plural shape
for all three products, which is what makes the deletion visible if anyone
reintroduces the singular.

Labels stay per-destination catalog keys (`editInSoundscaper`,
`editInFramescaper` at `src/common/i18n/catalogs.js:1031-1032`, plus a new
`editInLightscaper`) resolved by a derived key name rather than a `{product}`
placeholder, because the German strings carry product-specific word order
(`:26-27`) and four browser assertions match those exact strings
(`tests/browser/editor-products.spec.js:114`, `:118`, `:134`;
`tests/browser/audio-editor-track-lock.spec.js:61`). A Node test asserts every
registered product has a label key in both catalogs.

### Switching in L1 is navigation; project handoff stays exactly as gated

The exit gate's "product switching reaches all three products from each of them
in a browser workflow" is satisfied by the **navigation** path — the
registry-derived sidebar links — and by nothing else. The **project-carrying
handoff** in File > Edit in … keeps its current gate verbatim:
`crossProductHandoffAvailable` stays `false` for Soundscaper on the web
(`src/soundscaper/ui/SoundscaperAudioEditorBootstrapV29.tsx:150`), desktop-only
for Framescaper
(`src/framescaper/ui/FramescaperAudioEditorBootstrapV28.tsx:150`), and `false`
for Lightscaper. The submenu items render disabled with the recorded reason
(`tests/audio-editor-track-lock-application-menu.test.ts:66-67`).

Separating the two stops the gate being "met" by turning handoff on. Handoff
carries a project through `prepareProjectHandoff`
(`src/common/editor/controller/project-admin-service.ts`) into a destination
that must open it; Lightscaper has no schema to open until L2, so enabling it
would ship a broken path to satisfy a wording.

### Seven photo capability keys, explicit booleans in all three profiles

`PROJECT_FEATURE_CAPABILITY_IDS` gains seven keys with
`org.soundscaper.capability.photo-*` ids: `photoSurface`, `photoLibrary`,
`photoMetadata`, `photoDevelop`, `photoExport`, `photoLocalAdjustments`,
`photoRaw` — one per owning milestone (L1, L3, L2/L5, L4, L5, L6, L7). All seven
are added as explicit booleans to Soundscaper's and Framescaper's capability
maps (all `false`) and to Lightscaper's, where exactly `photoSurface` is `true`.
Every other key in Lightscaper's map is `false`, which is the exit gate read
literally.

There is no choice about totality: two tests deep-equal each profile's key set
against the registry
(`tests/audio-editor-project-feature-capabilities.test.ts:31-36`;
`tests/audio-editor-foundation-feature-registration.test.ts:73-76`), and both
hardcode the pair `['soundscaper', 'framescaper']`, so both are rewritten to
iterate `PRODUCT_IDS` in the same change. Each new key also needs a reviewed
documentation label or `docs:generate` throws
(`scripts/lib/docs-reference-generator.mjs:279-283`).

Lightscaper does **not** spread `SHARED_CAPABILITIES`
(`src/common/product-capabilities.js:1-12`). That constant is an all-`true`
audio/video baseline, and a photo product that spreads it then overrides eight
of its ten keys back to `false` reads as a claim with a correction rather than a
declaration. `SHARED_CAPABILITIES` stays untouched for the two timeline
products; Lightscaper lists all 59 keys explicitly.

### Registration is the last step, so the tree is never red

`PRODUCT_IDS` gaining `'lightscaper'` is the single switch that starts
generating 17 more route documents, starts requiring an inventory block, starts
requiring OPFS evidence, and starts adding a column to three generated handbook
pages. WP-L1.0 therefore generalizes the seam while the tree still holds two
products — proving the N-ary behaviour with injected three-entry profile
fixtures rather than with a registered product — WP-L1.1 lands the whole
Lightscaper tree unregistered, and WP-L1.2 throws the switch with every consumer
already prepared.

### Per-product web-delivery facts move into the profile

The profile gains `siteIcons`, `installManifest` (name, description, scope,
start URL), `metaDescriptionKey`, `copyPrefix`, and `workspaces`.
`App.jsx:17-21, :68-91`, `scripts/generate-static-routes.mjs:34, :40-45`,
`scripts/lib/offline-application-shell.mjs:70-85`, and
`BrandSidebar.jsx:153-160` read those fields instead of branching on the id,
which retires four web ternaries and two hardcoded lists and makes the third
product's branding data rather than four coordinated edits.

### The Lightscaper profile declares `.liscape`

`projectFileExtension` is already a required profile field, and
`src/common/project-file-extensions.ts` already reserves `.liscape` for
`lightscaper` in `PROJECT_FILE_EXTENSION_BY_PRODUCT`, which is why Soundscaper
and Framescaper open a `.liscape` file today. The Lightscaper profile therefore
declares `projectFileExtension: PROJECT_FILE_EXTENSION_BY_PRODUCT.lightscaper`
rather than introducing a suffix, `tests/project-file-extensions.test.ts` stops
asserting that `lightscaper` has no runtime profile, and the generated
capability reference renders the `scape` family as `.liscape` for the new
product with no change to the family ID. Saving in Lightscaper renames an
incoming `.sscape` or `.fscape` to `.liscape` through the shared
`withProjectFileExtension`; nothing about the archive changes. L8 owns the
desktop side, where the packaged Lightscaper build is the first to claim the
`.liscape` OS association.

### Lightscaper copy lands in its own catalog module

New keys go into `src/common/i18n/lightscaper-copy.js` exporting
`LIGHTSCAPER_COPY_BY_LOCALE` with `de` and `en` blocks, spread into the two
bundled catalogs by appending the import and the spread to existing lines — the
pattern already used at `src/common/i18n/catalogs.js:11-12` and `:21`, `:26`.
This is not style: `catalogs.js` is allowlisted at exactly its current 2037
lines (`config/maintainability-allowlist.json:27`), so one added line fails `npm
run check:architecture`, and raising the ratchet for new copy is the allowlist
exception this repository refuses.

### The desktop two-product fence is machine-checked

`RELEASE_PRODUCTS` (`scripts/desktop-release-assets.mjs:19`) and the nightly
product loop (`scripts/desktop-nightly-tests-products.mjs:27`) move to one
exported `DESKTOP_PACKAGED_PRODUCT_IDS` in
`scripts/lib/desktop-packaged-products.mjs` with identical values, and a test
asserts `PRODUCT_IDS` minus that set equals `['lightscaper']` with L8 named in
the message. Behaviour is byte-identical; the fence becomes a failing test
rather than a comment, so a later agent cannot half-wire a Lightscaper desktop
target.

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| Keep `otherProductId` and add `otherProductIds` beside it | The singular returns a plausible wrong answer forever; the next unmigrated consumer is a silent misroute, not a failure. |
| A `{product}` placeholder key instead of per-destination labels | German word order already differs per label (`catalogs.js:26-27`) and four browser assertions match the exact strings; a placeholder trades working evidence for one saved key. |
| Enable cross-product handoff for Lightscaper to satisfy the switching gate | Handoff opens a project in the destination; Lightscaper has no project schema until L2, so it would ship a broken path to satisfy wording. |
| Omit audio/video keys from Lightscaper's capability map | Two tests deep-equal every profile's key set against the registry; an omitted key is a red suite, and a silent `undefined` reads as "not enabled" in the generated handbook without saying so. |
| Spread `SHARED_CAPABILITIES` into Lightscaper and override | Eight of its ten keys would be corrected back to `false`; a declaration that needs a correction is not a declaration. |
| Register the product first and wire consumers after | `PRODUCT_IDS` drives route generation, inventory identity, OPFS evidence, and three generated documents at once; registering first means a red tree across every intermediate commit. |
| Add the `lightscaper` shard id before the workflow rows | `check-shard-coverage.mjs:17-28` fails the coverage job for a shard that uploaded nothing, and `node-test-shards.test.js:123-134` fails the matrix cross-check; both must move in one change. |
| Give Lightscaper the two products' `web-enhanced` OPFS evidence block | The L1 surface stores nothing; copying twelve OPFS evidence paths to pass `production-opfs-worker-policy.test.js:57-66` would be a capability claim manufactured for a loop. |
| Grow `catalogs.js` with the new keys | It sits on a 2037-line ratchet; new copy belongs in a module, and raising an allowlist entry for new work is the exception this repository refuses. |
| Touch desktop packaging, identity, or product lists in L1 | The roadmap blocks all of it until L8; L1's only desktop change is making the two-product fence a test. |

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| L1.0 | Serialized (one work stream) | Seam generalization with two products still registered: registry helpers, route parsing, bootstrap map, profile-driven branding, desktop fence |
| L1.1 | Serialized (one work stream) | The unregistered Lightscaper tree: profile, empty-library shell, capability keys, copy module, icon, handbook section |
| L1.2 | Serialized (one work stream) | Registration: `PRODUCT_IDS`, inventory block, `_headers` rows, PWA artifacts, generated docs |
| L1.3 | Serialized (one work stream) | The `lightscaper` shard, both workflow matrices, architecture rules |
| L1.4 | Serialized (one work stream) | Browser acceptance across Chromium, Firefox, and WebKit |

Every phase is serialized: all five packets edit `src/common/` spine files and
the same configs, so parallel tracks would collide on `products.js`, the
capability registry, and the inventory.

## Work packets

Every L1 packet is decomposed here against the five fields (Outcome, Invariants,
Acceptance, Non-goals, Stop condition); no slice doc is owed at pickup, and any
packet that grows one names it here first.

### WP-L1.0 — N-product seam over two registered products

- **Outcome:** `otherProductIds` replaces `otherProductId`;
  `resolveApplicationRoute` derives the product from a basePath→id map built
  from `PRODUCT_PROFILES` instead of the `segments[0] === 'framescaper'` test
  (`src/common/site/route.js:18-19`), with the pure parser extracted so tests
  can inject a three-entry fixture; `App.jsx` selects its bootstrap from a
  registry-keyed lazy map and builds intro copy, title, and icon links from
  profile fields (`src/common/site/App.jsx:14-21`, `:68-91`); `BrandSidebar`
  renders N−1 destination links and reads its workspace list from the profile
  (`src/common/site/BrandSidebar.jsx:111-112`, `:153-160`); `switch-product`
  becomes a per-destination submenu
  (`src/common/editor/ui/application-menus.js:196-202`;
  `src/common/editor/ui/workspace/workspace-application-menu-runtime.js:236-240`);
  `generate-static-routes.mjs` and `offline-application-shell.mjs` read profile
  fields; `filterProductMenus` takes each menu group's owning product from a
  profile field instead of four `'framescaper'` literals
  (`src/common/editor/ui/application-menu-product-filter.js:12`, `:64`),
  `productStorageKey` reads a `storageKeyPrefix` profile field
  (`src/common/editor/ui/meter-settings.ts:89-90`), and
  `workspaceSwitcherOptions` reads the profile's `workspaces` list
  (`src/common/editor/ui/workspace/useAudioEditorWorkspaceLifecycle.js:107-112`),
  which is the seam `lightscaper-4-plan.md` assumes L1 leaves behind;
  `scripts/lib/desktop-packaged-products.mjs` holds the desktop fence.
- **Invariants:** the two registered products' emitted routes, manifest JSON,
  icon bytes, head links, menu ids, and disabled reasons are unchanged; no new
  always-visible chrome appears (`AGENTS.md:8-11`); the desktop tree,
  `vite.config.mjs`, `electron-builder.config.cjs`, and `desktop/constants.js`
  keep their binary product resolution.
- **Acceptance:** `npm run check` green; new
  `tests/site-product-registry.test.js` and `tests/site-product-route.test.js`
  prove route parsing, head links, and destination lists against an injected
  three-entry profile fixture and assert `otherProductIds` is total and ordered;
  `tests/editor-products.test.js` and
  `tests/audio-editor-track-lock-application-menu.test.ts:57-79` updated to the
  submenu shape; `tests/offline-application-shell-build.test.js` and
  `tests/offline-static-route-install.test.js` still pass byte-for-byte on both
  existing products; `tests/site-product-menu-filter.test.js` asserts that for
  an injected three-entry profile fixture every product-scoped menu group,
  storage key, and workspace list is derived from the profile, and that no
  `productId === '<literal>'` remains in the three modules the Outcome names —
  every literal left under `src/common/editor/ui/` is a per-product feature
  guard that fails closed; a new fence test asserts `PRODUCT_IDS` minus
  `DESKTOP_PACKAGED_PRODUCT_IDS` is empty before registration, with the
  expectation moving to `['lightscaper']` in WP-L1.2, and names L8 in its
  message.
- **Non-goals:** no third product, no new capability key, no i18n key, no
  workflow edit, no desktop behaviour change.
- **Stop condition:** stop if any consumer of the registry cannot be expressed
  as a profile field or a registry lookup without a product id literal — record
  it as a named seam defect rather than leaving a ternary behind a helper.

### WP-L1.1 — The Lightscaper tree, unregistered

- **Outcome:** `src/lightscaper/product.js` exports `LIGHTSCAPER_PROFILE` (id,
  name, description, `basePath: '/lightscaper'`, `defaultWorkspace`,
  `workspaces`, `panels`, empty `importChoices`/`exportChoices`, a
  `shortcuts.disabledCommandIds` covering every audio and video command family,
  empty `applicationFeatures`, a total capability map, `siteIcons`,
  `installManifest`, `metaDescriptionKey`, `copyPrefix`) but is not yet in
  `PRODUCT_IDS`; `src/lightscaper/ui/LightscaperPhotoLibraryShell.tsx` renders
  the branded empty-library surface and emits the readiness attribute
  `src/main.jsx:9-14` waits for; `PROJECT_FEATURE_CAPABILITY_IDS` gains the
  seven photo keys (`src/common/editor/project-feature-capabilities.ts:3-55`)
  with reviewed labels (`scripts/lib/docs-reference-generator.mjs:11-63`), both
  existing profiles and both inventory `projectFeatures` blocks gain them as
  `false`, and `groundedAt` moves; `src/common/i18n/lightscaper-copy.js` carries
  the `de`/`en` keys; `public/logo/lightscaper-icon.svg` ships with a finite
  `viewBox` (`scripts/lib/offline-application-shell.mjs:119-126`);
  `handbook/src/content/docs/lightscaper/index.md` gives
  `documentationUrl('lightscaper', 'manual')` a destination.
- **Invariants:** the Lightscaper capability map's key set equals the
  registry's; exactly `photoSurface` is `true`; the shell renders no audio or
  video authoring control and opens no store; `src/common/i18n/catalogs.js`
  stays at 2037 lines; no module under `src/lightscaper/` imports
  `src/framescaper/` or `src/soundscaper/`.
- **Acceptance:** `npm run check` green;
  `tests/lightscaper-product-profile.test.js` asserts the profile's key set
  against `PROJECT_FEATURE_CAPABILITY_IDS`, the single `true` key, the frozen
  shape, and the disabled-command coverage; `tests/i18n-runtime.test.js:17-19`
  still passes with the merged keys; `node scripts/check-file-size.mjs` reports
  no allowlist movement; `npm run docs:check` passes with the seven new
  capability rows; `tests/lightscaper-photo-library-shell.test.tsx` renders
  `LightscaperPhotoLibraryShell` and asserts it emits `data-audio-editor-bound`
  (or `role="alert"`) exactly as `src/main.jsx:9-14` requires, renders the
  branded empty-library copy from `src/common/i18n/lightscaper-copy.js`, mounts
  without a project store, command runtime, or storage backend, and contains no
  audio or video authoring control.
- **Non-goals:** no catalog schema, no develop state, no storage, no
  registration, no shard.
- **Stop condition:** stop if the empty-library shell needs any project schema,
  store, or command runtime to mount — that is L2/L3 work and the shell must
  render without it.

### WP-L1.2 — Registration and web delivery

- **Outcome:** `PRODUCT_IDS` and `PRODUCT_PROFILES` gain `lightscaper`
  (`src/common/products.js:4`, `:8-11`); `config/production-capabilities.json`
  gains a Lightscaper `products` block with `profileEvidence`,
  `applicationFeatures: {}`, the four platform tiers (`web-core: available`,
  `web-enhanced: planned`, `electron-enhanced: planned`, `electron-only:
  planned`, each with evidence paths that exist), `importFamilies`,
  `exportFamilies`, and `projectFeatures` deep-equal to the profile;
  `tests/production-opfs-worker-policy.test.js:57-66` is narrowed to the two
  products that own the milestone-2 OPFS boundary plus an assertion that every
  other registered product declares a non-`available` `web-enhanced` status;
  `public/_headers` gains `/lightscaper/:locale/` and
  `/lightscaper/embed/:locale/` with `microphone=(), speaker-selection=(),
  display-capture=(), camera=(), geolocation=()`; the offline shell emits
  `manifest-lightscaper.webmanifest` and three PNG icons; the three generated
  handbook reference documents are regenerated with the third column; the
  desktop fence test's expectation moves from empty to `['lightscaper']` in the
  same commit that adds the id to `PRODUCT_IDS`, keeping the L8 reference in its
  message.
- **Invariants:** the two existing routes' Permissions-Policy strings,
  manifests, icons, and generated head links are unchanged; every Lightscaper
  capability claim except `photoSurface` is `false`; every inventory evidence
  path exists on disk; no `dist` asset exceeds 25 MiB
  (`scripts/check-cloudflare-assets.mjs:6`) and no emitted JavaScript chunk
  exceeds 500,000 bytes (`scripts/check-build-chunks.mjs:11`).
- **Acceptance:** `npm run check:static` green, which runs
  `generate-static-routes`, `generate-offline-application-shell`,
  `check-i18n-build`, `check-cloudflare-assets`, and `check-build-chunks` inside
  one `npm run build`; `npm test -- --shard=common`, `--shard=framescaper`,
  `--shard=soundscaper` all green;
  `tests/production-capability-inventory.test.js` and a new
  `tests/lightscaper-capability-inventory.test.js` pin the block;
  `tests/framescaper-capture-cloudflare-policy.test.js` updated to the
  seven-pattern list, still asserting no route receives comma-joined policies;
  `tests/offline-application-shell-build.test.js` and
  `tests/offline-static-route-install.test.js` extended to the third product;
  `npm run docs:reference:check` clean after `docs:generate`.
- **Non-goals:** no shard, no workflow edit, no browser spec, no desktop
  packaging, no handoff enablement.
- **Stop condition:** stop if any capability tier would need evidence that does
  not exist on disk — downgrade the tier's status instead of inventing a path.

### WP-L1.3 — The `lightscaper` test shard and architecture rules

- **Outcome:** `NODE_TEST_SHARD_IDS` becomes `['common', 'framescaper',
  'lightscaper', 'soundscaper']` and `PRODUCTS` gains its classifier entry
  (`scripts/lib/node-test-shards.mjs:12`, `:24-27`); both workflow matrices read
  `shard: [common, framescaper, lightscaper, soundscaper]`
  (`.github/workflows/quality.yml:78`;
  `.github/workflows/desktop-preview.yml:113`) in the same commit;
  `tests/node-test-shards.test.js:104-112` generalizes "names both products" to
  "names more than one product"; `.dependency-cruiser.cjs` gains a
  `no-cross-product-imports` rule forbidding
  `^src/(soundscaper|framescaper|lightscaper)/` from importing a sibling product
  tree.
- **Invariants:** the shards partition the suite with no file in two of them and
  none in none (`tests/node-test-shards.test.js:28-39`); the `lightscaper` shard
  is non-empty, because `scripts/run-node-tests.mjs:19-21` throws otherwise and
  `scripts/check-shard-coverage.mjs:17-28` fails the coverage job for a shard
  that uploads nothing; the new rule is green at introduction — no
  product↔product import exists today.
- **Acceptance:** `npm test -- --shard=lightscaper` runs the Lightscaper-named
  tests and passes; `npm test -- --shard=common`, `--shard=framescaper`,
  `--shard=soundscaper` unchanged; `tests/node-test-shards.test.js` passes both
  workflow matrix cross-checks; `npm run check:architecture` green; `npm run
  coverage:check` green over the union of four shard profiles.
- **Non-goals:** no coverage threshold change (`.c8rc.json` includes only
  `src/common/editor/**`, so `src/lightscaper/**` is outside the measured set);
  no new workflow job beyond the matrix row.
- **Stop condition:** stop if the classifier would place a cross-product test
  into the Lightscaper shard — rename the test after the product that owns it,
  or after neither, per the shard rule
  (`scripts/lib/node-test-shards.mjs:6-11`).

### WP-L1.4 — Browser acceptance on three engines

- **Outcome:** `tests/browser/lightscaper-product-surface.spec.js` boots
  `/lightscaper/en/` and asserts the branded sidebar name, the document title
  and icon link, the empty-library surface, the removal of the first-paint
  progress bar, and the absence of any audio or video authoring control;
  `tests/browser/site-product-switching.spec.js` asserts that from each of the
  three routes the sidebar offers exactly the other two, that following each
  link lands on that product's branded route, and that the File > switch-product
  submenu lists two disabled destinations with the recorded reason.
- **Invariants:** both specs pass on `chromium`, `firefox`, and `webkit`;
  neither spec depends on OPFS, MediaRecorder, or IndexedDB Blob storage, none
  of which the pinned WebKit build exposes (`roadmap.md:271-274`); no
  client-side error is emitted during either workflow.
- **Acceptance:** `npm run test:browser -- --project=chromium
  tests/browser/lightscaper-product-surface.spec.js
  tests/browser/site-product-switching.spec.js` and the same command for
  `--project=firefox` and `--project=webkit`; both specs run in CI through the
  existing browser jobs (`.github/workflows/quality.yml:181`, `:214`, `:232`,
  `:274`) and are staged into the nightly payload automatically by the
  whole-directory copy (`scripts/lib/desktop-nightly-tests-staging.mjs:74`).
- **Non-goals:** no project handoff assertion beyond the disabled state; no
  storage, import, or develop assertion.
- **Stop condition:** stop if the empty-library surface cannot reach a stable
  ready state on WebKit without storage — record the engine limitation and the
  automated part that does close, rather than claiming three engines.

## Quality-budget and evidence duties

- L1 registers no workload in `config/quality-budgets.json` and collects no
  measurement, so `npm run audit:quality-results` sees an unchanged ledger.
- The capability inventory is the only machine-readable claim L1 writes. Its
  `groundedAt` literal moves in lockstep with the pin at
  `tests/production-capability-inventory.test.js:23`, and every tier's evidence
  is checked for existence at `:185-203`.
- L1 adds no third-party dependency, so
  `config/production-licensing-matrix.json`, `THIRD_PARTY_LICENSES.md`,
  `LICENSES/`, and `npm run audit:ci` are untouched; the one new asset is a
  hand-authored SVG under `public/logo/`.
- Bundle evidence is the existing build gate: the Lightscaper shell is a lazily
  imported chunk placed by reachability — it matches no group in
  `scripts/lib/build-chunk-groups.mjs:26-91` — and must stay under the
  500,000-byte chunk ceiling and the 25 MiB Pages asset ceiling.
- Route arithmetic is evidence: registration takes the generated document count
  from 34 to 51 (three products × 17 committed locales,
  `src/common/i18n/locales.js:82-100`) and adds one manifest and three PNG
  icons, inside the offline shell's 4,096-asset and 256 MiB limits
  (`scripts/lib/offline-application-shell.mjs:14-16`).

## Coordination rules

- **Spine files — one owner per edit, rebase before push.**
  `src/common/products.js`, `product-capabilities.js`,
  `editor/project-feature-capabilities.ts`, `site/route.js`, `site/App.jsx`,
  `site/BrandSidebar.jsx`, `editor/ui/application-menus.js`,
  `editor/ui/application-menu-product-filter.js`, `editor/ui/meter-settings.ts`,
  `editor/ui/workspace/workspace-application-menu-runtime.js`,
  `editor/ui/workspace/useAudioEditorWorkspaceLifecycle.js`, `i18n/catalogs.js`;
  `config/production-capabilities.json`,
  `config/maintainability-allowlist.json`, `public/_headers`;
  `scripts/lib/node-test-shards.mjs`, `offline-application-shell.mjs`,
  `docs-reference-generator.mjs`, `scripts/generate-static-routes.mjs`;
  `.dependency-cruiser.cjs`, `.github/workflows/quality.yml`,
  `.github/workflows/desktop-preview.yml`.
- **The shard row and the workflow matrices are one commit.** Splitting them
  reds the coverage job and the matrix cross-check in both directions; neither
  half is independently green. A test's shard also follows its basename, not
  only its imports — `classifyNodeTestFile` matches each product's `name` regex
  against it (`scripts/lib/node-test-shards.mjs:24-27, :42-48`) — so the
  acceptance command and the filename are chosen together.
- **The capability-key registry is a serialized revision.** At most one key
  addition in flight product-wide: three profiles, the inventory, the label map,
  and three generated documents all move with it.
- **Generated artifacts are regenerated, never hand-edited.** The three handbook
  documents come from `npm run docs:generate`; a hand edit is caught by `npm run
  docs:reference:check`.
- **This tree is edited by many concurrent sessions.** Stage explicit paths and
  confirm `git diff --cached --name-only` before committing; a local gate run in
  the shared tree measures other sessions' work, so verify a candidate commit in
  a detached worktree before pushing it.

## Known constraints this plan absorbs

- **The catalog ratchet.** `src/common/i18n/catalogs.js` cannot grow by one line
  (`config/maintainability-allowlist.json:27`), which is why all Lightscaper
  copy is a module whose import and spread are appended to existing lines.
- **The two-catalog reality.** Only `de` and `en` are bundled
  (`src/common/i18n/catalogs.js:16`, `:1021`); the other 15 committed locales
  resolve to English at runtime (`:2030-2032`) while still getting their own
  static documents. "Per-locale product copy for every supported locale"
  therefore means two authored catalogs and 17 generated routes, not 17
  translations.
- **The empty shard trap.** A shard id with no test files throws in the runner
  (`scripts/run-node-tests.mjs:19-21`) and fails the coverage gate
  (`scripts/check-shard-coverage.mjs:17-28`), so WP-L1.1 and WP-L1.2 must have
  produced Lightscaper-named tests before WP-L1.3 adds the id.
- **The readiness attribute.** The first-paint progress bar is removed only when
  `[data-audio-editor-bound]` or `[role="alert"]` appears (`src/main.jsx:9-14`);
  a shell that emits neither shows a permanent loading bar that no non-browser
  gate would notice.
- **`groundedAt` is pinned.** Any inventory edit moves the literal at
  `tests/production-capability-inventory.test.js:23` with it.
- **Desktop stays two-product.** `desktop/constants.js:3-6`,
  `desktop/main.mjs:216-217`, `vite.config.mjs:14, :69`,
  `electron-builder.config.cjs:1-2`, `scripts/desktop-prepare.mjs:74-76`,
  `desktop/direct-wav-smoke.js:42`, and `desktop/project-library-contract.ts:14`
  keep their binary resolution until L8; the fence test is what keeps that
  deliberate.
- **The Framescaper V30 still-image campaign** on `codex/milestone-8-images`
  owns still ingest and timeline-image modeling. L1 touches none of it and must
  not fork or preempt it.

## Watch items (not gates yet)

- The 500,000-byte chunk ceiling under three lazily imported product bootstraps;
  a drifting shared shell chunk is addressed in the group table
  (`scripts/lib/build-chunk-groups.mjs:26-91`), not in the ceiling.
- The offline shell's 4,096-asset and 256 MiB aggregate limits as the route
  count grows with committed locales.
- `web-enhanced` honesty for Lightscaper: the tier stays `planned` until L3
  actually uses the shared storage facade, at which point the OPFS evidence
  claim becomes true rather than copied.
- Whether the sidebar destination list stays readable at N > 3; the submenu
  already scales, the sidebar link list does not indefinitely.
- The generated `product-capabilities.md` description string
  (`scripts/lib/docs-reference-generator.mjs:339`) still names two products by
  hand — regenerated content, so a copy edit, not a seam defect.

## Non-goals and fences

- No catalog schema, develop state, pixel contract, or metadata reader — all of
  it is L2, and L1's surface stores nothing.
- No desktop identity, packaging, protocol scheme, session partition, or
  per-product desktop wiring; all of it is blocked until L8.
- No capture, tethering, or camera permission anywhere in the Lightscaper route:
  both new `_headers` rows deny microphone, camera, display-capture,
  speaker-selection, and geolocation.
- No ML capability, no destructive raster editing, no patent-encumbered codec.
- No cross-product handoff enablement; the gate is unchanged in all three
  products.
- No new always-visible chrome: the empty-library surface is the route's own
  content, and every new entry point is a menu or an existing sidebar link slot
  (`AGENTS.md:8-11`).
- No allowlist exception: a file that would cross the 600-line ceiling
  (`config/maintainability-allowlist.json`, `defaultMaxLines`) is split.
