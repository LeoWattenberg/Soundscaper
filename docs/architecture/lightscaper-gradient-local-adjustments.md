# Gradient local adjustments

Linear and radial gradients are authorable through Develop's existing menu and
bind to existing color, detail and LUT adjustments. The shared frame
renderer owns the coverage and blend, so preview, raster export and editable Frame
handoff use the same saved recipe. Frame's existing mask dialog also authors the
new nodes.

The additive `linear-gradient` graph node stores normalized `start` and `end`
coordinates. Its ramp projects pixel centers onto that line and clamps coverage
to zero through one. Coordinates describe the input extent of the bound effect;
subsequent geometry also transforms the optional overlay. Existing graph kinds,
process versions and unmasked recipes retain their rendering semantics.

The additive `radial-gradient` node stores normalized `center` and positive
`radius` coordinates plus an `innerFraction` in `[0, 1)`. Coverage is full within
the inner ellipse and falls linearly to zero at the outer ellipse, evaluated at
pixel centers in the bound adjustment's input extent. Existing invert, feather,
and boolean nodes can compose either gradient.

Masked adjustments interpolate decoded linear RGB and preserve the input alpha.
Zero and full coverage preserve the exact original and adjusted RGB bytes.
Geometry effects cannot be mask-bound. External raster/alpha inputs remain
unsupported by photo recipes until a portable resource contract is implemented.
Coverage caches and scratch storage have an explicit working-memory bound, and
owned temporary pixels are cleared when their scoped consumer finishes.

Saving uses the existing draft, revision checks and history writer. Overlay
selection is temporary presentation state. This slice does not add persistent
mask names, ordering or enablement fields. Range masks, brush resources,
composition authoring, mask management and healing remain subsequent L6 work.

Qualification uses Lightscaper tests only. The complete repository suite and
cross-product cleanup are deferred until implementation finishes. This change
does not alter the assistance runtime closure and needs no manual **Update AI
assets** run.
