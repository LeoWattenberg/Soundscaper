# Motionscaper composition link foundations

M10 is in progress. The versioned offer, streamed verification, receiver storage,
update rules and saved-revision frame renderer are implemented foundations.
Framescaper successor editor/source routing, browser and desktop transports,
linked PCM delivery and portable linked archives remain unfinished. There is no
shipping connected-editor workflow yet.

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
version 2. Its upgrade appends asset, chunk, staging, linked-revision and
link-state stores while preserving the original migration journal. Neither
Framescaper family-v1 storage nor Motionscaper storage is opened by this receiver.

Verified bodies, revision retention and state publication share one IndexedDB
transaction. Publication failure leaves the previous accepted revision intact;
a delayed transfer cannot overwrite a newer accepted revision. Every published
historical closure is conservatively retained until an explicit collection
policy is implemented. Reader verification also detects corrupted stored chunks.

Compiled link render plans pin the saved revision and use the shared scene,
expression, shutter, depth and lens renderer. Source time is exact composition
seconds after the owning timeline applies trim/retime. Requests outside the
accepted half-open duration refuse. Preview may explicitly reduce authored
quality; final rendering uses authored quality and returns a premultiplied
linear working surface. A render retains its dependency lease through cleanup,
so later saved offers do not replace an active task's authority.

Focused Node and real Chromium IndexedDB fixtures qualify private staging,
cancellation, reopening, pending updates, Undo/Resume and Conform. Actual
CanvasKit tests qualify saved-revision rendering, arbitrary seeks and retained
image bytes after receiver reopen. These foundations do not close M10's connected
editor, native delivery, archive or cross-origin isolation gates.

No **Update AI assets** run is required; the assistance runtime closure is unchanged.
