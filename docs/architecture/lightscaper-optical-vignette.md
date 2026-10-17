# Manual optical vignette

Photo Develop's existing adjustment chooser and Frame's existing effect rack
expose **Optical vignette**. The closed `optical-vignette-v1` family has one
finite **Amount** control from -100 through 100, defaulting to zero. Stored
and CPU-prepared values retain fractional precision without Q8 or Float32
coefficient quantization. Existing recipes, history, presets, sidecars and
editable handoffs retain the effect's authored position and amount without a
schema migration.

This is a manual radial light gain. Positive amounts lift corners; negative
amounts attenuate them. It does not identify a lens or infer a sensor center,
profile, highlight protection or camera-specific falloff. The existing
Post-crop vignette keeps its separate artistic black/white mixing, shape and
highlight controls.

## Coordinates and gain

The output keeps the incoming extent. For integer pixel coordinates `x`, `y`
in an incoming stage of width `w` and height `h`:

```text
radiusSquared = ((2*x + 1 - w)^2 + (2*y + 1 - h)^2) / (w^2 + h^2)
gain = 2 ^ ((2 * amount / 100) * radiusSquared)
outputLinearRGB = inputLinearRGB * gain
```

The center is `((w - 1) / 2, (h - 1) / 2)` on the pixel-center lattice, with
radius normalized by the half diagonal. Every pixel in a 2×2 plane has gain
`sqrt(2)` at Amount 100. In a 3×1 plane, the side pixels have gain `2^0.8`
and the center has gain one. Positive gain preserves black and channel ratios
algebraically before rounding or byte clipping.

Coordinates belong to the stage where the effect occurs. Optical correction
before an effect-list crop carries the corrected pixels through that crop;
correction after the crop recenters on the cropped extent. Legacy
`develop.geometry` already executes before the effects list, so its crop also
precedes optical correction. There is no Original-space or sensor-space
anchor, and execution does not reorder legacy geometry.

## Precision, masks and ownership

The native path directly multiplies linear Float32 RGB and rounds once into
the destination Float32 plane. It retains signed/HDR RGB without a byte
working image or gamut clipping. Nonfinite or overflowed results refuse
delivery and join output retirement. The byte path continuously decodes
encoded sRGB to linear, multiplies, re-encodes, clamps and rounds once to bytes.
It does not use a quantized gain or byte transfer lookup.

Disabled effects and zero amount preserve every sample. Gain one bypasses
transfer or multiplication, and native zero components retain their original
bits, including negative zero. Alpha always copies exactly. A zero-alpha
source pixel copies all four components, preserving transparent hidden RGB.

Masks evaluate against the incoming stage and blend on the destination grid.
The private Current unchanged-component blend compares incoming and staged
components before interpolation, preserving exact unchanged bits through
fractional coverage. Defringe shares this policy; permanent shared mask math
keeps its existing behavior. Optical vignette adds no geometric mask-overlay
transport. Later lens distortion and projective geometry retain their ordered
coverage projection.

Metadata, controls and declared quotas are admitted before pixels. Physical
borrowed backing is charged before owned stage allocation. The standalone
byte stage admits borrowed source backing plus one owned output within
512 MiB. Native stage descriptors retain the existing 8192-side,
16,777,216-pixel and 256 MiB Float32-plane limits. Native writers require
dedicated, disjoint source and destination planes, use no frame-sized scratch
and remain under the Current aggregate processing budget. Consumers and
cancellation join before pinned owned storage retires; opaque primary and
independent physical retirement failures remain observable.

## Current delivery routes

Current byte and native processing supports authored process versions 1, 2
and 3. Proxy editing applies the formula on its reduced incoming grid; Full
and PNG export evaluate the unchanged recipe at natural resolution. RAW
Originals remain native through Develop before final display or output
encoding. Active Frame Source2/3 and RAW Source4 readers execute the saved
recipe while retaining the Original, pack and native receipt. Presentation
caches do not become Develop authority. Permanent byte facades retain their
prior supported families.

Frame CPU finishing, WebGL2 preview and FFmpeg have explicit routes. WebGL2
uses integer texel fetches and highp arithmetic. Its one-byte RGB envelope
applies to the recorded finite corpus, with exact alpha, no-op and transparent
hidden RGB in those cases; it is not a universal bound over every finite
JavaScript control. FFmpeg carries original alpha separately through planar
RGB processing. CPU/native/FFmpeg remain authoritative delivery paths, and
complete Photo Develop GPU conformance remains a separate milestone.

## Qualification

Forty-four focused checks cover independent gain literals, fractional controls,
wide/thin grids, native signed/HDR and tiny values, exact no-op/zero/alpha bits,
overflow refusal, metadata and physical quotas, crop order, masks and joined
cancellation. Actual pinned FFmpeg, Frame CPU, PNG delivery, editable
Source2/3 and RAW Source4 rendering match independent optical references while
retaining Original, pack and receipt custody. Reduced-grid and Full native
previews use their declared pixel-center lattices.

The selected Lightscaper regression passes 3,302 checks in 379 files. All 34
Chromium/Firefox cases across the four manual lens families pass without skips
or retries, including English/German optical authoring, Escape, Save, durable
history, Full/Fit, reload and actual WebGL2 pixel comparisons. Lightscaper and
Frame builds retain existing startup-graph and chunk ceilings.

This slice changes no dependency, assistance engine or native runtime closure.
No manual **Update AI assets** run is required. Licensed profile correction
remains separate work.
