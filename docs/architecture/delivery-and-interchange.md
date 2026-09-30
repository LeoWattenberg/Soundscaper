# Delivery and interchange

Delivery turns a validated project plan into user-owned artifacts. Interchange
describes the same project or render for another application. Both use the
editor's canonical timing, visibility, media, and publication rules; neither is
a parallel export engine.

This page records the maintained semantic and publication contracts. Current
source modules and machine-readable registers are authoritative; roadmap status
and diagnostic campaigns do not change delivery behavior.

## Authorities

- `createExportPlan` and the video plan builders define delivery semantics.
- `src/common/editor/video-export-plan-version.ts` is the graph-plan version
  authority. Other plan families have separate closed version surfaces.
- `delivery-preset.ts`, `delivery-queue.ts`, and `delivery-report.ts` own the
  shared preset, queue, and report vocabularies.
- Product strategies and admitted browser or desktop executors run an already
  validated plan; they do not change its meaning.
- `config/production-licensing-matrix.json` and the
  [licensing policy](../policies/licensing.md) decide what may be
  distributed. A preset or runtime probe cannot grant that permission.
- Project identity, opaque custody, and fallback preservation remain governed
  by [`project-compatibility.md`](../policies/project-compatibility.md).

`config/quality-budgets.json` describes automated diagnostics, not release
certification. The repository owner makes the release decision under the
[release policy](../operations/release.md).

## Common delivery contract

One semantic plan serves direct export, queued delivery, browser execution,
native execution, presets, batches, and reports. A backend extends plan
admission and execution; it does not invent backend-only project meaning.

Options are validated before expensive work or destination publication.
Unknown versions, unsupported combinations, unavailable capabilities, and
losses that cannot be represented truthfully are typed refusals.

Every conversion, omission, fallback, and conformance result appears in a
delivery report. The shared dispositions are `preserved`, `converted`,
`missing`, and `omitted`. Successful output with an unreported conversion is a
contract failure.

Publication preserves the direct-save boundary: select destination authority
before rendering; write to an isolated temporary sink or sibling; seal and,
where supported, reopen and verify the result; then commit atomically without
replacing an unrelated output. Cancellation, failure, stale authority, or
supersession publishes no partial member.

Executor selection is reported. Browser or hardware capability may choose a
faster route only for the same plan. An unavailable route follows the declared
fallback or reports one exact refusal reason; it never silently changes canvas,
timing, channels, captions, color, or quality.

## Reports, presets, and queues

A report records resolved settings, format, range, channel map, dither,
resampling, loudness and normalization, encoder or fallback choice, conformance,
and every conversion or omission. Reports save through the `report` file-service
purpose and are available from the delivery-report menu.

Reports are sealed values. A stage that learns new facts rebuilds the report
from its inventory instead of appending after counts were fixed. Missing
evidence stays absent or explicitly unverified; it never becomes an invented
zero or pass.

A preset is versioned, validated data over plans. It may declare container,
codec, profile, color, audio layout, captions, metadata, executor, fallback,
and licensing status, but contains no private encode path. Catalog visibility
is distinct from execution and distribution. A native target can remain visible
on the browser executor and resolve to a reported unavailable fallback.

The in-session queue provides ordering, explicit reorder, pause between jobs,
cancel, and retry from failure. Each persistent backend declares either tested
resume from authenticated checkpoints or atomic verified restart. Pausing does
not claim that arbitrary encoder bytes can be suspended and resumed.

Queue records contain bounded plans, fingerprints, grants, destinations,
reservations, state, progress, and attempt metadata—not media bodies. Recovery
revalidates the project revision, plan, sources, destination, runtime, and
checkpoints before continuing.

## Audio delivery

Audio delivery extends the ordinary export plan and renderer. Format writers,
channel limits, dither, mapping, resampling, stem archives, and direct
publication remain shared with ordinary export.

### Mastering sequences

A mastering sequence is an ordered view over timeline-annotation regions.
Entries reference region identity and own order, metadata, preceding gap, and
fades; they do not copy time ranges or audio. All positions resolve through the
runtime annotation projection.

Delivery renders each unique region through the ordinary offline renderer,
inserts real silence for gaps, and applies entry fades to output. Each gap and
extent is scaled before output positions are accumulated so rounding cannot move
a boundary away from its audio. The project is never mutated.

Missing or invalid regions produce a typed validation error rather than a
silently shortened sequence. There is no realtime-stream fallback because a
contiguous project stream does not represent the assembled timeline. Stems and
ADM are refused because the maintained plan defines no sequence semantics for
them.

Where a writer supports cues, entries reuse RIFF marker interchange. A writer
without cue support reports the omission without changing audio bytes.

### Loudness, conformance, and batches

Loudness normalization is a plan step, never an encoder flag. The pipeline
measures rendered material, computes one gain from the integrated target and
true-peak ceiling, applies it after channel mapping in the neutral path, and may
measure the delivered samples again.

If the true-peak ceiling prevents the integrated target, gain stops at the
ceiling and the report records the shortfall; delivery adds no unstated limiter.
Normalization is refused for stems, ADM passthrough, and realtime fallbacks.
The destructive loudness effect remains a separate editing action.

When captured, the delivered measurement is stamped into broadcast metadata
and reported beside the projection. A material disagreement is its own finding.
A delivery that does not capture a second measurement reports projections only.

Conformance reads produced bytes before publication when a maintained reader
exists. It checks duration, rate, sample format, channel count and map,
broadcast metadata, cues, ADM, and stamped loudness. A failed check fails the
delivery after sealing an explanatory report. An unsupported or streamed format
reports `conformance-unverified`; lack of a reader is not a pass.

A batch is a list of ordinary plans plus a manifest. Mixes, selections, loops,
regions, mastering sequences, stems, and preset/range alternates are independent
members. Each owns its output and report; the batch also lists members that did
not run. Completed members may publish, but no individual member publishes
partially. Retry selects failed members from the report.

Authored immersive delivery supports beds through 7.1.4, positioned objects,
and binaural rendering. Bed and object routes flatten into one explicit channel
mapping. The binaural report names the renderer and its limitations instead of
implying a measured HRTF.

ADM passthrough is separate: neutral path, no dither, exact full-source shape,
and chunk preservation. It reproduces admitted bytes or refuses. Authored
immersive features never weaken its refusal rules.

## Video delivery

`canvas.size` states output extent and `canvas.fit` selects `contain`, `cover`,
or `stretch`. Preview and every executor consume the same decision. Quality is
the semantic tier `draft`, `balanced`, or `high`, which each encoder maps to its
own settings; plans do not carry encoder-specific CRF or bitrate values.

Audio layout is `preserve`, `mono`, or `stereo` and is applied to the rendered
mix before video staging. Every video executor receives the same audio. Custom
matrices remain in the audio workflow where per-channel meaning is visible.

Caption delivery is explicit: sidecar through the maintained text writers,
muxed when container and executor admit a track, or burned as a deterministic
render-plan stage. Cue selection and timing are validated before encoding. An
empty range, adjacent cues, script/font gaps, unsupported styling, or a path
that cannot stage captions is handled or reported deliberately. A keyed path
without caption staging refuses captions.

An admitted WebCodecs tier and its maintained fallback consume identical frame,
container, audio, mapping, and metadata plans. Elementary-stream timestamps are
derived from the exact rational frame rate, never a decimal approximation.
Encoder selection and fallback reason are report items.

Platform presets may describe 4K, HDR, 10-bit, hardware encode, mezzanine,
alpha, or image sequences. A preset cannot add codec bytes or clear source,
patent, notice, or provenance requirements. Required color, precision, HDR, or
alpha facts that an executor cannot preserve are refused before work.

## Interchange profiles

EDL, OTIO, and FCPXML describe the rendered edit. They use the shared
interchange visibility projection, including inherited folder state and solo.
Audio mute does not imply picture invisibility. An unrepresentable clip or
feature becomes a report item, never an unreported `continue`.

Their common timing rules are:

- preserve sequence rates as exact rationals, never decimal literals;
- use sample rate for audio-domain items and sequence rate for pictures;
- carry sequence start and drop/non-drop policy into record timecode;
- derive source duration from record duration so rounded ends agree;
- include VFR timing in an explicit metadata namespace; and
- require exact structure and integer boundaries, using tolerance only for an
  inherently floating-point representation.

CMX3600 EDL exports one selected sequence track, supported cuts/transitions,
reel mapping, and timecode; it does not flatten unsupported tracks heuristically.
OTIO exports audio/video tracks with gaps, item ranges, sequence/VFR metadata,
and nested stacks where admitted; it does not invent effects, transitions, or
embedded media. FCPXML exports a spine with connected lanes, stable-identity
resources, rational times, format, and default roles; it does not claim import,
event/library management, time maps, transitions, or Motion vocabulary.

DAWproject is project exchange, not a rendered edit list. Muted tracks are
exported as muted rather than omitted. Exact sample positions, beat-positioned
tempo and signature maps, and float32 WAV media preserve the maintained scope.

DAWproject import validates and decodes before constructing the project,
persists sources before switching documents, and removes newly persisted bodies
if the switch fails. Unsupported plug-ins, effects, looping, automation,
routing, video, or warp detail is reported rather than approximated.

Conformance tests parse output with independently provisioned tools recorded in
`config/interchange-conformance-tools.json`. They are test inputs, not bundled
dependencies. Reader limitations do not redefine a correct file merely to
satisfy a lenient oracle. See
[`interchange-conformance.md`](../reference/interchange-conformance.md).

## Archive, consolidate, and trim

An archive checksum manifest comes from reading the finished archive, not from
copying the writer's own digest list. Verification checks every member, names
failures, distinguishes size from digest mismatches, and reports missing and
unlisted members. A streamed or unreadable archive records why evidence could
not be gathered without retroactively failing an already committed save.

Consolidation copies reachable linked originals into managed storage, verifies
the source while streaming and the copy by reading it back, then drops the link
under its compare-and-swap fence. A crash may leave collectible unreferenced
managed bytes, never a project whose only media was removed. Unreachable
originals are itemized; external media is never deleted, moved, or rewritten.

Trim-media decides which bytes survive, so it ignores render visibility: hidden
or muted references still protect media. It widens referenced ranges by handles,
merges overlapping or abutting ranges, and leaves sources unchanged when an
honest remap cannot be proved.

The current trim writer is managed-video, keyframe-aligned stream copy. It
widens starts to the preceding keyframe and may retain more, never less. Audio,
external media, unsupported containers, exact-timing-bound sources, and
relationships that cannot be remapped are reported rather than altered.

Trimmed bytes use a new content-addressed key so undo can reach the old body.
One project command updates source facts and every reference measured against
them. It refuses omitted references, timing-grid changes, and remaps across a
discarded gap, and maps against the runs actually written after keyframe
widening. Both consolidate and trim publish through the delivery-report surface
and retain their declared resume or atomic-restart semantics.
