# Luminance range local adjustments

Develop’s existing Settings and presets menu authors a luminance range and binds
it to an existing adjustment. Frame’s selected visual mask dialog authors the
same shared node. Saved recipes retain scalar thresholds and bindings; overlay
selection stays temporary presentation state.

The closed `luminance-range` node stores `id`, `lower`, `upper`, and `falloff`.
All values are canonical finite numbers: `0 <= lower <= upper <= 1` and
`0 <= falloff <= 1`. Coverage is full inside the inclusive interval and falls
linearly to zero over `falloff` outside each endpoint. Zero falloff makes a hard
inclusive interval. The evaluator rounds once to a coverage byte.

Membership uses straight linear Rec. 709 luminance. sRGB inputs are decoded
once; declared linear inputs are used directly. Fully transparent pixels have
zero coverage. Partial alpha does not attenuate membership again because the
masked blend preserves input alpha. Existing encoded raster-luma semantics and
vector, gradient, feather, invert, and boolean nodes remain compatible.

Photo preview, full-resolution rendering, export, and packed editable Frame
rendering evaluate membership from the actual frame entering the bound effect.
Earlier enabled adjustments and geometry therefore influence membership, while
the bound effect cannot select its own output. Each evaluation has a fresh scoped
cache and captures its input bytes before yielding. Reachable range nodes require
an authoritative native straight UNORM8 sRGB-primary frame with sRGB or linear
transfer; unreachable nodes require none. Dimensions-only callers refuse ranges.

Standalone Frame finishing evaluates media and visual masks on their placed
post-finishing output. An adjustment mask samples the incoming composition before
its own operations. The existing premultiplied Float64 composition is explicitly
converted to straight linear UNORM8 for this evaluator. This conversion does not
expand the photo frame contract or promise deep-processing range precision.

An opted-in overlay observes the exact coverage used by the selected adjustment
and projects it through subsequent enabled geometry. One presentation owner
paints Before, After, and the overlay, publishes readiness after their borrowed
scopes join, clears their targets together, and wipes temporary pixel and coverage
storage on completion, replacement, or cancellation. It never samples the painted
After canvas. Mask graph planes, captured signals, projection scratch, retained
coverage, and overlay pixels are admitted against the existing 64 MiB mask working
limit before allocation; this is not a total application memory ceiling.

Color ranges, brush resources, full mask management, composition authoring,
and healing remain open L6 work. Qualification is limited to Lightscaper tests;
full-suite and cross-product cleanup follow implementation. The assistance runtime
closure is unchanged, so no manual **Update AI assets** run is required.
