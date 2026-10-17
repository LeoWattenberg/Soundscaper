# Editable photo and still handoff

Lightscaper's File menu exports a saved photo version as a Framescaper Scape
archive and imports an explicitly selected editable image from a saved archive.
The transfer creates a destination copy. Browser origins keep separate media
stores under the [product-origin contract](../decisions/product-origins.md), and
neither operation changes the sender's original, recipe, versions, or history.

The editable image source carries an immutable original binding, the shared
Develop process and ordered recipe, its natural output dimensions, and origin
provenance. The archive retains the original and canonical image pack together
with every referenced LUT, including disabled effects. Canonical pixels describe
the original before Develop; the saved recipe remains separate and editable.
Current RAW handoff uses [Source4 native Original authority](lightscaper-raw-image-handoff.md):
the DNG/CRW and unchanged saved recipe remain editable, while pack pixels are a
disposable presentation cache. Frame regenerates authenticated native words
before Float32 Develop, native Save/reopen and reverse Photo3 receive.
The single-photo transfer carries one saved version. Full photo history and
catalog definitions stay in the sender's library.

## Collection sequences

File → Photo → Download collection as Framescaper sequence… opens a chooser for
manual collections, smart collections, or saved filters. Scope and collection
must both be selected explicitly. Catalog collections use the native query's
photo-ID order; saved filters retain their saved sort and direction, including
the native ID tie-break. Stack collapsing does not omit matching photos.

Each matching photo becomes a distinct editable source and timeline clip, even
when photos share an original. The source retains its active saved version's
process1, process2 or Current process3 recipe, original, provenance, natural
output dimensions, LUTs and Current brush resources, including disabled and
unused declarations. RAW and raster placements may share a sequence. Clips are
contiguous in a 30-fps sequence using
the canonical still duration. Ordering and duration presets remain optional
future work. The sender's originals, versions, history, and collections remain
unchanged; the archive carries the selected versions, not full photo histories
or catalog definitions.

Empty collections, unsupported masks, missing or changed originals or LUTs,
changed catalog or definition facts, and exceeded capacities refuse the whole
archive. No partial sequence is delivered. Photos plus unique LUTs are limited
to 4,094 entries, with complete captured facts limited to 2 MiB. Capture limits
unique encoded originals plus LUT bodies to 128 MiB; archive assembly separately
limits generated image packs plus unique LUTs to 128 MiB and final ZIP output
to 256 MiB. Each original remains limited to 64 MiB. These are admission and
per-owner bounds, not an aggregate native-codec or ZIP memory estimate.

The destination picker starts from the download gesture. Close and library
retirement join catalog reads, preparation, archive work, and destination
settlement. Saved and Download started describe the destination acknowledgment;
opening the archive in Framescaper is a separate operation.

Focused Chromium and Firefox tests cover English and German menu entry,
manual and smart collections, saved-filter ordering, editable import, and
rendering through native Framescaper owners within the Lightscaper test origin.
This does not qualify separate-origin Framescaper application UI, WebKit,
large-library delivery, or the remaining L5 export and handoff matrix.

## Archive inspection and authenticated receive

Inspection authenticates the current Frame project digest and the complete
declared asset inventory, then closes the ZIP before returning immutable scalar
choices. It never selects a source by default and does not authenticate or grant
selected original, pixel, or LUT bodies. A corrupt selected body can therefore
appear as a choice but must fail receive. Unsupported mask recipes are reported
as unavailable instead of being silently flattened or partially imported.

Receive authenticates the selected image pack and all referenced LUT bodies.
The canonical frame digest is derived from the authenticated pack. The retained
original then passes actual image signature/profile admission, native decode,
orientation, geometry, alpha, and byte-equal canonical pixel verification before
any original publication. An archive's MIME declaration, original digest, or
claimed canonical dimensions alone cannot authorize a destination write.

The fixed archive input and expanded envelope limit is 256 MiB; selected pack
plus unique LUT bodies are limited to 128 MiB, and the original to 64 MiB.
Raster processing admits one static 8-bit sRGB frame. The explicit Current
Source4 route verifies native linear sRGB16 against its retained RAW receipt,
preserving process1/2/3 and publishing Photo3. These are admission and
per-owner bounds, not an aggregate ZIP/native memory estimate. Cancellation and
close join all outstanding ZIP, native, resource, and publication consumers.

## Selected-library publication

The captured selected Session owns one mutation lease from archive read through
publication acknowledgment. Fresh photo, original, and version identities must
not collide with incoming provenance or the destination catalog. Digest dedupe
may reuse an authenticated retained original's storage key while the received
photo keeps its own identities. Exact LUT identities and bytes are retained;
required keyword definitions are resolved before photo publication.

A successful native catalog acknowledgment is the import result. Lost
acknowledgments require a complete expected-photo readback, including its saved
recipe and original binding. Later cancellation, cleanup, or UI refresh failure
cannot reinterpret an acknowledged import as absent. The receipt distinguishes
complete settlement from recovery pending; a refresh retry uses the same
captured library generation. Original custody, resource storage, and catalog
publication remain separate durable owners with reconciliation between them.

The dialog joins inspection, receive, and reload on close or selected-library
retirement. Replacing an archive clears its choices, and imported facts from a
retired dialog are not presented as results in a different library. Opening File
alone loads no archive or dialog implementation.

## Ordinary Framescaper stills

The reader also admits ordinary static image sources when the caller explicitly
selects a real matching timeline or Project Bin image clip in an existing
sequence. Current Frame project admission proves clip identities are globally
unique. The unchanged Source1 pack is authenticated before promotion to an
editable source with a neutral process1 recipe and genuine Frame provenance.
Timeline timing and composition are not converted into photo adjustments.

Only Frame's stored NFC filename survives ordinary still ingest; this path
cannot recover an earlier spelling. Its nullable MIME hint is preserved while
authenticating the unchanged pack, then the promoted source declares the
recognized image format. Actual signature and native pixel verification remain
mandatory. Editable Source2 images keep their original provenance and reject an
ordinary clip-selection field. The import dialog exposes explicit timeline or
Project Bin placement selection for ordinary stills; no placement is selected
by default.
