# Motionscaper composition link foundations

M10 is in progress. Versioned offers, streamed verification, receiver storage,
atomic owner/history updates, saved-revision picture/PCM adapters and bounded
portable archive assembly/import are implemented foundations. The explicit
successor browser shell exposes File-menu connections and paired placement,
with lazy exact preview and delivery. Real connected-editor Chromium workflows
cover saved updates, Undo/Resume, reviewed Conform, portable reopen and decoded
MP4 pixels matching preview. Generated thumbnails, filmstrips and source-monitor
playback use retained scene bytes. The isolated Linux x64 desktop's native chooser
and saved-file watcher have interactive qualification. Native delivery and the
remaining desktop platforms still need release qualification.

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
transactions own their cancellation/timeouts. The connected browser transport
bounds pairing to 60 seconds, active RPC to 30 seconds, and established peer
presence to 120 seconds for throttled tabs. Each session pins one project and
composition identity, serializes saved updates, and exposes Disconnect.

## Update and history rules

Only a complete, durably retained offer may enter the update state machine.
A newer compatible output replaces the accepted snapshot as one owning-editor
history action. A newer incompatible output or native PCM sample grid remains
pending until Conform.
Older deliveries are ignored, exact repeats are idempotent, and a known revision
number with another digest refuses. The newest pending revision supersedes
earlier pending deliveries.

Undo restores a retained historical snapshot and pauses automatic acceptance.
Resume accepts a compatible pending snapshot; incompatible output still needs
Conform. Conform preserves an existing pause until Resume. Accepted, pending and
paused intent round-trip through storage without retaining a transport session.

Conform first shows a review without changing accepted intent. The fit-window
policy maps each retained source window in seconds onto the new frame grid,
showing exact before/after bounds, rates, rounding and clamping. Timeline starts,
durations, fades and animation stay fixed. Reverse, freeze, ramp and warp
ordinates are rebased with the source window; native audio rates stay aligned.
Apply verifies the reviewed owning project and pending digest, then publishes
all affected timeline, nested and bin occurrences as one undo action. Changed
intent requires a new review; cancellation and failed publication leave the
accepted revision unchanged.

## Receiver storage and rendering

Explicit successor admission opens `kw-media-framescaper-editor-v2` database
version 5. Version 2 appended asset, chunk, staging, linked-revision and
link-state stores; version 3 appends a separate owner/history store while
preserving the original migration journal and linked bytes. Version 4 adds a
separate portable-archive custody store; immutable original family-v1 migration
records remain separate. Version 5 adds archive-body references, binary chunks
and private archive staging. Neither Framescaper family-v1 storage nor
Motionscaper storage is opened by this receiver.

New archive custody uses binary chunks of at most 4 MiB and retains the exact
source bytes with whole-archive and per-chunk SHA-256 verification. Existing
Blob records remain readable. Private staging has a renewable 24-hour lease;
publication joins the owning transaction, and failure or cancellation rolls
back its private chunks. Expired staging is reclaimed in pages of 64 records.

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

Session write fences are storage-only metadata. Claiming a new fence withdraws
the previous writer's publication authority even if project intent is unchanged.
Every later save, prepared link commit and deletion must present that fence.
A fresh fence creates no library entry, and pending migration identities refuse
claims. The bounded owner catalog omits uncreated and retired entries. Deletion
writes a tombstone atomically, preserving original custody and historical media
while rejecting late autosaves and link commits. Restore/reimport policy and
garbage collection remain separate work.

A link may also own one distinct companion audio source through `audioSourceId`.
Both placement leaves share one accepted revision, receiver state and atomic
history action; companion ownership cannot overlap another linked leaf.

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
addressing owns clip trim, reverse and retime policy.

The successor Frame source adapter now resolves its exact drawable ordinal to
`ordinal / composition.frameRate`, sharing Frame's clip/keyframe presentation
oracle for forward/reverse/retimed placement. It captures the retained scene
before any encoded decoder. A bounded eight-request queue and 16 MiB default
frame LRU (256 MiB explicit maximum) keep random seeks independent of prior
playback. Returned pixels are private copies; resizing uses explicit nearest
sampling at this display carrier. The actual exact Frame preview composes these
pictures with its color/alpha pipeline. Projects with timeline images retain
the existing layered painter order, materializing Motion pictures before the
shared compositor. Virtual sources also request asynchronous frames during
playback. Focused actual CanvasKit/Frame tests cover seek/reseek, transparency
and mixed image order. The connected sender/receiver menu browser workflow
also saves a portable archive, opens it in a fresh receiver, exports real MP4
and verifies file pixels and actual native presentation separately, then reopens
the project offline. The file oracle retains the absolute 12-code authored-color
bound: native I420/NV12 output uses an independent limited-range BT.709 inverse;
native RGB output must meet the same bound and is explicitly unqualified for
normative plane verification. Actual file tags, geometry, two frame timestamps,
native output, HTML-video pixels and a separately constructed same-byte native
frame control are retained. A control never replaces the authored file bound.
Chromium 151's retained blue fixture presented code 241 despite correct 709
planes yielding about 253 by the normative inverse. Its original absolute HTML
assertion remains a recorded failure. The exact Chromium/libyuv source and a
constant-plane control agree with the bounded H709 chroma coefficient in
[the pinned libyuv implementation](https://chromium.googlesource.com/libyuv/libyuv/+/8aeb3a9ca36341a640528e59b34b5d641080dca8/source/row_common.cc).
The maintained presentation check requires actual native and HTML output to
match the same-tag native control; it does not claim universal display fidelity.

Owned WebCodecs AVC output now completes missing Main-profile SPS color signaling
from the producer's explicit BT.709 limited I420 contract and actual emitted
configuration. This includes absent VUI and in-band SPS parameter sets. Existing
consistent descriptions stay byte-identical; conflicting color, incompatible
profile/level/constraints, contradictory crop geometry and unsupported or
malformed bounded syntax refuse before writing. A native decoder configuration
may describe fewer Main constraint flags or a higher defined level than its actual
SPS; the SPS must retain every declared flag and remains the format authority.
Main Level 1b is ordered between Levels 1 and 1.1 using constraint_set3, as
specified by [RFC 6184](https://www.rfc-editor.org/rfc/rfc6184#section-8.1).
This compatibility rule does not claim unequal codec labels are canonical or
byte-identical. An actual level above the declared configuration refuses.
Neither codec string nor
profile bytes are rewritten. This is a bounded metadata parser, not a full
PPS/VCL conformance validator or support for Baseline/High/scaling syntax.

The retained WebKit 2336 control emitted SPS/PPS in all six actual packets over
three seconds, including three requested IDR frames. Completing only the absent
signaling made its native NV12 decoder report BT.709 while preserving every active
plane byte, coded-picture/PPS byte, packet order and timestamp. Independent
FFmpeg 9.0.1 decoding confirmed all full active planes unchanged. Separately
constructed absent-VUI and additional in-band cases also passed; these are not
claims about native encoder emission. The original valid 811-byte MP4 and strict
native-metadata refusal remain retained. The pinned WebKit decoder ignores the
supplied color override; the bounded producer operation follows
[the primary H.264 metadata implementation](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavcodec/bsf/h264_metadata.c#L183).
This does not modify imported media or qualify valid-transfer behavior in the
separate raw-FFmpeg export route.

The engine companion adapter presents 4,096-frame stereo Float32 storage chunks
on the saved Motion project's native sample rate, including a short terminal
chunk and silent scenes. The engine retains ownership of trim, reverse,
resampling and pitch policy. The actual successor controller resolves this
source before encoded metadata and buffer acquisition, including short scenes.
Its deferred export strategy authenticates the owning project snapshot and
injects only its linked generated sources into the shared offline exporter.
Real Frame finishing tests cover random seek order, changed pixels, cleanup and
forged/stale authority refusal. Native delivery remains unqualified.

Reopened export resolves virtual timing tables from retained canonical owner
history without installing encoded proxy assets in the ordinary media cache.
Generated-only video plans require no encoded decoder. A silent reserved audio
companion does not request an audio encoder; actual authored linked or ordinary
audio keeps the normal codec admission and muxing path.

## Portable archive foundations

The exporter accepts fresh and edited family-v2 intent and preserves retained
v1 originals when present, then streams each unique linked digest once alongside
ordinary Frame assets. Virtual picture/PCM descriptors are regenerated from the
accepted revision; they never request encoded media bodies. Metadata, entry,
expanded-byte and Blob budgets are admitted before
linked body acquisition; a streaming destination observes backpressure. Every
linked body is independently hashed before the final manifest is written.

Import validates the typed snapshots and exact physical dependency inventory,
authenticates retained archive custody, then stages linked bodies. One
receiver transaction retains the owner project, its states and revisions, and
all linked bytes. Corrupt media, cancellation, publication failure and identity
conflicts leave no imported owner visible. Portable custody currently has a
default 512 MiB Blob admission limit. Ordinary-media candidates are retained
conservatively before publication; a failed owner transaction exposes no owner.
On reopen, missing ordinary-media cache entries are recovered from verified
portable custody before activation. Chromium qualifies publication failure,
retry, page closure, deliberate deletion of the separate ordinary-media cache,
reopen and re-export. Standard File Copy gives the imported document a fresh
owner identity while preserving its exact source archive. Replace requires the
physical project lease and an unchanged durable owner digest/write fence. Its
transaction preserves the previous portable archive before publishing the new
owner, link states and custody; original-v1 migration records stay unchanged.
Conflicting ordinary media receives deterministic local source identities and
all inherited source references are rebound through the maintained Frame
helpers. Reopen verifies that these bindings are the only changes to the
archived project before restoring media, including after complete cache loss.
Shared live validation limits aggregate linked
output to 2,000,000 frames before any timing-table allocation.

Focused Node and real Chromium IndexedDB fixtures qualify private staging,
cancellation, reopening, pending updates, Undo/Resume, Conform, portable import
rollback and atomic owner/history publication. Actual
CanvasKit tests qualify saved-revision rendering, arbitrary seeks and retained
image bytes after receiver reopen; PCM tests read retained WAV bytes after
reopen. The dedicated connected-editor gate serves the production-shaped sender,
receiver and bridge headers and exercises actual File-menu pairing. Interactive
native watcher evidence is recorded in
[desktop saved links](motionscaper-desktop-saved-links.md). Native generated-source
delivery and the remaining platform matrix remain incomplete release gates.

No **Update AI assets** run is required; the assistance runtime closure is unchanged.

The owned encoder callback also reverses the exact Firefox153 native avcC
serializer defect: zero reserved bits coupled with one duplicated NAL header on
each single SPS/PPS. Admission requires the recovered sets to equal the actual
owned key packet byte for byte before ordinary strict geometry/profile/color
validation. General and imported avcC parsing stays strict. A six-frame, three-
second native Firefox control retained identical complete BGRX output and all
non-SPS packet bytes/timing; independent pinned FFmpeg9.0.1 decoding retained
identical full active YUV planes. The original malformed description and decoder
warnings remain evidence. This bounded control does not replace final menu and
offline workflow qualification.

Cold-load offline handoff replays a bounded set of completed resources actually
observed in this document: versioned same-origin JavaScript, CSS, WASM and fonts.
It waits for the exact active own worker, serializes requests, and stops on known
resource-timing loss, limits, cancellation or failure. The lazy helper admits at
most 256 URLs, 4096 observations and 32 fonts within 30 seconds; it does not expand install
inventory or fetch unused optional modules. Its settled state describes requests,
not durable custody or a complete historical resource inventory. The offline
linked workflow separately verifies the observed assets, original fonts and
navigation bytes against the current build's shell cache and waits for restored
owner/editor readiness before the existing picture/link/error assertions.
