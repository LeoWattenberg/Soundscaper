# Lightscaper milestone L9 plan: final qualification

> **Historical document (2026-08-31):** the qualification campaign, signed
> readiness, fixed lab, certificate, notarization, and admission mechanisms
> below are not current repository policy. A future Lightscaper release follows
> the owner-run [release policy](release-policy.md), ordinary CI, and optional
> product QA.

> Owning source for L9 sequencing, the qualification-campaign decisions,
> their invariants, and the bounded work packets. The
> [Lightscaper roadmap](../roadmap-lightscaper.md#l9-final-qualification)
> owns scope and status; the [release policy](release-policy.md), the
> [quality budgets](quality-budgets.md), the
> [licensing policy](production-licensing-policy.md), and the compatibility
> register own their claims. Grounded against the repository on 2026-08-25 at
> commit `3d1e908c` with file:line verification. L9 depends on every earlier
> Lightscaper plan closed — [L1](lightscaper-1-plan.md) through
> [L8](lightscaper-8-plan.md) — and consumes the main roadmap's milestone-9
> campaign machinery rather than duplicating it; this plan is written ahead of
> those closures so the one-way decisions and today's verified evidence gaps
> are recorded once. Re-ground every citation at pickup — earlier milestones
> will have moved the tree.

## Goals and ordering principle

1. **Primary: every deferred row becomes a recorded verdict.** L9 is the sole
   owner of Lightscaper's human, real-device, real-camera, real-GPU,
   wide-gamut-display, assistive-technology, real-library-scale, packaged
   signing, and external-licensing evidence. The roadmap routes every such row
   here by construction: an L1–L8 gate needing human judgment is a scope error,
   the automated part closes in its own milestone, and the remainder is named
   as an L9 row (`roadmap-lightscaper.md:42-49`). L9 turns each named row into
   an accepted result, a recorded failure, or a user-approved scope reduction —
   never into silence. The evidence rules stand unweakened: one attempt and
   zero retries (`docs/quality-budgets.md:130-132, 153-156`;
   `config/quality-budgets.json:79-80`), exact environment identity with
   software-renderer refusal (`docs/quality-budgets.md:127-129, 143, 199-206`),
   and the fail-closed release decision — zero open critical or high defects,
   unknown defects triaged as high, missing or stale evidence blocking the
   affected tier (`docs/release-policy.md:11-16`;
   `config/release-severity-policy.json:30-40`).
2. **Secondary: engineering exists only to make evidence collectable.** L9
   produces no new product capability, schema revision, capability flip, or
   user-visible surface; its code is fixtures, generators, collectors, run
   profiles, provisioning scripts, environment descriptors, evidence registers,
   and audit commands. A defect found during qualification is fixed under the
   release-severity rules (`docs/release-policy.md:24-29`) by the milestone
   owning the defective code, never absorbed here.

Work is ordered by decision irreversibility. Three one-way doors shape every
evidence row and land first, once, under user review: the first-release schema
baseline the retained-migration promise starts from, the supported-matrix
truth-up fixing which browsers and desktop targets Lightscaper claims, and the
signing identity. The evidence register and the zero-retry run profiles land
second, because every track publishes into them; the tracks then run per
environment in parallel, and closure is serialized behind one release record.

## What already exists (do not re-plan)

- **The release decision is fail-closed and machine-readable.** Severity levels
  with per-level waiver disposition
  (`config/release-severity-policy.json:4-28`); the release gate —
  `maximumOpen.critical` 0, `maximumOpen.high` 0, `unknownClassification:
  "block-as-high"`, `missingRequiredBudget: "block"` (`:30-40`);
  `inaccessible-critical-workflow` and `license-or-provenance-failure` both
  `waiver: "prohibited"` (`:89-97`, `:111-119`); a medium-only waiver policy
  capped at 30 days (`:123-141`); six requalification triggers (`:143-150`). The
  prose owner states the same consequences
  (`docs/release-policy.md:38-45, 47-54, 56-63, 75-78`).
- **The five-point qualification bar is binding.** A workload enters
  `qualification.qualifiedWorkloadIds` only with a digest-pinned fixture or
  generator, a provisioned exact environment descriptor, an automated collector
  emitting every required finite metric, a verdict from
  `scripts/quality-budget-evaluator.mjs`, and retained raw evidence from a
  no-retry run (`docs/quality-budgets.md:92-99`); a passing test, a checked-in
  proposed threshold, and a fast hosted-runner number are each explicitly
  insufficient (`:101-103`).
- **The evidence contract is machine-audited inside the canonical gate.**
  `config/quality-budgets.json:71-83` names the evaluator, file verifier,
  evidence writer, and cohort auditor with `attemptCount` 1, `retryCount` 0,
  exact-config budget digest, exact-descriptor environment fingerprint, and
  positive byte-length plus SHA-256 raw evidence; `npm run
  audit:quality-results` (`package.json:133`) runs inside `audit:ci` (`:139`),
  `check:static` (`:140`), and `check` (`:141`).
- **The per-milestone evidence register is a pattern to copy.**
  `config/milestone-6-qualification-evidence.json:1-12` holds schema version,
  workload id, evidence root, `status: "pending-external"`, a `blockedBy`
  sentence, null source revision and budget digest, and one measurement row per
  profile with path, byte length, and SHA-256; its auditor pins the evidence
  path, root, and profile-id set
  (`scripts/lib/milestone-6-qualification-evidence.mjs:35-42`) and its
  collection contract (`:80`), exposed as `npm run
  audit:milestone-6-qualification` and `npm run milestone6:handoff-matrix`
  (`package.json:128-129`).
- **Provisioned third-party conformance tooling is a pattern to copy.**
  `config/interchange-conformance-tools.json` pins versions,
  `scripts/provision-interchange-conformance.mjs` digest-verifies what it
  fetches into the uncommitted `vendor/interchange-conformance/`, and two npm
  scripts drive them (`package.json:53-54`); conformance-time tools are neither
  bundled nor linked, so no obligation flows into the AGPL-3.0-only
  distribution (`docs/interchange-conformance.md:22-34, 36-40`).
- **Release-artifact discipline exists, two products wide.** The assembler
  validates runtime manifests, stages corresponding source, and writes
  `SHA256SUMS` over every release file
  (`scripts/desktop-release-assets.mjs:48-97`) against an exact per-product,
  per-target package inventory (`:19-46`, `:100-110`); notices are verified
  against the lockfile by `check:notices` (`package.json:139`).
- **The CI matrices L9 qualifies against already run:** Node shards
  `common|framescaper|soundscaper` (`.github/workflows/quality.yml:77-78`),
  browser projects `chromium|webkit` in the pinned container (`:180-181`) with
  Firefox on a host runner, and two products across five packaged desktop
  targets (`.github/workflows/desktop-preview.yml:336-355`).

## Verified gaps this campaign must close (grounded 2026-08-25)

1. **No Lightscaper environment descriptor exists, and one descriptor in the
   whole tree is qualification-eligible.** Of the seven environments
   (`config/quality-budgets.json:340-517`), only
   `portable-node-structural-26.5.0` carries `qualificationEligible: true`
   (`:360`); the fixed-GPU owner host is `unprovisioned` with null
   `gpuDriverVersion`, `powerMode`, and `displayMode` (`:378-401`, `:388-393`),
   the native OS lab matrix has five null `physicalHosts` (`:419-425`), and the
   release matrix has three null fingerprint fields and one evidence path,
   `roadmap.md#9-final-convergence-and-qualification` (`:506-517`).
2. **No raw decode path exists to qualify.** `libraw`, `demosaic`, and `bayer`
   appear nowhere under `src/`, `config/`, or `docs/`. The L9 camera corpus has
   no consumer until L7's decoder lands, and L7's own exit gate already names
   camera-model breadth as an L9 row (`roadmap-lightscaper.md:453-454`).
3. **No wide-gamut render path exists to review on a wide-gamut display.** The
   color vocabulary declares `display-p3` and `bt2020`
   (`src/common/editor/video-color-management-v27.ts:30`), the managed SDR
   interpretation narrows to sRGB/BT.709 (`:74-79`), and admission throws on
   anything else (`:404-407`); native still-sequence admission refuses
   wide-gamut primaries by the same fail-closed rule
   (`src/common/editor/native-media-image-sequence-rgba8-admission.ts:16,
   46-48`).
4. **No checked-in run profile satisfies the no-retry rule.** Both Playwright
   configs retry once (`playwright.config.mjs:14` under CI;
   `playwright.nightly-tests.config.mjs:63`), while the measurement procedure
   requires retries disabled and one worker
   (`docs/quality-budgets.md:130-132`).
5. **Accessibility evidence is far below the release bar.**
   `assertNoSeriousAxeViolations`
   (`tests/browser/audio-editor-test-helpers.js:399-412`) is used by 18 of the
   86 files matching `tests/browser/*.spec.js`; there is no WCAG-tagged sweep
   and no zoom/reflow, forced-colors, or screen-reader evidence, and
   `COMMITTED_LOCALE_TAGS` holds 17 tags with `ar` the only committed
   right-to-left locale (`src/common/i18n/locales.js:82-100`). An inaccessible
   critical workflow is critical and unwaivable
   (`docs/release-policy.md:38-45`;
   `config/release-severity-policy.json:89-97`).
6. **Machine-readable citations into the Lightscaper roadmap are unverified.**
   `tests/roadmap-guidance.test.js:7` reads only `roadmap.md`, and its anchor
   check matches only `roadmap.md#<anchor>` (`:57-58`); the Lightscaper roadmap
   requires that verification be extended in the same change that adds the
   first machine-readable citation (`roadmap-lightscaper.md:570-573`).
7. **The retained-migration promise is still empty.**
   `config/project-compatibility.json:4-8` holds current schema 17, minimum
   readable 17, and `retainedMigrationSources: []`; the per-product revision
   contract shape exists for Framescaper only (`:9-38`).
8. **Signing, notarization, upgrade, and uninstall evidence are absent by
   design, and the assembler is two products wide.** macOS stays ad-hoc-signed
   while no identity is acquired (`electron-builder.config.cjs:3-6`),
   `identity`, `hardenedRuntime`, and `notarize` are gated on that acquisition
   (`:84-89`), `publish` is null (`:122`), NSIS preserves application data on
   uninstall (`:80`), and the update path is a 24-hour GitHub releases poll
   (`desktop/update-check.js:1-2`). `RELEASE_PRODUCTS`
   (`scripts/desktop-release-assets.mjs:19`) and the derived
   `EXPECTED_RUNTIME_MANIFESTS` (`:43-46`) admit two products only, and the
   inventory validator rejects any other product id (`:100-110`); nine package
   rows per product across five targets (`:23-42`) become 27 packages and 15
   runtime manifests once Lightscaper is claimed.
9. **No Lightscaper workload, fixture, or milestone tag exists.** The only
   milestone-9 rows are `m9-complete-system-soak-8h-v1`
   (`config/quality-budgets.json:1325-1336`) and `m9-complete-system-soak` over
   `release-qualification-matrix` (`:1725-1745`), plus the `"9"` tag on
   `video-preview-12fx-720p-v1` (`:521-522`) — all three owned by the two
   existing products.

## Decisions

### The first-release baseline is per schema family, and Lightscaper's is its own

The compatibility register carries one `projectSchema` baseline
(`config/project-compatibility.json:4-8`) plus a per-product revision contract
for Framescaper (`:9-38`). Lightscaper's catalog and develop families follow
the second shape: the register gains a Lightscaper revision contract whose
retained-migration baseline freezes at the release that first ships
Lightscaper, which is the other two products' release only if Lightscaper ships
in the first shipped release at all. Before that freeze, pre-release clean
breaks of `PhotoCatalogV1`, `DevelopStackV1`, `RenderSampleProfileV1`,
`PhotoMetadataReadV1`, and `PhotoSidecarV1` stay legal; after it they are
forbidden, and every catalog written by a shipped build reopens in every later
build through a retained migration. It lands in WP-L9.0 before any evidence
run, because a later freeze invalidates every migration row collected before it
(`docs/release-policy.md:75-78`;
`config/release-severity-policy.json:143-150`).

### The supported matrix is trued up before any evidence row is scoped

Lightscaper's claimed matrix is decided at campaign start, in one bounded
roadmap edit under user approval, and every evidence packet scopes to the
approved result. Three questions close there rather than implicitly: whether
storage-dependent web qualification claims Safari at all, given that the pinned
Playwright WebKit build exposes no OPFS, no MediaRecorder, and no IndexedDB
Blob storage (`roadmap.md:270-274`) and that L3 and L4 already defer WebKit on
that ground (`roadmap-lightscaper.md:287-290, 335-337`); which of the five
desktop targets Lightscaper claims, given that adding it to `RELEASE_PRODUCTS`
takes the release inventory to 27 packages; and whether the wide-gamut display
row is a claim or a recorded limitation if L7 ships Display-P3 output on fewer
platforms than the matrix names (`roadmap-lightscaper.md:435-436`).

### One signing identity, three products

Signing and notarization identity is acquired once for the publisher, not once
per product; Lightscaper reuses the identity the main roadmap's milestone 9
requalifies, with its own application id, notarization submission, and
signature-verification row per target. If no identity exists at campaign start,
that is a named external blocker on WP-L9E.0, the desktop tier is blocked per
the release policy, and no ad-hoc-signed package ships — the current ad-hoc
configuration is a development posture (`electron-builder.config.cjs:3-6,
84-89`), never a release one.

### Reference converters are provisioned tools, and breadth is published as a list

Raw render review compares Lightscaper's neutral camera baseline against
independent converters provisioned exactly like the interchange reference
implementations — pinned versions in a checked-in config, a provisioning script
that digest-verifies what it fetches, an uncommitted `vendor/` root, a
dedicated npm script (`docs/interchange-conformance.md:22-34`;
`package.json:53-54`) — so nothing is bundled, linked, or redistributed and no
obligation flows into the AGPL-3.0-only distribution (`:36-40`). Camera raw
files that are not freely licensed are provisioned the same way and never
committed; the corpus manifest records per-file license, source, and digest.
The result is published as a list, honoring the roadmap's honesty requirement
(`roadmap-lightscaper.md:494-497`): the exact models, sensor layouts, and
firmware revisions that decoded and rendered within tolerance, plus the exact
set that refused and each refusal reason. No aggregate claim — "most cameras",
"all major vendors" — enters the capability inventory, the roadmap, or the
release record.

### Human evidence rides the machine evidence contract

A screen-reader walkthrough, a display measurement, and a signature check are
recorded through the same result contract as a collector run: exact workload
id, ordered fixture ids, environment descriptor id, source revision, budget
digest, renderer class, one attempt, zero retries, and retained raw artifacts
pinned by byte length and SHA-256 (`config/quality-budgets.json:71-83`;
`docs/quality-budgets.md:144-145`). Every human row carries a digest-pinned
task script, an observer identity, and metrics that are counts and measured
deltas — blocked workflows, unannounced state changes, unreachable controls —
never adjectives. A row whose evidence cannot reduce to a finite metric is not
a gate; it becomes a watch item.

### Rejected alternatives (recorded to prevent re-litigation)

| Alternative | Why rejected |
| --- | --- |
| Qualify on hosted CI runners | Hosted CI is explicitly ineligible for fixed-hardware timing because of shared CPU and software-renderer behavior (`docs/quality-budgets.md:76-79`), and a software renderer where hardware is required fails the result outright (`:143`). |
| Substitute Playwright WebKit for Safari on real devices | It is engine evidence only (`docs/quality-budgets.md:28-30`), and the storage APIs the library depends on are absent from that build (`roadmap.md:270-274`). |
| Simulate the six-figure library with a synthetic generator alone | L3 already owns a pinned synthetic large-library fixture on a CI-runnable class (`roadmap-lightscaper.md:278-280`; `lightscaper-3-plan.md`); the L9 row exists because real file sizes, storage pressure, and decode cost are what it removes. |
| Weaken a threshold to close a row | A threshold change requires old and new values, affected fixture and environment, raw before/after measurements, reason, and reviewing commit, and thresholds are never loosened to make a regression pass (`docs/quality-budgets.md:719-726`). |
| Ship Lightscaper desktop ad-hoc-signed to unblock the matrix | A missing mandatory provenance or licensing artifact is critical and unwaivable (`docs/release-policy.md:47-54`; `config/release-severity-policy.json:111-119`). |
| Give L9 a diagnostics product surface of its own | The diagnostics report is a main-roadmap milestone-9 deliverable (`docs/milestone-9-plan.md:245-250`); Lightscaper contributes its catalog field list plus the test pinning that surface's allowlist, and builds nothing if it has not shipped at pickup. |
| Retire `pending-external` by relabeling | The milestone-6 register keeps the status with an explicit `blockedBy` sentence (`config/milestone-6-qualification-evidence.json:5-6`); a row moves to accepted only when its pinned artifacts exist. |

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| L9.0 | Serialized (one work stream) | Baseline freeze, supported-matrix truth-up, signing identity, evidence register, qualification profiles, environment descriptors |
| L9A | Parallel track | Real-camera raw corpus and reference-converter review |
| L9B | Parallel track | Real-device browsers, wide-gamut display color, real-GPU render parity |
| L9C | Parallel track | Assistive technology, zoom, contrast, locale, direction |
| L9D | Parallel track | Real-library soak at six-figure scale |
| L9E | Serialized | Packaged desktop, licensing sign-off, convergence, closure |

Track packets carry their phase letter — `WP-L9A.0` through `WP-L9E.0`, one per
track — so an earlier plan deferring a row here names the track that owns it.

## Work packets

Every L9 packet is decomposed here against the five fields (Outcome,
Invariants, Acceptance, Non-goals, Stop condition); no slice doc is owed at
pickup, and a track packet that grows one after re-grounding is named here first
as `lightscaper-9<letter>-<track>.md`.

### WP-L9.0 — Baseline freeze, matrix truth-up, and signing identity

- **Outcome:** the three one-way decisions recorded — a Lightscaper revision
  contract in `config/project-compatibility.json` naming the first-release
  baseline version of each Lightscaper schema family with its
  retained-migration source list; one bounded, user-approved edit to the L9
  roadmap section fixing the claimed browser and desktop matrix, the Safari
  disposition, and the wide-gamut claim; the signing-identity decision with its
  acquisition state. `config/production-capabilities.json` browser and desktop
  target claims reconciled with the approved matrix.
- **Invariants:** no migration is written for any pre-release Lightscaper
  schema version; the typed reimport path keeps covering versions older than
  the baseline; roadmap anchors cited by machine-readable policies keep
  resolving; a claimed platform never exceeds a provisioned environment.
- **Acceptance:** `npm test -- --shard=common` covers the reinstated
  compatibility rule and the new revision contract;
  `tests/production-capability-inventory.test.js` passes with the reconciled
  target sets and every evidence path present on disk (`:196-200`); `npm run
  check:static` green; a Node test proves a catalog saved by a baseline build
  reopens in the next build through a retained migration.
- **Non-goals:** no schema change, capability flip, evidence collection, or
  roadmap edit beyond the approved truth-up.
- **Stop condition:** stop if any pre-release schema version needs a retained
  migration to make evidence pass — a baseline-choice error, not a fixture gap;
  stop if the truth-up would claim a platform whose descriptor is
  unprovisioned.

### WP-L9.1 — Evidence register, qualification profiles, environment descriptors

- **Outcome:** `config/lightscaper-9-qualification-evidence.json` on the
  milestone-6 register shape (schema version, workload ids, evidence root
  `qualification/lightscaper-9`, status, `blockedBy`, source revision, budget
  digest, one measurement row per profile with path, byte length, SHA-256), its
  auditor under `scripts/lib/`, and `npm run audit:lightscaper-9-qualification`
  plus `npm run lightscaper9:handoff-matrix` wired into `audit:ci`; five
  `unprovisioned` environment descriptors in `config/quality-budgets.json` —
  `lightscaper-raw-reference-lab`, `lightscaper-display-color-lab`,
  `lightscaper-gpu-vendor-matrix`, `lightscaper-assistive-technology-lab`,
  `lightscaper-real-library-lab` — each with explicit null fingerprint fields
  and an `eligibleWorkloadIds` list; dedicated one-worker, zero-retry
  Playwright and Node qualification profiles; `tests/roadmap-guidance.test.js`
  anchor verification confirmed to cover `roadmap-lightscaper.md#<anchor>` —
  landed by the first machine-readable citation (L3's quality-budget workload,
  `lightscaper-3-plan.md`) and re-asserted here, not re-implemented.
- **Invariants:** development CI keeps its retry behavior
  (`playwright.config.mjs:14`); hosted-runner timing never enters qualification
  evidence; an unexpected renderer, driver, display, or device is an
  environment failure, never a skip (`docs/quality-budgets.md:127-129`); the
  register never reports accepted for a row whose pinned artifact is absent.
- **Acceptance:** `npm run audit:quality-results` passes with the new
  descriptors; `npm run audit:lightscaper-9-qualification` exits non-zero while
  any claimed row lacks its pinned artifact and prints the blocking set; a
  deliberately mismatched environment fingerprint fails a Node test in the
  `common` shard; `npm test -- --shard=common` covers the register contract and
  re-asserts the `roadmap-lightscaper.md#<anchor>` verification; `npm run
  check:static` green.
- **Non-goals:** no threshold values — WP-L9A.0 through WP-L9E.0 register their
  own; no collection; no hardware procurement.
- **Stop condition:** stop if a required environment cannot be provisioned —
  record the named external blocker in `blockedBy` and scope the dependent
  packet, following the milestone-6 register precedent
  (`config/milestone-6-qualification-evidence.json:5-6`).

### WP-L9A.0 — Real-camera raw corpus and reference-converter review

- **Outcome:** workload `l9-raw-camera-breadth` over fixture
  `l9-raw-camera-corpus-v1` on `lightscaper-raw-reference-lab`: a provisioned,
  digest-manifested corpus spanning vendors, sensor generations, and both Bayer
  and X-Trans layouts, each file carrying license, source, and SHA-256;
  `config/lightscaper-raw-reference-tools.json` and
  `scripts/provision-lightscaper-raw-reference.mjs` on the interchange
  precedent; a collector that decodes each file, renders the neutral camera
  baseline, and compares against the reference converters; a digest-pinned
  side-by-side review script per corpus model against those converters, walked
  on the calibrated `lightscaper-display-color-lab` display and recorded
  against that descriptor with an observer identity, so the roadmap's visual
  half is collected beside its metric half (`roadmap-lightscaper.md:494-497`);
  the published per-model support list with refusal reasons.
- **Invariants:** no corpus file is committed; no reference converter is
  bundled or linked; a model that refuses decode is recorded as refused, never
  dropped from the corpus; an embedded-preview fast path is never scored as a
  full-decode pass.
- **Acceptance:** thresholds `rawBreadth.undecodedCorpusFiles eq 0`,
  `rawBreadth.unreportedFallbacks eq 0`, `rawBreadth.referenceDeltaE2000P95 lte
  3`, `rawBreadth.publishedModelsWithoutEvidence eq 0`, and
  `rawBreadth.visualArtifactFindings eq 0` — banding, false color, maze
  artifacts, and clipped highlights counted per model, pinned with the observer
  identity and the review-script digest — evaluated by
  `scripts/quality-budget-evaluator.mjs` and pinned into the L9 register; `npm
  run provision:lightscaper-raw-reference` followed by the collector reproduces
  the manifest digests; a `common`-shard Node test pins the corpus manifest
  schema and the required license field.
- **Non-goals:** no decoder work — L7 owns the decoder; no camera-profile or
  lens-profile database, both blocked on licensing
  (`roadmap-lightscaper.md:430-434`); no aesthetic preference ranking between
  converters, since findings are counted artifact classes.
- **Stop condition:** stop if closing a row requires a corpus file whose
  license does not permit the lab's use, or if a converter comparison passes
  only by exempting a sensor layout.

### WP-L9B.0 — Real devices, wide-gamut display color, and real-GPU parity

- **Outcome:** three workloads on real hardware.
  `l9-real-device-browser-matrix` over `l9-library-and-develop-walkthrough-v1`
  — current and previous Chromium, Firefox, and Safari on real devices
  (`roadmap-lightscaper.md:498-499`) over import, browse, cull, develop,
  export, and every declared fallback. `l9-wide-gamut-display-color` over
  `l9-color-target-chart-v1` on `lightscaper-display-color-lab` — measured
  comparison on calibrated sRGB and Display-P3 displays including soft proofing
  against the export profile. `l9-gpu-render-parity-breadth` over
  `l9-gpu-parity-stack-v1` on `lightscaper-gpu-vendor-matrix` — the develop
  stack on real AMD, Intel, NVIDIA, and Apple GPUs against the CPU oracle L7
  pinned.
- **Invariants:** no software-renderer row counts
  (`docs/quality-budgets.md:199-206`); preview and export pixels stay identical
  apart from the declared output-only steps (`roadmap-lightscaper.md:72-78`);
  an unreported conversion is a high defect by definition
  (`config/release-severity-policy.json:11-16`); a fallback that engages
  silently fails the row.
- **Acceptance:** thresholds `deviceMatrix.blockedWorkflows eq 0`,
  `deviceMatrix.unreportedFallbacks eq 0`, `displayColor.softProofDivergences
  eq 0`, `displayColor.measuredDeltaE2000P95 lte 2`,
  `displayColor.outOfGamutUnreported eq 0`, `gpuParity.minimumSsim gte 0.98`,
  `gpuParity.maximumChannelMae lte 0.0236`, and `gpuParity.softwareRendererRows
  eq 0` — the SSIM and MAE limits matching the registered keyed-parity contract
  (`docs/quality-budgets.md:219`) — evaluated and pinned into the L9 register
  under the WP-L9.1 zero-retry profiles.
- **Non-goals:** no new render path; no color-management implementation, since
  L7 owns wide-gamut output; no browser-version pinning here — "current and
  previous" is pinned in the release record.
- **Stop condition:** stop if a claimed browser or GPU-vendor row cannot be
  provisioned — record the named blocker and reduce the claim in the roadmap
  under user approval, never approximate it with an engine substitute or a
  software renderer.

### WP-L9C.0 — Assistive technology, zoom, contrast, locale, and direction

- **Outcome:** workload `l9-assistive-technology-review` over
  `l9-culling-and-develop-task-script-v1` on
  `lightscaper-assistive-technology-lab`: the digest-pinned task script walked
  with a screen reader per platform across grid, filmstrip, loupe, compare,
  survey, culling, masks, and develop; at 200% zoom and reflow, forced-colors,
  and reduced-motion; in a left-to-right and the committed right-to-left locale
  (`src/common/i18n/locales.js:82-100`); plus a WCAG-tagged automated sweep
  extending `assertNoSeriousAxeViolations`
  (`tests/browser/audio-editor-test-helpers.js:399-412`) across the Lightscaper
  browser specs.
- **Invariants:** an inaccessible critical workflow is critical and unwaivable
  (`docs/release-policy.md:38-45`;
  `config/release-severity-policy.json:89-97`); keyboard completeness is
  asserted, not observed; the review scopes to the committed locale set, never
  the Audacity superset.
- **Acceptance:** the automated half runs in CI — `npm run test:browser` over
  the Lightscaper specs with the sweep enabled, threshold
  `accessibility.seriousOrCriticalAxeViolations eq 0`; the human half registers
  `accessibility.blockedCriticalWorkflows eq 0`,
  `accessibility.keyboardUnreachableControls eq 0`,
  `accessibility.unannouncedStateChanges eq 0`, and
  `accessibility.reflowClippedControls eq 0`, each pinned with the observer
  identity and the task-script digest.
- **Non-goals:** no new UI, no locale additions, no remediation — a finding
  routes to the milestone owning the surface.
- **Stop condition:** stop and escalate on any blocked critical workflow; the
  campaign pauses for fix-and-requalify, because no waiver exists here.

### WP-L9D.0 — Real-library soak at six-figure scale

- **Outcome:** workload `l9-real-library-soak` over `l9-real-library-240k-v1`
  on `lightscaper-real-library-lab`: a six-figure photo count at real file
  sizes under real storage pressure, exercised over import, preview build,
  browse, filter, search, develop, and export in one wall-clock soak, with
  collectors for every threshold metric and for original-digest stability; the
  row's evidence list also names L3's `l3-synthetic-library-v1` structural
  result as the CI half of the same claim, so the soak reports what real file
  sizes, storage pressure, and decode cost add to a bound already proved
  structurally (`lightscaper-3-plan.md`).
- **Invariants:** the soak duration is wall-clock under the qualification
  profile, never simulated time; heap measurement follows the pinned per-engine
  procedure (`docs/quality-budgets.md:137-141`); originals stay
  digest-identical across import, develop, relink, and eviction
  (`roadmap-lightscaper.md:69-71`), and the byte-identical restoration half of
  that invariant is proved by L2's develop-state-removal test
  (`lightscaper-2-plan.md`), which this row's
  `catalog.originalDigestMismatches` threshold then carries end to end; a
  failed autosave or unrecovered job is data-loss-shaped
  (`config/release-severity-policy.json:43-54`).
- **Acceptance:** thresholds `catalog.originalDigestMismatches eq 0`,
  `soak.failedAutosaves eq 0`, `soak.unrecoveredJobs eq 0`,
  `soak.retainedJsHeapDeltaBytes lte 134217728`, and
  `soak.postWarmupHeapSlopeMibPerHour lte 4` — the last two reusing the
  registered milestone-9 soak limits (`config/quality-budgets.json:1731-1732`)
  — plus `library.gridScrollFrameIntervalP95Ms lte 33.34` and
  `library.searchLatencyP95Ms lte 250`; every `library.*` threshold L3
  registered structurally has a matching real-scale row here or a recorded
  reason it does not transfer; two consecutive soaks produce metric sets whose
  deltas fall inside the recorded run-to-run noise band; the collector emits
  every threshold metric finitely.
- **Non-goals:** no threshold loosening to reach a pass
  (`docs/quality-budgets.md:719-726`); no catalog-persistence redesign, since
  L2 owns that decision and its budgets.
- **Stop condition:** stop if the soak passes only by exempting a subsystem,
  and route that defect through release severity; stop immediately on any
  data-loss-shaped failure.

### WP-L9E.0 — Packaged desktop, licensing sign-off, convergence, and closure

- **Outcome:** workload `l9-packaged-desktop-qualification` over
  `l9-packaged-upgrade-catalog-v1` on the approved desktop matrix: signature
  and notarization verification on every claimed package, upgrade and downgrade
  with a real catalog preserved, uninstall preservation against the documented
  contract (`electron-builder.config.cjs:80`), add-in-place libraries on real
  removable volumes including disconnection and relink, and the
  update-notification path offline and erroring
  (`desktop/update-check.js:1-2`); the release assembler admitting Lightscaper
  (`scripts/desktop-release-assets.mjs:19, 43-46`) with the full package
  inventory. Licensing sign-off: a `config/production-licensing-matrix.json`
  row, a `THIRD_PARTY_LICENSES.md` section with the exact locked version, the
  `LICENSES/` text, and an explicit license selection for every dual-licensed
  input — the raw decoder, any lens-profile data, every new runtime asset
  (`docs/production-licensing-policy.md:220-223`). The convergence scenario:
  photo work moves between Lightscaper and Framescaper on web and on desktop
  and returns re-editable with fallbacks reported. Closure updates the L9
  roadmap statuses with evidence links.
- **Invariants:** no unsigned or un-notarized package ships for a claimed
  target; no user catalog is repaired in place without a recoverable copy
  (`docs/release-policy.md:65-73`); a missing license, notice,
  corresponding-source, or provenance artifact is critical and unwaivable
  (`:47-54`); every medium defect ships only under an approved, scoped,
  expiring waiver (`config/release-severity-policy.json:123-141`).
- **Acceptance:** `npm run check:static` green with the extended assembler and
  licensing matrix, which runs `check:notices` and `audit:quality-results`
  inside `audit:ci` (`package.json:139-140`);
  `tests/production-licensing-matrix.test.js` passes with the new rows;
  thresholds `package.unsignedArtifacts eq 0`, `package.notarizationFailures eq
  0`, `upgrade.catalogPreservationFailures eq 0`,
  `downgrade.unrecoverableCatalogs eq 0`, `uninstall.userDataLosses eq 0`,
  `addInPlace.outOfScopeAccesses eq 0`, `convergence.unreportedConversions eq
  0`, and `qualification.releaseBlockingDefects eq 0` accepted in the L9
  register; `npm run audit:lightscaper-9-qualification` reports every claimed
  row accepted rather than `pending-external`.
- **Non-goals:** no new packaging seam — L8 owns it; no codec whose licensing
  and patent gates are unresolved; no publish target beyond the approved
  matrix.
- **Stop condition:** stop with the tier blocked if no signing identity exists
  for a claimed target; stop closure while any `qualification.*` threshold is
  unmet, any claimed-but-unprovisioned environment row remains, or any row is
  relabeled rather than collected.

## Quality-budget and evidence duties

- Seven new workloads — `l9-raw-camera-breadth`,
  `l9-real-device-browser-matrix`, `l9-wide-gamut-display-color`,
  `l9-gpu-render-parity-breadth`, `l9-assistive-technology-review`,
  `l9-real-library-soak`, and `l9-packaged-desktop-qualification` — enter
  `config/quality-budgets.json` as `planned` with fixtures, environment ids,
  thresholds, and evidence paths on the registered shape of
  `m9-complete-system-soak` (`:1725-1745`); none enters
  `qualification.qualifiedWorkloadIds` (`:6-12`) until all five bar points hold
  (`docs/quality-budgets.md:92-99`).
- Every metric name binds its published unit — `Ms` publishes in `ms`, `Bytes`
  in `bytes` (`docs/quality-budgets.md:163-168`) — and every threshold uses
  only `eq`, `gte`, or `lte` (`:605-608`).
- Collectors stay manual scripts under `scripts/collect-l9-*.mjs`; CI enforces
  ledger integrity through `npm run audit:quality-results` and the new `npm run
  audit:lightscaper-9-qualification`, both inside `audit:ci`
  (`package.json:139`). Correctness suites keep running in ordinary CI, while
  timing, color, GPU, and device thresholds qualify only on provisioned
  environments, one attempt, zero retries (`docs/quality-budgets.md:130-132,
  153-156`).
- Fixture and corpus provisioning follows the interchange precedent: pinned
  versions and digests checked in, bytes fetched and verified into an
  uncommitted `vendor/` root (`docs/interchange-conformance.md:22-34`). A
  threshold change records old and new values, fixture, environment, raw
  before/after measurements, reason, and reviewing commit (`:719-726`).

## Coordination rules

- L9.0 is one work stream — WP-L9.0 then WP-L9.1; L9A–L9D open only after both
  pass, and L9E is serialized behind all of them.
- Spine files, one owner per edit, rebase before push:
  `config/quality-budgets.json`, `config/production-capabilities.json`,
  `config/project-compatibility.json`, `config/release-severity-policy.json`,
  `config/production-licensing-matrix.json`, `THIRD_PARTY_LICENSES.md`,
  `config/maintainability-allowlist.json`, the `package.json` scripts block,
  `.github/workflows/quality.yml`, `.github/workflows/desktop-preview.yml`,
  `scripts/desktop-release-assets.mjs`, `scripts/lib/node-test-shards.mjs`,
  `tests/roadmap-guidance.test.js`, `roadmap-lightscaper.md`, and
  `tests/production-capability-inventory.test.js`.
- Schema revisions stay serialized product-wide: at most one in flight, and
  none at all after WP-L9.0 freezes the baseline without a recorded migration.
- The L9 evidence register is append-mostly: a measurement row's path, byte
  length, and SHA-256 are written once by the packet that collected it, and a
  later edit to an accepted row is a requalification, not a fix.
- Every environment-descriptor edit is reviewed against that descriptor's own
  test; the native OS lab schema is versioned in
  `scripts/lib/native-os-lab-schema.mjs`, so adding Lightscaper profiles there
  is a descriptor-version increase, never an in-place edit.
- A test's shard follows its basename as well as its imports
  (`scripts/lib/node-test-shards.mjs:24-27, 42-48`), so an acceptance command
  names the shard its file lands in: a `lightscaper-` basename runs under
  `--shard=lightscaper`, and a `--shard=common` test is named after neither
  product.
- Shared fate on repository gates: `npm run check` stays green on every push.

## Known constraints this plan absorbs

- **Provisioning is capital, not code.** Five new environments plus the release
  matrix need hardware, calibrated displays, assistive-technology licenses,
  cameras, and removable volumes; every track blocks on at least one, which is
  why WP-L9.1 front-loads the descriptors while the rows stay `unprovisioned`.
- **L7 gates two of the tracks.** Raw breadth and wide-gamut display color have
  no product path to exercise until L7's decoder and wide-gamut output land;
  the color vocabulary exists but admission refuses it today
  (`src/common/editor/video-color-management-v27.ts:404-407`). If L7 ships
  without wide-gamut output on a platform, the WP-L9.0 truth-up removes that
  color row.
- **Blocked-on-licensing items stay excluded.** Profile-based lens corrections
  and camera-matching color profiles remain blocked
  (`roadmap-lightscaper.md:430-434`); their evidence rows activate only after
  the licensing review, exactly as a blocked workload already records its fence
  (`config/quality-budgets.json:1316-1323`).
- **The main roadmap's milestone 9 owns the shared campaign** — release record,
  provenance attestation, diagnostics surface, and the Soundscaper/Framescaper
  matrices (`docs/milestone-9-plan.md:245-250, 387-399`); L9 adds Lightscaper
  rows to those artifacts and never forks a second release process.

## Watch items (not gates yet)

- Signing and notarization identity acquisition lead time — it starts before
  L9E, not at it, and is shared with the main roadmap's milestone 9. Browser
  release cadence moves the same way: "current and previous"
  (`roadmap-lightscaper.md:498-499`) is pinned in the release record, not here.
- Display calibration drift: a re-profiled display is a new environment
  revision, not a silent edit (`docs/quality-budgets.md:723-725`). Raw corpus
  licensing behaves the same way: files with unclear redistribution terms are
  provisioned per lab, and a corpus that shrinks for licensing reasons shrinks
  the published support list with it.
- ML-dependent capabilities stay outside every L9 row while the milestone-7
  rules hold (`roadmap-lightscaper.md:111-118`); if any ship, their evidence is
  a new row, never a relaxation of an existing one. Convergence rows likewise
  assume the Framescaper V30 still-image campaign on `codex/milestone-8-images`
  landed on `main` (`roadmap-lightscaper.md:57-60`).

## Non-goals and fences

- No new product capability, schema revision, capability flip, or user-visible
  surface: L9's entire output is evidence and the tooling that collects it.
- No qualification by simulation — no software-renderer rows, no hosted-CI
  timing promotion, no retried passes (`docs/quality-budgets.md:76-79, 143,
  153-156`) — and no threshold, budget, severity, or waiver weakening to reach
  closure (`docs/quality-budgets.md:719-726`;
  `config/release-severity-policy.json:123-141`). No roadmap scope edit lands
  without explicit user approval; the WP-L9.0 truth-up is one bounded change.
- No capture, tethering, destructive raster editing, or patent-encumbered codec
  enters any fixture or corpus (`roadmap-lightscaper.md:101-119`); no reference
  converter, corpus file, or assistive-technology tool is bundled, linked, or
  redistributed (`docs/interchange-conformance.md:36-40`); and no Adobe
  catalog, XMP, or DNG compatibility is claimed by any evidence row (`:91-92`).
