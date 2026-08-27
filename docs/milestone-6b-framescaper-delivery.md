# Milestone 6B pickup: Framescaper delivery

> Owning pickup contract for the Framescaper half of milestone 6. The
> [milestone-6 plan](milestone-6-plan.md) owns the shared delivery decisions,
> the 6.0 packets, and cross-track sequencing; the
> [roadmap](../roadmap.md#6-professional-delivery-and-interchange) owns product
> scope and status. This document decomposes the 6B summary into slices with
> the five packet fields. Grounded on 2026-08-16 at commit `14f45438`. Its
> siblings are [`milestone-6a-soundscaper-delivery.md`](milestone-6a-soundscaper-delivery.md)
> and [`milestone-6c-interchange-archive.md`](milestone-6c-interchange-archive.md).

## What reviewing the finished track changed

**The track was reviewed on 2026-08-19, after every slice was marked complete,
and the review found defects the gates could not.** Every local gate was green
at the time: typecheck, lint, dependency-cruiser, the file-size ceiling, the
coverage thresholds, 8803 node tests, and the encoder-tier browser spec on
Chromium and Firefox. What follows is what that did not cover, recorded here
because a milestone's own document is where the next reader looks.

Three defects were reachable from the export dialog. Choosing any delivery
target exported a WAV: the target carried the plan's bare `mp4` into a request
whose `video-` prefix is what the router reads, so every targeted delivery went
down the audio path, where an unrecognized format normalizes to WAV. Stating any
canvas field while a target was selected replaced that target's whole canvas, so
a background colour dropped a 1080x1920 cover delivery to the automatic canvas
while the report still named the target. And a caption track with nothing in the
delivered range staged a zero-byte SubRip document, which the shipped FFmpeg
refuses to open — a delivery that died in the encoder with a message that never
mentioned captions, in the slice whose invariant says an option is validated at
plan build.

The burned picture had two of its own. The stage was sized from canvas height
alone and `drawtext` neither wraps nor clips, so on the catalog's own 1080x1920
target a caption past 28 characters drew off both edges; the type is now the
smaller of the height rule and a width rule, and the text wraps. And the `enable`
window was closed at both ends, so a cue ending exactly where the next begins —
which is what a transcript label track produces — drew both captions on the frame
they share. Both were measured through the pinned core, before and after.

Burn-in also staged one font file, the Latin subset, and this build has no
fontconfig to fall back through: every Cyrillic and Greek caption burned in as
blanks. The subset is chosen per cue now, out of the seven the interface already
loads. A script whose letters and accents live in different subsets still cannot
be drawn whole from one file; those characters are named in the delivery report
rather than left blank in the picture.

The keyed path carried four latent defects, none of them reachable while the app
mounts V18 or V19. Its renderer refused any canvas past 1280x720, so the vertical
delivery its plan admits could never have rendered a frame. It refused any
background but `#000000`. Its deliveries reported no frame rate at all, because
the inventory read only the decimal spelling. And a cancelled keyed export
surfaced as a failed one, because cleanup after the runtime had been terminated
produced refusals the caller aggregated. All four are fixed. The keyed path still
cannot deliver captions — it stages no files and stream-copies its picture — but
it now refuses the request instead of dropping it silently.

Five pieces of the acceptance evidence did not hold, each established by mutating
the product and watching the suite stay green: the keyed delivery fit, the
burn-in placement, the audio-layout wiring, the two tiers' audio parity, and a
remux module the packet named as 6B-3's FFmpeg half that nothing imported. Each
now has a test that goes red against that mutation, and the orphan is gone.

The exit gate had one of its own. 6B-5 registered the vertical companion so the
gate would cover the reframing, and made a run deliver at both canvases — but
`delivery.webVideoRenderP95Rtf` read a flat list of five timings with nothing
saying which delivery they measured. Timings are keyed by canvas now, and the
row reads the slowest one.

## Pickup status and sequencing

**Status on 2026-08-19: every 6B slice is complete.** 6B-1 lifted the canvas,
6B-2a and 6B-2b delivered captions as sidecars, muxed tracks and burn-in,
6B-3 added the WebCodecs encode tier with its browser evidence, 6B-4 declared
the platform delivery targets without clearing a licensing row, and 6B-5 made
the exit gate cover the vertical canvas the milestone added. What each slice
settled, and what it left for another milestone, is recorded below.

The delivery canvas is now an
explicit decision rather than a cap: `canvas.size` states the delivered extents
outright and `canvas.fit` (`contain`, `cover`, `stretch`) decides how a source of
another aspect lands in them, so a 9:16 delivery of a 16:9 master is a supported
request. Both are validated at plan build, both ride delivery presets and the
export dialog, and both paths carry them — the graph plan through a canonical
version bump (6 → 8, through WP-6.0.0's constant, because its wasm runner read
canvas fields loosely and would have ignored a new one) and the keyed V7 plan
without one, because its canvas is read as a closed record in canonical field
order and an older build therefore refuses a fit-carrying plan outright.

Quality is the second option to land, and it is a tier rather than a number:
a plan states `draft`, `balanced`, or `high`, and each delivery path reads that
tier into its own encoder settings. That is the slice's stop condition honoured
rather than skirted — a plan carrying a CRF would only mean something to the
encoder it was written against, which would strand 6B-3's WebCodecs tier and
6B-4's platform encoders. `balanced` reproduces the arguments delivery already
produced, so an untouched export stays byte-stable, and both FFmpeg-backed paths
now read one shared mapping instead of the two hard-coded copies they had.

Audio layout follows the same rule from the other side. A delivery states
`preserve`, `mono`, or `stereo`, and the layout is applied to the rendered mix
before it is staged as WAV rather than to an encoder argument — both video paths
consume that staged file, so a downmix left to the encoder would have reached
only the composed graph. It reuses the audio exporter's own mapping, so a mono
video delivery and a mono audio delivery are the same downmix. A custom matrix
stays with the audio dialog, which has the per-channel editor that makes one
legible.

The slice's acceptance evidence is in `tests/fixtures/video-delivery-goldens.ts`.
Byte-stability is measured rather than asserted: the default-option argument
vectors were regenerated at 1f2502ee — five commits before 6B-1's first change,
which is the last commit whose delivery arguments this milestone had not touched
— and came back identical on both the composed-graph and keyed paths. The crop
goldens pin the readable geometry each 9:16 fit produces — letterboxed at
1080x608 with 656 above and below, cropped by overlaying a 3413-wide frame that
overhangs by 1166 on the left and 1167 on the right, or stretched to the canvas
outright.

Three bounds are worth naming, all on the keyed path. A keyed canvas is capped at
about 2.09 megapixels, which is one RGBA frame fitting the keyframe encoder's
8 MiB stream limit: 1080×1920 is admitted, 1080×1944 is refused, and the refusal
happens at plan build. The keyed frame rate is still capped at 30 fps by that
encoder's own ceiling. And a keyed background is a hex colour, because that path
clears a WebGL target itself and has no FFmpeg colour palette to resolve a name
against; the composed graph still takes either.

The preview gap this section used to name is closed. While the export dialog is
open and stating a video delivery it publishes the canvas it means, and the
preview resolves against that rather than the project's own derived canvas, so a
9:16 reframing is judged before the render rather than after it.

One defect of this slice's own making was found later and is fixed. The offline
export closed its canvas record against `width`, `height` and `frameRate` only,
while the V20 strategy passed the `fit` every keyed plan states — so the keyed
path refused its own plan and no keyed export reached a frame. The seam went
untested because the strategy test asserts the fit is passed while faking the
encoder, and the export test built its own canvas without one. Dropping the fit
would have been the quieter bug of the two: a delivery that asked to crop would
have been letterboxed with nothing to say so.

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
4. **Selected V27 now has explicit caption tracks.** Its locally implemented
   M1–M4 route supports SRT, WebVTT, and a bounded IMSC 1.1 subset, pending
   guided-local and external qualification. That route deliberately grants no
   caption burn-in or mux authority. The historical 6B-2 implementation below
   consumes label tracks through its existing sidecar/burn-in seam; adopting
   the V27 track model remains an explicit later delivery integration rather
   than an implied current capability.
5. **Codec licensing review is release evidence, not test activation.** The six
   native targets are implemented and visible for testing. Helper contract v1
   admits their closed media/render kinds, and 5B has V7–V12 plan admission,
   professional profiles, a V2 queue/controller, and a bounded FFmpeg source
   host. Exact payload, target, platform, containment, and project-authority
   checks still fail closed at execution. The licensing rows are reported by
   milestone 9 and block stable 1.0 admission only.

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
WP-6.0.2, with its catalog enabled for testing; **6B-5** evidence alongside,
publishing last.

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

**6B-2a landed on 2026-08-18, and the container matrix it asked for is short
because both shipped containers carry captions.** Measured against the pinned
`@ffmpeg/core` 0.12.10 rather than inferred: MP4 muxes as `mov_text` (3GPP timed
text) and WebM as `webvtt`, both encoders are present in the build, and a
caption-carrying command produced by this code round-trips through the demuxer
with its cue text and timing intact. The reporting path for a container that
cannot carry captions exists and is exercised by a plan-build refusal, but no
shipped container reaches it.

One measured characteristic is worth recording. A WebM delivery that also
carries audio shifts its whole timeline by about 14 ms — the Opus encoder's
priming, applied by the muxer — and the cues shift with it. Without audio the
cues land exactly. At 30 fps that is 0.42 frames, inside the slice's
`delivery.captionCueErrorFrames lte 1` budget, and it is a container property
rather than anything the caption path does.

The muxed document is always SubRip whatever sidecar the caller picked, because
both subtitle encoders read it losslessly for plain cues and one staged form
keeps the muxed track independent of the sidecar decision. Only `-sn` is dropped
for a caption-carrying delivery; `-dn` stays, because a source's data streams
have nothing to do with captions.

**6B-2b landed the same day, and two of its decisions were settled by measuring
the shipped runtime rather than by preference.** The pinned core's libass has no
font provider, so the `subtitles` filter exits zero and draws nothing at all —
which is why burn-in goes through `drawtext` with a font staged explicitly. And
that build's FreeType reads WOFF but refuses WOFF2, so the staged font is the
WOFF the design system already ships: Inter semibold, already a declared OFL
dependency, so burning captions in adds a use rather than a licensing row.

Cue text is read from a staged file per cue rather than written into the filter
graph. That is not caution: the escaped form was compared byte-for-byte against
the file form across ten awkward strings, and it got a plain `16:9` wrong —
FFmpeg refused the command outright — along with quotes, backslashes and
percent signs. One `drawtext` per cue, because a filter's text is fixed for the
whole graph and only its `enable` window varies, which is also why the slice
bounds a burned delivery at 2000 cues rather than emitting a graph no runtime
will parse.

The presentation is one constant, not a schema: Inter semibold at 4.5% of canvas
height with a floor, white on a 55% black box, centred in the bottom 10%
title-safe band. Milestone 4 owns styled captions; the seam is the whole of
`video-caption-burn-in.ts`, so when that schema lands the module consumes it and
these constants retire. Timing was verified against the runtime at 10 fps: each
cue's appearance and disappearance falls inside one frame of its label time.

## 6B-2a — Caption selection and muxed captions

- **Outcome:** caption-track selection as a 6B-1 plan option; muxed captions
  where the container supports them, removing `-sn` exactly for caption-carrying
  plans while `-dn` stays, since a source's data streams have nothing to do with
  captions; sidecar delivery
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

**6B-3 is complete.** Capability detection, the elementary-stream boundary, the
producer, the execution path, the service wiring and the browser evidence have
all landed. Two measured facts shaped what exists. The pinned core's IVF *demuxer* reads a
hand-built header correctly — `Input #0, ivf ... Video: vp9 (Profile 0) (VP90),
25 tbr` — so the VP9 remux direction this tier needs is sound. Its IVF *muxer*
crashes the wasm outright with a memory access fault, which is a hazard worth
knowing but not one this tier walks into, because nothing here ever muxes to
IVF. The H.264 half was checked end to end: a real elementary stream remuxed
into MP4 through `buildVideoRemuxArgs` at 30000/1001 and came back `29.97 tbr`,
so the exact rational survives the boundary the slice's stop condition names.

The producer has since landed too: it renders the same frames the FFmpeg path
renders, hands each to a `VideoEncoder`, and writes the elementary stream as it
goes. Timestamps come from the rational rate in microseconds rather than from a
decimal frames-per-second, which is the slice's stop condition met rather than
approximated. The encoder queue is bounded, because one RGBA frame is megabytes
and an unbounded queue is the tab falling over, and a failed or aborted encode
closes the encoder and throws instead of returning the chunks it happened to
collect. The quality tier is read a second way here — as a bitrate rather than a
CRF — which is exactly why the plan states a tier and neither number.

The wiring is in the export service, before anything is encoded, because the
delivery report is written from the plan and a decision taken deeper could never
have appeared in it. It travels down through the product strategy to the encoder
that runs, and every delivery — accelerated or not — carries a `delivery.encoder`
item, because which encoder ran cannot be recovered from the finished file. Each
fallback states its own reason: a browser without the API, a browser that
refuses the codec, a canvas past every level, or a composed-graph delivery that
has nowhere to put encoded chunks. Asking the question may never fail a
delivery, so a plan the probe cannot describe falls back to the encoder that was
going to run anyway and says so.

What the two tiers share is deliberate and structural. The container, the
mapping, the metadata stripping and the audio encoder are written once per
format and used by both, so the two differ in how the picture was compressed and
in nothing else; a test holds the two argument vectors against each other. The
concurrency is shared for the same reason — a producer and a subprocess running
at once, either able to fail first, with rings, lease and abort signal to unwind
exactly once — since cleanup that differs between two delivery paths is the
defect no golden-output comparison can see. The tiers disagree about one thing
only: raw frames have an exact expected byte total, while an encoded stream's
completion means the producer closed its ring.

The evidence is `tests/browser/audio-editor-video-delivery-encoder-tiers.spec.js`.
Byte equality is not the claim and cannot be, so the same plan is encoded by both
tiers in Chromium and the deliveries are compared as pictures: same length in
frames, both read back by FFmpeg at `29.97 tbr` — the exact rational surviving
the elementary-stream boundary, which is this slice's stop condition — and
decoded pictures differing by 1.4 of 255, against a bound of 4. Firefox and
WebKit run the fallback half, where the decision must report a reason rather
than fail.

That spec earned its keep on its first run. The producer waited for the encoder
queue to drain on a microtask, and an encoder does its work and delivers its
chunks in tasks: the queue could not shrink while the loop held the thread, so
the page froze outright. No unit test could have seen it, because a synchronous
fake encoder returns its chunk before the queue is ever measured. The wait now
yields to the task queue, preferring the encoder's `dequeue` event where a
browser implements it, and the regression test drains on a timer the way a real
encoder does.

Levels are computed from the specifications' own tables rather than guessed:
720p30 resolves to H.264 3.1 and VP9 3.1, 1080p30 to 4.0 and 4.0, 1080p120 to
5.1, and a canvas past every level is refused with the reason instead of at an
encoder that would only say "unsupported". Every fallback carries why, because a
delivery that quietly took the slower path is the reporting failure this
milestone's gate exists to catch.

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

**6B-4's substrate landed on 2026-08-18 and is enabled for testing.** The
catalog names nine delivery targets, including six native targets — 4K HDR10,
10-bit SDR, hardware H.264, ProRes mezzanine, alpha mezzanine, and PNG image
sequences. Human licensing status never hides or disables them. On the browser
executor, a native request follows its declared fallback and reports
`executor-unavailable`; on the native executor, exact payload, target,
platform, containment, capacity, consent, and project-authority checks decide
whether work can run.

The app retains the relevant licensing snapshot for milestone-9 reporting and
stable 1.0 admission. It is not execution authority, and neither a pending nor
an unknown human-review row changes build, package, catalog, or test behavior.

## 6B-4 — Electron format tier and platform presets

- **Outcome:** the preset and plan substrate for 4K/HDR, 10-bit, hardware
  encode, image sequences, alpha, and mezzanine delivery, and the platform
  preset catalog. Every implemented preset is visible and testable. Browser
  delivery degrades a native target visibly because that executor cannot run
  it; native delivery requires an authenticated 5B payload and the exact
  machine-verifiable runtime authorities. Licensing status is milestone-9
  stable-release evidence, never current execution authority.
- **Invariants:** a preset never creates legal availability; no codec byte
  ships ahead of its row; the Electron queue binding stays behind
  `PersistentRenderQueuePortV1`
  (`platform/persistent-render-queue-port.ts:39`) and the unimplemented
  `render-job-port` host seam — no second execution path.
- **Acceptance:** every catalog preset is selectable; a browser-executor
  fallback is visible in the dialog and report, while an authenticated native
  route runs or reports one exact machine-verifiable reason.
- **Non-goals:** no licensing decisions, no FFmpeg enabled-set growth, no
  helper contract changes — those are 5.0/5B-owned.
- **Stop condition:** stop current execution only when an exact payload,
  platform, containment, capacity, consent, or project-authority check fails.
  Stop stable 1.0 admission when a required milestone-9 licensing review is
  pending.

## 6B-5 — Exit evidence

**6B-5 is complete, in the only sense a gate with no lab can be.** The 6B
surface is recorded against the ten-minute video master of
`m6-reference-master-suite-v1` under workload `m6-reference-master-delivery`:
`delivery.videoFrameCountError eq 0`, `delivery.avDriftMaximumMs lte 20`,
`delivery.captionCueErrorFrames lte 1`, `delivery.webVideoRenderP95Rtf lte 12`.
Not one threshold moved for this slice.

What did change is what the gate covers. The suite's 720p canvas predates the
6B-1 canvas lift, so on its own it could no longer exercise the thing this
milestone added: a run could deliver the landscape master twice, satisfy every
threshold, and never reframe anything. `m6-reference-master-vertical-v1` is now
registered beside it — a companion entry rather than an edit, because a fixture
change is a new fixture revision and never a silent edit to a baseline
(docs/quality-budgets.md, "Milestone 6 reference master, and its vertical
companion"). It is the same master at 1080×1920, identical in audio and video
duration and in frame rate, which is what keeps one real-time denominator
correct for both.

Registering it would have been decorative without three refusals, so the
collector has them. A video artifact must now state the canvas it delivered, and
a run that files no delivery at a registered canvas is rejected rather than
scored. A companion that drifts on duration or rate is refused, because the
shared denominator would otherwise be measuring the wrong length of media with
nothing to say so; so is one whose canvas duplicates the suite's, which would
erase the distinction it exists to draw. And every registered fixture must reach
`qualified` before acceptance, each named individually in the blocker list, so a
companion left behind cannot quietly stop covering 9:16.

Correctness runs in ordinary CI; the RTF rows qualify only on the named
environments, no-retry, and both are unprovisioned today. Both fixtures remain
`planned`. The collector therefore still refuses to publish acceptance and names
every fact the lab owes, exactly as the M5 collector does.
