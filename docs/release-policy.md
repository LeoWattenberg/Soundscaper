# Production release policy

This policy turns the roadmap's production claims into a fail-closed release
decision. The machine-readable source is
[`config/release-severity-policy.json`](../config/release-severity-policy.json).
Evidence in that file describes current controls; it is not by itself proof that
a platform tier has passed qualification.

## Product-owned 1.0 release status

`1.0.0-rc.1` freezes the independent Soundscaper-v1 and Framescaper-v1 project,
archive, browser-storage, desktop-library, and project-coupled native identities
recorded by [WP-9.0.0](wp-9.0.0-baseline-decision.md). The version and channel
authority is [`config/product-release-lines.json`](../config/product-release-lines.json).
Soundscaper candidate publication uses an exact `soundscaper-v*-rc.*` or
`soundscaper-v*-beta.*` tag. Framescaper retains its separate
`framescaper-v*` prerelease prefix and is deferred from Soundscaper Stable 1.0.

The Soundscaper-only `v1.0.0` workflow is supported only after the versioned
`soundscaper-stable-1` evaluator admits the exact candidate commit, packages,
five professional-native targets, signed technical readiness, platform and
accessibility campaign, notices/legal approval, release rehearsal, and all 22
eight-hour soak runs. Missing evidence blocks the tag workflow; no baseline
decision or Framescaper deferral can substitute for a Soundscaper requirement.
The retained dual-product campaign remains available for later Framescaper
qualification, but its rows do not enter Soundscaper admission.

Later RCs and stable 1.0 may fix implementation defects but may not introduce a
second clean schema or storage break. The first supported successor of either
project family must migrate from that family's v1 baseline.

## Release decision

No open critical or high defects are permitted in a release. Unknown defects
are treated as high until triage proves otherwise. Missing or stale evidence and
missing required quality budgets block the affected product, distribution
surface, or platform tier. A release record must identify the source revision,
artifact digests, platform and hardware matrix, fixture versions, test results,
known low defects, and every approved medium-severity waiver.

The release owner makes a separate decision for each qualified tier. A failure
on one tier may only be scoped away when the product can prevent distribution
to that tier and all shared artifacts remain proven unaffected.

## Severity and response

| Level | Meaning | Release treatment |
| --- | --- | --- |
| Critical | Data loss or disclosure, a failed mandatory security or legal boundary, or an inaccessible critical workflow without safe recovery. | Block immediately; no waiver. |
| High | Material media-correctness, continuity, or primary-workflow failure without complete recovery. | Block; fix and requalify. |
| Medium | Bounded impact with a documented workaround in a supported workflow. | Release only with an approved, scoped, expiring waiver. |
| Low | Cosmetic or low impact with no correctness, access, security, licensing, or recovery consequence. | Track in an owned issue. |

Data loss and corruption include silent truncation, destructive migration,
unrecoverable partial output, or overwriting the last recoverable revision. A/V
drift, audio dropout, and dropped video frames are high by default and become
critical when they silently destroy captured input, source state, or the only
recoverable output. Numeric fixture budgets are maintained separately; this
policy cannot relax them.

## Accessibility

Accessibility is a release property, not a cosmetic exception. An inaccessible
critical workflow is critical and cannot be waived. Qualification covers
keyboard operation, accessible names and roles, focus order and restoration,
announcements, supported zoom, contrast, and reduced-motion behavior across the
declared browser and desktop matrix. A platform-specific failure blocks that
tier until corrected and requalified.

## Security, licensing, and provenance

A failed security boundary or missing mandatory license, notice, corresponding
source, provenance, or delivery evidence is critical. These defects cannot be
accepted through a waiver. Disable or remove the affected surface when it can
be isolated; otherwise stop distribution of the product. Threat and licensing
matrices own the detailed boundaries and evidence, while this policy owns the
release consequence.

## Waivers

Waivers are permitted only for medium defects. Each record must contain an ID,
issue, owner, rationale, exact scope, workaround, approver, approval timestamp,
and expiry timestamp. Approval lasts at most 30 days. It does not alter a
numeric quality budget, legal obligation, security boundary, or accessibility
requirement. Expiry blocks the next release; renewal requires a new review and
record rather than editing history.

## Rollback and recovery

Every production artifact must have a known last-safe version and a reversible
distribution action. On a critical discovery, stop promotion, preserve project
and artifact evidence, identify affected versions and tiers, and roll back or
disable the affected surface. Never repair a user's project in place without a
recoverable copy. Security events also follow credential revocation and incident
response; licensing events preserve the publication manifest and halt the
affected download.

After a rollback, repeat the full affected qualification matrix. Schema or
migration changes, codec/runtime/driver changes, security or licensing evidence
changes, platform/hardware changes, budget changes, and any recovery event also
invalidate the relevant prior qualification.
