# Motionscaper AE scene transfer qualification

The first scene mapping is an explicit structural review option in the bridge domain. It does not establish installed After Effects or renderer equivalence. The source exchange and full original Motion archive remain the authority for unsupported intent.

The admitted camera is an unparented one-node perspective camera with captured SDK `NO_AUTO_ORIENT`, XYZ position, Z roll, neutral Orientation/X/Y rotation, zero anchor, unit scale and full opacity. Zoom and focus distance use composition-pixel values and authored hold/linear keys. Depth of field must stay disabled. The Motion draft uses aperture zero and explicit clipping planes (near 0.1, far 10000000); inactive AE lens/iris settings stay in custody. Point-of-interest, orthographic, tilted, parented, expression-driven and sampled camera motion require another mapping or rendered fallback.

The admitted light is a captured SDK `LightType.AMBIENT`, without adjustment or parent semantics. Static opaque SDR color requires the caller's explicit sRGB or linear Rec.709 interpretation; intensity converts percentages to a multiplier and can retain hold/linear keys. Ambient position/orientation has no lighting influence and becomes an identity transform. Negative intensity, point/spot falloff, parallel/environment lights, shadows and animated color remain unsupported. AE and Motion material response remains a reported rendering difference even for the admitted ambient parameters.

Optional `scene` metadata is closed and retained only on camera/light layers. Missing legacy metadata remains absent and does not acquire guessed orientation or light types. Popup integers are not an authority for semantic light types.

The focused domain tests exercise custody absence, exact parameter units, key timing, color interpretation, reverse mapping and refusal paths. They are structural fixtures, not captures from an installed Adobe host. The generated ES3 exporter captures SDK names without source mutation. The importer validates scene metadata and bounds before creating native camera/light layers, then verifies SDK types and numeric base/key values; host clamping rolls back its owned items. Synthetic host tests cover these operations and rollback. The opt-in File > After Effects Bridge import/export controls have an actual Chromium workflow covering default-off review, color selection, invalidation after changing review, Import, Save, library reopening, reverse native scene plan and exact original exchange custody. Real installed-host frame/subframe, camera projection, light/material, color and rollback reference checks remain separate gates.

## Primary references

- [Adobe camera and light settings](https://helpx.adobe.com/after-effects/desktop/work-with-layers/camera-layer/cameras-lights-points-interest.html) defines one-node versus point-of-interest orientation, zoom distance, ambient behavior, intensity, falloff and material response.
- [Adobe scripting Layer.autoOrient](https://ae-scripting.docsforadobe.dev/layer/layer/#layerautoorient) provides the named orientation enum.
- [Adobe scripting LightLayer.lightType](https://ae-scripting.docsforadobe.dev/layer/lightlayer/#lightlayerlighttype) provides the named ambient/point/spot/parallel/environment enum.
- [Camera match names](https://ae-scripting.docsforadobe.dev/matchnames/layer/cameralayer/) and [light match names](https://ae-scripting.docsforadobe.dev/matchnames/layer/lightlayer/) identify controls without translating popup integer values.
