# Current native raster export

The Current export owner accepts the native Original and Current Develop
renderer already used by the editor. Linear RAW samples remain Float32 through
output sizing, output sharpening, graphic watermark and text glyph compositing,
in that order. Nearest sizing keeps the established top-left samples; bilinear
sizing filters premultiplied linear RGB. Sharpening uses the native spatial
kernel's continuous encoded-domain calculation. Graphics and glyphs arrive as
encoded RGBA8 assets, are decoded before filtering, and blend over the native
image in linear light. Straight alpha and signed/HDR RGB survive these stages.

The existing File export dialogs offer PNG bit depth. Opening a dialog keeps
the existing eight-bit defaults; choosing sixteen bits creates explicit nested
Output2 settings (`schemaVersion: 2`, `bitDepth: 16`). Current capture also admits
unchanged unversioned output settings. JPEG refuses sixteen-bit settings before
the destination picker. The permanent legacy output capture, preset, batch and
journal normalizers remain strict and refuse Output2.

Current presets, batch plans and recovery journals preserve Output2 inside their
existing version-one outer envelopes. They use named Current capture and
normalization policies; they never strip the depth fields to make an old owner
accept them. Current Session exposes a separate `exportPresetsCurrent` child;
the old child keeps its strict contract. Existing scalar list and write
acknowledgments, catalog leases, revision checks, destination acknowledgment and
sidecar retry semantics remain the publication boundary.

Output2 changes scalar export settings only. It changes no Photo/Develop history,
sidecar schema, Original body or resource inventory. Existing Scape catalog packs
carry photos and Develop presets; export presets and destination journals remain
local settings. Deleting a preset or replacing a journal uses the existing scalar
CAS operations. The depth field creates no new asset or retention root, and no
native working plane is persisted by export.

## Codec boundary

PNG8 and JPEG receive one full-resolution encoded sRGB byte plane after all
native output stages. Their existing encoders retain their byte behavior.
PNG16 instead receives the native linear Float32 frame. The deterministic PNG16
encoder clips RGB to the delivery gamut, applies the sRGB transfer and rounds
to UNORM16 while writing big-endian RGBA scanlines directly into a 64 KiB
streaming feed. It writes IHDR depth16/color type6, sRGB intent, zlib IDAT and
checked PNG chunks. It creates no full-frame encoded word intermediate.

The PNG16 codec also explicitly accepts encoded sRGB UNORM16 and UNORM8 input;
byte compatibility expands each code by257. It refuses implicit linear word
input, other transfer functions and other primaries. Choosing PNG16 for an
ordinary encoded raster promotes that Original to linear Float32 before Current
Develop, so output processing does not insert a byte working plane. That
promotion cannot invent source precision absent from the Original.

## Ownership and bounds

Native Develop keeps its existing 768 MiB admission. The Current export owner
adds a one-GiB aggregate bound for physical Original and rendered backings, a
conservative 64 MiB held mask-resource scope, graphic/glyph resources, replacing
Float32 output planes, final byte delivery if required, and the codec's declared
storage budget. At most two privately owned output planes overlap; replacing a
stage immediately wipes and retires the previous one. The remaining aggregate
capacity can lower the codec's existing 256 MiB maximum. These bounds describe
owned and borrowed bytes, not total JavaScript heap or browser process RSS.

PNG16 charges retained compressed chunks, final container/chunk headers and a
one-MiB codec/row reserve before retaining compressed output. Its pinned fflate
stream's rolling/hash buffers, row spans, emitted spans and retained chunks are
physically wiped. The output transfers to its caller only after joined codec
retirement. The outer export joins the renderer and Original owners before
publishing and wipes encoded bytes after destination settlement. Opaque abort
reasons and distinct cleanup failures are preserved, including detachment of an
owned plane. Encoded output must own a dedicated fixed buffer and cannot alias
any borrowed pixel plane, even when a delivered view shadows `buffer`.

## Qualification

Focused Lightscaper cases independently inflate PNG16 output and verify literal
big-endian words, CRCs, row/chunk boundaries, adjacent sensor precision, HDR
delivery clipping, alpha, cancellation and physical retirement. Real selected
Current Session tests import owned DNG sensor bytes through the pinned LibRaw
worker, export the authenticated native Original, and verify unchanged source
words and saved Develop state. Separate cases cover ordinary raster promotion
and the complete resize/sharpen/graphic/glyph order. Browser qualification uses
the real menu, selected catalog, renderer, worker and codecs; only the exact
manifest-pinned WASM fetch is routed locally.

This work changes no RAW compiler inputs or assistance runtime closure. It
requires no manual **Update AI assets** run. [Editable RAW Frame
handoff](lightscaper-raw-image-handoff.md) retains the authenticated Original and
native receipt separately from its byte presentation cache. External RAW runtime
publication, embedded-preview culling, wide-gamut output and other remaining
roadmap work are separate.
