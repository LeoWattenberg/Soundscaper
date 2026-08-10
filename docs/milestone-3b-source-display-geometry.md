# Milestone 3B-2b: source display geometry

> Slice-level pickup decomposition for the export half of
> [3B-2](milestone-3b-work-packets.md#3b-2--probed-source-timing-and-preserved-characteristics),
> continuing [3B-2a](milestone-3b-probed-source-characteristics.md), which
> deferred export orientation because it could not prove what the pinned FFmpeg
> build does with a container display matrix. This document opens with that
> proof. Every measurement below was executed against the pinned runtime on
> 2026-08-10 and is reproducible from the commands recorded beside it.

## What was measured

3B-2a's slice boundary named one blocking question: does our pinned FFmpeg build
apply the container display matrix inside a `filter_complex` graph? Guessing was
forbidden, so the question was deferred to this slice's probe matrix. It is now
answered, together with four neighbouring facts that change the design.

The runtime under test is `@ffmpeg/core` 0.12.10, which reports itself as
**FFmpeg 5.1.4**, driven through the same `exec` entry point the product uses.
The browsers are the Playwright-pinned Chromium 149 and Firefox 151 that the
probe matrix already qualifies.

| # | Question | Measured answer |
| - | -------- | --------------- |
| M1 | Can a fixture declare rotation with `-display_rotation`? | No. The option does not exist before FFmpeg 6.0; `-metadata:s:v:0 rotate=90` with `-c copy` writes the `tkhd` matrix instead. |
| M2 | What size does the timing probe's `showinfo` report for a rotated source? | `s:24x32` for a 32x24 coded stream — the probe reads **autorotated** frames, so V14's persisted coded size is the presented size for every rotated source. |
| M3 | Does `filter_complex` receive autorotated frames, and is `-noautorotate` honoured? | Yes and yes: the default graph sees `24x32`, and `-noautorotate` yields the coded `32x24`. |
| M4 | Which way is a matrix printed as `rotation of 90.00 degrees` applied? | A quarter turn counter-clockwise, by FFmpeg's own autorotation and by Firefox alike — the 270° clockwise value 3B-2a persists, reproduced by `transpose=2`. |
| M5 | Do browsers apply the pixel aspect ratio to `videoWidth`/`videoHeight`? | Chromium does; **Firefox does not**. The same anamorphic source presents 64x24 in one engine and 32x24 in the other. |
| M6 | What does today's export graph do with a pixel aspect ratio? | Discards it: `scale=…:force_original_aspect_ratio=decrease` fits the coded frame and `setsar=1` drops the ratio, so an anamorphic source exports squeezed and letterboxed. |

M2 is a defect in what 3B-2a shipped, not a gap: a rotated phone clip persists a
coded size that is really its presented size, so `resolveVideoDisplayGeometry`
cannot reconcile the two and the properties panel tells the user their ordinary
rotated clip has geometry that "disagrees". The probe must read coded frames.

M5 is why this slice cannot simply make the export reproduce whatever the local
decoder presented. That rule would export the same project squeezed in Firefox
and correct in Chromium. The source's display geometry is one fact; the engines
disagree about how much of it they apply, and each surface must close its own
gap.

## Slice boundary

This slice makes **display geometry the presented truth on every surface**:
probed as coded frames, derived the same way everywhere, applied by the export
graph itself, and completed in the preview where the browser left it undone.

Two things stay outside it:

1. **Re-import upgrade** of an already-imported source moves to **3B-2c**. It is
   a distinct editing surface — an undoable command that re-probes an existing
   source, replaces its timing, characteristics, and presented size, and defines
   which edits survive a frame-rate or frame-count change — and it belongs with
   the trim and conform contracts rather than with a rendering correction.
2. **Packaged Electron probe-matrix rows** stay `pending-external`. This slice
   adds the geometry fixtures and the browser rows that this environment can
   actually execute; the four packaged rows still have no runner and are not
   relabelled.

## Contracts closed before code

1. **A probe reports coded frames.** The timing probe disables autorotation so
   that `showinfo` describes the frame the banner's display matrix is relative
   to. Coded size, pixel aspect ratio, and rotation are then three independent
   facts about one frame instead of two views of two different frames.
2. **Display geometry is the source's truth and is engine-independent.** It is
   derived — never persisted — from coded size, rotation, and pixel aspect
   ratio, and it is what every surface aims to present. Two engines that present
   the same source differently are two different residuals against one geometry,
   not two geometries.
3. **Each surface applies its own residual, and only its own.** The preview
   applies what its browser did not; the export graph decodes the source itself,
   so it disables autorotation and applies the whole coded→display transform.
   Neither surface re-applies what its decoder already did, which is 3B-2a's
   third contract carried forward rather than replaced.
4. **The export canvas comes from display geometry, not from a decoder.** The
   canvas that both the export and the preview reference is derived from the
   source's display geometry, so the same project renders the same frames on
   every engine. A source whose geometry cannot be reconciled keeps using its
   presented size, exactly as today.
5. **Unreconciled geometry is still never overridden.** When the probe and the
   decoder cannot be reconciled, or the probe reported nothing, no surface
   applies anything and the properties surface keeps disclosing it. A probe that
   contradicts the decoder is not promoted to truth by this slice.
6. **A residual rotation is disclosed, not applied, in the preview.** No
   qualified engine produces one — both apply the display matrix — so a preview
   rotation would be an unproven transform applied to unproven geometry. The
   export graph rotates because it decodes coded frames, which is a different
   claim: it applies a probed rotation to frames it knows are unrotated.
7. **No document schema revision.** Display geometry is derived, the presentation
   is derived, and nothing new is persisted. The video export plan version is a
   wire contract between the planner and the FFmpeg adapter, so it moves to
   version 5 and the adapter keeps accepting the older versions it already
   accepts.
8. **Fixtures are generated by the pinned runtime and pinned by digest.** The
   geometry fixtures are produced from an in-repository test pattern by the same
   `@ffmpeg/core` build the product ships, with `-c copy` variants for the
   anamorphic, rotated, and rotated-anamorphic cases, and they carry no
   third-party media.

## Commit sequence

Each step is independently green under the canonical gate.

### S1 — This decomposition

No code. Records the six measurements, the contracts they force, and the two
items that stay outside the slice.

### S2 — The probe reports coded frames

`-noautorotate` on the timing-probe input, with the parser unchanged: it already
reads the size `showinfo` prints, and now that size is the coded one. Regression
coverage uses the captured log text of a rotated source.

### S3 — The presentation a graph must apply

`video-source-presentation.ts`: from characteristics and a presented size,
derive the ordered operations that carry coded frames to display geometry — the
pixel-aspect scale, then the rotation — plus the display size they produce and
the residual a browser decoder still owes. Pure module, table-driven tests.

### S4 — The canvas and the plan

`resolveVideoExportCanvas` derives from display geometry, and the export plan
carries a per-input presentation at version 5.

### S5 — The graph applies it

`buildVideoFfmpegArgs` emits `-noautorotate` for every input that carries a
presentation and inserts the presentation chain ahead of the branch allocator,
so both the sequential and layered graphs inherit it once per input.

### S6 — The preview closes its own gap

The preview passes each entry's display size to the compositor viewports, so an
anamorphic source stops rendering squeezed in an engine that ignores the pixel
aspect ratio.

### S7 — Fixtures and browser proof

The generated geometry fixtures, a browser qualification that imports them
through the real product path, checks the persisted characteristics and the
per-engine reconciliation, and exports through the real argument builder to
prove the exported frame fills its canvas in the expected orientation. The probe
matrix gains the geometry fixtures and browser rows.

### S8 — Status, evidence, gates

Roadmap and packet status, maintainability ratchets, and the canonical gate.

## Concurrency

The Soundscaper track works in the same tree. This slice owns the video probe,
export planner, FFmpeg argument builder, preview compositor entry geometry, and
the video browser fixtures. It touches no schema, no capability register, and no
command or protocol registry, so the revision slot stays free for the next
document change.

## Non-goals

- No re-import upgrade (3B-2c).
- No deinterlacing, colour management, or transcoding.
- No baked rotation at ingest: the conform-at-ingest path keeps re-probing its
  own output, so whatever it bakes stays described by the characteristics that
  describe the stored bytes.
- No relabelling of the four packaged Electron probe rows.

## Stop conditions

- Stop if a surface would have to apply a transform its decoder already applied.
- Stop if the export would depend on which browser produced the project.
- Stop if display geometry would have to be persisted to be usable.
- Stop if a fixture would need media this repository cannot generate.
