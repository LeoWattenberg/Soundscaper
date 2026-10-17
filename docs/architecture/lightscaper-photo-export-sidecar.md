# Lightscaper photo export sidecars

The Lightscaper-owned `photo-export-sidecar` schema records one saved photo
version's Develop recipe and metadata beside a rendered export. Its suggested
filename is the complete rendered filename followed by `.lightscaper.json`,
such as `Photo.png.lightscaper.json`; its MIME type is `application/json`.
This schema makes no Adobe catalog, XMP Develop-state, or DNG compatibility
claim. An optional JSON download is available inside the existing File-menu
PNG/JPEG export dialogs and selected-photo batch export dialog. It is off by
default; explicit export presets and recovered batch settings can retain the
choice. The image and JSON have separate publication acknowledgments.

`createPhotoExportSidecarV1` accepts one complete Photo1/2 document and a closed
own-data request containing `catalogId`, `photoId`, `versionId`, and
`expectedRevision`. It matches catalog/photo/revision before recipe admission,
fully admits the source through the owning Photo1/2 validator, rechecks the
admitted identities, then selects the explicitly requested version. A virtual
copy need not be the active version; a delayed caller never follows a different
active version implicitly. Missing versions and stale revisions refuse.
This remains the permanent legacy reader and refuses Photo3.

`createPhotoExportSidecarV2` admits a complete Photo3 and retains its selected
process1/2/3 recipe, including ordered Clone/Heal definitions. A Photo3 with
an older active recipe still produces Sidecar2: the envelope describes the
admitted source document, not only its active recipe. The explicit Current
reader dispatches complete Photo1/2 to Sidecar1 and Photo3 to Sidecar2 without
rewriting the document. Current Session capabilities are named
`readExportSidecarCurrent` and `exportJournalCurrent`; the legacy capabilities
retain their original Photo1/2 admission.

The closed JSON envelope contains:

| Field | Meaning |
| --- | --- |
| `schemaFamily`, `schemaVersion`, `kind` | `lightscaper`, sidecar version `1` or `2`, and `photo-export-sidecar`. |
| `photoSchemaVersion` | Photo1/2 for Sidecar1; exactly Photo3 for Sidecar2. |
| `binding` | Catalog/photo IDs, photo revision, and the captured active version ID as provenance. |
| `original` | Exact original filename, lowercase SHA-256, and positive safe-integer byte length. |
| `version` | Selected ID, master/virtual-copy kind, name, creation time, and saved shared Develop state. |
| `metadata` | Current authored Photo metadata, including the separately authored filename. |
| `extractedMetadata` | Original-derived normalized ImageMetadata1 facts, or explicit `null`. |

The original binding describes the admitted photo's immutable original; the
scalar projection does not read or authenticate its body. Source filename
spelling and normalization form remain exact. Authored descriptive fields stay separate
from extracted EXIF/IPTC facts. Raw/partial capture-time fields and unknown
timezone offsets keep their owning metadata semantics. Metadata is serialized
as admitted JSON text; this does not promise authored Unicode EXIF encoding.

Develop process1, process2, and process3 keep their explicit versions. Shared
admission
preserves effect order and canonical mask graph/binding order. Disabled LUT
references remain present with their exact digest-derived scalar identities.
There are no original or LUT bodies, catalog storage locators, pixel buffers,
brush raster bodies, or native capabilities in the sidecar. A LUT reference is
not proof that its
body is available, and reading the sidecar grants no storage or import
authority. Output-only sizing, resampling, sharpening, watermarks, raster
encoding, and container metadata scopes are not part of the saved Develop
recipe. Complete history, snapshots, other versions, and catalog memberships
continue to belong to the existing Photo/Scape owners.

Normalization returns detached, deeply frozen facts. Canonical serialization
sorts object keys by codepoint while preserving the owning normalized array
order, and emits compact JSON with no clock, generated identity, or trailing
newline. Parsing checks the existing 2 MiB character and UTF-8 byte limits
before `JSON.parse`; admission and serialization also check the complete
canonical output against that bound. Unknown fields, accessors, inherited
state, malformed identities, and unsupported/future sidecar, Photo, Develop,
or extracted-metadata versions refuse. Photo1 cannot contain process2.
Reading never migrates or upgrades a recipe or source photo.

This is a read-only projection, with no command, undo, history, or catalog
write. Existing Scape codecs and retention rules are unchanged; the sidecar is
an external exported artifact, not a new Scape asset or persistent catalog
record. Deleting that artifact changes no original, LUT, or saved recipe.
Any future sidecar import or application must explicitly authenticate the
chosen original and resource bodies through their existing owners.

The single-export consumer captures its saved-facts reader in the selected
library generation before preparing the raster destination. It binds the
complete canonical sidecar to the actual detached recipe being rendered and
rechecks catalog/photo/version/revision, active version, and complete saved
facts before image publication. Original and renderer owners finish their
joined checks before that publication. Close and generation retirement join
pending reads and native deliveries before retiring their owners.

A successful image save or download acknowledgment remains valid if the JSON
download fails or is canceled. The dialog reports that partial result and
offers a JSON-only retry using the captured reader and actual acknowledged
image filename, without rendering or opening another picker. Changed saved
facts refuse the retry. A real JSON download acknowledgment likewise survives
late cancellation. These are separate deliveries, not a multi-file atomic save.

Batch export captures both download targets in its initial gesture and records
the image and JSON acknowledgments independently in its durable journal. Each
delivery revalidates complete saved facts and the original/LUT resource
bindings. Current delivery also verifies the complete retained brush closure.
Current fresh image and JSON intent require the caller's positive native CAS
acknowledgment; matching readback after a false or lost acknowledgment retains
durable uncertainty for review and does not authorize another download.
Legacy lost-acknowledgment reconciliation remains unchanged, and the scalar
journal wire version remains one. A paired member is complete only after both
acknowledgments;
unfinished JSON remains recovery work after reopening the queue. Recovery
retains the image acknowledgment, requires review of uncertain delivery, and
can retry only JSON without pixel reads, encoding, or a new picker.

Maintained Lightscaper tests cover deterministic JSON, selected-generation
capture, recipe and metadata drift, joined retirement, durable acknowledgments,
and single/batch JSON-only retry. The existing English/German Chromium/Firefox
single-export witness passed all 14 cases for PNG/JPEG downloads, original and
history preservation, reopening, and a refused JSON download followed by retry.
The Current repair export witness also passes 14 English/German Chromium/Firefox
cases: Clone/Heal before crop/flip/exposure, exact PNG and independently decoded
JPEG pixels, Sidecar2 saved facts, JSON-only retry and reopened batch recovery,
and unchanged native Original hash, bytes, and custody. Focused Lightscaper
tests prove exclusive positive native claims and hidden replacement-batch
Develop exclusion alongside the permanent legacy behavior.
The remaining L5 export-matrix qualification is separate; this implementation
does not add sidecar import or complete the full L5 milestone.
