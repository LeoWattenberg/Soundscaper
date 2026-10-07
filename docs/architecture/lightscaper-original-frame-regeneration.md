<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Retained original frame regeneration

Budget recorded before implementation: one genuine retained Blob is admitted
and read at a time, at most 64 MiB. The current static sRGB/unorm8 source profile
admits at most 8192 pixels per side and 16,777,216 pixels (64 MiB RGBA).
Accounted decode JavaScript buffers comprise source input, native returned RGBA,
and its safe canonical snapshot: at most 192 MiB. Native decoder/canvas memory
and retained Blob backing are separately bounded platform resources. Decode
retains the existing cooperative 60-second deadline; cancellation never leaves
a late successful native session without deterministic cleanup.

The owner accepts the exact preview original binding and genuine Blob only.
Intrinsic Blob snapshots ignore subclass overrides. Size is checked before the
single bounded read, and bytes are independently SHA-256-bound before decoder
open and again after the writable decoder input has been exposed. Source
admission, static topology, declared color and original EXIF orientation are
verified through existing shared owners. Oriented header geometry must match
the immutable binding before the native decoder opens. Authored metadata is
absent from this boundary and cannot change decoder orientation.

The existing import preparation and this regeneration path share a factored
safe native-session port. Shared canonical RGBA snapshot/zero-alpha behavior
remains a common pixel operation. Shared imaging leaves have the non-recursive
`editor-imaging` semantic chunk owner: the existing Frame image source/decoder
already load these kernels, and a photo consumer must not absorb them into its
product chunk. Product startup graphs continue to measure the resulting bytes. Regeneration uses the existing low-level
browser decoder and never constructs or persists an original-bearing frame
pack or a new PhotoDocument.

Native session and source input are closed/cleared before a callback consumes
the owned oriented frame. The callback is awaited and that frame is wiped in
finally on success, failure or cancellation. Original bytes remain exact.
The callback's owned frame plus preview preparation's 96 MiB budget totals at
most 160 MiB. Prepared immutable preview Blobs survive temporary-frame cleanup.
The composing cache owner admits at most 64 queued IDs, schedules one active
original, links cancellation/close, and rechecks current catalog/media binding
before preview publication. This pure owner changes no custody roots or cache.

Chromium, Firefox and WebKit qualify actual JPEG EXIF transforms through the
native decoder; decode-only evidence does not broaden the storage support
matrix or activate a product capability. Runtime assets and inventories stay
unchanged; no manual Update AI assets run is required.
