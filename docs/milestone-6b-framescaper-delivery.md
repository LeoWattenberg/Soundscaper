# Milestone 6B pickup: Framescaper delivery

> Owning pickup contract for the Framescaper half of milestone 6. The
> [milestone-6 plan](milestone-6-plan.md) owns the shared delivery decisions,
> the 6.0 packets, and cross-track sequencing; the
> [roadmap](../roadmap.md#6-professional-delivery-and-interchange) owns product
> scope and status. This document decomposes the 6B summary into slices with
> the five packet fields. Grounded on 2026-08-16 at commit `14f45438`. Its
> siblings are [`milestone-6a-soundscaper-delivery.md`](milestone-6a-soundscaper-delivery.md)
> and [`milestone-6c-interchange-archive.md`](milestone-6c-interchange-archive.md).

## Pickup status and sequencing

**Status on 2026-08-18: 6B-1 is under way.** The delivery canvas is now an
explicit decision rather than a cap: `canvas.size` states the delivered extents
outright and `canvas.fit` (`contain`, `cover`, `stretch`) decides how a source of
another aspect lands in them, so a 9:16 delivery of a 16:9 master is a supported
request. Both are validated at plan build, both ride delivery presets and the
export dialog, and both paths carry them — the graph plan through a canonical
version bump (6 → 8, through WP-6.0.0's constant, because its wasm runner read
canvas fields loosely and would have ignored a new one) and the keyed V7 plan
without one, because its canvas is read as a closed record in canonical field
order and an older build therefore refuses a fit-carrying plan outright.

Two bounds and one gap are worth naming. A keyed canvas is capped at about 2.09
megapixels, which is one RGBA frame fitting the keyframe encoder's 8 MiB stream
limit: 1080×1920 is admitted, 1080×1944 is refused, and the refusal happens at
plan build. The keyed frame rate is still capped at 30 fps by that encoder's own
ceiling. And the video preview still resolves the project's derived canvas, so a
delivery that reframes to 9:16 is not previewed at 9:16 — the preview honours a
fit it is given, but nothing yet gives it the delivery's.

6B opened only after every 6.0 acceptance check passed. Four grounding facts
bound every slice below, and each one narrows scope rather than widening it:

1. **The plan-version surface was a three-way drift until WP-6.0.0 landed.**
   At grounding the planner, the direct contract, the FFmpeg runner, and the
   quality-budget fixture with its security test and narrative each pinned a
   version independently, and three of them had drifted apart. WP-6.0.0 made
   `video-export-plan-version.ts` the only place a version is written down, so
   6B-1's 6 → 8 bump moved one number and its pins followed. A strategy layer
   carries its own version surface
   (`controller/product-video-export-strategy.ts:7`). No 6B slice touches a
   plan version except through that constant.
2. **7B-5 never landed.** Milestone 7 delivered 7A-1/7A-2 only, so at
   grounding there was no vertical canvas or delivery crop stage anywhere in
   `src/common/editor/` and the 720p defaults were the only canvas there was.
   6B-1 owns vertical delivery whole, including acceptance — nothing is
   absorbed. The 720p numbers remain the *automatic* ceiling; they no longer
   bound a delivery that states its own canvas.
3. **The muxer question is closed by measurement**, not deferred: see the
   revised decision in the milestone-6 plan. Muxing is 0.1% of FFmpeg-side
   cost, so 6B-3 reuses the shipped FFmpeg and takes on no new dependency.
4. **Styled captions do not exist.** Milestone 4's caption schema is Planned
   with its revision deliberately unassigned
   (docs/milestone-4-plan.md:381-383); what exists is label tracks with
   sidecar I/O (`src/common/editor/label-io.js:1-2`,
   `controller/label-service.ts:19-67`), and the code records the handoff
   ("when milestone 4 owns a styled caption schema, the target changes
   here", `assistance/transcript-labels.ts:10-11`). 6B-2 therefore scopes
   burn-in to label tracks explicitly and names its upgrade seam.
5. **Every codec-capability licensing row is blocked.** All six rows
   (config/production-licensing-matrix.json:516-576) and the `native-codecs`
   gate (config/production-licensing-matrix.json:437) are shut, and helper
   contract v1's job-kind set is closed with no media/render kind admitted.
   The 5B software substrate exists (plan admission, professional profiles,
   the 5B-3 queue model) but no native binary, no cleared row, and no
   implemented `render-job-port` host
   (`src/common/editor/platform/render-job-port.ts:9-23`). 6B-4 is therefore
   substrate and honest declaration, not enablement.

Since the plan was first grounded, a V7 keyframe export subsystem
(`video-keyframe-export-plan-v7.ts` and siblings, FFmpeg-backed, with a
read-side WebM container verifier in
`video-keyframe-video-container-stream.ts:13-17`) and the V19/V20 export
strategy seams (`src/framescaper/video-export-strategy-v19.ts`,
`video-export-strategy-v20.ts`, `video-export-dispatch-v20.ts`) have landed.
They are plan-seam consumers; 6B options must reach them through the same
builders, not beside them.

Implementation order: **6B-1** (options and the canvas lift) first — every
later slice consumes its option surface; then **6B-2a/6B-2b** (captions) and
**6B-3** (WebCodecs tier) in parallel, file-disjoint; **6B-4** substrate after
WP-6.0.2, its gated rows staying shut; **6B-5** evidence alongside, publishing
last.

## 6B-1 — Canvas, aspect, and delivery options

- **Outcome:** canvas size, rational frame rate, aspect, fit mode,
  background, quality, audio layout, caption selection, and range become
  validated plan/preset options, deliberately lifting the 1280×720@30
  default ceiling (`video-export.js:24-26`, applied at :100-103). Vertical
  (9:16, 1080×1920-class) delivery is owned here whole, including the
  delivery crop stage. Options ride `createVideoExportPlan`
  (`video-export.js:143`) and resolve identically through the wasm path and
  the V19/V20 strategy seams.
- **Invariants:** an unexercised option leaves existing exports byte-stable;
  option validation happens at plan build, never in an encoder; the plan
  version bumps once, through the WP-6.0.0 constant, with the fixture,
  security test, and narrative moving in the same change.
- **Acceptance:** crop-correct goldens including 9:16; byte-stability
  fixtures for default-option exports across the wasm and keyframe paths; a
  rejected option (odd dimensions, unsupported rate) is a typed refusal.
- **Non-goals:** no new codecs or containers; no HDR or 10-bit (6B-4's
  fenced tier); no caption rendering (6B-2).
- **Stop condition:** stop if any option needs per-encoder meaning — the
  plan is the semantic authority — or if the canvas lift would require
  weakening the milestone-2 direct-transport invariants.

## 6B-2a — Caption selection and muxed captions

- **Outcome:** caption-track selection as a 6B-1 plan option; muxed captions
  where the container supports them, removing `-sn`/`-dn` exactly for
  caption-carrying plans (`video-ffmpeg.js:71-72`); sidecar delivery
  (existing `label-io.js` formats) selectable per delivery and itemized in
  the report; a container without caption support reports the omission.
- **Invariants:** mux rides the plan and its args — no post-hoc file
  surgery; a plan without captions keeps emitting `-sn`/`-dn` byte-stably;
  cue text and timing come from the label model only.
- **Acceptance:** `delivery.captionCueErrorFrames lte 1`
  (config/quality-budgets.json:1335) on muxed fixtures reopened by the
  demuxer; a webm/mp4 matrix documents which containers mux and which
  report sidecar-only.
- **Non-goals:** no styling, speakers, regions, or safe-area semantics — the
  milestone-4 schema owns them.
- **Stop condition:** stop if muxing would require a second FFmpeg
  invocation over finished files.

## 6B-2b — Label-track burn-in

- **Outcome:** a burn-in render stage in the filter plan that rasterizes
  selected label tracks with a single deliberately minimal, fixed
  presentation (safe-area-respecting placement, one legible style), scoped
  and labeled as label burn-in. The upgrade seam is named in code: when the
  milestone-4 styled-caption schema lands, the stage consumes it and the
  fixed presentation retires.
- **Invariants:** burn-in is a plan stage with deterministic output —
  golden-testable frames; no styling vocabulary is invented (one fixed
  presentation is a constant, not a schema); sidecar/mux delivery of the
  same track is unaffected.
- **Acceptance:** burned goldens at 16:9 and 9:16 within the calibrated
  frame-comparison thresholds; cue appearance/disappearance within one frame
  of label times.
- **Non-goals:** no per-label styling, no user-configurable fonts or
  placement, no styled-caption schema work.
- **Stop condition:** stop if acceptable burn-in cannot avoid inventing
  styling state — then this slice waits for milestone 4 rather than
  front-running it.

## 6B-3 — WebCodecs encode tier

- **Outcome:** a WebCodecs encode path for qualified SDR outputs whose
  containers are written by the FFmpeg that already ships, falling back
  semantically to the full FFmpeg path — same plan, same goldens
  (roadmap.md:731-732). **The muxer design decision this slice used to own is
  closed:** measurement showed muxing is 0.1% of FFmpeg-side cost and the
  pinned build already stream-copies into both containers, so there is no
  muxer dependency to choose. `src/common/editor/video-remux-ffmpeg.ts` and
  its test are the FFmpeg half, landed ahead of the WebCodecs producer.
  What remains is the producer: a `VideoEncoder` fed from the existing
  offline WebGL frame source, chunks wrapped as an elementary stream, and
  capability detection with semantic fallback.
- **Invariants:** WebCodecs availability never changes what a plan means;
  encoder selection is reported per delivery; the muxer is a reviewed
  dependency under the runtime asset discipline — no codec or muxer byte
  enters the Pages bundle past the ceilings.
- **Acceptance:** same-plan goldens across both encode paths on the
  qualified browser matrix; `delivery.webVideoRenderP95Rtf lte 12`
  (config/quality-budgets.json:1339) in development evidence; an
  unqualified browser reports fallback, not failure.
- **Non-goals:** no HDR, no new codec families, no native encode (6B-4's
  fenced tier).
- **Stop condition:** stop if the two paths' outputs diverge beyond the
  golden thresholds, or if the exact rational rate cannot survive the
  elementary-stream boundary frame-for-frame — an approximate rate is the
  one thing this tier may not trade for speed.

## 6B-4 — Electron format tier and platform presets (substrate only until rows clear)

- **Outcome:** the preset and plan substrate for 4K/HDR, 10-bit, hardware
  encode, image sequences, alpha, and mezzanine delivery, and the platform
  preset catalog — every preset declaring its legal availability from the
  licensing matrix and degrading visibly, per WP-6.0.2. Against today's
  matrix that means: presets exist, declare `blocked` per their rows
  (config/production-licensing-matrix.json:516-576), and resolve to no plan.
  Enablement of any row is external: a cleared licensing decision plus the
  serialized 5.0 contract change admitting a media job kind, plus the 5B
  native binary — none simulated here.
- **Invariants:** a preset never creates legal availability; no codec byte
  ships ahead of its row; the Electron queue binding stays behind
  `PersistentRenderQueuePortV1`
  (`platform/persistent-render-queue-port.ts:39`) and the unimplemented
  `render-job-port` host seam — no second execution path.
- **Acceptance:** every catalog preset renders its legal status and
  fallback; a gated preset's degradation is visible in the dialog and the
  report; no test simulates a cleared row.
- **Non-goals:** no licensing decisions, no FFmpeg enabled-set growth, no
  helper contract changes — those are 5.0/5B-owned.
- **Stop condition:** stop on any codec whose milestone-5 gates are not
  clear — the preset declares unavailability instead; stop if declaring a
  preset would require inventing a licensing vocabulary the matrix does not
  already have.

## 6B-5 — Exit evidence

The 6B surface recorded against the ten-minute video master of
`m6-reference-master-suite-v1` (config/quality-budgets.json:976-987) under
workload `m6-reference-master-delivery` (config/quality-budgets.json:1324-1343):
`delivery.videoFrameCountError eq 0`, `delivery.avDriftMaximumMs lte 20`,
`delivery.captionCueErrorFrames lte 1`, `delivery.webVideoRenderP95Rtf lte 12`
(config/quality-budgets.json:1331-1339). The fixture's 720p spec predates the
6B-1 canvas lift; the companion fixture entry including 9:16 is a reviewed
budget change under the threshold-change rules
(docs/quality-budgets.md:607), never a silent edit. Correctness runs in
ordinary CI; RTF rows qualify only on the named environments, no-retry, and
both are unprovisioned today — the collector refuses to publish acceptance,
exactly as the M5 collector does.
