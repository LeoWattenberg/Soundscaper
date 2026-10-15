# Lightscaper Current Develop conformance

The repaired Photo path retains process3 settings alongside original media,
native history, masks and resource references. Its owning qualification must
exercise those complete documents rather than project them into the older
process1/2 fixtures. These checks extend the L4/L5 exit evidence; final
inter-slice qualification remains a separate task after implementation.

## Operation and process matrix

`tests/lightscaper-develop-operation-matrix-current.test.ts` maintains 50 cases:
all 17 current adjustment families at process2 and process3, and the 16
resource-free families at process1. Process1 intentionally refuses LUTs.
Every case authors a non-neutral adjustment, persists it through the selected
Current session and reads the saved settings before rendering.

The same case compares repeated proxy rendering, natural full-resolution
rendering, decoded lossless PNG delivery through the Current export controller,
and the actual Frame editable-image adapter over an authenticated canonical
pack. Process3 also compares against an independently constructed original-space
Clone result, proving that the repair prepass precedes each adjustment without
changing its process2 operation semantics. Original bytes, complete Photo rows
and canonical pack bytes remain unchanged by rendering and export.

These are host-conformance checks. Family-specific mathematical goldens remain
in the existing operation reference tests. The matrix does not claim browser
JPEG codec parity, GPU parity, deep processing or wide-gamut admission.

## Generated Current settings

Generated tests use bounded, repeatable seeds and the actual Current session,
catalog commands and native resource repositories. Their recipes include
ordered repairs, names, composed masks, enabled and disabled effects, geometry,
LUT references and installed brush resources. Independent assertions cover
history and snapshot restoration, selective settings transfer, preset
roundtrips, process stability and original/resource custody.

Native presets can retain authenticated brush resources in their selected
catalog. External preset JSON retains its stricter resource boundary; a native
resource reference alone grants no authority to export or import a brush body.

## Raster settings matrix

The Current raster matrix combines PNG/JPEG, all five sizing modes,
capture/strip metadata scope and default-off sidecar selection. Expected output
dimensions and pixels are specified independently of the application resize
planner. Capture fixtures include camera metadata in the authenticated PNG
Original; exported metadata and Sidecar2 provenance are read back from the
delivered artifacts. Rendering and delivery preserve saved Photo rows and
original bytes.

Node uses the real PNG codec and independent PNG readback. Its controlled
native JPEG canvas boundary records the exact pixels delivered to the browser
encoder and returns structural JPEG bytes. That boundary proves controller
and metadata integration, not JPEG compression. Existing focused browser
workflows qualify native PNG/JPEG delivery for selected repaired recipes;
the complete browser codec/settings cross-product remains an L5 qualification
item.

No application runtime closure, runtime assets, bundle ownership or UI entry
points change in this qualification slice. A manual **Update AI assets** run
is not required.
