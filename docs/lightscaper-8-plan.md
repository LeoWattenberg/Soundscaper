# Lightscaper milestone L8 plan: desktop tier

> Owning source for L8 sequencing, the desktop-packaging and add-in-place
> library decisions, their invariants, and the bounded work packets. The
> [Lightscaper roadmap](../roadmap-lightscaper.md#l8-desktop-tier) owns
> scope and status; the capability inventory, licensing policy, and
> quality-budget policies own their claims. Grounded against the repository
> on 2026-08-25 at commit `3d1e908c` with file:line verification. L8
> depends on L1 (lightscaper-1-plan.md) for the registered product,
> registry, and shard, on L3 (lightscaper-3-plan.md) for the catalog and
> its derivatives, and on L7 (lightscaper-7-plan.md) for the native
> services it packages; signing identities, notarization credentials, and
> real-hardware measurement are L9 rows (lightscaper-9-plan.md) and none
> gates L8. Re-ground every citation at pickup — earlier milestones will
> have moved the tree.

## Goals and ordering principle

1. **Primary: the packaged product never reaches outside what the user
   granted.** An add-in-place library reads and writes only inside a granted
   directory root, a revoked or disconnected root produces a defined recoverable
   state rather than a partial read, and every path leaving the sandboxed
   renderer is a validated IPC request over a bounded read capability
   (`desktop/main.mjs:265-275`, `desktop/read-capability-admission.js:11-21`).
2. **Secondary: one packaging seam, extended — not a third packaging stack.**
   Every L8 surface grows out of the existing per-product seam: the
   electron-builder configuration and its product branches
   (`electron-builder.config.cjs:1-2`), the staging script
   (`scripts/desktop-prepare.mjs:74-76`), the packaged smoke plan decoder
   (`desktop/desktop-smoke-configuration.js:48-60`), and the release assembler's
   exact inventory (`scripts/desktop-release-assets.mjs:19-46`).

Work is ordered by admission risk: the desktop product decision is a binary
ternary in every packaging file, most of them failing *open* onto Soundscaper,
so a Lightscaper build produced before that repair is a mislabeled Soundscaper
package. Admission repair lands first, packaged identity and CI rows second, the
add-in-place library and native-service packaging afterwards — both proven by
packaged smoke runs that cannot exist until a packaged Lightscaper does.

## What already exists (do not re-plan)

- **The packaging seam is complete and product-parameterized — for exactly two
  products.** `electron-builder.config.cjs:1` derives every branch from
  `process.env.SCAPE_PRODUCT === 'framescaper'`: app id (`:21`), entitlements
  (`:11-13`), file associations including the Soundscaper-only `aup3`/`aup4`
  rows (`:53-68`), macOS category and usage descriptions (`:91-99`), Linux
  executable name, category, and synopsis (`:104-115`).
  `scripts/desktop-prepare.mjs` stages the renderer, runtimes, licenses, and the
  application `package.json` from the same binary id (`:74-76`, `:346`,
  `:362-374`) across five declared targets (`:78-80`).
- **Packaged hardening is enforced at pack time, not asserted in prose.**
  `scripts/desktop-after-pack.mjs:66-74` runs the codec-policy audit and every
  native payload verifier before flipping the V1 fuse set with
  `strictlyRequireAllFuses` (`:88-103`) — `RunAsNode` off, `OnlyLoadAppFromAsar`
  on, ASAR integrity validation on, `GrantFileProtocolExtraPrivileges` off — and
  writes the installed-resource closure manifest (`:108-113`). The renderer runs
  sandboxed, context-isolated, without Node integration or webview tag
  (`desktop/main.mjs:265-275`), reaching main only through the frozen bridge
  `desktop/preload.mjs:218-220` exposes as `scapeDesktop`/`soundscaperDesktop`
  plus a Framescaper superset carrying `projectLibrary`; the packaged smoke pins
  that key list (`scripts/lib/desktop-smoke.mjs:8-104`) and refuses Framescaper
  evidence from a Soundscaper build (`:160-166`).
- **Capability-scoped folder access already exists on the Framescaper side.**
  `desktop/native-services-root-repository.ts:15-22` records a durable-root
  grant as `rootPath` plus `volumeIdentity` and `directoryIdentity`; `authorize`
  refuses a grant id naming a different directory or already revoked (`:52-68`);
  `revoke` disables every watch rule bound to the grant in the same transaction
  (`:96-126`); `revalidate` compares the live probe's canonical path, volume
  identity, and directory identity and answers false on mismatch (`:128-137`);
  `resolveDestination` joins only an admitted relative destination under the
  root (`:139-143`) and `requireActive` refuses a revoked grant (`:145-150`).
- **Watched-folder reconciliation is already the authority, not `fs.watch`.**
  `src/common/editor/native-watch-reconciliation.ts:3-34` records the doctrine:
  a bounded sweep at startup and every thirty seconds is authoritative, an event
  only shortening the wait; a candidate is stable only after two identical
  size/mtime observations two seconds apart plus a successful probe; duplicate
  suppression keys on canonical file identity *and* content fingerprint
  together, because identity alone re-imports bytes replaced in place and
  fingerprint alone re-imports after a rename. Constants are pinned at `:42-46`,
  the vocabulary at `:48-56`, rules at 1 024 and a 100 000-entry sweep
  (`desktop/native-services-watch-repository.ts:24-26`).
- **Derived media is already barred from being editorial authority.**
  `src/common/editor/video-proxy-generation.ts:3-13` states that a proxy is a
  preview stand-in while clip bounds, source timing, relink identity, and
  delivery keep referring to the original;
  `src/common/editor/controller/video-proxy-original-observer.ts:13-21` refuses
  as soon as the generation token, storage key, or digest stops matching what
  was opened. Reads are per-owner count- and byte-bounded with a fifteen-minute
  TTL (`desktop/file-capabilities.js:36`, `:56-88`;
  `desktop/constants.js:40-48`) and writes rename into place through a save
  target that reports space exhaustion (`desktop/save-targets.js:2, 13, 19-38`).
- **Native services already package fail-closed with an empty payload set.**
  `config/framescaper-media-host-payload-manifest.json:10-11` ships
  `"payloads": []` with all five targets `pending-external` and a written
  blocker reason; `scripts/desktop-prepare.mjs:98-104` verifies the manifests
  before the build tree is destroyed and copies the *verified* bytes into the
  staged application (`:348-361`); `npm run audit:framescaper-media-host`
  (package.json:130) runs inside `audit:ci` (package.json:139) reporting built
  versus pending (`scripts/audit-framescaper-media-host.mjs:20-26`).
- **The packaged CI matrix and the release inventory are in place.**
  `.github/workflows/desktop-preview.yml:336` crosses two products with five
  targets (`:337-357`), runs the hardened smoke (`:435-439`), retains a per-cell
  runtime manifest (`:472-475`), and uploads one artifact per cell (`:502-514`).
  The release assembler pins `RELEASE_PRODUCTS`
  (`scripts/desktop-release-assets.mjs:19`), five targets (`:20-22`), nine
  package rows per product (`:23-43`), the exact runtime manifest set
  (`:44-46`), and an exact package count with no unexpected inputs (`:124-135`);
  `tests/desktop-release-package-inventory.test.js:16-28` pins the
  nine-per-product naming in CI.

## Verified gaps this plan closes (grounded 2026-08-25)

- **Six packaging entry points fail open onto Soundscaper.**
  `desktop/constants.js:3` resolves any product id that is not `framescaper` to
  `soundscaper`, propagating to the app id, scheme, session partition, and
  update tag prefix (`:5-10`). The same open ternary appears in
  `electron-builder.config.cjs:1-2`, `scripts/desktop-prepare.mjs:74-76`,
  `scripts/desktop-smoke.mjs:19-24`, `scripts/desktop-release-assets.mjs:143`,
  `scripts/desktop-nightly-tests-products.mjs:50`, and
  `scripts/lib/desktop-scape-open-smoke.mjs:169`, so a
  `SCAPE_PRODUCT=lightscaper` build today produces a package identified as
  Soundscaper — a mislabeled artifact, not an error.
- **Two entry points already fail closed and need a third arm, not a repair.**
  `desktop/protocol.js:80-85` throws on any product that is not Soundscaper or
  Framescaper and `scripts/desktop-after-pack.mjs:272-277` throws on an
  unrecognized packaged product filename; the capture permissions policy denies
  by default for an unknown product (`desktop/protocol.js:163-167`), which
  matches the Lightscaper capture fence.
- **The desktop project-library contract is a closed two-value union.**
  `desktop/project-library-contract.ts:14` freezes
  `['soundscaper', 'framescaper']`, `:36` derives `DesktopLibraryProduct` from
  it, and `preferredProduct` on every stored project row is typed by it
  (`:51-57`). No photo-shaped locator exists either:
  `desktop/linked-original-locator-validation.ts:5-16` closes the linked media
  kind to `'audio' | 'video'` and `:18-38` closes the admissible MIME types to
  video plus AIFF/WAV/RF64.
- **Adding a third product breaks the milestone-5 aggregation by construction.**
  `.github/workflows/desktop-preview.yml:549-553` downloads every `nightly-*`
  artifact into one directory and
  `scripts/lib/milestone-5-handoff-matrix.mjs:176-186` rejects that directory
  unless its entries are exactly the ten `nightly-<product>-<target>` roots from
  that file's own two-product list (`:23-24`, `:35-37`, `:504-506`);
  `aggregateMilestone5HandoffMatrix` demands ten cells (`:41-43`).
- **The release assembler's per-product label prefix is a binary ternary, and
  two workflow steps assert a literal package count.**
  `scripts/desktop-release-assets.mjs:111-119` prefixes a package label with
  `'Framescaper'` or `'Soundscaper'` and `:143` builds the file-name pattern
  from the same ternary, so a Lightscaper package is asserted against the
  Soundscaper pattern and fails as a missing one; the manifest-count message is
  already stale — "all five native builds" while `EXPECTED_RUNTIME_MANIFESTS`
  derives ten (`:44-46`, `:54-55`).
  `.github/workflows/desktop-preview.yml:679-682` and `:800-803` fail unless
  exactly two packaged Chromium sandboxes are found, and the lease-matrix build
  loop is a literal two-product bash loop (`:776-788`), mirrored in
  `scripts/lib/desktop-project-library-lease-matrix.mjs:77, 83`.
- **The packaged smoke has no Lightscaper mode and no Lightscaper bridge
  expectation.** `desktop/desktop-smoke-configuration.js:48-60` maps nine smoke
  modes to decoders and throws on anything else; the expected bridge lists are
  Soundscaper-base and Framescaper-superset only
  (`scripts/lib/desktop-smoke.mjs:8-104`).
- **The capability inventory has no Lightscaper desktop claim.**
  `tests/production-capability-inventory.test.js:25` binds the
  `config/production-capabilities.json` `products` keys to `PRODUCT_IDS`,
  `:35-38` demands a status and an existing evidence path for all four platform
  tiers, and `:23` pins the grounding date.

## Decisions

### The desktop product decision becomes a registry lookup that refuses

Every packaging site resolves its product through one shared admission helper
that throws on an unknown id, replacing the six open ternaries above.
`desktop/constants.js:3` stops defaulting: an unrecognized `SCAPE_PRODUCT` or
`desktop/product.json` id is a build failure, not a Soundscaper build, and the
two sites that already refuse (`desktop/protocol.js:80-85`,
`scripts/desktop-after-pack.mjs:272-277`) gain a third arm through the same
helper, not a third literal. This is the desktop half of the L1 registry work
the roadmap defers with its "Blocked until L8" line.

### Lightscaper joins the release inventory, not the milestone-5 matrix

`DESKTOP_PACKAGED_PRODUCT_IDS`, the single list L1 lands in
`scripts/lib/desktop-packaged-products.mjs` behind the release assembler and the
nightly-with-tests packager, gains `lightscaper`, taking the release inventory
from eighteen packages and ten runtime manifests to twenty-seven and fifteen,
and the two binary product-name ternaries
(`scripts/desktop-release-assets.mjs:111-119`, `:143`) become lookups over the
registry the desktop admission helper uses. `MILESTONE_5_PACKAGE_CELLS`
(`scripts/lib/milestone-5-handoff-matrix.mjs:23-24, 35-37`) stays at ten cells,
because that matrix is milestone 5's readiness authority: a Lightscaper blocker
inside it would move milestone 5's `milestoneReleaseReady` verdict (`:63-65`)
for reasons milestone 5 does not own. The aggregation job's `pattern: nightly-*`
download (`.github/workflows/desktop-preview.yml:549-553`) therefore splits into
two product-scoped downloads, so Lightscaper artifacts never enter the directory
`validatePackageMatrixDirectory` inspects (`:176-186`).

### The add-in-place grant is a directory root, never a per-file capability

A library added in place grants one directory root, admitted and revalidated by
the existing durable-root model
(`desktop/native-services-root-repository.ts:15-22, 128-137`). Photo reads
inside it are ordinary bounded read capabilities derived from the grant, so
per-owner ceilings still bound concurrency (`desktop/constants.js:40-41`).
Per-file locators are not extended to photos: `MAX_READ_CAPABILITIES_PER_OWNER`
is 128 (`desktop/constants.js:40`) while a real library holds six figures of
files, so a per-file model cannot represent the library, and rename detection
needs a directory to sweep.

### Rename and move detection reuses the shared reconciliation model unchanged

External renames and moves are detected by the sweep that already exists, not by
a photo-specific watcher. `src/common/editor/native-watch-reconciliation.ts`
keys duplicate suppression on canonical file identity plus content fingerprint
together (`:3-34`), the pair that distinguishes "the same photo moved" from "a
new photo with the same name": identity survives a rename, fingerprint a move
between directories inside the root. A rename inside a granted root relinks the
catalog entry rather than re-importing it; a move out of every granted root
marks the photo missing and offers L3's relink.

### A disconnected volume is a render-admission refusal, not a view toggle

When a granted root's volume identity stops matching
(`desktop/native-services-root-repository.ts:128-137`), develop continues
against the preview-resolution derivatives L3 builds, and any full-resolution
evaluation — loupe at 1:1, zoom past the derivative's resolution, and every
export — refuses with a stated cause naming the missing volume. The refusal
lives in a shared admission check under `src/common/`, on the side of the line
the proxy doctrine already draws
(`src/common/editor/video-proxy-generation.ts:3-13`). Placing it in the develop
path but not the export path — or the reverse — is the defect the platform
invariant forbids: one check serves both, with both products' tests in the same
change.

### L7's native services package as an empty, audited, pending-external manifest

L8 packages L7's native raw-decode and preview services through the shape that
already survives an unbuilt payload:
`config/lightscaper-raw-host-payload-manifest.json` mirrors
`config/framescaper-media-host-payload-manifest.json:10-11` — `payloads: []`,
one row per declared target with `status: "pending-external"` and a written
blocker — verified in `scripts/desktop-prepare.mjs` before the build tree is
destroyed, staged from the verified bytes, and audited by a new
`audit:lightscaper-raw-host` wired into `audit:ci` (package.json:139). An absent
payload is refused at staging rather than silently skipped, and the packaged
product falls back to the Web Core decode path L7 owns — the container read,
embedded preview, and neutral baseline while L7's LibRaw licensing row stands
`blocked`, and the WASM decoder once it clears.

### The packaged loop is one new smoke mode, not a new harness

The loop runs as one bounded smoke plan registered in the existing decoder map
(`desktop/desktop-smoke-configuration.js:48-60`), encoded on the command line
under the existing 4 KiB plan ceiling
(`scripts/lib/desktop-scape-open-smoke.mjs:132-145`), executed by the packaged
application, and asserted from its single emitted evidence line as the
Scape-open smoke already is (`scripts/desktop-smoke.mjs:54-60`). The Lightscaper
bridge expectation extends the base list as the Framescaper superset does
(`scripts/lib/desktop-smoke.mjs:101-104`), never a second table.

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| Keep the binary product ternaries and add a third literal per site | Six sites already fail open onto Soundscaper (`desktop/constants.js:3` and siblings); a third literal preserves the failure mode that produces a mislabeled package. |
| Add Lightscaper to `MILESTONE_5_PACKAGE_CELLS` | The matrix is milestone 5's readiness authority (`scripts/lib/milestone-5-handoff-matrix.mjs:63-65`); a Lightscaper blocker must never move a milestone-5 verdict. |
| Leave Lightscaper out of `DESKTOP_PACKAGED_PRODUCT_IDS` and ship it separately | `validateDesktopReleasePackageInventory` refuses any package it does not expect (`scripts/desktop-release-assets.mjs:124-135`); a second release path would be a second inventory authority. |
| A per-file capability per photo | The per-owner ceiling is 128 read capabilities (`desktop/constants.js:40`); a library of six-figure photo counts cannot be represented, and rename detection needs the directory. |
| A Lightscaper-only watcher tuned for stills | `native-watch-reconciliation.ts:3-34` already solves stability, duplicate suppression, rename, and overflow; a second watcher would drift on exactly those cases. |
| Fork the durable-root repository into a Lightscaper-named module | Forking a Framescaper module is a placement defect under the standing rules; the grant, lease, and revocation semantics would diverge silently. |
| Treat a disconnected volume as a UI banner and render from derivatives anyway | Preview and export must be the same render; a full-resolution export silently taken from a preview derivative is an unreported conversion. |
| Block L8 on a built native raw payload | The Framescaper hosts prove the fail-closed empty-manifest shape works (`config/framescaper-media-host-payload-manifest.json:10-11`); a built payload is an L9 external row. |
| Defer the nightly-with-tests rows until a Lightscaper browser spec needs a packaged runtime | The roadmap names release *and* nightly matrix rows in one Planned bullet (roadmap-lightscaper.md:463-466) and a plan may not descope a Planned deliverable; the rows ride the five nightly cells that already exist rather than adding any. |

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| L8.0 | Serialized (one work stream) | Desktop product admission: the shared refusing lookup, the six open ternaries, the two fail-closed arms, the project-library product union |
| L8.1 | Serialized (one work stream) | Packaged Lightscaper identity, entitlements, associations, icons, release inventory, and the CI matrix rows |
| L8A | Parallel track | Add-in-place libraries: root grants, watched-folder rename/move relink, disconnected-volume refusal |
| L8B | Parallel track (file-disjoint) | L7 native raw and preview service packaging, audit, and native-off completeness |
| L8C | Serialized (one work stream) | The packaged end-to-end loop smoke and the capability/evidence record |

L8A and L8B open only once every L8.1 acceptance passes — both are proved by
packaged smoke runs L8.1 makes possible — and L8C closes after both.

## Work packets

Every L8 packet is decomposed here against the five fields; no slice doc is owed
at pickup, and any packet that later grows one names its filename here first.

### WP-L8.0 — Desktop product admission

- **Outcome:** one shared desktop product-admission helper resolving a product
  id from `SCAPE_PRODUCT` or `desktop/product.json` and throwing on an unknown
  id, consumed by `desktop/constants.js:3-10`,
  `electron-builder.config.cjs:1-2`, `scripts/desktop-prepare.mjs:74-76`,
  `scripts/desktop-smoke.mjs:19-24`, `scripts/desktop-release-assets.mjs:143`,
  `scripts/desktop-nightly-tests-products.mjs:50`, and
  `scripts/lib/desktop-scape-open-smoke.mjs:169`; the two refusing sites
  (`desktop/protocol.js:80-85`, `scripts/desktop-after-pack.mjs:272-277`)
  admitting the third product through it; three products in
  `desktop/project-library-contract.ts:14`, `DesktopLibraryProduct` (`:36`)
  unchanged.
- **Invariants:** an unknown product id never resolves to a known product; the
  Soundscaper-only `aup3`/`aup4` associations
  (`electron-builder.config.cjs:61-67`) and the Framescaper-only main-process
  authorities (`desktop/main.mjs:216-217`) stay bound to their own products.
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/desktop-product-admission.test.js`, proving every listed site throws on
  `SCAPE_PRODUCT=notaproduct` and resolves all three known ids, keeping
  `tests/desktop-release-package-inventory.test.js` and
  `tests/production-capability-inventory.test.js` green; `npm run check:static`
  passes.
- **Non-goals:** no package is built; no CI matrix row; no bridge change.
- **Stop condition:** stop if any site cannot refuse an unknown product without
  changing Soundscaper or Framescaper behavior; the difference is reported
  before the ternary is touched.

### WP-L8.1 — Packaged Lightscaper identity and the desktop CI rows

- **Outcome:** `org.lightscaper.desktop`, the `lightscaper-app` scheme, its
  session partition and update tag prefix (`desktop/constants.js:5-10`); a
  Lightscaper entitlements plist with neither camera nor microphone, unlike
  `desktop/framescaper-entitlements.mac.plist`; a `.liscape`-plus-legacy-`.scape`
  association matching the pattern the two shipping products already use in
  `electron-builder.config.cjs` — Lightscaper is the first build to claim
  `.liscape` — a macOS category, and a Linux executable name, category, and
  synopsis (`electron-builder.config.cjs:82-115`); an icon source beside
  `public/logo/framescaper-icon.svg`; `lightscaper` in
  `DESKTOP_PACKAGED_PRODUCT_IDS` (`scripts/lib/desktop-packaged-products.mjs`,
  landed by L1) with both product-name ternaries
  (`scripts/desktop-release-assets.mjs:111-119`, `:143`) replaced by registry
  lookups and the stale manifest-count message (`:55`) corrected; L1's desktop
  two-product fence test retired in the same commit that adds `lightscaper` to
  `DESKTOP_PACKAGED_PRODUCT_IDS`, replaced by an assertion that the packaged set
  equals `PRODUCT_IDS`; a third packaging-matrix row
  (`.github/workflows/desktop-preview.yml:336`); the nightly matrix rows the
  roadmap names beside the release rows — the third product in the packager's
  loop (`scripts/desktop-nightly-tests-products.mjs:27`) and a
  `packaged-lightscaper` project beside the two declared
  (`playwright.nightly-packaged-metrics.config.mjs:39-50`); the milestone-5
  aggregation download narrowed to its two products
  (`.github/workflows/desktop-preview.yml:549-553`); the literal sandbox counts
  (`:679-682`, `:800-803`) derived from the product list each step builds.
- **Invariants:** the milestone-5 package cells stay ten
  (`scripts/lib/milestone-5-handoff-matrix.mjs:41-43`); every existing
  Soundscaper and Framescaper package name is byte-identical; Lightscaper claims
  no capture entitlement or usage description.
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/desktop-release-package-inventory.test.js` extended to twenty-seven
  packages and fifteen runtime manifests, with a case proving a Lightscaper
  package is rejected while `DESKTOP_PACKAGED_PRODUCT_IDS` omits it;
  `npm test -- --shard=framescaper` runs
  `tests/milestone-5-handoff-matrix.test.js`, shelved there by its
  `native/framescaper-*` references, proving the matrix still assembles from ten
  cells with Lightscaper artifacts in the run; the nightly matrix stays at its
  five target cells (`.github/workflows/desktop-preview.yml:600-620`) with three
  packaged runtimes inside each and a Linux sandbox count of three; the
  `package` job — which runs on tag push, schedule, and nightly dispatch
  (`:327-330`), not on ordinary pushes — produces and smokes the Lightscaper
  cell on all five targets (`:435-439`).
- **Non-goals:** no signing, notarization, or hardened-runtime activation
  (`electron-builder.config.cjs:9-10` stays identity-gated); no new
  nightly-with-tests target cell; the third product rides the five that exist.
- **Stop condition:** stop if the third product cannot be added without changing
  a Soundscaper or Framescaper artifact name or the cell count.

### WP-L8A.0 — Capability-scoped add-in-place library roots

- **Outcome:** the durable-root grant, watch, and lease repositories generalized
  in place out of Framescaper-only naming into product-neutral modules both
  products register; a Lightscaper library-root selection, revalidation, and
  revocation path over the validated-IPC discipline the existing root channels
  use (`desktop/preload.mjs:183`); reads inside a granted root issued as bounded
  read capabilities under the existing ceilings (`desktop/constants.js:40-41`);
  Lightscaper sidecar writes inside a granted root landing through the atomic
  save-target path (`desktop/save-targets.js:2, 19-38`).
- **Invariants:** no read or write resolves outside an active grant root
  (`desktop/native-services-root-repository.ts:139-150`); revoking a root
  disables every watch rule bound to it in the same transaction (`:96-126`); a
  symlinked or non-directory root is refused (`:128-137`); a granted root is
  read-only for original bytes; derivative previews stay in the managed library
  store L3 owns (`videoDerivatives`) and no derivative byte is written into a
  granted root.
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/desktop-library-root-scope.test.ts`, proving path traversal, symlink,
  sibling-directory, and post-revocation reads and writes all refuse, and
  `tests/desktop-library-root-revocation.test.ts`, proving revocation reaches a
  defined recoverable state with watch rules disabled and the catalog intact;
  `npm test -- --shard=framescaper` keeps the Framescaper root suites green.
- **Non-goals:** no widening of the locator kind union
  (`desktop/linked-original-locator-validation.ts:5-16`); no moving or renaming
  of the user's files from catalog operations.
- **Stop condition:** stop if the generalization cannot keep both products'
  existing root tests green in the same change — the fork is not the fallback.

### WP-L8A.1 — Watched-folder rename, move, and relink assistance

- **Outcome:** Lightscaper library roots reconciled by the shared sweep
  (`src/common/editor/native-watch-reconciliation.ts:42-56`) under a photo
  admission rule over L3's accepted extensions; a rename inside a granted root
  relinking by canonical identity; a move between granted roots relinking by
  content fingerprint; a move out of every granted root marking the photo
  missing and offering L3's relink; a deletion recorded as missing.
- **Invariants:** identity and fingerprint are both required before a candidate
  is treated as the same photo (`:3-34`); a partially written file is never
  imported or relinked (`:42-46`); the sweep and candidate ceilings are never
  raised for a large library
  (`desktop/native-services-watch-repository.ts:24-26`).
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/desktop-library-watch-relink.test.ts`, which drives rename-in-place,
  move-between-roots, move-out-of-scope, replace-in-place, and delete against a
  synthetic root and asserts each decision, and
  `tests/desktop-library-watch-bounds.test.ts`, which proves a root holding more
  entries than the sweep ceiling refuses new candidates instead of growing
  unbounded state.
- **Non-goals:** no filesystem mutation from catalog folder operations; no
  ML-assisted matching; no content search outside granted roots.
- **Stop condition:** stop if any relink decision requires re-digesting a
  full-resolution original on every sweep; the fingerprint is recorded at import
  (`src/common/editor/controller/video-proxy-original-observer.ts:23-29`).

### WP-L8A.2 — Disconnected volumes: derivative develop, refused full render

- **Outcome:** a shared render-admission check that consumes a photo's
  original-availability state, admits derivative-resolution evaluation, and
  refuses full-resolution evaluation and every export with a stated cause naming
  the unavailable volume; that state driven by the grant revalidation result
  (`desktop/native-services-root-repository.ts:128-137`); a menu-reached relink
  entry clearing the refusal once the volume returns.
- **Invariants:** preview and export take the same decision from the same check
  — no path renders full resolution from a derivative; a refusal is visible and
  attributed, never a silent substitution; reconnecting restores full-resolution
  rendering without re-importing.
- **Acceptance:** `npm test -- --shard=common` runs
  `tests/photo-render-availability-admission.test.ts`, proving the
  derivative-admitted and full-refused split for both products' render entry
  points, and `tests/photo-export-availability-refusal.test.ts`, proving an
  export of an unavailable original refuses rather than producing a file;
  WP-L8C.0's packaged smoke drives the same states by invalidating and restoring
  a directory's recorded identity.
- **Non-goals:** no automatic re-import from a substitute volume; no best-effort
  upscaling of a derivative to stand in for the original.
- **Stop condition:** stop if the refusal cannot be expressed once for both
  paths — two checks are the defect this packet prevents.

### WP-L8B.0 — L7 native raw and preview services packaged fail-closed

- **Outcome:** `config/lightscaper-raw-host-payload-manifest.json` on the
  Framescaper manifest shape
  (`config/framescaper-media-host-payload-manifest.json:1-11`), its five
  declared targets (`scripts/desktop-prepare.mjs:78-80`) each `pending-external`
  and blocker-reasoned, verified before the build tree is destroyed and staged
  from the verified bytes as `:98-104` and `:348-361` already do;
  `scripts/audit-lightscaper-raw-host.mjs` and an `audit:lightscaper-raw-host`
  script wired into `audit:ci` (package.json:139); a packaged path falling back
  to L7's Web Core decode path — the first-party container read, embedded
  preview, and neutral baseline while the LibRaw row is `blocked`, and the WASM
  decoder when that row clears; the licensing matrix row,
  `THIRD_PARTY_LICENSES.md` section, and `LICENSES/` text for any new runtime
  asset in the same change.
- **Invariants:** an absent or digest-mismatched payload refuses at staging and
  never ships; the packaged product with every native service disabled is a
  complete Web Core product; no native payload byte enters the asar — only its
  authenticated pins (`scripts/desktop-prepare.mjs:59-61`).
- **Acceptance:** `npm run audit:lightscaper-raw-host` reports five
  pending-external targets and zero built payloads; `npm run audit:ci` passes
  with the new audit in the chain; `npm test -- --shard=lightscaper` runs
  `tests/lightscaper-raw-host-payload-manifest.test.js`, proving a tampered
  digest and a missing target both refuse, and
  `tests/lightscaper-raw-host-native-off.test.js`, proving that with every
  native service disabled the resolved capability set equals the Web Core set
  and no develop or export operation becomes unreachable; WP-L8C.0's packaged
  smoke asserts the same set from the packaged application's evidence line.
- **Non-goals:** no native payload built, signed, or measured; no camera-profile
  or lens-profile data.
- **Stop condition:** stop if any Lightscaper develop or export capability
  becomes reachable only through the native path — the Web Core fallback is the
  product and the native tier is an accelerator.

### WP-L8C.0 — The packaged end-to-end loop smoke and its evidence

- **Outcome:** one Lightscaper smoke mode registered in
  `desktop/desktop-smoke-configuration.js:48-60` with a bounded encoded plan
  driving install-fresh-profile, open, import-in-place from a granted root —
  whose grant is established by the encoded smoke plan seeding the durable-root
  repository directly (`desktop/native-services-root-repository.ts:15-22`)
  against a temporary directory in the isolated profile, never through the
  native directory picker; the picker path is exercised by WP-L8A.0's
  IPC-validation tests and its interactive behavior is an L9 row — disconnect
  and relink, develop, export, and reopen inside the packaged application,
  asserted from one emitted evidence line (`scripts/desktop-smoke.mjs:54-60`); a
  Lightscaper expected-bridge list extending the base
  (`scripts/lib/desktop-smoke.mjs:101-104`); the workflow step running it on
  linux/x64 beside the Scape-open smoke, which is gated to that one target today
  (`.github/workflows/desktop-preview.yml:465-470`), with the remaining four
  declared targets (`scripts/desktop-prepare.mjs:78-80`) handed to L9 as a named
  row under the roadmap's automated-part rule (roadmap-lightscaper.md:42-48);
  the Lightscaper `electron-enhanced` and `electron-only` blocks in
  `config/production-capabilities.json` with evidence paths that exist and the
  grounding date bumped in the file and in
  `tests/production-capability-inventory.test.js:23`.
- **Invariants:** the plan stays inside the 4 KiB command-line ceiling
  (`scripts/lib/desktop-scape-open-smoke.mjs:132-145`); the smoke runs in an
  isolated profile removed afterwards (`scripts/desktop-smoke.mjs:39-52`).
- **Acceptance:** `npm run desktop:smoke:lightscaper-library` passes against a
  packaged Lightscaper build in the nightly/tag `package` job on linux/x64
  beside the Scape-open smoke (`.github/workflows/desktop-preview.yml:465-470`);
  `npm run check` proves the plan encode/decode and evidence assertions on every
  commit without a packaged build, and `npm test -- --shard=lightscaper` runs
  `tests/desktop-lightscaper-library-smoke.test.js`, which pins them directly;
  `npm test -- --shard=common` keeps
  `tests/production-capability-inventory.test.js` green.
- **Non-goals:** no human verification, no real removable volume, no signed
  installer run, and no native file-dialog interaction of any kind in the smoke
  — the disconnect is driven by invalidating the grant's recorded directory
  identity.
- **Stop condition:** stop if a loop stage cannot be asserted from the packaged
  application's own evidence; a stage needing a human becomes an L9 row.

## Quality-budget and evidence duties

- L8 registers no new timing threshold in `config/quality-budgets.json`: the
  exit gate is correctness and scope containment, the large-library import,
  scroll, filter, and search budgets belong to L3's pinned fixture, and a
  packaged sweep-latency threshold recorded here would qualify only on
  `owner-qualified-windows-x64-rtx3090-01` or `native-os-lab-matrix`, both
  `unprovisioned`.
- L8 owes bounded evidence artifacts on the existing pattern: the per-cell
  runtime manifest already retained
  (`.github/workflows/desktop-preview.yml:472-475`) and one bounded Lightscaper
  library-smoke result uploaded the way the timing probe is (`:449-456`), so a
  packaged run's decisions outlive the job log. Boundedness is proven by test:
  the sweep, candidate, and read-capability ceilings assert in WP-L8A.1's bounds
  test, not under load.
- The capability inventory is the durable record: every Lightscaper desktop
  capability lands in `config/production-capabilities.json` with evidence paths
  that exist (`tests/production-capability-inventory.test.js:35-38`), and an
  unbuilt native payload is stated `partial` with its pending-external manifest
  as evidence, never `available`. Any new third-party input from WP-L8B.0
  carries a `config/production-licensing-matrix.json` row, a
  `THIRD_PARTY_LICENSES.md` section at the exact locked version, `LICENSES/`
  text, and a `build:*`/`audit:*` pair in `audit:ci` (package.json:139) in the
  same change.

## Coordination rules

- L8.0 and L8.1 are one serialized work stream; L8A and L8B run file-disjoint —
  grant, watch, and render-admission modules to L8A, the payload manifest, audit
  script, and staging to L8B.
- **Spine files, one owner per edit, rebase before push:**
  `desktop/constants.js`, `desktop/main.mjs`, `desktop/preload.mjs`,
  `desktop/protocol.js`, `desktop/project-library-contract.ts`,
  `desktop/desktop-smoke-configuration.js`, `electron-builder.config.cjs`,
  `scripts/desktop-prepare.mjs`, `scripts/desktop-after-pack.mjs`,
  `scripts/desktop-release-assets.mjs`, `scripts/lib/desktop-smoke.mjs`,
  `scripts/lib/desktop-packaged-products.mjs`,
  `scripts/lib/milestone-5-handoff-matrix.mjs`,
  `scripts/desktop-nightly-tests-products.mjs`, `package.json`,
  `playwright.nightly-packaged-metrics.config.mjs`,
  `.github/workflows/desktop-preview.yml`,
  `config/production-capabilities.json`,
  `config/production-licensing-matrix.json`,
  `config/maintainability-allowlist.json`.
- The IPC channel table is edited once per packet: `desktop/constants.js:64-213`
  and the preload mirror (`desktop/preload.mjs:5-68`) stay identical, and the
  packaged smoke bridge list (`scripts/lib/desktop-smoke.mjs:8-104`) moves in
  the same commit or the smoke fails on every target at once.
- WP-L8A.0's durable-root and watch generalization renames symbols across the
  Framescaper native-services registration; it lands as one change with both
  products' suites green, and no other packet edits those modules meanwhile.
- Desktop library schema revisions stay serialized product-wide: at most one in
  flight, and `DESKTOP_LIBRARY_SCHEMA_VERSION` /
  `DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION`
  (`desktop/project-library-contract.ts:5-6`) move in one commit with their
  migration and tests. Shared fate on repo gates: `npm run check` stays green on
  every push, and the packaged matrix rows are added and smoked in the same
  change that adds the product to `DESKTOP_PACKAGED_PRODUCT_IDS`, never before.
- A test's shard follows its basename as well as its imports
  (`scripts/lib/node-test-shards.mjs:44-47`), so filename and acceptance command
  are chosen together: a `lightscaper-` prefixed file is invisible to
  `--shard=common`.

## Known constraints this plan absorbs

- **Six ternaries fail open, two fail closed.** WP-L8.0 repairs both classes
  before anything is packaged (`desktop/constants.js:3`,
  `electron-builder.config.cjs:1-2`).
- **A third product multiplies the packaging matrix.**
  `.github/workflows/desktop-preview.yml:336` goes from ten packaging jobs to
  fifteen at sixty minutes each and the lease matrix builds one more unpacked
  product per runner (`:776-788`) — accepted cost, not a reason to trim targets.
- **L7 dependency:** the native raw and preview payloads do not exist and are
  not expected to. Every WP-L8B.0 acceptance is satisfied by the empty, audited
  manifest and the Web Core fallback, as the Framescaper hosts satisfy theirs
  today (`config/framescaper-media-host-payload-manifest.json:10-11`).
- **L3 dependency:** derivative previews, the relink path, and the accepted
  photo extension set are L3's; L8 consumes and defines none of them. Started
  before L3's derivative tiers land, WP-L8A.2 waits rather than inventing a
  derivative model.
- **The 600-line ceiling bites here.** `desktop/main.mjs` sits exactly on it and
  `desktop/preload.mjs` sits on a 756-line allowlist ratchet recorded because a
  sandbox preload cannot be split across files
  (`config/maintainability-allowlist.json:7`,
  `scripts/check-file-size.mjs:7-10`); both are spine files this milestone
  edits, so new desktop code lands in new modules and a Lightscaper library
  bridge forces a deliberate ratchet raise, not an extraction.
- **Signing stays off.** `electron-builder.config.cjs:9-10` keeps macOS
  ad-hoc-signed with the hardened runtime off while no identity is supplied, and
  CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false`
  (`.github/workflows/desktop-preview.yml:401-402`).

## Watch items (not gates yet)

- The nightly-with-tests cell packages a third runtime inside the same
  hundred-and-fifty-minute budget (`.github/workflows/desktop-preview.yml:596`),
  and `packaged-lightscaper` carries the shared packaged smoke until L3 and L5
  land Lightscaper specs. Runner budget, not scope, surfaces here: fifteen
  packaging cells at sixty minutes beside five nightly cells at a hundred and
  fifty.
- Directory-identity probing on network volumes and Windows removable media
  decides how reliably WP-L8A.2's disconnect state is entered; the simulated
  disconnect is honest evidence, and real-volume behavior is an L9 row.

## Non-goals and fences

- No tethered capture, camera control, or capture permission: the Lightscaper
  entitlements plist carries no camera or microphone key and the packaged
  capture policy denies by default (`desktop/protocol.js:163-167`).
- No destructive raster editing and no filesystem mutation of the user's
  originals from catalog folder operations — a granted root is read-only for
  original bytes. No ML-dependent capability: relink matching is identity plus
  content fingerprint (`src/common/editor/native-watch-reconciliation.ts:3-34`),
  never a learned matcher.
- No patent-encumbered codec enters the packaged product ahead of its licensing
  and patent review; the codec-policy audit already refuses forbidden FFmpeg
  content at pack time (`scripts/desktop-after-pack.mjs:66-74`).
- No second packaging, release, or smoke stack, and no signing identity,
  notarization credential, real volume, real camera, or human judgment in any L8
  acceptance.
- Every new surface is menu-reached and off by default (AGENTS.md:8-11).
