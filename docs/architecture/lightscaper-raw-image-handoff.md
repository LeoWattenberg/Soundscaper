# Editable RAW image handoff

The Current Photo → Frame handoff retains an authenticated DNG or CRW Original
and the selected saved recipe. Frame regenerates native linear sRGB RGBA16 from
that Original before Current Float32 Develop. The existing File/Photo handoff,
Frame image Develop and repair menus, native Save and reverse Photo receive
menus own the workflow.

## Source and pack authority

`FramescaperImageSourceV4` is the explicit editable RAW successor. It retains
process1, process2 or process3 exactly, uses provenance2, and records the native
descriptor, same-instance LibRaw `raw_flip`, pinned decoder identity and a
SHA-256 of top-left row-major opaque RGBA16 words serialized big-endian. Receipt
hashing streams through a 64 KiB scratch allocation; it does not allocate an
encoded full word plane. Source1, Source2 and Source3 readers remain strict.

FramePack1 retains its existing wire format: exact encoded Original, canonical
conversion receipt, timing/index metadata and a compressed RGBA8 presentation
cache. Its RAW conversion receipt has exactly these fields:

```ts
{ schemaVersion: 1, kind: 'raw-original', raw: source.raw }
```

An explicit field projection passes only Source1 pack
metadata into the permanent pack reader. Saved Develop, provenance and native
receipt fields remain separate project authority.

Scalar receipt admission grants no native body proof. Archive export/import,
native project publication and Frame rendering authenticate the actual complete
pack and Original, exact receipt, container signature/MIME, decoder output
extent, native orientation and word digest. A small header preflight binds the
receipt's exact encoded size before the generic pack parser allocates receipt
metadata. Complete pack SHA-256 still covers the presentation cache. Its pixels
never supply RAW authoring or Develop inputs.

## Rendering and authoring

The Source4 reader borrows authenticated native words through its exclusive
scoped Original owner. The actual private LibRaw worker terminates before that
borrower runs. Current Float32 Develop applies saved repairs, geometry, color,
spatial effects, LUTs and local masks. Only final display conversion produces
RGBA8. A changed Frame recipe preserves Source4 and its RAW receipt while
recording truthful Frame provenance. Applying an unchanged draft preserves the
original source.

Native Clone/Heal and draft brush editing use the same canonical Original and
resource owners. Temporary brush bodies belong to the draft and do not become
durable until Apply. Disabled LUTs, unused named masks and unused brush inputs
remain in the complete resource closure for archive and native publication.

Closing or cancelling joins admitted native work and consumers before retiring
owned Original bytes, word planes, presentation planes, pack snapshots and
resource readers. Opaque cancellation and decoder failures do not publish a
partial handoff. Range-port results remain borrowed; the proof owner allocates
and retires its own exact Original snapshot.

## Bounds and reverse publication

Source4 uses a separate one-GiB aggregate working bound. Decoder and render
phases are planned separately because worker retirement precedes consumption.
Decode reserves the pinned 512 MiB WASM maximum, the full 128 MiB native output
cap even for a dishonest smaller descriptor, encoded Original copies and a
32 MiB bounded-range/hash/metadata reserve. Render planning includes the actual
Current Develop plan, resident pack copies, retained Original, output display
and host copy, plus authoring or temporary resource work where applicable.
Physical padding in borrowed producer pack backings is charged. These are
owned storage bounds, not an exact JavaScript heap or process-RSS prediction.
Oversized combinations refuse; legacy byte routes retain their existing bounds.

Single and mixed RAW/raster collection exports preserve selected order and
distinct placements even when Originals alias. The collection owner reserves
its existing retained-body capacity during native preflight and authenticates
every generated body. It does not widen the permanent legacy MIME policy.

Reverse receive re-proves the actual RAW Original and native receipt. A
Source4 always produces a Current Photo3, including when its saved recipe is
process1 or process2. The recipe, exact Original identity, native orientation
and resource closure survive; fresh destination catalog identities and existing
custody rules still apply. No decoded deep pixel plane is persisted in
FramePack1.

## Qualification

The selected Lightscaper regression passes 3,030 cases across 347 files,
including genuine DNG/CRW native decoding, mixed collection handoff, poisoned
cache refusal as authority, independent native receipt proof, import admission,
immutable saves, authoring/resource lifetime and reverse publication.
Chromium and Firefox each pass the actual menu round trip with a named Process2
mask, native Frame preview, Process3 Clone, Project Bin thumbnail, Save/reopen
and reverse Photo3. Full-plane comparisons and native storage observations
verify the unchanged Original and complete selected recipe.

Scalar descriptor and Current working-plan metadata stay independent of native
processing bodies. Optional native Develop, RAW proof and menu-owned repair
execution retain separate lazy owners. Both product builds pass the existing
startup and chunk ceilings: 53 Lightscaper and 100 Framescaper ready-graph
requests, with six initial requests each. Full cross-product and final
inter-slice qualification remain separate roadmap work.

This slice uses the existing pinned LibRaw runtime and does not change native
runtime bytes or the assistance runtime closure. External RAW asset publication,
broader camera qualification, wide gamut, highlight recovery, GPU/native execution
and the remaining roadmap exit gates are separate work. Opt-in
[camera culling previews](lightscaper-culling.md#current-raw-preview-source) stay
outside the authenticated Original and native receipt used by handoff.
