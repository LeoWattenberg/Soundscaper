# Engineering documentation

This directory documents the contracts a maintainer needs to understand,
change, test, or release Soundscaper and Framescaper. It is organized by task
and subject rather than by the order in which the software was implemented.

For product scope, status, and sequencing, use the
[Soundscaper and Framescaper roadmap](../roadmap.md) or the
[Lightscaper roadmap](../roadmap-lightscaper.md). For end-user instructions,
use the [handbook](../handbook/src/content/docs/index.md). Completed work
packets, dated implementation inventories, and superseded qualification plans
belong in Git history, not in the maintained documentation set.

## Understand or change the architecture

- [Architecture and maintainability](architecture/overview.md) explains source
  ownership, dependency directions, composition, and repository guardrails.
- [Time and media](architecture/time-and-media.md) defines canonical timing,
  edit, retime, proxy, and media-preservation contracts.
- [Production and rendering](architecture/production-rendering.md) covers
  parameter addressing, automation, mixer graphs, keyframes, transitions, and
  renderer-neutral output.
- [Native services](architecture/native-services.md) describes helper
  processes, pathless renderer bridges, native audio and plug-ins, media, and
  package admission.
- [Delivery and interchange](architecture/delivery-and-interchange.md) covers
  export plans, queues, reports, mastering, archives, and interchange formats.
- [Local assistance](architecture/local-assistance.md) explains the optional
  local-model runtime, consent, result, and publication boundaries.
- [Desktop codec providers](architecture/desktop-codec-providers.md) defines
  bundled, operating-system, and external FFmpeg provider selection.
- [Realtime effect workers](architecture/realtime-effect-workers.md) records
  the implemented parallel effect-stack execution contract.

## Develop and test

- [Source graphs](development/source-graphs.md) generates focused dependency
  views for local development.
- [End-to-end coverage](development/end-to-end-coverage.md) explains how Node
  and browser coverage is captured and combined.
- [Quality diagnostics](development/quality-diagnostics.md) defines correctness
  thresholds, performance observations, and how budgets change.
- [Editor performance](development/performance.md) records scaling behavior,
  measured costs, reproduction methods, and correctness guardrails.
- [Smaller performance candidates](development/performance-candidates.md)
  records areas needing representative profiles before implementation.
- User workflow regression audits record reproducible defects and their checks
  for [editing](development/bugfix-editing.md),
  [dialogs](development/bugfix-dialogs.md),
  [import and export](development/bugfix-io.md), and
  [generators, macros, mixer and labels](development/bugfix-generators-macros.md).

## Operate and release

- [Release process](operations/release.md) separates automated evidence,
  optional owner QA, and the owner's release decision.
- [Desktop signing and notarization](operations/signing.md) covers the external
  credentials and first-candidate workflow.
- [Build local-model runtimes](operations/local-models/build-runtimes.md),
  [publish local models](operations/local-models/publish.md), and
  [run real-model tests](operations/local-models/nightly-tests.md) cover the
  model runtime lifecycle.
- [Reproduce model conversions](operations/local-models/conversion-reproduction.md)
  records the pinned conversion protocol.
- The optional owner checklists are separate for
  [Soundscaper](operations/qa/soundscaper.md) and
  [Framescaper](operations/qa/framescaper.md).

## Review policy and compliance

- [Production threat model](policies/security.md) is the narrative security
  authority paired with the machine-readable security matrix.
- [Production licensing and provenance](policies/licensing.md) defines source,
  notice, redistribution, and corresponding-source requirements.
- [Project compatibility](policies/project-compatibility.md) defines readable
  project families, preservation, fallbacks, and migration behavior.
- [Licensing review checklist](policies/licensing-checklist.md) is the owner's
  release worksheet.

## Work on product features

- [Framescaper capture](features/framescaper-capture.md) covers permission,
  durability, recovery, publication, and privacy.
- [Framescaper Web VCR](features/framescaper-web-vcr.md) covers the isolated
  desktop guest and its cropped capture path.
- [Framescaper image media](features/framescaper-images.md) defines current
  image import behavior and the remaining format boundary.

## Look up evidence and reference material

- [Audacity effect parameters](reference/audacity-effect-parameters.md) records
  the AUP4 parameter audit.
- [Interchange conformance](reference/interchange-conformance.md) explains the
  independent readers and schemas used for validation.
- [Bundled codec corresponding source](reference/bundled-codec-corresponding-source.md)
  gives exact rebuild and replacement instructions.
- [Local-model provenance](reference/local-model-provenance.md) records the
  evidence required before a model can be offered.
- The dereverberation record is split into the
  [current design](research/dereverberation/overview.md),
  [empirical bake-off](research/dereverberation/bakeoff.md), and
  [ONNX conversion record](research/dereverberation/onnx-conversion.md).

## Consult durable decisions

- [Family-v1 project baseline](decisions/project-family-v1.md) records the
  independent Soundscaper and Framescaper baseline freeze.
- [Product origins and handoff](decisions/product-origins.md) records the
  separate-origin cutover and permanent editable-copy transfer route.

## Maintaining this directory

Keep current behavior and stable design constraints here. Put status and future
ordering in a roadmap, user workflows in the handbook, executable truth in
source and machine-readable registers, and one-off implementation narration in
the commit or pull request that performed the work. When a policy paragraph is
bounded by `policy-narrative` comments, edit its owning register and run the
documented synchronization command; never edit the generated paragraph by
hand.
