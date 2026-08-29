# Milestone 9 plan: final convergence and qualification

> Owning source for milestone-9 sequencing, the qualification-campaign
> decisions, and the bounded work packets. The
> [roadmap](../roadmap.md#9-final-convergence-and-qualification) owns scope
> and status; the release policy, quality budgets, threat model,
> compatibility policy, and licensing policy own their claims. Re-grounded
> against the qualification infrastructure on 2026-08-29. Milestone 9 depends
> on milestones 1–6, the shipped milestone-8 capability set, and the completed
> 8+C origin cutover.

> **Provenance note (2026-08-28):** the repository-grounded inventory and
> implementation-generation citations below describe the pre-freeze campaign
> snapshot. They are not active project compatibility, migration, or package
> authority. The family-v1 freeze is owned by
> [`config/project-compatibility.json`](../config/project-compatibility.json)
> and the [WP-9.0.0 decision](wp-9.0.0-baseline-decision.md).

> **Implementation truth-up (2026-08-29):** the behavior-by-environment matrix,
> exact 152-check inventory, dedicated fail-closed admission path,
> deterministic `m9-complete-system-soak-8h-v1` generator and collectors, and
> menu-reached local diagnostics are implemented. This is infrastructure, not
> stable admission. No real eight-hour qualification pair, 152-check campaign,
> rehearsal, or full-matrix cohort is accepted yet. The complete 18-profile
> native tier remains mandatory and is blocked only on external legal/source
> and payload custody, lab/hardware identity, signing, and notarization
> evidence. The matrix is not reduced. The governing
> [campaign-matrix decision](wp-9-campaign-matrix-decision.md) records the
> exact cells and evidence rules. MIDI is excluded from stable 1.0.

## Goals and ordering principle

1. **Primary: no unproven claim ships.** Milestone 9 produces no new
   product capability. It converts every provisional, planned, and deferred
   qualification claim into a recorded pass, a recorded fail, or an
   explicit user-approved scope reduction — never into silence. The
   evidence rules already exist and are not weakened here: one attempt,
   zero retries, exact environment identity, and software-renderer refusal as
   defined by the [measurement procedure](quality-budgets.md#measurement-procedure)
   and [fixed-hardware environments](quality-budgets.md#fixed-hardware-environments),
   plus the fail-closed release decision —
   no open critical or high defects, unknown defects triaged as high,
   missing or stale evidence blocks the affected tier under the
   [release decision](release-policy.md#release-decision).
2. **Secondary: engineering exists only to make evidence collectable.**
   The campaign builds fixtures, collectors, run profiles, provisioning,
   and the diagnostics surface — the one §9 deliverable that is product
   code — and otherwise changes no product behavior. A defect found during
   qualification is fixed under the
   [release-severity rules](release-policy.md#severity-and-response), not
   absorbed as silent scope.

Work is ordered by decision irreversibility: the first-release baseline
(which schema version the retained-migration promise starts from), the
supported-matrix truth-up (which platforms §9 actually claims), and the
signing identity are one-time decisions that shape every evidence row;
they land first, once, under user review. Evidence tracks then run in
parallel per environment.

## What already exists (do not re-plan)

- **The workload and collector are implemented.** `m9-complete-system-soak`
  (config/quality-budgets.json:1893-1918) with fixture
  `m9-complete-system-soak-8h-v1` — an eight-hour soak with required
  browser and desktop pass ratios of 1 (config/quality-budgets.json:1423-1446)
  — against the `release-qualification-matrix` environment
  (config/quality-budgets.json:547-563). Thresholds already pin retained
  JS heap delta ≤ 128 MiB, post-warmup heap slope ≤ 4 MiB/hour, Electron
  RSS delta ≤ 512 MiB, zero audio dropouts, zero unreported dropped
  frames, A/V drift ≤ 20 ms, zero failed autosaves, zero unrecovered
  jobs, and the four qualification ratios including
  `qualification.migrationPassRatio eq 1` and
  `qualification.releaseBlockingDefects eq 0`. The
  `video-preview-12fx-720p-v1` fixture is already tagged for milestones
  1, 4, and 9 (config/quality-budgets.json:567-582).
- **The behavior-by-environment matrix is registered.**
  `config/milestone-9-behavior-environments.json` binds every guided check to
  exact browser, desktop, native-profile, fixed-qualification, or review cells.
  The inventory is exactly 152 checks. Behavior expands to 12 product/browser
  combinations, 10 product/platform desktop combinations, and all 11
  Soundscaper plus all 7 Framescaper native profiles. Separately, the soak
  register has six dual-product browser engine/version cells and five
  dual-product desktop-platform cells.
- **Qualification custody fails closed.** The dedicated collector, evidence
  register, auditor, and stable-release admission check require two distinct
  full-duration runs for each applicable runtime cell, exact environment and
  source identities, repeatability-band agreement, and closed campaign
  evidence. Contract mode is explicitly ineligible for qualification.
- **Local diagnostics are implemented.** Both products expose the report only
  through a menu. Its allowlisted local snapshot contains no media, transcript,
  automatic network, or project mutation authority.
- **The decision framework.** Release severity, waiver, accessibility,
  and rollback rules (docs/release-policy.md; machine-readable
  config/release-severity-policy.json). Evaluator and verifier tooling:
  `scripts/quality-budget-evaluator.mjs`,
  `scripts/verify-quality-budget-result.mjs`, and
  `npm run audit:quality-results` inside the canonical gate.
- **Release-artifact discipline, partially.** The release assembler
  verifies runtime manifests, validates the corresponding-source sidecar,
  fetches digest-verified archives, and writes `SHA256SUMS` over every
  release file. `scripts/desktop-release-assets.mjs` enforces nine packages per
  product: 18 total across Soundscaper and Framescaper.
  Notices are verified against the lockfile by
  `scripts/check-third-party-notices.mjs`. Fuses are flipped and verified by
  `scripts/desktop-after-pack.mjs` at pack time.
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

## Verified gaps this campaign must close (re-grounded 2026-08-29)

1. **None of the 11 soak cells has its required pair of real eight-hour runs.** The deterministic
   generator, short contract-mode witness, collectors, register, and auditor are
   implemented. Qualification still requires exactly 22 runs: two consecutive
   28,800-second runs for each dual-product runtime cell, with zero retries,
   exact environment identity, finite threshold metrics, and repeatability-band
   agreement. A shortened,
   simulated, retried, or neighbouring-cell run cannot fill a slot.
2. **The 152-check campaign has not been executed.** The exact inventory and
   behavior-by-environment expansion exist, but the rehearsal and full campaign
   still need authenticated results for every applicable cell. An infrastructure
   test, free-text note, engine substitute, or relabeled pending row is not
   acceptance evidence.
3. **The full native tier is externally blocked, not reduced.** All 11
   Soundscaper and all 7 Framescaper profiles remain mandatory. The open inputs
   are external legal/source and target-payload custody, corresponding source
   and notices, codec/patent review, exact lab and hardware fingerprints,
   signing, and notarization. No synthetic payload, software renderer, hosted
   runner, adjacent profile, or smaller cohort may substitute.
4. **Signing, notarization, provenance, and lifecycle evidence remain absent.**
   Stable admission still needs authenticated packages, signatures, update and
   rollback behavior, upgrade/downgrade and uninstall preservation, notices,
   hashes, corresponding source, and build provenance on each claimed target.
5. **Accessibility campaign evidence remains open.** The Chromium
   `accessibility-wcag-sweep.spec.js` covers both maintained routes with the
   WCAG 2.2 AA tag set at 100%/200% reflow, forced colors, and reduced motion;
   its checked-in baseline currently has zero critical or serious violations.
   `assertNoSeriousAxeViolations` is also used in 19 of the current 92 browser
   specs. Exact-cell keyboard-complete and platform screen-reader evidence is
   still absent, as is full workflow coverage across the 17 committed locales
   (src/common/i18n/locales.js:82-100) with Arabic as the only shipped
   RTL locale, and one RTL browser localization spec. The
   [release policy](release-policy.md#accessibility) makes an inaccessible
   critical workflow an unwaivable critical defect.
6. **The migration floor is frozen at each family v1 baseline.**
   Pre-release Soundscaper and Framescaper documents and stores remain
   unsupported and untouched; numeric-only documents fail with typed
   `REIMPORT_REQUIRED` through the hardened identity reader. The active
   register retains no pre-release migration source, and requires every
   future supported Soundscaper or Framescaper schema to migrate from its own
   family v1. There is no baseline migration or copy-forward runtime.
7. **No single accepted scenario moves a project between a web product and a
    packaged Electron product.** Web↔web and Electron↔Electron are
    covered separately; the [§9 exit-gate scenario](../roadmap.md#9-final-convergence-and-qualification)
    is not yet witnessed end-to-end.
8. **The diagnostics implementation still needs matrix evidence.** The local,
   allowlisted report is implemented and menu-reached, but an offline export and
   no-network witness must still be accepted on every applicable release cell.

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

### Supported matrix is fixed

The user-approved matrix is closed in
[`wp-9-campaign-matrix-decision.md`](wp-9-campaign-matrix-decision.md): both
products on current and previous Chrome, Firefox, and Safari releases (12 web
cells); both products on Windows x64, Windows ARM64, macOS ARM64, Linux x64,
and Linux ARM64 (10 desktop cells); and all 11 Soundscaper plus all 7
Framescaper native OS lab profiles. The 152 guided checks expand over their
explicitly applicable cells. A neighbouring environment, Playwright WebKit in
place of Safari, hosted runner in place of a native lab, software renderer,
synthetic payload, or manual free-text result cannot satisfy a missing cell.

The complete native tier is mandatory and is not eligible for scope reduction.
Its remaining blockers are external legal/source and payload custody,
corresponding source and notices, codec/patent review, lab and hardware
identity, signing, and notarization evidence. MIDI is post-1.0 and has no
positive capability or runtime cell; GAT-01 checks only that its stable-1.0
absence fence remains closed.

### Qualification run profile

The dedicated qualification profiles and admission rules are implemented and
remain separate from development configs:
one worker, zero retries, pinned fixture digests, environment identity
verified before measurement, and raw plus accepted evidence retained under the
[measurement](quality-budgets.md#measurement-procedure) and
[result-evaluation](quality-budgets.md#result-evaluation) contracts. The
development configs keep their retry behavior; the campaign never
launders a retried hosted-CI pass into qualification evidence.

### Diagnostics without telemetry

The implemented §9 diagnostics deliverable is a **local, exportable,
user-invoked report** — never a background channel. It reuses the two proven
shapes:
the compatibility reports governed by [project compatibility](project-compatibility.md)
and the structured evidence writer's
identity discipline (scripts/quality-budget-evidence.mjs). Contents are
versions, capability snapshot, environment identity, recent typed errors,
storage and library state, and recovery journal status — explicitly no
media content, no transcripts, no paths beyond the user's own view, and
no network use. The [desktop preview](../Technical_README.md#desktop-preview)
also records the preserved no-telemetry posture,
is a preserved invariant, verified by the same evidence style as
milestone 7's `networkRequestsAfterInstall eq 0`.

### Signing is enacted upstream, requalified here

Milestone 5's exit gate owns first enactment of packaging, signing, and
notarization ([roadmap milestone 5](../roadmap.md#5-electron-native-services-and-extensibility)); milestone 9 owns the release-shaped
requalification: signature and notarization verification on every
package, upgrade/downgrade with library preservation, uninstall
preservation (the [documented desktop contract](../Technical_README.md#desktop-preview)), and
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

The infrastructure portions of 9.0 are implemented. Environment provisioning,
two-run soak evidence, the expanded 152-check campaign, and 9A–9F release
evidence remain open; phase names are not evidence statuses.

## Work packets

The 9.0 packets are decomposed here; 9A–9F are summarized against the
five fields and are decomposed into slice docs at pickup, after
re-grounding, following the [milestone-3 pattern](milestone-3-plan.md).

### WP-9.0.0 — Baseline, matrix truth-up, and migration reinstatement

**Disposition: implemented decisions; campaign evidence pending.** The approved
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
  stale platform documentation corrected in the
  [desktop preview](../Technical_README.md#desktop-preview).
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

- **Disposition:** The dedicated profile, matrix, identity validation, and
  fail-closed admission infrastructure are implemented. Real environments and
  exact fingerprints remain external evidence inputs.
- **Outcome:** Dedicated zero-retry, one-worker qualification profiles;
  every required environment descriptor captured with exact fingerprints per
  the [fixed-hardware rules](quality-budgets.md#fixed-hardware-environments);
  runner labels resolving uniquely to
  each machine; the evaluator wired to refuse mismatched identity.
- **Invariants:** Development CI keeps its retry behavior; hosted-runner
  timing never enters qualification evidence merely because it ran in the
  functional engine matrix; an unexpected renderer or driver is an
  environment failure, never a skip.
- **Acceptance:** A deliberately mismatched environment fails; a
  qualified m2 structural workload re-verifies unchanged under the new
  profiles; each provisioned descriptor passes
  `npm run audit:quality-results`.
- **Non-goals:** No threshold edits; no new workloads.
- **Stop condition:** Stop if a required environment cannot be
  provisioned — record the named external blocker and scope the
  dependent packets, following the
  [milestone-3 pending-external precedent](milestone-3b-work-packets.md).

### WP-9.0.2 — Pinned soak and long-session fixtures

- **Disposition:** Generator, digest-pinned specifications, contract mode,
  collector, evidence register, repeatability checks, and auditor are
  implemented. No qualification run pair has been accepted.
- **Outcome:** The deterministic soak-project generator implementing
  `m9-complete-system-soak-8h-v1` (pinned generator revision, seed, and
  digests under the [fixture discipline](quality-budgets.md#fixtures-and-project-sizes))
  exercising both products across autosave, handoff, render/export jobs,
  capture, and recovery; retention and revalidation of the
  digest-pinned milestone-1 preview medium; collectors for every soak metric
  including
  `soak.unrecoveredJobs` over the milestone-6 queues and
  `soak.failedAutosaves`.
- **Invariants:** Fixtures are deterministic and digest-pinned; the
  8-hour duration is wall-clock under the qualification profile, never
  simulated time for the timing metrics; heap measurement follows the
  pinned [measurement procedure](quality-budgets.md#measurement-procedure).
- **Acceptance:** Two consecutive soak runs on the provisioned matrix
  produce metric sets whose deltas are within the recorded run-to-run
  noise band; the collector emits every threshold metric finitely.
- **Non-goals:** No threshold loosening to make the soak pass; follow
  [Changing a threshold](quality-budgets.md#changing-a-threshold).
- **Stop condition:** Stop if the soak can only pass by exempting a
  subsystem — that subsystem's defect goes through release severity
  instead.

### WP-9.0.3 — Local exportable diagnostics

- **Disposition:** Product implementation and focused offline/no-mutation
  coverage are complete; exact-cell qualification evidence remains pending.
- **Outcome:** The menu-reached (AGENTS.md:8-11), user-invoked
  diagnostics report per the decision above, on both products and both
  platforms, with a save/export path using the existing bounded
  publication machinery; documentation for recovery, compatibility,
  migration, keyboard, codec, plug-in, and backup workflows required by
  [roadmap §9](../roadmap.md#9-final-convergence-and-qualification) landing beside it.
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

**Evidence pending.** Qualify both products on current and previous Chrome,
Firefox, and Safari per the approved 12-combination web behavior matrix,
including every fallback path. Functional CI already runs all three Playwright
engines, and the route-level WCAG 2.2 AA sweep covers both products at normal
and 200% reflow, forced colors, and reduced motion. Complete the remaining
accessibility release evidence with keyboard-complete critical workflows,
platform screen-reader checks recorded as manual evidence, guided critical-
workflow verification of 200% zoom/reflow, forced colors, and reduced motion,
and RTL coverage beyond the single localization spec. Invariant: an
inaccessible critical workflow is unwaivable-critical under the
[release policy](release-policy.md#accessibility). Stop: a browser
row that cannot be provisioned is recorded as a named blocker, never
approximated by an engine substitute (Playwright WebKit is engine
evidence, not Safari qualification, as the
[active quality policy](quality-budgets.md#what-is-active-today) records).

### 9B — Desktop matrix (summary)

**Evidence pending.** For both products on the five approved desktop targets:
package, sign, notarize where applicable, verify
signature and fuse state at smoke time, upgrade/downgrade with library
preservation, uninstall preservation, crash and recovery behavior
(extending desktop/main-window-recovery.ts coverage to packaged builds),
and the update-notification path under offline, throttled, and error
conditions. Consumes the milestone-5 signing enactment; requalifies it
release-shaped. Windows-on-ARM and Linux-ARM64 rows follow the approved
matrix. The complete native tier adds all 11 Soundscaper and all 7 Framescaper
lab profiles and remains mandatory. Its only open inputs are external
legal/source and payload custody, notices/review, exact labs and fingerprints,
signing, and notarization evidence; the tier is never reduced. Stop: any absent
external input leaves its exact rows pending and stable admission blocked.

### 9C — Complete-system soak (summary)

**Infrastructure implemented; all 11 real run pairs (22 runs) pending.** Run
`m9-complete-system-soak` on the provisioned release matrix under
the qualification profile; both pass ratios must reach 1. Resource
pressure (low disk, memory pressure, thermal throttling where the lab
can induce it) is recorded as separate labeled runs, not mixed into the
threshold run. Stop: any data-loss-shaped soak failure (failed
autosave, unrecovered job, corrupted revision) is a critical defect and
pauses the campaign for fix-and-requalify.

### 9D — Migration, compatibility, and convergence (summary)

**Campaign evidence pending.** Run the retained-migration matrix from WP-9.0.0
on every qualified platform; future-schema read-only and opaque-state round
trips; the acceptance-matrix handoff scenario witnessed
end-to-end including the missing web↔packaged-Electron single-scenario
path; fallback returns without losing editable state. Stop: any unreported
conversion found here is a high defect under the
[release policy](release-policy.md#severity-and-response).

### 9E — Release artifacts and provenance (summary)

**Evidence pending.** Wire the release assembler into a workflow (today
`npm run desktop:release-assets` is manual); build-provenance
attestation added for release artifacts; notices, hashes,
corresponding-source, licensing and codec/plug-in legal status verified
per licensing policy. Functional package/smoke CI covers both products on all
five desktop targets, but signed, notarized, provenance-bound release evidence
remains pending. Assemble the release record with every field required by the
[release decision](release-policy.md#release-decision). Stop: missing mandatory
license, notice, or provenance evidence is critical and unwaivable under the
[security, licensing, and provenance policy](release-policy.md#security-licensing-and-provenance).

### 9F — Release rehearsal and closure (summary)

**Not started; stable admission remains blocked.** Execute all 152 guided
checks over every applicable exact cell, then one full rehearsal: assemble,
verify, install, upgrade, and roll back under the
[rollback and recovery policy](release-policy.md#rollback-and-recovery). Defect
burn-down reaches zero release-blocking defects; every medium defect shipped
only under a [scoped, expiring waiver](release-policy.md#waivers). Closure updates
roadmap §9 statuses with evidence links, keeping the anchor set intact.
Stop: closure with any `qualification.*` threshold unmet, any
unprovisioned-but-claimed environment row, or any relabeled pending row
— the [milestone-3 pending-external precedent](milestone-3b-work-packets.md)
holds to the end.

## Known constraints this plan absorbs

- **MIDI is excluded from stable 1.0.** It contributes no positive capability
  behavior, soak operation, or runtime environment cell. GAT-01 verifies only
  that the shipped absence fence remains closed. Future MIDI work belongs to
  milestone 9+ and requires its own later qualification decision.
- **The m2 lease matrix is closed** (`m2-gate-electron-concurrency`
  Implemented). Its reviewed family-v1 packaged cohort covers all five
  maintained desktop targets. The campaign still re-runs it on the final
  release matrix — release qualification repeats, it does not inherit.
- **Provisioning is capital, not code.** Exact browser, desktop, fixed-profile,
  and all 18 native lab environments need real identities. Infrastructure
  completion cannot replace them.
- **Localization scale.** 17 committed locales with one RTL locale is
  today's honest surface; the §9 localization/RTL review scopes to the
  shipped locale set, not to the 59-locale Audacity superset
  (src/common/i18n/locales.js:9-70).

## Watch items

- macOS signing/notarization identity acquisition is a stable-admission gate;
  acquire it before 9B evidence collection, not during closure.
- ONNX/GPU-era additions from milestone 7: if the optional assistance
  milestone shipped, its packs and helper join the soak surface and the
  uninstall-preservation story (models directory survives uninstall).
- Browser release cadence: "current and previous" in the approved campaign matrix
  is a moving target; pin the versions in the release record, not in
  this plan.
- M6/M7 admission on `owner-qualified-windows-x64-rtx3090-01` may land earlier
  after those workloads have formal profiles and accepted runs. The native,
  capture, and release matrices remain independent provisioning duties for 9.0
  and none may inherit or substitute that result.

## Non-goals and fences

- No new product features, schema revisions, or capability flips.
- No telemetry, crash uploading, or any background network channel; the
  diagnostics surface is local and user-invoked only.
- No qualification by simulation: no software-renderer timing rows, no
  unregistered hosted-CI performance promotion, and no retried passes under the
  [measurement procedure](quality-budgets.md#measurement-procedure).
- No native-tier scope reduction, synthetic payload, invented legal approval,
  adjacent-profile substitution, or fabricated lab fingerprint.
- No positive MIDI capability or runtime qualification row in stable 1.0;
  GAT-01 is only the absence-fence check.
- No threshold, budget, or severity weakening to reach closure; follow
  [Changing a threshold](quality-budgets.md#changing-a-threshold).
- No roadmap scope edit without explicit user approval; every truth-up
  in WP-9.0.0 is a named, bounded, user-approved change following the
  milestone-2 and milestone-7 precedents.
