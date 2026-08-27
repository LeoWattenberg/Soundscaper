# Milestone 3B-2c: re-import upgrade

> Slice-level pickup decomposition for the last open half of
> [3B-2](milestone-3b-work-packets.md#3b-2--probed-source-timing-and-preserved-characteristics).
> [3B-2a](milestone-3b-probed-source-characteristics.md) made ingest persist
> probed truth and [3B-2b](milestone-3b-source-display-geometry.md) made every
> surface present it; both deferred the upgrade of a source that was *already*
> imported, because it is an editing surface rather than a rendering correction.
> This document owns it. Grounded against the repository on 2026-08-10; every
> file and line reference below was read, not inferred.

## What goes stale, and why it cannot be inferred

A video source carries three kinds of derived fact: its timing (rational rate,
source frame count, timing asset, and the decision that produced them), the
characteristics a probe reported, and the frame size the local decoder
presented. All three can be wrong in a document this build opens, for three
reasons that are already on the record.

1. **The probe was unavailable at ingest.** When no timing probe succeeds,
   `probeVideoTiming` returns the explicit fallback (`video-timing-probe.ts:84-90`)
   and ingest persists a *fabricated* 30/1 rate, an all-unreported
   characteristics record, and no timing asset (`controller/source-import.ts:62-70`,
   `280-314`). The properties surface already discloses exactly this state as
   `timing-unprobed` (`source-properties-model.ts:210-212`). The rate is not
   wrong because the file changed; it is wrong because nothing ever read it.
2. **The probe read the wrong frames.** Until `09c5f81` the timing probe decoded
   with autorotation left on, so for every rotated source the persisted *coded*
   size is really the presented size — 3B-2b's measurement M2. A document
   written before that commit still carries it, and its properties panel still
   reports that an ordinary rotated clip has geometry that "disagrees".
3. **The presented size belongs to another engine.** `source.width`/`height` are
   what the importing browser presented (3B-2a contract 2), and Chromium applies
   a pixel aspect ratio to `videoWidth` where Firefox does not — 3B-2b's M5. A
   project made in one engine records a presented size the other engine never
   produces, so its reconciliation is a residual that this engine does not owe.

None of the three can be repaired by inference; that is 3B-2a's first contract.
They can only be repaired by reading the same bytes again with the current
build. That is what this slice adds, and the reason it is a *command* rather
than a load-time repair: replacing a source's frame grid moves every clip that
was cut against it, and an edit that moves clips is undoable or it is a bug.

## Slice boundary

This slice adds **one undoable command that re-probes an already-imported video
source and conforms the edits that depended on its old frame grid**, reachable
from the surface that discloses the staleness.

Two things stay outside it, unchanged from 3B-2b:

1. **Packaged Electron probe-matrix rows** stay `pending-external`. This
   environment still has no packaged runner, and the four rows are not
   relabelled.
2. **Relink** — pointing a source at *different* bytes — remains what
   `project-bin/replace-media` and the linked-original relink services already
   do. An upgrade and a relink are different operations on different axes: one
   changes what we know, the other changes what we have.

## Contracts closed before code

1. **An upgrade re-reads; it never re-writes.** The content digest is the
   source's identity, and the validator binds a timing asset to it
   (`project-v10-foundation-validation.ts:262-265`). The upgrade probes the
   bytes the document already names, so `id`, `storageKey`, `contentSha256`,
   `name`, and `mimeType` cannot change. Where ingest would conform a file to
   CFR to obtain exact timing, an upgrade refuses instead: conforming writes new
   bytes, and new bytes are a re-import.
2. **An upgrade never lowers what is known.** A source that carries exact timing
   keeps it — a re-probe that falls back is refused rather than allowed to
   replace an exact rational rate with a nominal guess. A source that carries no
   exact timing and still cannot be probed is refused too, because there is
   nothing to upgrade. What the upgrade may not do is trade a reading for a
   fabrication.
3. **A characteristics record is replaced whole, never merged.** The record
   describes one reading of one frame (3B-2a contract 1); merging two readings
   would describe no frame. So the new probe's record replaces the old one
   entirely, including fields it did not report, and the properties surface
   discloses what is now unknown. The one field the probe does not own is
   `extractedAudioStreamIndex`: it records which program *ingest* extracted, so
   it is carried by the same rule ingest applied — named only when the inventory
   reports exactly one stream and the source has audio
   (`controller/source-import.ts:286-292`).
4. **Provenance is history, not a probe result.** `timingDecision.mode` records
   how the stored bytes came to exist. A source whose media was conformed at
   ingest keeps `conform-cfr-at-ingest` however exactly it re-probes, because
   the bytes really were conformed. Only the never-probed fallback — the one
   with `reason`/`failures` and no timing asset — becomes `exact` when a probe
   finally succeeds.
5. **Sequence placement survives; the source range is conformed in wall-clock.**
   A source frame rate is source metadata and never a sequence rate, which is
   3B-2's own invariant, so `sequenceStartFrame` and `sequenceFrameCount` are
   untouched: a clip stays where it is on the timeline and lasts exactly as
   long. Its source range is conformed once, as a change of basis on the
   source's nominal grid: each of the in and out points is scaled by
   `newRate / oldRate` in exact integer arithmetic under the shared time
   module's named `point` policy (`timeline-time.ts:79-94`), and the extent is
   the difference of the conformed points. The conform goes through the nominal
   rate rather than through a timing index, because persisted source frames are
   indices on the nominal grid — re-deriving them through the asset would make a
   persisted edit depend on an asset that can be missing.
6. **A range that no longer fits is clamped, and the clamp is reported.** The
   validator requires `sourceInFrame + sourceFrameCount <= source.sourceFrameCount`
   (`project-v10-foundation-validation.ts:299`), and a corrected frame count can
   be smaller than the fabricated one. Such a range is clamped into the media
   with a one-frame floor; the clip's timeline placement and extent still do not
   change. The command result names every clamped clip and the surface discloses
   the count, so the user learns which edits the upgrade could not preserve
   exactly instead of discovering it later.
7. **The extracted audio program is not re-made.** `sampleFrameCount`,
   `hasAudio`, the extracted audio source, its clips, and the poster and
   thumbnail derivatives all survive untouched. Re-extracting audio would change
   an audio source's frame count and move audio clips — that is a re-import, not
   an upgrade. Linked audio does not move either, because the video clip it
   mirrors did not.
8. **One command, one undo.** `source/reprobe` carries the new source facts and
   every conformed clip range together, so a document can never hold a new frame
   rate with ranges cut against the old one. Undo restores both. The existing
   `source/update` allowlist stays closed to timing and geometry
   (`commands/project-source-bin-runtime.js:124-128`): a caller that could set a
   frame rate without conforming clips could author an invalid document.
9. **No schema revision.** Every field the upgrade writes already exists in V14
   and is already validated. The single in-flight revision slot stays free.
10. **No new capability.** Both products ingest video through one path, so
    `org.soundscaper.capability.source-characteristics` is already registered
    available in both profiles (3B-2a contract 9). Making an existing,
    registered fact re-readable adds no state and no product gate.

## Commit sequence

Each step is independently green under the canonical gate.

### S1 — This decomposition

No code. Records what goes stale, the ten contracts, and the two items that stay
outside the slice.

### S2 — The upgrade planner

`video-source-upgrade.ts`: from a persisted source, a resolved probe, the size
this engine presented, and the clips that reference the source, derive the
source changes, the conformed clip ranges, the clamp report, and the typed
refusals of contracts 1, 2, and 4. Pure module, no project or storage imports,
table-driven tests over the fabricated-rate, corrected-coded-size, foreign
presented-size, shrinking-frame-count, and no-change cases.

### S3 — The command

`source/reprobe` in the protocol, the project/source/bin domain, and its
runtime: apply the source changes and every conformed range in one mutation,
under the bounds the existing assertions already enforce.

### S4 — The controller service

Read the source's own bytes back through the store, re-probe them with the
current runtime, publish a timing asset when one is produced, plan, and commit —
with the digest checked against the document before anything is written, and
every refusal typed. Exposed as `controller.actions.video.reprobeSource`.

### S5 — The surface

The source properties panel gains the action and its result: what changed, and
how many clips were clamped. The disclosure that motivates the action —
`timing-unprobed`, `geometry-disagrees` — is already on that panel.

### S6 — Browser proof

A qualification that imports a fixture through the real product path, degrades
it to the never-probed state the older build produced, upgrades it through the
real surface, and proves the rate, the characteristics, and the conformed clip
range against the same fixture's known values.

### S7 — Status, evidence, gates

Roadmap and packet status, maintainability ratchets, and the canonical gate.

## Concurrency

The Soundscaper track works in the same tree. This slice owns the video source
upgrade path: one new pure module, the `source/*` command domain, one controller
service, and the source properties panel. It touches no schema, no capability
register, and no compatibility rule, so the revision slot stays free for the
next document change. The one shared file it edits is the command protocol,
which it appends to.

## Non-goals

- No relink, no media replacement, no transcode, and no conform-at-ingest from
  the upgrade path.
- No re-extraction of the audio program, and no regenerated poster or
  thumbnails.
- No automatic upgrade at load: a load-time repair would move clips outside
  undo, which contract 8 exists to prevent.
- No batch upgrade of every stale source at once. One source, one command, one
  undo entry; a sweep can be built on it once the single case is proven.
- No relabelling of the ten automated packaged Electron release-evidence rows.

## What landing it established

Two things the decomposition did not anticipate came out of building it, and
both are recorded here rather than left for a later reader.

- **A document with no reading is a document with no ownership.** Degrading a
  saved project into the never-probed shape is not enough to make it open: a
  feature manifest that claims `framescaper.source-characteristics` and
  `framescaper.video-timing-assets` while the state carries neither is a
  document that contradicts itself, and the validator refuses it. The browser
  fixture therefore drops both requirements, which is exactly what an ingest
  that reported nothing would have written.
- **Both boundaries conform independently, so an extent can lose a frame.** A
  ten-second range conformed from 24 to 23.976 comes back 239 frames, not 240.
  That is the intended consequence of contract 5 — conforming boundaries rather
  than durations is what keeps a clip on the media it was cut against — and it
  is pinned by a test so a future reader does not "fix" it.

## Stop conditions

- Stop if an upgrade would have to write media bytes to succeed.
- Stop if a probe result would have to be merged with an older one to be usable.
- Stop if conforming a clip would have to move it on the timeline.
- Stop if the upgrade would need a schema revision to persist what it reads.
