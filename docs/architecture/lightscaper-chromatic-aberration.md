# Manual chromatic aberration correction

Photo Develop's existing adjustment chooser and Frame's existing effect rack
expose **Chromatic aberration**, with independent **Red** and **Blue** controls.
Each accepts finite values from -100 through 100 and defaults to zero. The
closed `chromatic-aberration-v1` family retains its authored order and numbers
in the existing recipe, history, preset, sidecar and editable handoff envelopes.
There is no automatic detection, camera profile lookup or schema migration.

## Reference grid and channel sampling

The output keeps the incoming extent. Green and alpha copy their exact source
samples on the reference grid. For each corrected red or blue channel, output
pixel center `p`, image center `c` and displacement `d = p - c` give:

```text
k = channelControl * 0.0001
r² = dot(d, d) / dot(c, c)
source = c + d * (1 + k * r²)
```

Positive controls sample outward; negative controls sample inward. Four
bilinear taps outside the source rectangle contribute transparent zero. Each
corrected channel divides its alpha-weighted color sum by its own sampled
alpha sum. A zero sampled alpha sum produces channel zero. The sampled alpha
sum is never rounded to a byte or written to output alpha. Writers decompose
signed displacement into an integer offset and direct fractional magnitude,
retaining tiny supported weights without absolute-coordinate cancellation.

A zero control copies that channel exactly, even if the other channel is
active. Both-zero and disabled effects preserve every sample bit. For an
output pixel whose reference alpha is zero, hidden green stays unchanged;
red and blue retain their independently copied or reconstructed values. This
explicit hidden-color rule avoids importing a full-pixel alpha policy from the
separate lens-distortion family.

The byte path interpolates encoded sRGB. The native path interpolates linear
Float32, retaining signed/HDR RGB and fractional alpha without a byte working
image. Each corrected native write rounds once into Float32. Proxy editing
uses the same controls on the reduced grid; Full, export and editable handoff
retain natural-resolution evaluation under the unchanged recipe.

## Masks, execution and ownership

The correction permits local masks. Coverage blends on the destination
reference grid. Green, alpha and zero-control channels remain exact through
that blend. This stage adds no geometric mask-overlay transport; later
whole-image distortion and projective geometry retain their existing ordered
coverage transport.

Current byte and native compositions own the new stage explicitly. Permanent
byte facades retain their prior supported families. Existing CPU finishing,
WebGL2 preview and FFmpeg have dedicated routes; the established RGB Split
translation keeps its own behavior.

WebGL2 reads exact texels and uses highp arithmetic. Qualification applies its
one-byte envelope only to the recorded corrected-channel corpus; reference
green, alpha and zero-control channels remain exact in those cases. This is
not a universal bound over every finite JavaScript control: coefficient
underflow and integer-boundary rounding can change tiny alpha support and
hidden color. CPU/native/FFmpeg remain authoritative delivery paths. Complete
Photo Develop GPU conformance remains a separate open milestone.

Metadata and quotas are admitted before source samples. The standalone byte
stage charges physical borrowed source backing plus its dedicated output
against 512 MiB. Native writing borrows dedicated, disjoint Float32 planes
under the Current processing budget, with no frame-sized scratch. Consumers
and cancellation join before owned outputs retire; opaque primary and
independent retirement failures remain observable.

This slice changes no assistance engine or native runtime closure. No manual
**Update AI assets** run is required. Defringe, optical vignette and licensed
profile correction remain separate work.
