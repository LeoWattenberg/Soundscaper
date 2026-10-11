# Lightscaper batch graphic export

Graphic watermarks are an optional setting in File → Download selected photos.
The dialog uses the existing single-export placement controls and graphic
renderer. Each batch member follows the existing resize, output sharpen and
graphic composition path before PNG/JPEG encoding. Opening the application
does not expose or load these controls.

The batch plan and catalog-scoped export journal can retain an optional
`graphicWatermark` scalar intent. The closed version 1 intent contains:

| Field | Meaning |
| --- | --- |
| `schemaVersion`, `kind` | Exactly `1` and `photo-raster-batch-graphic`. |
| `contentSha256`, `byteLength` | Lowercase SHA-256 and bounded positive byte length of the selected file. |
| `anchor` | One of the existing nine graphic anchor positions. |
| `widthFraction`, `marginFraction`, `opacity` | Existing normalized output placement and opacity. |

The journal retains no file body, filename, storage locator, decoded pixels
or browser authority. Legacy plans and journals without this optional field
retain their existing key order and serialized bytes. Readers that predate
the field refuse it as unknown. Current admission refuses unknown fields,
future versions and malformed values; loading never migrates, drops or
silently replaces retained intent.

Before Start becomes available, the dialog captures the immutable native Blob
and hashes bounded spans. Every delivered hash buffer is wiped, and retirement
joins a held native read before settling cancellation. The resulting prepared
selection has an in-process owner identity; cloning its public fields cannot
forge that identity. The queue captures it and matches the complete scalar
intent before destination acquisition. The existing graphic frame owner still
admits the image signature, metadata, native decode and orientation. A file
digest alone grants no image or native destination authority.

After reopening unfinished raster work, the queue shows the retained placement
and requires the matching file to be selected again. The filename can differ;
both byte length and digest must match. A wrong selection leaves the journal
and completed acknowledgments unchanged. Recovery preserves original member
indices and filenames and schedules only admitted unfinished jobs. Applying
an export preset clears an ephemeral graphic selection rather than changing
unfinished retained intent.

An image acknowledgment remains valid if its paired JSON delivery fails.
JSON-only recovery requires no graphic selection, image decode, pixel read or
raster encoding. Both image and JSON acknowledgments continue to mean browser
download initiation, rather than a physical-file durability claim. Explicit
review of uncertain delivery and all existing resource checks still apply.

The graphic is an output setting, separate from the saved Develop recipe,
Photo versions, undo history and Scape assets. Its retention belongs to the
existing export journal lifecycle. This addition does not complete the L5
export matrix or require a manual Update AI assets run.

Focused Lightscaper qualification passed 144 Node controls and eight
English/German Chromium/Firefox browser cases. The native PNG cases cancel a
queued member while another renders, reload the actual retained journal,
refuse a different graphic, then resume with the same bytes under another
filename. They verify output pixels, preserved completed acknowledgments and
unchanged saved photos and original resources. The held preset/hash regression
verifies that applying a preset clears the file and joins preparation before
updating output settings. The remaining L5 format and profile matrix stays open.
