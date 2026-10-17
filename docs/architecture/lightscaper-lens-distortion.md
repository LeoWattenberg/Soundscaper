# Manual lens distortion

Photo Develop's existing adjustment chooser and Frame's existing video effect
rack offer **Lens distortion**. Both surfaces remain behind their existing
opt-in menus. Adding the effect starts at zero; existing recipes acquire no
new stage. Amount accepts finite numbers from -100 to 100.

The shared numeric `lens-distortion-v1` family fits the existing process1/2/3
recipe envelopes. Catalog history, presets, sidecars and editable Source2/3/4
handoffs retain that exact family, order and amount without a schema migration.
Permanent byte rendering facades retain their earlier supported families; the
active Current composition explicitly selects the new renderer.

## Fixed radial process

The output keeps the incoming stage's width and height. For output pixel center
`p = (x + 0.5, y + 0.5)`, center `c = (width/2, height/2)` and displacement
`d = p - c`, the inverse source coordinate is:

```text
k = amount * 0.003
r² = dot(d, d) / dot(c, c)
source = c + d * (1 + k * r²)
```

The half diagonal bounds `r²` by one within the output aperture. The radial
derivative is at least 0.1 across the admitted amount range, preventing a folded
map. Positive amounts sample farther from the center; negative amounts sample
closer. There is no automatic crop or profile lookup.

Four bilinear taps use transparent support outside the source rectangle.
Sampling filters premultiplied RGB and alpha, then restores straight RGB.
Filtered zero alpha produces zero RGB. A neutral stage copies exact samples,
including hidden color, negative zero and subnormals, without interpolation.

The byte path filters encoded sRGB. The native path filters linear Float32,
preserving signed/HDR RGB and fractional alpha; it never quantizes through a
byte working image. Each destination write rounds into its actual sample type.
Current fit previews evaluate the same amount on their native proxy grid;
Full inspection, export and editable handoff retain natural resolution.

## Masks and ownership

Distortion is a geometric operation and cannot receive a local mask, including
when neutral or disabled. The mask manager, both gradient dialogs, range
dialogs and brush editor omit it from binding choices. Current authoring and
render admission enforce the same rule independently of the controls.

A mask observes the incoming stage of its bound color adjustment. Temporary
coverage created before distortion follows every later radial and projective
transform in authored order. A range mask after distortion samples the warped
incoming pixels. Current planning retains this ordered transport privately;
the existing geometry and saved mask contracts are unchanged.

Metadata, natural extents, resource authority and work quotas are admitted
before source samples. The scalar mapper supports the existing large byte
natural extents; each host retains its own tighter pixel and processing limits.
The standalone byte stage charges the entire intrinsic borrowed source backing
and one owned output against 512 MiB. Native writing borrows disjoint dedicated
Float32 planes under the existing Current processing owner, with no frame-sized
scratch. The local byte bound does not claim to bound the entire host phase.

Current coverage projection admits dedicated input coverage and charges its
RGBA/staged/coverage scratch under the existing 64-MiB mask budget. Scoped
outputs join their consumers and physically retire on success, cancellation
or failure. Exact opaque operation failures remain observable alongside
independent retirement failures.

## Shared video execution

Frame CPU finishing uses the same byte kernel. Native WebGL2 preview has an
explicit versioned pass with transparent bilinear support and byte-stage
quantization. Its varied-alpha 9×7 GPU comparisons use a declared one-byte
envelope; the small literal golden is exact. This individual shared-effect path does not
complete GPU evaluation of the whole Photo Develop stack.

FFmpeg evaluates the same inverse map with explicit taps. Input and computed
output alpha travel through separate extract/merge planes, avoiding packed to
planar conversion drift. The owning pinned-WASM test compares actual emitted
pixels with an independent rational coordinate/alpha oracle.

Chromatic aberration, defringe, optical vignette and licensed lens profiles remain
separate work. No assistance engine or native runtime closure changes; no
manual **Update AI assets** run is required.
