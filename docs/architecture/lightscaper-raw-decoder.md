# Lightscaper RAW decoding and Current workflow

The Current editor's File → Import workflow accepts DNG and Canon CRW through
the real LibRaw WASM service. It retains the exact Original and regenerates
native linear RGBA16 for development, thumbnails and display. The
existing raster and permanent legacy routes retain their byte contracts.
The Current Float32 stack now includes geometry, seven spatial families,
authenticated LUTs, local adjustments and Original-space Clone/Heal. Expanded
workflow qualification is in progress. RAW export/handoff and wider L7–L9
work remain incomplete. The externally hosted decoder and corresponding source
still require publication.

## Import, development and custody

`raw-source-v1.ts` qualifies a bounded TIFF DNGVersion declaration or CIFF
HEAPCCDR header. Filename extensions and File MIME hints do not authorize a
decoder. Current preparation snapshots each File once, hashes it, and keeps
an immutable Blob before native decoding. The native callback supplies actual
oriented dimensions and the source flip scalar. DNG descriptive metadata uses
the existing bounded TIFF reader; unsupported CRW descriptive fields remain
unknown. Canonical Original MIME is `image/x-adobe-dng` or `image/x-canon-crw`.

The selected Current Session publishes through its existing catalog writer,
Original deduplication, custody roots, import intent and native ACK recovery.
The Original1/Photo contracts need no schema change. A RAW preparation outcome
has no byte FramePack1 artifact: that format remains canonical RGBA8. Retained
RAW bytes are the authenticated regeneration source; no deep working plane is
persisted in the catalog or history.

Current Original reads verify body length/hash, native geometry and the
selected Photo revision before and after borrowed delivery. The active
Current renderer normalizes native words directly into Float32 and applies
white balance, tone ladder, chroma, black-and-white mix, HSL, point/parametric
curves and color wheels. Original-space Clone/Heal precede geometry; effects
then run in authored order, including crop/perspective/rotation/flips,
post-crop vignette, clarity, noise reduction, grain, texture, dehaze,
detail sharpening and authenticated cube LUTs. Procedural/range/brush graph
masks sample the incoming native stage and blend in linear RGB; only coverage
retains byte precision. Selected observed coverage projects through remaining
geometry for an optional temporary overlay. Stage results round in Float32;
there is no RGBA8 working intermediate. The
[linear working contract](lightscaper-linear-working.md) describes the color
domains, exact retained byte route and numerical limits.

The Current multistage renderer plans its borrowed source, at most two live
Float32 planes, masks/resources, repair scratch and display work against
768 MiB before pixels or resource bodies are read. An active LUT adds twice
its declared byte length and a conservative 128 MiB parser/transient reserve;
that reserve is not an exact JavaScript heap bound. Oversized combinations
refuse. The separate original white-balance/tone foundation retains its
512 MiB limit and strict supported-stage set.

Encoded RGBA8 is created only for disposable thumbnails, histograms and canvas
presentation. Develop saves scalar recipes beside the unchanged Original.
The opted-in Current Develop Settings repair entry previews native Original
pixels, applies local Clone/Heal changes to the draft, and leaves durable
publication to Save. Close joins preview retirement. RAW-specific export,
Frame handoff and culling integration remain pending, as do highlight recovery,
wide-gamut output, GPU/native processing, lens profiles and HDR merge.

## Decode contract

`src/common/editor/raw/libraw-runtime-v1.ts` owns a worker for one operation.
The worker receives an owned copy of the input, instantiates the pinned module,
and either demosaics RAW to linear sRGB `unorm16` RGBA or extracts an embedded
preview. It returns no native handles. Its WASM scope destroys LibRaw and wipes
the whole current heap; the client joins worker retirement before calling the
consumer. The returned plane is scoped to that callback and wiped when it
settles. Aborting terminates the worker, so synchronous native decode can be
cancelled without waiting for a native polling hook.

The fixed neutral decode uses native 16-bit output, linear gamma, sRGB
primaries, AHD demosaic, no auto-brightening, no automatic/camera white balance,
and the file's orientation. Alpha is opaque. The result retains precision beyond
an 8-bit preview; it is not an unclipped camera-space float/HDR promise.
Scoped Original decoding also returns the flip from the same native instance;
the existing pixels-only API retains its contract. Embedded previews carry
their original native flip scalar and encoding. A
missing preview returns `null` and never silently develops a replacement.

Input is limited to 64 MiB. Images must fit 8192 pixels per side and
16,777,216 pixels in total. The nonshared WASM heap starts at 32 MiB and cannot
grow beyond 512 MiB. Embedded previews are limited to 16 MiB. Native RAW scratch
has an additional upstream 256 MiB allocation quota. The output plane and
native heap are retired separately; downstream deep processing starts only
after worker retirement. Unsupported compression, oversized input, allocation
failure, corrupt data, and unknown module imports fail explicitly.

## Reproduction and source availability

`config/lightscaper-libraw-runtime-manifest.json` records the exact upstream
archive, compiler image digest, bridge and license hashes, binary hash and
length, memory bounds, and import/export inventories. The unmodified upstream
archive and built runtime live under `runtime-assets/libraw/0.22.2/`, outside
Vite's public directory. They must remain outside the Pages bundle.

Use Node 26.5.0 and npm 12.0.1. With Emscripten 3.1.64 available as `em++`, run:

```sh
node scripts/build-lightscaper-libraw-wasm.mjs --output /tmp/libraw-rebuilt.wasm
node scripts/audit-lightscaper-libraw-wasm.mjs
cmp runtime-assets/libraw/0.22.2/libraw.wasm /tmp/libraw-rebuilt.wasm
rm /tmp/libraw-rebuilt.wasm
```

Alternatively set `EMXX` to a wrapper running `em++` in the manifest's exact
`emscripten/emsdk` image digest. Mount the checkout read-only and a temporary
directory writable at the same absolute host/container paths; set `TMPDIR` to
that writable directory. The recipe disables networking requirements and fixes
`SOURCE_DATE_EPOCH`, UTC, locale, floating-point options, and path mappings.
It extracts the digest-verified source into a temporary directory and removes
that directory on completion or failure. A normal build must reproduce the
manifest's exact binary hash and ABI; it cannot bless a changed artifact.

Publication must supply the pinned upstream archive, the complete source bundle
containing the bridge, exact recipe, manifest, WASM inspection helper and
notices, and the decoder at the versioned asset origin. A source bundle can be
created with `node scripts/package-lightscaper-libraw-source.mjs`. Source and
runtime publication are separate from **Update AI assets**; this decoder does
not change the assistance runtime closure. No external RAW runtime publication
is claimed by this foundation.

The browser loader fetches only
`https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm` and verifies
its exact digest and bounded memory before compilation. Failed fetches can be
retried; only a verified compiled module is cached. Each native instance audits
its imports and ABI again. A modified decoder requires rebuilding the source
and explicitly reviewing/updating its pins together with the browser source.

The initial artifact is 876,336 bytes, SHA-256
`7f9f4e791177114e5224e52c85f7be8b5d79bc5e48e1f87a4f69b1f6edf52c29`.
A build from a separately extracted source bundle reproduced those exact bytes.
The only imports are memory-growth notification and four unavailable WASI
descriptor operations (`fd_read`, `fd_write`, `fd_close`, `fd_seek`), which
return `EBADF` without host file access. The compiler's native-exception table
and trap exports are admitted explicitly alongside the narrow RAW API.

## Focused verification fixtures

`tests/helpers/lightscaper-raw-dng-current-fixture.ts` writes a small owned
uncompressed RGGB DNG from independent sensor literals. It supplies controlled
orientation, color and adjacent 12-bit sensor levels for actual native decode.
It intentionally has no embedded preview.

`config/lightscaper-raw-fixtures.json` pins a Canon D60 CRW lens-cap capture
whose author declared CC0. Run
`node scripts/provision-lightscaper-raw-fixtures.mjs` before the focused tests;
`--check` verifies the local cache without a download. The fixture is ignored
under `vendor/lightscaper-raw-fixtures/` and is never shipped in the editor.
Its tests exercise actual camera compression and JPEG-preview extraction; a
lens-cap capture provides no scene-color accuracy evidence. These two fixtures
do not establish broad camera support.

The decoder foundation passed 31 focused Node cases and four actual-worker
browser cases across Chromium and Firefox. Those browser cases verify the entire
oriented RGBA16 plane, greater-than-byte precision, absent-preview behavior,
corrupt input refusal and scoped output wiping. The selected Lightscaper Node
regression at that foundation passed 2,807 cases across 315 files.

Current workflow qualification adds real selected-library DNG and pinned CRW
imports, exact Original/custody and fresh-session recovery, native orientation,
deep-buffer retirement and interruption around native publication. The CRW
import verifies its actual 3088×2056 output and leaves unavailable descriptive
metadata unknown. Chromium and Firefox also run the actual File menu, import
an owned DNG with an incorrect raster MIME hint, display its thumbnail, apply
white balance and exposure through native-depth processing, Save and reload.
Independent native words and full display-plane literals accompany unchanged
Original bytes and content tokens. These browser tests route only the
manifest-pinned decoder bytes at the real asset URL; they do not replace app
code, the decoder or its worker. All six RAW browser cases pass across those
two browsers: two complete menu workflows and four decoder-worker cases.
They prove that workflow under those tested
conditions, without claiming external publication, camera breadth or L7 exit.

The expanded native develop packet adds focused numerical tests for geometry,
all seven spatial families, LUT body authentication, incoming-stage masks and
Clone/Heal, plus scoped retirement and metadata-first budget refusal. Its new
browser workflow exercises repair, masked global adjustment, sharpening and
crop/rotation through the real Current editor. Final integration results are
still being qualified; the historical counts above describe the preceding
decoder/global-workflow packets. L3–L6 exit gates, L7 completion, L8 and L9
remain pending.
