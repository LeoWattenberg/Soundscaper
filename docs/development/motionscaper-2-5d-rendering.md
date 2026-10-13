# Motionscaper 2.5D rendering contract

M09 remains **In progress**. Layer > Scene exposes camera/light creation,
3D transforms, materials, shadows and lens/shutter quality. The renderer and
matching-quality worker/WebGL, host/CPU and native reference workflows are
implemented, including translucent intersections and isolated precompositions.
Historical focused and software Linux results were reported before the reboot;
their temporary receipts are unavailable. A fresh source-328 packaged Linux
scene passed; hardware and remaining platforms stay open. See [final validation status](motionscaper-final-integration-validation.md).
These are Motionscaper semantics; After Effects pixel parity is unqualified.

## Cameras and geometry

The topmost active camera controls its containing composition. Perspective zoom
is measured in pixels. Orthographic scale is zoom divided by the larger canvas
dimension. The camera looks along its local positive Z axis; near/far distances
bound camera-local forward depth. Parenting, anchors and invertible nonuniform
or mirrored transforms remain authoritative.

Without an authored camera, the centered implicit camera preserves the complete
Z=0 composition grid. Positive world Z recedes from that camera. Camera rigs and
planes must have finite, well-conditioned affine inverses; singular or nearly
singular transforms refuse before target or source acquisition.

Contiguous 3D pixel layers form a depth group. Each pixel ray intersects every
plane, samples its premultiplied local source, and blends translucent fragments
from far to near over the actual backdrop. Equal-depth ties preserve authored
layer order. A visible 2D layer or adjustment separates depth groups; nulls,
cameras, lights and hidden matte sources do not. Precompositions render into
isolated child grids before their resulting plane is transformed.

Local masks precede local effects and projection. Mattes use the containing
composition grid and retain source opacity, luma/alpha mode and inversion.
Referenced matte sources remain hidden. Adjustment layers operate on their
admitted 2D backdrop; isolate an adjustment in a precomposition before placing
that result in 3D.

## Materials and lights

Active lights affect 3D layers that accept lighting; 2D layers retain their
source colors. With no active lights, sources remain unlit. Ambient response,
two-sided Lambert diffuse response and Blinn specular response operate in
premultiplied linear Rec.709 SDR and clamp to the SDR range without changing
source alpha. Material shininess is the specular exponent.

Point and spot intensity has no distance attenuation. Spot direction is its
parented local positive Z axis; the authored cone is the full angle. Feathering
smoothly weights the interval between the inner and outer cone.

Shadow rays test other planes in the same depth group between receiver and
point/spot light. Source, mask, effect, matte and composite opacity determine
caster transmission; half-covered casters transmit half the incident light.
Both the light's shadow flag and the material's cast/receive flags apply.

## Lens and shutter quality

Aperture is disk diameter in camera-local world units. Deterministic paired disk
strata have zero mean; all rays converge at the focus distance. Each lens ray
performs depth sorting, material shading and shadows before averaging. One
declared lens sample uses the centered pinhole. The default is 16 samples;
optional composition `depthOfFieldSamples` declares 1–64. Preview may explicitly
reduce that count. An omitted override preserves each nested composition's own
quality; an explicit preview cap cannot increase nested quality.

Optional composition `temporal` declares rational shutter endpoints within
minus one through one frame and 1–64 samples. The root shutter evaluates the
entire nested scene at exact stratified midpoints, with equal rational weights;
nested shutters do not multiply it. Sequential samples share bounded scene,
expression and native-audio analysis work. Float64 accumulation precedes one
final Float32 store, and every subframe's consumption ledger is checked.

Each composition admits at most 64 depth planes, 32 lights and 67,108,864 combined
plane/lens/light/shadow work units. The 16-megapixel surface and default 512 MiB
working-memory limits also apply. Rendering yields for cancellation and refuses
excess work before acquisition. No work duration or prior playback affects a
sample's intent. These rendering changes do not require an **Update AI assets**
run; the assistance runtime closure is unchanged.
