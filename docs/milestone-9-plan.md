# Milestone 9 plan: final convergence and qualification

> Owning source for milestone-9 sequencing, the qualification-campaign
> decisions, and the bounded work packets. The
> [roadmap](../roadmap.md#9-final-convergence-and-qualification) owns scope
> and status; the release policy, quality budgets, threat model,
> compatibility policy, and licensing policy own their claims. Grounded
> against the repository on 2026-08-11 with file:line verification.
> Milestone 9 depends on milestones 1–6 and both milestone-8 sub-phases;
> this plan is written ahead of those closures so the campaign's
> irreversible decisions and today's verified evidence gaps are recorded
> once. Re-ground every citation at pickup — earlier milestones will have
> moved the tree.

> **Provenance note (2026-08-28):** the repository-grounded inventory and
> implementation-generation citations below describe the pre-freeze campaign
> snapshot. They are not active project compatibility, migration, or package
> authority. The family-v1 freeze is owned by
> [`config/project-compatibility.json`](../config/project-compatibility.json)
> and the [WP-9.0.0 decision](wp-9.0.0-baseline-decision.md).

## Goals and ordering principle

1. **Primary: no unproven claim ships.** Milestone 9 produces no new
   product capability. It converts every provisional, planned, and deferred
   qualification claim into a recorded pass, a recorded fail, or an
   explicit user-approved scope reduction — never into silence. The
   evidence rules already exist and are not weakened here: one attempt,
   zero retries (docs/quality-budgets.md:102-104,
   config/quality-budgets.json:68-69), exact environment identity with
   software-renderer refusal (docs/quality-budgets.md:93, 121-142;
   config/quality-budgets.json:81), and the fail-closed release decision —
   no open critical or high defects, unknown defects triaged as high,
   missing or stale evidence blocks the affected tier
   (docs/release-policy.md:11-16).
2. **Secondary: engineering exists only to make evidence collectable.**
   The campaign builds fixtures, collectors, run profiles, provisioning,
   and the diagnostics surface — the one §9 deliverable that is product
   code — and otherwise changes no product behavior. A defect found during
   qualification is fixed under the release-severity rules
   (docs/release-policy.md:24-29), not absorbed as silent scope.

Work is ordered by decision irreversibility: the first-release baseline
(which schema version the retained-migration promise starts from), the
supported-matrix truth-up (which platforms §9 actually claims), and the
signing identity are one-time decisions that shape every evidence row;
they land first, once, under user review. Evidence tracks then run in
parallel per environment.

## What already exists (do not re-plan)

- **The workload is registered.** `m9-complete-system-soak`
  (config/quality-budgets.json:1096-1116) with fixture
  `m9-complete-system-soak-8h-v1` — an eight-hour soak with required
  browser and desktop pass ratios of 1 (config/quality-budgets.json:852-862)
  — against the `release-qualification-matrix` environment
  (config/quality-budgets.json:228-239). Thresholds already pin retained
  JS heap delta ≤ 128 MiB, post-warmup heap slope ≤ 4 MiB/hour, Electron
  RSS delta ≤ 512 MiB, zero audio dropouts, zero unreported dropped
  frames, A/V drift ≤ 20 ms, zero failed autosaves, zero unrecovered
  jobs, and the four qualification ratios including
  `qualification.migrationPassRatio eq 1` and
  `qualification.releaseBlockingDefects eq 0`. The
  `video-preview-12fx-720p-v1` fixture is already tagged for milestones
  1, 4, and 9 (config/quality-budgets.json:244).
- **The decision framework.** Release severity, waiver, accessibility,
  and rollback rules (docs/release-policy.md; machine-readable
  config/release-severity-policy.json). Evaluator and verifier tooling:
  `scripts/quality-budget-evaluator.mjs`,
  `scripts/verify-quality-budget-result.mjs`, and
  `npm run audit:quality-results` inside the canonical gate.
- **Release-artifact discipline, partially.** The release assembler
  verifies runtime manifests, validates the corresponding-source sidecar,
  fetches digest-verified archives, and writes `SHA256SUMS` over every
  release file (scripts/desktop-release-assets.mjs:25-87), enforcing an
  exact nine-package inventory (scripts/desktop-release-assets.mjs:90-117).
  Notices are verified against the lockfile by
  `scripts/check-third-party-notices.mjs:12-63`. Fuses are flipped and
  verified at pack time (scripts/desktop-after-pack.mjs:34-41).
- **Baseline archive evidence.** The family-v1 archive suite
  (`tests/audio-editor-scape-v1-baseline.test.ts`) covers current-family
  writable admission, foreign-family and later-version opaque custody,
  byte-exact Save Copy, and typed refusal of pre-baseline archives. The
  selected Framescaper browser route independently refuses a pre-release
  format-2 archive without replacing the open project
  (`tests/browser/framescaper-prerelease-scape-refusal.spec.js`). Historical
  cross-product and packaged handoff fixtures were campaign evidence for
  pre-freeze generations and are not baseline admission evidence.
- **Renderer-crash recovery** with coalesced cleanup and reload
  (desktop/main-window-recovery.ts:56-80).

## Verified gaps this campaign must close (grounded 2026-08-11)

1. **No hardware qualification environment is currently provisioned:**
   `owner-qualified-windows-x64-rtx3090-01` retains historical diagnostic
   evidence but is unprovisioned and qualification-ineligible until its full
   current fingerprint is captured. `native-os-lab-matrix`,
   `capture-os-browser-lab-matrix`, and `release-qualification-matrix` also
   remain unprovisioned with null fingerprints and
   `qualificationEligible: false`.
2. **No soak or pinned long-session fixture exists.** The milestone-1 preview
   medium is now a digest-pinned six-second VP8 fixture, but it is not a
   long-session or soak workload. Roadmap §9's "every pinned long-session
   fixture" (roadmap.md:824-825) still quantifies over an empty set.
3. **No checked-in run profile satisfies the no-retry rule.** Both
   Playwright configs set `retries: 1` under CI (playwright.config.mjs:13,
   playwright.nightly-tests.config.mjs:48); qualification needs a
   dedicated one-worker, zero-retry profile per
   docs/quality-budgets.md:74-104.
4. **The §9 platform enumeration disagrees with the qualified matrix.**
   §9 promises "Windows, macOS, and Linux x64/ARM64" (roadmap.md:808-810),
   but macos-x64 was retired by user-approved milestone-2 scope revision 2
   (roadmap.md:279-283; config/milestone-2-closure.json:18), the
   capability inventory carries macOS arm64 only
   (config/production-capabilities.json:53-57), and the release assembler
   requires no macOS x64 package (scripts/desktop-release-assets.mjs:100).
   Safari likewise remains a provisional claim
   (config/production-capabilities.json:10-37) with WebKit qualification
   deferred by the same scope revision; WebKit does run functionally in CI
   (.github/workflows/quality.yml:59-60), so the deferral is a
   qualification gap, not a CI gap.
5. **Signing, notarization, and update/uninstall evidence are absent by
   design today.** macOS identity is ad-hoc with hardened runtime off
   (electron-builder.config.cjs:63-65), no publish target exists
   (electron-builder.config.cjs:93), desktop previews are documented as
   unsigned and unqualified for signing, notarization, rollback, or key
   rotation (docs/production-threat-model.md:1379-1380), the update path
   is a notification-only throttled GitHub poll
   (desktop/update-check.js:1-46), NSIS preserves app data on uninstall
   (electron-builder.config.cjs:52-60) — and no upgrade, downgrade, or
   uninstall-preservation test exists.
6. **The diagnostics deliverable is greenfield.** No telemetry, crash
   reporter, or diagnostics export exists anywhere in `src/` or
   `desktop/`; the only stated runtime network use is the release-check
   poll (Technical_README.md:121-122). `EditorTelemetrySnapshot`
   (src/common/editor/types.ts:313) is in-process view-state publication,
   not analytics — do not repurpose the name.
7. **Accessibility evidence is thin relative to the release bar.**
   `assertNoSeriousAxeViolations`
   (tests/browser/audio-editor-test-helpers.js:437-449) is used in 5 of
   61 browser spec files; there is no WCAG 2.2-tagged sweep, no
   zoom/reflow or screen-reader evidence, 17 committed locales
   (src/common/i18n/locales.js:82-100) with Arabic as the only shipped
   RTL locale, and one RTL browser test
   (tests/browser/audio-editor-shell-localization.spec.js:167). The
   release policy makes an inaccessible critical workflow an unwaivable
   critical defect (docs/release-policy.md:38-45).
8. **The migration floor is now frozen at each family v1 baseline.**
   Pre-release Soundscaper and Framescaper documents and stores remain
   unsupported and untouched; numeric-only documents fail with typed
   `REIMPORT_REQUIRED` through the hardened identity reader. The active
   register retains no pre-release migration source, and requires every
   future supported Soundscaper or Framescaper schema to migrate from its own
   family v1. There is no baseline migration or copy-forward runtime.
9. **No provenance attestation exists** — no build-provenance or SBOM
   step in any workflow; §9's provenance gate (roadmap.md:828-829) is
   today only SHA256SUMS plus the corresponding-source manifests.
10. **No single scenario moves a project between a web product and a
    packaged Electron product.** Web↔web and Electron↔Electron are
    covered separately; the §9 exit-gate scenario (roadmap.md:826-827)
    is not yet witnessed end-to-end.
11. **Stale platform documentation.** Technical_README.md:170-175 claims
    six platform jobs including macOS Intel; the workflow matrix has five
    targets with macOS arm64 only
    (.github/workflows/desktop-preview.yml:328-351).

## Campaign decisions

### First-release baseline and migration reinstatement

WP-9.0.0 freezes `{ soundscaper, 1 }` and `{ framescaper, 1 }` as separate
baseline identities. Their retained-migration lists are empty because no
pre-release project is readable or migrated. The next supported version of
either family must name that family's v1 as its retained migration source,
rebuild the affected migration fixture matrix, and wire the evidence into
`qualification.migrationPassRatio`. Every later schema change re-runs the
affected qualification matrix per the release-policy invalidation rule. A
second clean project or storage break on the RC or stable 1.0 line is forbidden.

### Supported-matrix truth-up

The §9 platform enumeration is resolved against reality at campaign
start, by explicit user decision, in one bounded roadmap edit (the
milestone-2 scope-revision precedent, roadmap.md:279-283; the
milestone-7 re-tiering precedent, docs/milestone-7-plan.md:93-104).
Open questions to close, not to answer implicitly: whether macos-x64
stays retired; whether Safari qualification (a milestone-1 release gate,
roadmap.md:207-208) is achievable with provisioned hardware or is
re-scoped; and which ARM64 rows the release matrix actually claims.
Nothing in this plan presumes the answers; every evidence packet scopes
to the approved matrix. If milestone 8B remains unimplemented at campaign
start, milestone 9 qualifies the shipped capability set and the roadmap keeps
its own rule: the full-DAW goal is not claimed; MIDI review rows apply only if
the implementation is proposed for stable 1.0.

### Qualification run profile

Qualification runs use dedicated profiles, not the development configs:
one worker, zero retries, pinned fixture digests, environment identity
verified before measurement, raw and accepted evidence retained per the
existing result contract (docs/quality-budgets.md:68-104, 458-522). The
development configs keep their retry behavior; the campaign never
launders a retried hosted-CI pass into qualification evidence.

### Diagnostics without telemetry

The §9 diagnostics deliverable is a **local, exportable, user-invoked
report** — never a background channel. It reuses the two proven shapes:
the compatibility report the products already render
(Technical_README.md:131-134) and the structured evidence writer's
identity discipline (scripts/quality-budget-evidence.mjs). Contents are
versions, capability snapshot, environment identity, recent typed errors,
storage and library state, and recovery journal status — explicitly no
media content, no transcripts, no paths beyond the user's own view, and
no network use. The no-telemetry posture (Technical_README.md:121-122)
is a preserved invariant, verified by the same evidence style as
milestone 7's `networkRequestsAfterInstall eq 0`.

### Signing is enacted upstream, requalified here

Milestone 5's exit gate owns first enactment of packaging, signing, and
notarization (roadmap.md:613-615); milestone 9 owns the release-shaped
requalification: signature and notarization verification on every
package, upgrade/downgrade with library preservation, uninstall
preservation (the documented contract, Technical_README.md:134-136), and
the update-notification path's offline/error behavior. If milestone 5
lands without signing (no identity available), that is a named external
blocker on WP-9B, recorded, never simulated.

## Phase structure

| Phase | Mode | Content |
| --- | --- | --- |
| 9.0 | Serialized (one work stream) | Baseline and matrix decisions, migration reinstatement, qualification profiles, environment provisioning, pinned soak/long-session fixtures, diagnostics surface |
| 9A | Parallel track | Browser matrix: Chromium/Firefox/Safari qualification, accessibility and localization sweep |
| 9B | Parallel track | Desktop matrix: packages, signing, upgrade/downgrade/uninstall, crash recovery |
| 9C | Parallel track | Complete-system soak and resource pressure |
| 9D | Parallel track | Migration, compatibility, and cross-product convergence |
| 9E | Parallel track | Release artifacts, provenance, and documentation |
| 9F | Serialized | Release rehearsal, defect burn-down, closure |

9A–9E start only when 9.0's acceptance passes and run per-environment in
parallel. 9F is serialized: one release record, one owner.

## Work packets

The 9.0 packets are decomposed here; 9A–9F are summarized against the
five fields and are decomposed into slice docs at pickup, after
re-grounding, following the milestone-3 pattern
(docs/milestone-3-plan.md:467-470).

### WP-9.0.0 — Baseline, matrix truth-up, and migration reinstatement

**Decision recorded 2026-08-28.** The approved
[`1.0.0-rc.1` baseline decision](wp-9.0.0-baseline-decision.md) freezes
Soundscaper v1 and Framescaper v1 as independent schema families. There are no
earlier retained migration sources: the original packet language below is
historical planning provenance, and “migration reinstatement” now means that
every future supported successor must retain its own family's v1 baseline.
Stable 1.0 remains blocked on the other Milestone 9 evidence.

- **Outcome:** The user-approved first-release baseline (schema version,
  supported platform matrix, Safari disposition) recorded in one bounded
  roadmap §9 edit plus the capability-inventory and closure-precedent
  updates; the retained-migration reinstatement enacted as the versioned
  policy change described above, with the rebuilt fixture matrix; the
  stale platform documentation corrected (Technical_README.md:170-175).
- **Invariants:** Roadmap anchors referenced by machine-readable policies
  survive (tests/roadmap-guidance.test.js); the typed `REIMPORT_REQUIRED`
  path keeps covering schemas older than the baseline; no migration is
  written for any pre-release schema version.
- **Acceptance:** Compatibility register tests cover the reinstated rule;
  a baseline-version document saved by the release build reopens in the
  next build through a retained migration; `roadmap-guidance` stays
  green; the migration fixture matrix feeds
  `qualification.migrationPassRatio`.
- **Non-goals:** No schema change; no new product capability.
- **Stop condition:** Stop if any pre-release schema version would need a
  retained migration to make evidence pass — that is a baseline-choice
  error, not a fixture gap.

### WP-9.0.1 — Qualification profiles and environment provisioning

- **Outcome:** Dedicated zero-retry, one-worker qualification profiles;
  the four environment descriptors captured and checked in with exact
  fingerprints per the fixed-hardware rules
  (docs/quality-budgets.md:121-142); runner labels resolving uniquely to
  each machine; the evaluator wired to refuse mismatched identity.
- **Invariants:** Development CI keeps its retry behavior; hosted-runner
  timing never enters qualification evidence
  (docs/quality-budgets.md:29-31); an unexpected renderer or driver is an
  environment failure, never a skip.
- **Acceptance:** A deliberately mismatched environment fails; a
  qualified m2 structural workload re-verifies unchanged under the new
  profiles; each provisioned descriptor passes
  `npm run audit:quality-results`.
- **Non-goals:** No threshold edits; no new workloads.
- **Stop condition:** Stop if a required environment cannot be
  provisioned — record the named external blocker and scope the
  dependent packets, exactly as milestone 3 did for its packaged probe
  rows (docs/milestone-3b-work-packets.md:14-17).

### WP-9.0.2 — Pinned soak and long-session fixtures

- **Outcome:** The deterministic soak-project generator implementing
  `m9-complete-system-soak-8h-v1` (pinned generator revision, seed, and
  digests — the fixture discipline of docs/quality-budgets.md:144-152)
  exercising both products across autosave, handoff, render/export jobs,
  and — after 8A/8B — capture and MIDI; retention and revalidation of the
  digest-pinned milestone-1 preview medium; collectors for every soak metric
  including
  `soak.unrecoveredJobs` over the milestone-6 queues and
  `soak.failedAutosaves`.
- **Invariants:** Fixtures are deterministic and digest-pinned; the
  8-hour duration is wall-clock under the qualification profile, never
  simulated time for the timing metrics; heap measurement follows the
  pinned per-engine procedure (docs/quality-budgets.md:87-91).
- **Acceptance:** Two consecutive soak runs on the provisioned matrix
  produce metric sets whose deltas are within the recorded run-to-run
  noise band; the collector emits every threshold metric finitely.
- **Non-goals:** No threshold loosening to make the soak pass
  (docs/quality-budgets.md:543-550).
- **Stop condition:** Stop if the soak can only pass by exempting a
  subsystem — that subsystem's defect goes through release severity
  instead.

### WP-9.0.3 — Local exportable diagnostics

- **Outcome:** The menu-reached (AGENTS.md:8-11), user-invoked
  diagnostics report per the decision above, on both products and both
  platforms, with a save/export path using the existing bounded
  publication machinery; documentation for recovery, compatibility,
  migration, keyboard, codec, plug-in, and backup workflows
  (roadmap.md:815-817) landing beside it.
- **Invariants:** Zero network use; no media content or transcript text
  in any report; report generation cannot mutate project state.
- **Acceptance:** A report generates offline on the qualified matrix;
  content is validated against an explicit allowlist schema; a
  no-network witness in the milestone-7 evidence style passes.
- **Non-goals:** No crash-dump uploader, no error aggregation service,
  no background writes.
- **Stop condition:** Stop if any consumer requires automatic or
  periodic report generation.

### 9A — Browser matrix and accessibility (summary)

Qualify current and previous Chromium, Firefox, and Safari per the
approved matrix, including every fallback path
(roadmap.md:806-807) — building on the functional coverage that already
runs all three engines (.github/workflows/quality.yml:59-60). Raise
accessibility to the release bar: a WCAG 2.2 AA-tagged automated sweep
across the browser suite (extending the two existing helpers,
tests/browser/audio-editor-test-helpers.js:408-449), keyboard-complete
critical workflows, screen-reader spot checks recorded as manual
evidence, zoom/reflow at 200%, forced-colors and reduced-motion
verification over the existing CSS surfaces, and RTL coverage beyond the
single localization spec. Invariant: an inaccessible critical workflow
is unwaivable-critical (docs/release-policy.md:38-45). Stop: a browser
row that cannot be provisioned is recorded as a named blocker, never
approximated by an engine substitute (Playwright WebKit is engine
evidence, not Safari qualification — docs/quality-budgets.md:20-23).

### 9B — Desktop matrix (summary)

Per approved target: package, sign, notarize where applicable, verify
signature and fuse state at smoke time, upgrade/downgrade with library
preservation, uninstall preservation, crash and recovery behavior
(extending desktop/main-window-recovery.ts coverage to packaged builds),
and the update-notification path under offline, throttled, and error
conditions. Consumes the milestone-5 signing enactment; requalifies it
release-shaped. Windows-on-ARM and Linux-ARM64 rows follow the approved
matrix. Stop: no signing identity available for a claimed target —
named blocker, tier blocked per release policy, never shipped ad-hoc.

### 9C — Complete-system soak (summary)

Run `m9-complete-system-soak` on the provisioned release matrix under
the qualification profile; both pass ratios must reach 1. Resource
pressure (low disk, memory pressure, thermal throttling where the lab
can induce it) is recorded as separate labeled runs, not mixed into the
threshold run. Stop: any data-loss-shaped soak failure (failed
autosave, unrecovered job, corrupted revision) is a critical defect and
pauses the campaign for fix-and-requalify.

### 9D — Migration, compatibility, and convergence (summary)

The retained-migration matrix from WP-9.0.0 running on every qualified
platform; future-schema read-only and opaque-state round trips
(roadmap.md:803-805); the acceptance-matrix handoff scenario witnessed
end-to-end including the missing web↔packaged-Electron single-scenario
path; fallback returns without losing editable state
(roadmap.md:826-827). Stop: any unreported conversion found here is a
high defect by definition (roadmap.md:821-823).

### 9E — Release artifacts and provenance (summary)

The release assembler wired into a workflow (today
`npm run desktop:release-assets` is manual); build-provenance
attestation added for release artifacts; notices, hashes,
corresponding-source, licensing and codec/plug-in legal status verified
per licensing policy; package smoke on every claimed target (today
Linux-x64-Soundscaper-only,
.github/workflows/desktop-preview.yml:282-301); the release record
assembled with every field the release policy requires
(docs/release-policy.md:14-16). Stop: missing mandatory license,
notice, or provenance evidence is critical and unwaivable
(docs/release-policy.md:47-54).

### 9F — Release rehearsal and closure (summary)

One full rehearsal: assemble, verify, install, upgrade, roll back
(docs/release-policy.md:65-78). Defect burn-down to zero
release-blocking defects; every medium defect shipped only under a
scoped, expiring waiver (docs/release-policy.md:56-63). Closure updates
roadmap §9 statuses with evidence links, keeping the anchor set intact.
Stop: closure with any `qualification.*` threshold unmet, any
unprovisioned-but-claimed environment row, or any relabeled pending row
— the milestone-3 pending-external precedent holds to the end
(docs/milestone-3b-work-packets.md:14-17).

## Known constraints this plan absorbs

- **Milestone 8B may stay blocked indefinitely** (roadmap.md:752-753,
  793-795). The campaign is structured so 8B's absence removes rows, not
  gates: MIDI evidence activates only after the 8B entry gate, exactly as
  the blocked workload already records
  (config/quality-budgets.json:1080-1094).
- **The m2 lease matrix is still open** (`m2-gate-electron-concurrency`
  Partial, roadmap.md:326); milestone-9 desktop evidence assumes it
  closed long before pickup, but the campaign re-runs it on the final
  matrix regardless — release qualification repeats, it does not
  inherit.
- **Provisioning is capital, not code.** Four environments need hardware,
  and the plan deliberately front-loads them in 9.0 because every
  parallel track blocks on at least one.
- **Localization scale.** 17 committed locales with one RTL locale is
  today's honest surface; the §9 localization/RTL review scopes to the
  shipped locale set, not to the 100+-locale Audacity superset
  (src/common/i18n/locales.js:9-70).

## Watch items (not gates yet)

- macOS signing/notarization identity acquisition lead time — start
  before 9B, not at it.
- ONNX/GPU-era additions from milestone 7: if the optional assistance
  milestone shipped, its packs and helper join the soak surface and the
  uninstall-preservation story (models directory survives uninstall).
- Browser release cadence: "current and previous" (roadmap.md:806-807)
  is a moving target; pin the versions in the release record, not in
  this plan.
- M6/M7 admission on `owner-qualified-windows-x64-rtx3090-01` may land earlier
  after those workloads have formal profiles and accepted runs. The native,
  capture, and release matrices remain independent provisioning duties for 9.0.

## Non-goals and fences

- No new product features, schema revisions, or capability flips.
- No telemetry, crash uploading, or any background network channel; the
  diagnostics surface is local and user-invoked only.
- No qualification by simulation: no software-renderer timing rows, no
  hosted-CI performance promotion, no retried passes
  (docs/quality-budgets.md:93, 102-104).
- No threshold, budget, or severity weakening to reach closure
  (roadmap.md:76-77; docs/quality-budgets.md:543-550).
- No roadmap scope edit without explicit user approval; every truth-up
  in WP-9.0.0 is a named, bounded, user-approved change following the
  milestone-2 and milestone-7 precedents.
