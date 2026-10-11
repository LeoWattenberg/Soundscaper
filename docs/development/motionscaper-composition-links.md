# Motionscaper composition link foundations

M10 is in progress. Versioned offers, streamed verification, receiver storage,
atomic owner/history updates, saved-revision picture/PCM adapters and bounded
portable archive assembly/import are implemented foundations. Framescaper
successor editor/source routing and browser/desktop transports remain unfinished.
There is no shipping connected-editor workflow yet.

## Revision and closure authority

Protocol `motionscaper-composition-link`, version 1, identifies one stable
composition inside a verified saved Motionscaper revision. Its output contract
contains dimensions, exact frame rate, frame duration, working/output color
spaces and premultiplied alpha. Renaming a project or composition does not change
external identity. Windows, paths, file handles and transport tokens are absent
from this persisted intent.

The offer currently retains the entire saved project and its complete declared
asset closure. This conservative ownership also covers nested compositions and
audio expression references; it does not prune unrelated compositions/assets.
Canonical metadata is capped at 32 MiB. Transfer deduplicates physical bodies by
SHA-256, admits 8 GiB by default with an explicit maximum of 64 GiB, and stages
sequential chunks of at most 4 MiB. Alias descriptors must agree on byte length.

The sender's digest is independently recomputed while streaming, and receiver
staging verifies its own byte contract before publication. Missing, short, long
or corrupt bodies never publish a new accepted snapshot. Cancellation cancels
an active reader and rolls back private staging. Injected providers and storage
transactions own their cancellation/timeouts; the future transport must bound
their response time.

## Update and history rules

Only a complete, durably retained offer may enter the update state machine.
A newer compatible output replaces the accepted snapshot as one owning-editor
history action. A newer incompatible output remains pending until Conform.
Older deliveries are ignored, exact repeats are idempotent, and a known revision
number with another digest refuses. The newest pending revision supersedes
earlier pending deliveries.

Undo restores a retained historical snapshot and pauses automatic acceptance.
Resume accepts a compatible pending snapshot; incompatible output still needs
Conform. Conform preserves an existing pause until Resume. Accepted, pending and
paused intent round-trip through storage without retaining a transport session.

## Receiver storage and rendering

Explicit successor admission opens `kw-media-framescaper-editor-v2` database
version 3. Version 2 appended asset, chunk, staging, linked-revision and
link-state stores; version 3 appends a separate owner/history store while
preserving the original migration journal and linked bytes. Neither
Framescaper family-v1 storage nor Motionscaper storage is opened by this receiver.

Verified bodies, revision retention and state publication share one IndexedDB
transaction. Publication failure leaves the previous accepted revision intact;
a delayed transfer cannot overwrite a newer accepted revision. Every published
historical closure is conservatively retained until an explicit collection
policy is implemented. Reader verification also detects corrupted stored chunks.

The owning repository prepares private bytes and a candidate state before the
editor builds its history action. Commit checks the exact owner digest and the
captured link state, then publishes bytes, revision, accepted/pending state and
validated project/history together. The accepted relation must match the project
exactly, and every history snapshot must retain its complete linked revision.
Owner intent is capped at 64 MiB. Preparations are single-use; conflicts, write
failure, cancellation and close reclaim their private chunks. Standalone link
writes refuse identities already owned by a document. Pending migrations and
fresh owners cannot claim each other's identity.

Compiled link render plans pin the saved revision and use the shared scene,
expression, shutter, depth and lens renderer. Source time is exact composition
seconds after the owning timeline applies trim/retime. Requests outside the
accepted half-open duration refuse. Preview may explicitly reduce authored
quality; final rendering uses authored quality and returns a premultiplied
linear working surface. A render retains its dependency lease through cleanup,
so later saved offers do not replace an active task's authority.

The display adapter explicitly converts this surface to full-range display-sRGB,
straight-alpha RGBA8. That boundary quantizes once; it is not float-lossless.
ImageData/WebGL fixtures preserve the resulting bytes and alpha. The PCM source
adapter pins the same saved revision, retains its provider lease, and supplies
exact `sourceTime + i/sampleRate` windows of at most 4,096 frames. Frame's source
addressing owns clip trim, reverse and retime policy. Both adapters still need
the successor editor's actual source routing and native delivery integration.

## Portable archive foundations

The current exporter accepts unchanged baseline intent and retained v1 original
custody, then streams each unique linked digest once alongside original Frame
assets. Metadata, entry, expanded-byte and Blob budgets are admitted before
linked body acquisition; a streaming destination observes backpressure. Every
linked body is independently hashed before the final manifest is written.

Import validates the typed snapshots and exact physical dependency inventory,
reconstructs and authenticates baseline custody, then stages linked bodies. One
receiver transaction retains the owner project, its states and revisions, and
all linked bytes. Corrupt media, cancellation, publication failure and identity
conflicts leave no imported owner visible. Baseline reconstruction currently has
a default 512 MiB Blob admission limit. Edited ordinary Frame intent and newly
inserted virtual linked sources still need a complete successor asset assembler;
these foundation archives are not yet the shipping editor save workflow.

Focused Node and real Chromium IndexedDB fixtures qualify private staging,
cancellation, reopening, pending updates, Undo/Resume, Conform, portable import
rollback and atomic owner/history publication. Actual
CanvasKit tests qualify saved-revision rendering, arbitrary seeks and retained
image bytes after receiver reopen; PCM tests read retained WAV bytes after
reopen. These foundations do not close M10's connected editor, native delivery,
complete save/archive or cross-origin isolation gates.

No **Update AI assets** run is required; the assistance runtime closure is unchanged.
