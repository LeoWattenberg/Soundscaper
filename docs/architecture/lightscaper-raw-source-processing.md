# Current RAW source processing

Current Lightscaper opts into source processing through Develop → Settings →
RAW source processing. The dialog offers Canonical Original, Linear headroom
and Highlight recovery. It authenticates and retires a selected noncanonical
source before enabling Apply. Apply changes the local draft; Save uses the
existing durable Develop/history command. Cancel and Close join outstanding
source work. This adds no default toolbar or panel.

The [recovery decoder foundation](lightscaper-raw-recovery.md) owns the separate
ABI2 native implementation and its immutable corresponding-source closure.
This document owns the application integration contract. The foundation's
original product-integration status describes that earlier decoder-only slice.

## Saved recipe and compatibility

Process4 adds exactly one group to the complete process3 recipe:

```json
"rawDevelopment": { "schemaVersion": 1, "mode": "recovery" }
```

The only modes are `canonical`, `headroom` and `recovery`. No native options,
exposure scale, pixel plane or decode authority is persisted. Canonical on an
older recipe is a byte-identical no-op. Selecting a noncanonical mode promotes
the complete recipe to process4. Returning to canonical keeps process4, including
repairs, masks, geometry and every effect declaration.

Explicit Current owners admit process1–4. Permanent versioned readers retain
their existing ceilings. In particular, the older central Current state alias
still admits only process1–3; call sites must choose the new through4 owner.
Photo3, Source4 and Sidecar2 keep their outer wire versions where the nested
recipe already carries its version. Source3 admits canonical process4 through
its explicit Current owner and refuses noncanonical RAW processing.

Current settings, clipboard and presets use Packet4/Preset4 with explicit RAW
selection. Full recipe resource closure includes disabled and unused retained
LUT and brush declarations. Existing Packet3 and Preset3 readers stay strict;
explicit Current compatibility can retain an actual older preset without
pretending that a future recipe is process3. Native rows and archive entries
carry their explicit Current successor formats.

Current backup selects Archive8 when any retained version uses process4 or
Workspace4, including RAW settings retained only in history, or when the preset
row has sticky version4. Its photo records keep LSCPACK4 framing under an
explicit Current policy; presets use the version4 entry and encoding. Permanent
Archive7 and Pack4 readers admit complete recipes and workspaces only through3.
Wholly older libraries retain their existing Archive5/6/7 selection and bytes.
Restore authenticates the full Original, LUT and brush closure before publishing
the private candidate library. Reopen preserves the complete recipes, history
and preset row; the previous library namespaces retain their content and custody.

## Canonical and derived authority

`original.withFrame`, Frame canonical reads, immutable Original bytes and ABI1
conversion receipts keep their canonical meaning. Noncanonical consumers use
the separately named `withDerivedFrame` capability. Headroom selects
`linear-headroom-v1`; recovery selects `highlight-recovery-v1`. A missing or
invalid derived capability refuses rather than falling back to canonical pixels.

The selected Photo owner captures request, methods, receivers and cancellation
before asynchronous acquisition. It checks the complete saved Photo, revision
and Original binding around every phase. One owned encoded snapshot is hashed
against the immutable Original. ABI1 authenticates native extent/orientation
and retires completely before ABI2 decodes that same snapshot. Frame also
authenticates the retained pack and exact canonical word receipt. ABI2's native
extent, flip and profile must match the captured binding.

The recovery runtime grants authority only to its actual scoped Float32 sample
plane and fixed profile. Copying pixels or attaching descriptive metadata grants
none. Authority expires when the consumer settles; owned input and output
storage are wiped after joined retirement. Descriptive `exposureScale` has
already been applied natively and must never be multiplied into the samples
again. Signed values and headroom survive until the requested output boundary.

Current render entry points validate the complete process4 recipe and active
source authority before sampling or making a private computational process3
projection. That projection retains all adjustment groups and is never saved.
Existing local metadata widgets similarly receive a metadata-only projection;
their Current wrapper reattaches the captured RAW group on Apply and on native
draft preview requests. Those widgets cannot replace the source policy.

## Preview, export and editable transfer

Before always displays the canonical Original. Its entire borrow retires before
After borrows the selected source. Proxy and full-resolution After use the same
captured mode; proxy sampling occurs only after source authentication. Clipping,
histogram and display output do not change the saved source policy.

Single and persisted batch export capture the named derived capability in the
Save gesture. The full saved recipe, including RAW processing, participates in
batch fingerprints and reopen/recovery checks. Current rendering keeps native
precision through masks, repairs, geometry, output sizing and compositing.
PNG16 receives final sRGB words; PNG8 and JPEG receive one final encoded byte
boundary. Sidecars retain the complete saved recipe. No derived frame replaces
the Original or the immutable ABI1 receipt.

Editable Photo/Frame and collection transfers retain process4 and complete
resource closure beside the unchanged RAW pack. Canonical verification remains
ABI1. Saved Frame rendering and Current repair/mask/brush drafts select ABI2
from the captured full recipe, including after reopen and history navigation.

## Lifetime and storage limits

Noncanonical decode retains the foundation's integer Bayer, input and extent
limits, including sixteen pixels per side. That minimum does not narrow older
canonical metadata admission. Native workers retire before their consumer is
entered; canonical words and ABI2 workers never overlap.

The Photo decode peak charges the encoded Blob, owned encoded snapshot and
runtime input, the 512 MiB heap bound, the 256 MiB Float32 bound and a 32 MiB
reserve. With the 64 MiB encoded bound this is 992 MiB. Frame charges its retained
pack separately and admits every phase under the one-GiB aggregate bound.

During native raster Develop, RAW encoded storage conservatively reserves
224 MiB beside the existing 768 MiB native owner. Graphic decoding starts after
RAW worker retirement; encoded graphic bytes and both physical graphic planes
are included before rendering. The output owner charges its own replacing
planes, retained sources and codec storage under the same one-GiB ceiling.
Oversized combinations refuse before allocation or publication.

Opaque failures retain their identity, distinct retirement failures remain
visible, and cancellation/Close join every admitted native or body borrower
before retiring selected-session resources. Temporary preview or repair work
never commits a recipe or installs a derived Original.

## Qualification and remaining scope

The owning `tests/lightscaper-raw-development-*.test.*`, derived-Original and
derived-Frame tests cover scalar compatibility, native source authority,
history/settings/presets/import, rendering, handoff and raster delivery. Focused
RAW browser specs exercise the actual menu-owned app, packaged workers, pinned
native decoders, full-plane comparisons, Save/reload and unchanged custody.
Only those verified runs establish supported workflow claims.

The decoder assets and corresponding source remain outside the Pages bundle;
external publication is a separate step. Wider camera/layout coverage, Display
P3 and soft proofing, HDR merge, GPU Develop and desktop native services remain
separate roadmap work. This integration changes no assistance-runtime closure
and requires no manual **Update AI assets** run.
