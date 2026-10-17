# Manual defringe

Photo Develop's existing adjustment chooser and Frame's existing effect rack
expose **Defringe**. The closed `defringe-v1` family has **Purple** and **Green**
strengths from 0 through 100, both defaulting to zero, and an **Edge threshold**
from 0 through 100, defaulting to 25. Controls accept finite fractional values
without integer or Q8 quantization. The effect retains its authored position
and parameters in existing recipes, history, presets, sidecars and editable
handoffs; it requires no schema migration.

This is manual suppression of thin purple or green edge fringes. It does not
identify a lens, infer a correction profile or promise removal of broad
fringes. Legitimate thin saturated edges can match the detector; local masks
let the user constrain the adjustment.

## Neighborhood and suppression

The output keeps the incoming extent. Each pixel reads an immutable 3×3
neighborhood, excluding its logical center. Coordinates clamp at image edges;
clamped taps that alias the center still count as individual neighbors. Only
neighbors with positive alpha contribute. A center with zero alpha copies all
four original components without evaluating the neighborhood.

Classification and correction use normalized encoded RGB. Define:

```text
Y = (54R + 183G + 19B) / 256
P = max(0, min(R, B) - G)
Q = max(0, G - max(R, B))
edge = clamp(4 * ((maximumY - minimumY) - edgeThreshold / 100), 0, 1)
purpleGate = clamp(4 * sum(alpha * (centerP - neighborP)) / sum(alpha), 0, 1)
greenGate = clamp(4 * sum(alpha * (centerQ - neighborQ)) / sum(alpha), 0, 1)
weight = clamp(edge * (purple / 100 * purpleGate + green / 100 * greenGate), 0, 1)
outputC = C + weight * (Y - C)
```

The center's luma seeds the minimum and maximum, which supported neighbors
expand. With no supported neighbor, both color gates are zero. Accumulating
weighted differences keeps constant colored regions exactly neutral even
when their alpha values differ. The correction preserves encoded luma
algebraically before output rounding; it does not claim invariant linear-light
luminance.

For an opaque black–magenta–white row, Purple 100 with the default threshold
turns the middle byte pixel into `(73, 73, 73)`. Green 100 turns an equivalent
green fringe into `(182, 182, 182)`. Flat colored regions and neutral edges
remain unchanged.

## Precision, masks and ownership

The byte path normalizes encoded sRGB samples and rounds changed RGB half up
to bytes. The native path evaluates the same encoded-color algebra using the
continuous odd-sRGB transfer over linear Float32 input. Only changed channels
decode back to linear and round once into Float32. There is no byte working
image or native gamut clipping; signed and HDR values remain supported within
finite Float32 limits.

Disabled effects, zero strengths, zero gates and unchanged components retain
their original bits. Alpha always copies exactly, including native negative
zero. Transparent hidden RGB is preserved. Current masked defringe compares
staged and incoming components before interpolation so fractional coverage
also preserves unchanged negative-zero components. Permanent shared mask
blending keeps its existing behavior.

Masks evaluate against the incoming stage and blend on the destination grid.
Defringe adds no geometric coverage transport. Later lens distortion and
projective geometry retain their existing ordered mask-overlay projection.
Proxy editing evaluates the radius-one neighborhood on its declared reduced
grid; Full and export evaluate the unchanged recipe at natural resolution.

Current byte and native compositions support authored process versions 1, 2
and 3. PNG delivery uses the actual Current renderer. RAW Originals remain
native through Develop before final display or output encoding. Active Frame
Source2/3 readers and the RAW Source4 reader evaluate the saved recipe while
retaining the immutable Original, pack and native receipt; presentation caches
do not become Develop authority. Permanent byte facades retain their prior
supported families.

Metadata, controls and quotas are admitted before source samples. The
standalone byte stage charges physical borrowed source backing plus its owned
output against 512 MiB. Native writing requires dedicated, disjoint source
and destination planes under the Current aggregate processing plan and uses
no frame-sized scratch. Consumers and cancellation join before owned storage
retires. Physical backing checks and wiping preserve opaque primary failures
and independent retirement failures.

Frame CPU finishing, WebGL2 preview and FFmpeg have explicit execution routes.
WebGL2 uses integer texel fetches and highp arithmetic; its one-byte RGB
envelope applies only to the recorded finite corpus, with exact alpha, no-op
and transparent hidden RGB in those cases. It is not a universal bound over
every finite JavaScript control. FFmpeg carries original alpha separately
through planar RGB processing. Complete Photo Develop GPU conformance remains
a separate milestone.

## Qualification

Forty-two focused checks exercise literal purple/green and alpha-weighted
pixels, independent neighborhood oracles, native signed/HDR and sub-byte
correction, mask order, ownership and cancellation, actual Frame CPU and
pinned FFmpeg, PNG delivery, editable handoffs, RAW rendering and reduced-grid
preview behavior. The selected Lightscaper regression passes 3,258 checks in
374 files. Twenty-six Chromium/Firefox cases cover all three manual lens
families, including English/German defringe authoring, Escape, Save, durable
history, Full/Fit, reload, Original custody and actual WebGL2 pixel comparison.
Both Lightscaper and Frame builds retain existing graph and chunk ceilings.

This slice changes no assistance engine, dependency or native runtime closure.
No manual **Update AI assets** run is required. Optical vignette and licensed
profile corrections remain separate work.
