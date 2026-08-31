# Milestone 3B-2a: probed source characteristics

> Slice-level pickup decomposition for the first half of
> [3B-2](milestone-3b-work-packets.md#3b-2--probed-source-timing-and-preserved-characteristics).
> The 3.0 foundation already probes exact timing; this document decomposes what
> replaces the remaining fabricated ingest metadata with probed truth, and where
> that truth is honoured. Grounded against the repository on 2026-08-10; every
> file and line reference below was read, not inferred.

## What the foundation already probes

3B-2's timing half is done. `probeVideoTiming`
(`video-timing-probe.ts:41-72`) tries exact runtime probes in preference order
and, when none succeeds, returns an explicitly recorded
`conform-cfr-at-ingest` decision carrying every backend failure. Ingest
publishes the resulting per-frame index as a digest-bound asset and persists the
exact rational rate, the source frame count, the asset reference, and the
decision that produced them (`controller/source-import.ts:270-294`,
`project-v10.ts:88-128`, validated at
`project-v10-foundation-validation.ts:238-267`).

What is still fabricated at ingest is everything *around* the timing:

```js
videoCodec: conformedAtIngest ? 'h264' : 'unknown',
audioCodec: canonicalAudio ? (conformedAtIngest ? 'aac' : 'unknown') : null,
```

— `controller/source-import.ts:295-296`. Rotation, pixel aspect, field order,
alpha, colour, the audio stream inventory, and the source start timecode are not
read, not stored, and not shown. A rotated phone clip, an anamorphic master, and
a square-pixel export are indistinguishable in the document.

## Slice boundary

This slice delivers the **probe → persist → disclose** spine for source
characteristics, and it closes 3B-1's deferred source-timecode origin.

Three things stay with **3B-2b**, and the roadmap ingest bullet moves to
**In progress** naming them rather than claiming them:

1. **Re-import upgrade** of an already-imported source. It is a separate editing
   surface — a command that re-probes an existing source, replaces its
   characteristics and timing, and proves which edits survive — and it can only
   be designed once the characteristics it upgrades exist and are validated.
2. **Export orientation.** Video export decodes the source with FFmpeg through a
   `filter_complex` graph and ends each clip chain with `setsar=1`, so a rotated
   or anamorphic source exports as its coded frames. Fixing that means deciding
   whether our pinned FFmpeg build applies the container display matrix in that
   graph, then either applying the probed rotation and sample aspect or
   explicitly disabling autorotation per input. Guessing that answer is exactly
   the double-application this slice's third contract forbids, and the probe
   matrix 3B-2b runs is what answers it. Until then the preview shows what the
   decoder presents and the properties surface discloses any rotation it did not
   apply.
3. **Probe-matrix evidence rows** for representative CFR and VFR fixtures across
   the packaged Electron runners.

3B-1 claimed "the sequence's source timecode reading for a clip's current source
frame" in its outcome and shipped only the labelling helper
(`sequence-timing-model.ts:104-107`, consumed by tests alone). The readout ships
here, with the probed origin, rather than being counted as already delivered.

## Contracts closed before code

1. **Reported, never inferred.** Every preserved characteristic is either a
   probed value or an explicit `null` meaning *this backend did not report it*.
   The record names the backend that produced it. A missing probe normalizes to
   the all-unreported record; it never normalizes to a plausible value. There is
   no rotation `0` standing in for "unknown", no `progressive` standing in for
   "not reported", no `sRGB` standing in for "unmeasured". A consumer that reads
   `null` must branch on unknown and disclose it, never present a guess as
   source truth.
2. **Coded geometry and presented geometry are different facts.** The probe
   reports the **coded** frame size, a rotation in `{0, 90, 180, 270}`, and a
   pixel aspect ratio as a reduced positive rational. `source.width` and
   `source.height` keep their existing meaning — the size the presentation
   runtime actually presents (`video-media.js:70-79`) — because every geometry
   consumer already reads them (`video-export.js:81-89`,
   `ui/video-preview-compositor.js:454-462`). Display geometry is **derived**
   from the coded size, the rotation, and the pixel aspect ratio, and is never
   persisted: a persisted derived size would need staleness policing on every
   re-probe.
3. **The decoder is the authority on what was already applied.** Browsers apply
   a container display matrix and pixel aspect ratio before reporting intrinsic
   dimensions, so the probe and the decoder usually agree and nothing must be
   re-applied. The resolver therefore compares derived display geometry against
   the presented size and classifies the entry: `applied` (they agree — apply
   nothing), `residual` (a quarter-turn and/or an anamorphic stretch explains
   the difference — apply exactly that), or `disagreed` (anything else — present
   as-is and disclose). The probe never overrides the decoder, because a wrong
   rotation applied twice is worse than a rotation shown as the decoder shows it.
4. **Field order and colour are disclosed, not converted.** Milestone 3 ships no
   deinterlacer and no colour management, so their consumer is the properties
   surface and milestone 6 interchange. An interlaced source is presented as
   coded frames and says so. Recording a characteristic no renderer honours is
   permitted only where disclosure is itself the honouring — the user learns why
   the picture combs — and each such characteristic is named here, not left to a
   later reviewer to discover.
5. **The audio stream inventory makes a silent drop visible.** Ingest extracts
   exactly one audio program, as it does today. The inventory records every
   audio stream the probe saw — index, codec, channel count, sample rate,
   language — and which one ingest extracted, so a multi-stream master no longer
   loses its other programs without a trace. The inventory is bounded so a
   hostile container cannot inflate a document through it.
6. **Source start timecode is a source-domain label.** It persists in the same
   timecode wire shape sequences use, at the source's own frame rate, with its
   own drop-frame flag, and it is legal at that rate by the same rule the
   sequence validator applies. The source timecode readout labels
   `sourceInFrame` offset by that origin. An unreported origin keeps labelling
   from zero and says the origin is unknown — the 3B-1 contract, now stated on
   the surface instead of in a comment.
7. **Nothing is conformed to make a characteristic true.** No transcode, no
   rotation bake-in, no pixel-aspect resample. The conform-at-ingest path stays
   exactly what the foundation defined: a timing decision, recorded as such.
8. **Revision.** New required structure on a persisted document type is a
   schema revision. This slice takes the single in-flight revision slot as
   **V14** and completes it in one commit: validators, factories, registration,
   desktop library scope, and fixtures together. Per the pre-release policy the
   bump is a clean break with no migration — V13 opens with the typed re-import
   error and V15 stays opaquely read-only.
9. **Registration.** The characteristics block is undeclared structure until it
   is registered, so V14 lands with capability
   `org.soundscaper.capability.source-characteristics`, its owned requirement
   `framescaper.source-characteristics` firing when any video source carries a
   reported characteristic, both product profiles, the production inventory, the
   compatibility register entry, and the state-to-manifest completeness fixture.
   Both products ingest video through one path, so the capability is available
   in both profiles in the same change that implements it.

## Commit sequence

Each step is independently green under the canonical gate.

### S1 — This decomposition

No code. Records the slice boundary, the nine contracts, and the revision-slot
claim before the first characteristic is written.

### S2 — The characteristics wire contract

`video-source-characteristics.ts`: normalize and validate the reported record —
coded size, rotation, pixel aspect ratio, field order, alpha, video and audio
codec, colour (primaries, transfer, matrix, range), the bounded audio stream
inventory, the source start timecode, and the reporting backend. Pure module,
no project imports, exhaustive rejection tests for every field.

### S3 — Display geometry

`video-display-geometry.ts`: derive display size from coded size, rotation, and
pixel aspect ratio, then classify against a presented size as `applied`,
`residual`, or `disagreed` per contract 3. Pure, table-driven tests over
square-pixel, anamorphic, quarter-turn, half-turn, and contradictory cases.

### S4 — The probe reports characteristics

Parse FFmpeg's stream banner (codec, coded size, `SAR`/`DAR`, pixel format and
colour tags, field order, `displaymatrix` rotation, per-stream audio lines, and
the container `timecode` metadata) into the S2 record, and carry it through
`probeVideoTiming` beside the timing decision. The parser is pure and tested
against captured banner text; no second FFmpeg run is added, because the timing
probe already decodes the file once.

### S5 — V14, atomic

Schema constant, `project-v14.ts` and its validation, source normalization
through the factory chain so a characteristic cannot be silently dropped on
reload, registration per contract 9, fresh desktop-library scope, compatibility
register and narrative sync, evidence repin, and the revision fixture set:
current-version validation, typed V13 rejection, future-schema read-only,
clone/undo/clipboard/`.scape`/desktop/archive round trips, byte-idempotent
load/save, and semantic survival after editing.

### S6 — Ingest persists probed truth

Replace the fabricated codec strings, derive `hasAudio` from the inventory when
reported, publish the characteristics with the timing decision, and keep the
existing rollback discipline intact.

### S7 — Consumers honour what was probed

A reported alpha channel survives poster and thumbnail capture instead of being
flattened onto opaque black. Rotation and pixel aspect are reconciled against
the decoder's presented size, which in every supported browser has already
applied both: the resolver therefore reports no residual, and the surfaces
present what the decoder gave them. A residual that a browser did produce is
disclosed rather than silently re-applied, and export orientation moves to
3B-2b for the reason recorded in the slice boundary.

### S8 — Source timecode and the properties surface

The video workspace gains a source timecode readout for the clip under the
playhead, labelled from the probed origin, and a source properties surface
disclosing codec, coded and display geometry, rotation, pixel aspect, field
order, colour, alpha, the audio stream inventory, and the timing decision —
each with its unknown state visible as unknown.

### S9 — Status, evidence, gates

Browser proof through the real product surface, roadmap and packet status,
maintainability ratchets, and the canonical gate.

## Concurrency

The Soundscaper track works in the same tree. This slice owns the video ingest,
probe, preview, and export modules plus the video half of the project document;
it touches the shared spine only at the schema constant, the command/protocol
registries it does not change, the capability and compatibility registers, the
i18n catalog, and the maintainability allowlist. Register edits, their pinning
tests, and the ratchet updates land inside the same commit as the change that
needs them, and the V14 slot is released for the next revision when S5 lands.

## Non-goals

- No re-import upgrade of an existing source (3B-2b).
- No export-side orientation or sample-aspect correction (3B-2b).
- No transcoding, proxy generation, retiming, or deinterlacing.
- No colour management or display transform.
- No multi-stream audio import; the inventory discloses, it does not import.
- No environment-matrix claims: the retained
  `config/milestone-3-timing-probe-fixtures.json` pins only the representative
  correctness media, and each automated run reports its own scope.

## Stop conditions

- Stop if a characteristic would have to be inferred to be persisted.
- Stop if honouring one would require overriding the decoder's presented size.
- Stop if the derived display geometry would have to be persisted to be usable.
- Stop if a second schema revision is proposed while V14 is in flight.
- Stop if the inventory or any probed field is unbounded on the wire.
