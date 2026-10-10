# Lightscaper photo export sidecar V1

The Lightscaper-owned `photo-export-sidecar` schema records one saved photo
version's Develop recipe and metadata beside a rendered export. Its suggested
filename is the complete rendered filename followed by `.lightscaper.json`,
such as `Photo.png.lightscaper.json`; its MIME type is `application/json`.
This schema makes no Adobe catalog, XMP Develop-state, or DNG compatibility
claim. The foundation supplies admission and serialization; menu, destination,
and paired-file publication remain consumer integration work.

`createPhotoExportSidecarV1` accepts one complete Photo1/2 document and a closed
own-data request containing `catalogId`, `photoId`, `versionId`, and
`expectedRevision`. It matches catalog/photo/revision before recipe admission,
fully admits the source through the owning Photo1/2 validator, rechecks the
admitted identities, then selects the explicitly requested version. A virtual
copy need not be the active version; a delayed caller never follows a different
active version implicitly. Missing versions and stale revisions refuse.

The closed JSON envelope contains:

| Field | Meaning |
| --- | --- |
| `schemaFamily`, `schemaVersion`, `kind` | Exactly `lightscaper`, `1`, and `photo-export-sidecar`. |
| `photoSchemaVersion` | The admitted source Photo version, 1 or 2. |
| `binding` | Catalog/photo IDs, photo revision, and the captured active version ID as provenance. |
| `original` | Exact original filename, lowercase SHA-256, and positive safe-integer byte length. |
| `version` | Selected ID, master/virtual-copy kind, name, creation time, and saved shared Develop state. |
| `metadata` | Current authored Photo metadata, including the separately authored filename. |
| `extractedMetadata` | Original-derived normalized ImageMetadata1 facts, or explicit `null`. |

The original binding describes the admitted photo's immutable original; the
writer does not read or authenticate its body. Source filename spelling and
normalization form remain exact. Authored descriptive fields stay separate
from extracted EXIF/IPTC facts. Raw/partial capture-time fields and unknown
timezone offsets keep their owning metadata semantics. Metadata is serialized
as admitted JSON text; this does not promise authored Unicode EXIF encoding.

Develop process1 and process2 keep their explicit versions. Shared admission
preserves effect order and canonical mask graph/binding order. Disabled LUT
references remain present with their exact digest-derived scalar identities.
There are no original or LUT bodies, catalog storage locators, pixel buffers,
or native capabilities in the sidecar. A LUT reference is not proof that its
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
Future sidecar consumers must first authenticate the chosen original and
resource bodies through their existing owners before any explicit application.

The eventual export consumer must capture these facts in the same selected
library generation as the rendered recipe and join its reads. Before paired
publication it must revalidate the catalog/photo/version/revision and retain
the existing destination cancellation, staging, and irreversible-ACK rules.
The foundation does not implement multi-file atomic save or sidecar import.
