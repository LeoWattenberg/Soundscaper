# Lightscaper RAW decoder foundation

The L7 decoder foundation is a real LibRaw WASM service. It does not yet make
RAW import reachable in the editor. Catalog import, Original/Frame storage,
develop-stack routing, wide-gamut delivery, and camera-model qualification
remain later L7/L9 work. Existing byte-based import continues to use its current
path.

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
Embedded previews carry their original native flip scalar and encoding. A
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

The foundation passes 31 focused Node cases and four actual-worker browser
cases across Chromium and Firefox. Those browser cases verify the entire
oriented RGBA16 plane, greater-than-byte precision, absent-preview behavior,
corrupt input refusal and scoped output wiping. The selected Lightscaper Node
regression passes 2,807 cases across 315 files. These checks qualify the decoder
foundation, not the still-pending editor RAW import workflow or full L7 exit.
