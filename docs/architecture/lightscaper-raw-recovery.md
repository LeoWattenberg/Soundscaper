# RAW highlight recovery foundation

This foundation adds a separate pinned LibRaw ABI2 decoder that retains signed
linear RGB Float32 before the ordinary RGB16 output conversion. It provides
actual channel reconstruction and a matching headroom reference profile.
Highlight recovery is not yet a completed Lightscaper feature: existing-menu
Current Develop, proxy, Full, raster export and editable Frame integration
remain pending. This packet adds no user-facing control or default behavior.

ABI1 remains unchanged, including its source, build, artifact, corresponding
source archive and license pins. The canonical Source4 receipt still describes
its original linear sRGB RGBA16 decode and defined-endian word digest. ABI2
returns derived processing pixels; it does not replace that canonical Original
or widen the permanent reader contracts.

## Fixed profiles and native capture

`withDecodedRawRecoveryFrameV2({ bytes, profile, signal? }, consume, options?)`
requires one of two explicit profiles, with no default:

- `linear-headroom-v1` uses native highlight mode 1.
- `highlight-recovery-v1` uses native highlight mode 3.

Each private native instance accepts one decode in mode 1 or 3. It exposes no
filename, filesystem, network, external color profile, embedded preview or
arbitrary processing options. Both profiles use AHD quality 3, the linear sRGB
matrix, gamma one, brightness one, no auto-brightening, no automatic/camera
white balance and the file's native orientation. The maximum-adjustment
threshold is explicitly 0.75, retaining the existing neutral decoder choice;
the effective maximum can therefore depend on the observed samples.

LibRaw scales the daylight multipliers by their maximum for both profiles.
Mode 3 then reconstructs channels using supported channel ratios before RGB
conversion. Comparing mode 3 with mode 1 isolates reconstruction from the
normalization change that would confound a mode-0 comparison.

The bridge overrides `LibRaw::convert_to_rgb_loop` and captures the actual
camera-to-sRGB matrix result before its usual ushort clipping. For the actual
normalized multipliers `q = imgdata.color.pre_mul`:

```text
exposureScale = 1 / min(q[0], q[1], q[2], q[3])
linearRGB = (actualMatrix * reconstructedCameraWords) * exposureScale / 65535
```

Matrix products and normalization use double arithmetic, followed by one
Float32 store. No RGB16 output image, gamma lookup or byte working plane
intervenes. Signed values and values above one remain available. Invalid
calibration, unusable reconstruction thresholds, raw-color bypass and
nonfinite or overflowed output refuse delivery. The supported exposure scale
is finite and between 1 and 65,536.

The callback receives exactly `{ frame, rawFlip, profile, exposureScale }`.
The frame uses unchanged PixelFrameV1 Float32, linear transfer, sRGB primaries
and opaque alpha one. Profile, flip and scale come from the same native
instance. The scale is descriptive and already applied; callers must not
multiply by it again. The native RGB buffer is little-endian IEEE Float32;
the instance copies it into an owned RGBA plane and adds alpha without
rescaling.

## Admitted sensor layouts and bounds

The profile admits integer, regular repeating 2×2 three-color RGB Bayer data.
All eight encoded filter rows must repeat one of the four Bayer arrangements,
with channel 3 treated as green. Floating RAW, Foveon, X-Trans, monochrome,
four-color, sRAW, Fuji layouts, non-square-pixel stretching and half-size/shrink
processing refuse. After unpack, only the integer `raw_image` layout is
accepted. Header, active-area, pitch and layout checks repeat before capture.

Input is at most 64 MiB. Raw and active dimensions must be from 16 through
8192 pixels per side and contain at most 16,777,216 pixels. Orientation writes
directly into the output using LibRaw's native flip mapping, swapping output
dimensions for transposed orientations without another full image plane.
The full extent is retained. LibRaw reconstruction visits complete 4×4 cells;
trailing partial cells remain outside that reconstruction pass.

The nonshared WASM heap starts at 32 MiB and is capped at 512 MiB. Conservative
preflight charges the input, padded Bayer data, padded four-channel processing
image, actual metadata and a 32 MiB reserve. It also charges the maximum live
processing phase: AHD scratch of 6,815,744 bytes, the reconstruction map or the
RGB Float32 output with histogram/profile storage. Allocation bounds are
checked again before output creation; oversized combinations refuse.

The client charges full intrinsic input backing before making its private
snapshot. Maximum decoder-plane overlap is 512 MiB WASM, 256 MiB RGBA output,
64 MiB caller backing and 64 MiB input copy: 896 MiB within the existing
one-GiB decoder policy. The native instance destroys LibRaw and wipes its
complete heap; worker retirement joins before the consumer receives pixels.
The callback-scoped RGBA backing is physically wiped after settlement.
Cancellation, late transfers, malformed responses, detachment and independent
cleanup failures retain joined ownership and opaque primary-error identity.

## Reproducibility and limits

The separate manifest is
`config/lightscaper-libraw-recovery-runtime-manifest.json`. Its runtime lives
at `runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm`, outside the
Pages bundle. Pinned LibRaw 0.22.2 and Emscripten 3.1.64 require no upstream
patch or dependency upgrade. Repeated builds produce 871,145 bytes with SHA256
`ee86c46d33cfb424cdc8468255ec349a823cc2221f5a0e5a54cc8571808b09b7`.
The reviewed inventory has the fixed ABI2 exports, two native-exception
auxiliary exports and five function imports. Descriptor operations have no
host filesystem authority.

`scripts/package-lightscaper-libraw-recovery-source.mjs` packages the complete
reproduction closure into the adjacent `corresponding-source.tar.gz`, including
the upstream source, bridge, manifest, build/audit recipes, this document and
licenses. External runtime/source publication is not claimed here.

Use Node 26.5.0 and npm 12.0.1. With the pinned Emscripten 3.1.64 available as
`em++`, reproduce and compare the artifact from the checkout:

```sh
recovery_dir=$(mktemp -d)
trap 'rm -rf "$recovery_dir"' EXIT
node scripts/build-lightscaper-libraw-recovery-wasm.mjs --output "$recovery_dir/rebuilt.wasm"
node scripts/audit-lightscaper-libraw-recovery-wasm.mjs --wasm "$recovery_dir/rebuilt.wasm"
cmp runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm "$recovery_dir/rebuilt.wasm"
node scripts/package-lightscaper-libraw-recovery-source.mjs --output "$recovery_dir/corresponding-source.tar.gz"
tar -xzf "$recovery_dir/corresponding-source.tar.gz" -C "$recovery_dir"
node "$recovery_dir/lightscaper-libraw-recovery-source/scripts/build-lightscaper-libraw-recovery-wasm.mjs" --output "$recovery_dir/from-source.wasm"
cmp "$recovery_dir/rebuilt.wasm" "$recovery_dir/from-source.wasm"
```

Alternatively, set `EMXX` to a wrapper invoking `em++` in the manifest's exact
`emscripten/emsdk` image digest. Mount the checkout read-only and a temporary
directory writable at matching absolute host/container paths; set `TMPDIR`
to that writable directory. The build needs no network and fixes source date,
UTC, locale, floating-point options and path mappings. It verifies the source,
bridge, build recipe and licenses, then checks the resulting binary against
the exact manifest digest. Temporary extracted sources retire on success or
failure. Keep the recovery archive and its sidecar at the separate ABI2 path;
the ABI1 corresponding-source archive must remain byte-for-byte unchanged.

An owned Bayer DNG with declared black/white levels and unequal channel
headroom exercises actual WASM and the production worker. Its saturated
non-reference channels regain ordered detail relative to mode 1 while the
reference channel and midtone controls remain stable. Separate canaries
exercise negative RGB, values above one and sub-word precision. Uniform fully
saturated controls remain spatially uniform; no arbitrary lost texture or
color recovery is claimed. These foundation checks do not establish broad
camera support, complete product integration, wide-gamut output or L7 exit.

No assistance engine closure changes, so no manual **Update AI assets** run is
required. LibRaw runtime and corresponding-source publication remain separate.
