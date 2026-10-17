# Engineering documentation

This directory documents the contracts a maintainer needs to understand,
change, test, or release Soundscaper, Framescaper, and Lightscaper. It is organized by task
and subject rather than by the order in which the software was implemented.

For product scope, status, and sequencing, use the
[Soundscaper and Framescaper roadmap](../roadmap.md) or the
[Lightscaper roadmap](../roadmap-lightscaper.md). The planned motion-graphics
program has its own [Motionscaper implementation order](development/motionscaper-implementation-order.md).
For end-user instructions, use the [handbook](../handbook/src/content/docs/index.md).
Completed work
packets, dated implementation inventories, and superseded qualification plans
belong in Git history, not in the maintained documentation set.

## Understand or change the architecture

- [Architecture and maintainability](architecture/overview.md) explains source
  ownership, dependency directions, composition, and repository guardrails.
- [Lightscaper application boundaries](architecture/lightscaper.md) defines
  the separate photo application, catalog storage and history, shared image
  evaluation, and explicit product interchange.
- [Photo source preparation](architecture/lightscaper-import-preparation.md)
  defines bounded source admission, shared decoding, and immutable metadata facts.
- [Managed photo import](architecture/lightscaper-managed-import.md) defines
  original custody, publication, digest dedupe, and interruption recovery.
- [Photo library sessions](architecture/lightscaper-photo-library-session.md)
  defines bounded menu-owned browsing, import bridges, and resource lifetime.
- [Photo Develop workspace](architecture/lightscaper-develop-workspace.md)
  defines per-version history, scoped rendering, settings selection, and durable batch receipts.
- [Opt-in GPU Develop preview](architecture/lightscaper-develop-gpu-preview.md)
  defines native WB/tone execution, whole-recipe CPU fallback, bounded ownership and remaining GPU scope.
- [Full-resolution Develop inspection](architecture/lightscaper-develop-full-resolution-zoom.md)
  defines authenticated original reads, fixed render profiles and scoped zoom presentation.
- [Photo export sidecars](architecture/lightscaper-photo-export-sidecar.md)
  defines the versioned saved-recipe and metadata JSON projection beside rendered images.
- [Editable photo and still handoff](architecture/lightscaper-image-handoff.md)
  defines authenticated archive selection, native original verification and selected-library publication.
- [Shared Texture](architecture/video-texture.md)
  defines deterministic alpha-weighted medium-frequency luma contrast and shared render ownership.
- [Shared deterministic Grain](architecture/video-grain.md)
- [Shared RGB noise reduction](architecture/video-noise-reduction.md)
  defines reversible luma/chroma neighborhoods, integer process math and original-alpha transport.
- [Shared Dehaze process](architecture/video-dehaze.md)
  defines alpha-aware transmission, bounded white-atmosphere reconstruction and shared pixel ownership.
- [Shared post-crop vignette](architecture/video-post-crop-vignette.md)
  defines natural-stage coordinates, integer process math, and original-alpha transport.
- [Shared color grading wheels](architecture/color-grading-wheels.md)
  defines overlapping LGG authoring, the explicit scalar process and shared render ownership.
- [Develop split preview](architecture/lightscaper-develop-split-preview.md)
  defines the opted-in divider, matched viewports and joined presentation ownership.
- [Develop preset restore](architecture/lightscaper-develop-preset-restore.md)
  defines physical preset presence and archive restoration.
- [Develop presets during photo import](architecture/lightscaper-develop-import-presets.md)
  defines explicit preset selection and revision-fenced import preparation.
- [Opt-in photo import options](architecture/lightscaper-import-options-ui.md)
  defines authored drafts, explicit preset loading, and durable import acknowledgements.
- [Photo batch rename](architecture/lightscaper-batch-rename.md)
  defines bounded name plans and revision-fenced per-photo publication.
- [Bounded batch rename presentation](architecture/lightscaper-batch-rename-ui.md)
  defines explicit name previews, partial results and menu-owned inverse undo.
- [Photo catalog backup snapshots](architecture/lightscaper-catalog-backup.md)
  defines revision-fenced catalog enumeration and authenticated retained-original archive output.
- [Photo catalog archive V5](architecture/lightscaper-catalog-archive-v5.md)
  defines complete mixed recipe and immutable LUT transport, bounded private restoration and unchanged publication authority.
- [Catalog backup presentation and destination lifetime](architecture/lightscaper-catalog-backup-ui.md)
  defines menu-owned saving, joined cancellation, and final file delivery acknowledgements.
- [Large photo-library diagnostics](architecture/lightscaper-large-library-diagnostics.md)
  defines the pinned native catalog fixture and bounded import, scroll, filter, and search observations.
- [Disposable photo preview preparation](architecture/lightscaper-preview-preparation.md)
  defines shared resize recipes and bounded original-free preview bodies.
- [Photo catalog definitions](architecture/lightscaper-catalog-definitions.md)
  defines bounded hierarchy and collection commands, scalar pages, and revision fencing.
- [Retained-original photo regeneration](architecture/lightscaper-original-frame-regeneration.md)
  defines authenticated native decoding and callback-scoped pixel custody.
- [Shared HDR exposure merge](architecture/lightscaper-hdr-merge.md) defines
  canonical brackets, lossless generated Originals, scoped staging and guarded publication.
- [Photo preview cache ownership](architecture/lightscaper-preview-cache.md)
  defines disposable paired storage, bounded demand scheduling, and original-custody fences.
- [Lightscaper editor copy](architecture/lightscaper-editor-copy.md)
  defines the small English/German editor defaults and guarded locale-loading boundary.
- [Translation catalog build ownership](architecture/translation-catalog-build.md)
  defines bounded generated chunks with complete lazy-loaded catalog contents.
- [Photo preview presentation](architecture/lightscaper-preview-presentation.md)
  defines opt-in canvas surfaces, serial pixel custody and compound memory budgets.
- [Photo catalog query workflows](architecture/lightscaper-catalog-workflows.md)
  defines menu-owned search/sort/filter, bounded definition selectors and explicit index preparation.
- [Photo catalog organization](architecture/lightscaper-catalog-organization.md)
- [Photo library culling](architecture/lightscaper-culling.md)
- [Photo import settings and presets](architecture/lightscaper-import-settings.md)
  defines bounded display-name recipes, authored metadata, keyword admission and revision-fenced presets.
- [Managed SDR pixel grading](architecture/pixel-frame-managed-sdr-grade.md)
- [Photo catalog queries](architecture/lightscaper-catalog-query.md)
  defines global sort order, bounded sparse scans and resumable query index migration.
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
  profiling methods, regression checks, and correctness guardrails.
- [Smaller performance candidates](development/performance-candidates.md)
  records areas needing representative profiles before implementation.
- [Editing performance boundaries](development/editing-performance-opportunities.md)
  records remaining optimization opportunities and the contracts they must preserve.

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

- [Desktop Blender integration](development/desktop-blender.md) covers track-list
  export, add-on installation, and live audio updates in Blender.
- [Framescaper capture](features/framescaper-capture.md) covers permission,
  durability, recovery, publication, and privacy.
- [Framescaper Web VCR](features/framescaper-web-vcr.md) covers the isolated
  desktop guest and its cropped capture path.
- [Framescaper image media](features/framescaper-images.md) defines current
  image import behavior and the remaining format boundary.

## Look up evidence and reference material

- [audio.com native project sync](research/audio-com-project-sync.md) records
  the authorization scopes, metadata/block wire format, and adapter boundary.
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
the commit or pull request that performed the work. Completed bug-fix audits and
performance-batch inventories, measurements, and validation logs belong in Git
history; keep reusable profiling tools and regression tests with their owners.
Preserve release, provenance, and compliance evidence in its established registers.
Before removing a record, move any open work or durable design constraint into
the relevant guide or roadmap. When a policy paragraph is
bounded by `policy-narrative` comments, edit its owning register and run the
documented synchronization command; never edit the generated paragraph by
hand.
