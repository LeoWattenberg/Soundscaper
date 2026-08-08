# Project compatibility contract

The versioned source of truth is
[`config/project-compatibility.json`](../config/project-compatibility.json).
Its statuses distinguish behavior enforced today from outcomes owned by later
roadmap milestones. A planned row is a release requirement, not permission to
discard state until that row is implemented.

## Core document versus `.scape`

The core project loader and the portable archive are separate compatibility
boundaries.

- A raw project object whose `schemaVersion` is newer than the maintained
  version is structured-cloned and returned read-only with reason
  `newer-schema`. It is not normalized through the current schema.
- That core behavior does not yet make an arbitrary future `.scape` archive
  lossless. The current archive importer walks known source and clip
  collections, may rewrite project/source identity on collisions, and restores
  media into current storage records. Future-archive read-only activation must
  avoid those mutations and preserve every unknown entry before it can be
  called compatible.
- A future `.scape` `formatVersion` is rejected before project persistence.
  Container-version support is never inferred from the inner project version.
- Current-format exact schema 9 `.scape` round trips promise JSON-semantic
  equality plus byte-exact preservation for the supported bounded tagged binary
  types described below. They do not promise byte-for-byte `project.json`
  equality, ZIP entry ordering, timestamps, or JSON formatting.

Read-only means that commands, autosave, overwrite, and migration publication
must remain disabled. A future document may be inspected or exported unchanged
only through a path proven not to normalize it. “Save a copy” may not silently
turn an unknown schema into the current schema.

One narrow linked-PCM portable-archive exception applies only to the
current-format exact schema 9 path. Under the 512 MiB linked-original ceiling,
a sender may be backed by a maintained RIFF/RF64 PCM or IEEE-float WAV, a
first-party BW64 integer-PCM `.wav`, or classic FORM/AIFF signed big-endian
integer PCM at 8, 16, 24, or 32 bits, or canonical first-party FORM/AIFC v1
`fl32` 32-bit floating point admitted only as exact `.aif` or `.aiff` plus
`audio/aiff`. It retains no owned PCM. Export reads its verified canonical
chunks and writes only a canonical `audio-f32le-chunks-v1` asset. External
container bytes and pathless locator identity are absent from the archive.
A maintained Electron chooser and initial bind still materialize one whole
source snapshot. After that binding commits, archive source reads acquire an
owner-scoped exact-revision range capability, hash the complete source in exact
at-most-4-MiB reads, recheck the binding, and decode through a range-backed
RIFF/RF64/BW64, classic AIFF, or canonical first-party AIFF-C source without
constructing another whole-original `Blob`. Classic AIFF admission and every
later read require bounded FORM/AIFF, COMM, and SSND structure. The AIFF-C
profile requires one four-byte FVER v1 (`0xA2805140`) before an exact 44-byte
COMM carrying 32-bit `fl32` and the exact Pascal compression name `32-bit
floating point`, plus structurally consistent SSND geometry. The first-party
label describes the maintained fixture, not authenticated provenance:
admission is producer-neutral and accepts any producer emitting that exact
tuple. Broader, compressed, and other AIFF-C profiles reject; broader
third-party interoperability and producer provenance are unqualified. A generic
platform port without the optional range operation retains the whole-`Blob`
source-reader fallback.
A fresh recipient without a linked-original port imports that asset through the
ordinary owned PCM writer,
then can close and reopen, recovering exact samples and project state with zero
linked bindings. The direct fixtures use first-party BW64 integer PCM, classic
AIFF, and canonical first-party AIFF-C float32; focused reader and import
coverage owns the maintained RIFF/RF64 PCM and IEEE-float, first-party BW64
integer-PCM, classic AIFF integer-PCM, and canonical first-party AIFF-C float32
input boundary.

This portable exception does not qualify future-schema archive preservation,
byte-exact external-container preservation or reconstruction, AIFF metadata
preservation, broader or compressed AIFC, third-party AIFC interoperability and
provenance, the `.aifc` extension, packaged executable or UI and operating-system
behavior, reference-scale evidence, relink or watch, other
audio formats, arbitrary third-party BW64, new BW64 ADM preservation or editing
semantics, a durable immutable byte lease, or range support outside maintained
post-bind Electron linked-PCM source reads.
Canonical PCM portability is the contract; the selected external container is
neither transferred nor reconstructed.

## Retained migrations

Schema 9 is the current writable schema. Inputs from schemas 1 through 8 are
validated and migrated atomically to schema 9. Migration functions must be
pure: the input fixture is retained unchanged, and failure publishes neither a
partial project nor partial history.

Every new schema version must add fixtures for its immediate predecessor and
the oldest retained schema. Project state, history, clipboard state, `.scape`,
and both product profiles must agree on the same migration boundary.

Those existing V1–V8 raw-project migrations remain maintained. Compatibility
beyond those retained raw-document migration paths—especially migration from
the prior shared `v1` scope or product-private Soundscaper libraries—is not a
current priority or a milestone prerequisite. Audacity project interchange
remains a separate compatibility boundary.

## Shared desktop current-schema persistence

The desktop editor has one implemented current-schema shared persistence
envelope. A fresh filesystem library scope `v2`
(`kw.media/scape-project-library/v2`) ignores rather than migrates the prior
shared `v1` scope. At the `v2` path, SQLite database schema 3 rejects schemas 1
and 2 instead of implicitly migrating, adopting, or backfilling them. Metadata
schema 2 binds a separate opaque library entry ID to the project identity,
exact schema 9, project revision,
byte length, SHA-256 digest, and a derived immutable revision-and-digest path.
No filesystem path, catalog entry ID, project-document digest, product
preference, timestamp source, or lease capability is exposed to a renderer.

Before publication, the main process canonicalizes the document with the
bounded tagged-binary Scape codec and applies the non-raiseable 256 MiB document
ceiling. The low-level store validates the persistence root schema, identity,
title, and revision. The main-owned identity service applies the shared strict
exact-V9 maintained-persistence-domain validator to the decoded document before
permitting host staging or catalog publication of a renderer commit. The same
service validates the loaded commit result and a stored project again before
returning either canonical document. Every serialized project first receives a
raw-JSON structural preflight capped at 101,536 JSON values and depth 130 before
`JSON.parse`; each exact-V9 decoded codec traversal and maintained-domain
validation phase is independently capped at 100,000 nodes and depth 128. The
service threads these lower-only caps through renderer input, loaded commit
results, stored reads, and response serialization. Renderer input refusal
precedes host mutation or staging. An over-budget loaded commit result is
refused before the renderer response, although host publication may already
have completed. Future-schema tag-shaped data is structurally counted but is
neither decoded nor interpreted. Canonical JSON-derived graphs and ordinary
direct objects reject accessors, `toJSON` hooks, method-shadowed arrays, hidden
or symbol data, cycles, exotic containers, and non-JSON scalars without
invoking application accessors; hostile proxies and prototype-polluted or
exotic injected graphs remain outside that code-safety claim. Counters reset
between the lexical, codec, validator, and serialization phases, so these
per-phase shape ceilings are not an aggregate work, CPU or elapsed-time,
allocation-amplification, cancellation, or resident-memory budget. The
validator strictly checks core project, document, media, and graph structures
without loading legacy migrations or executable effect and worker runtimes. All
audio effects must be cloneable and carry the generic effect identity, enabled,
and parameter structure.
Type-specific semantic checks currently cover missing-effect compatibility
metadata and parametric EQ; other first- and third-party effect payload semantics
are intentionally not gated yet. The store reserves each canonical path and a
unique random attempt in lease- and fencing-token-bound authoritative project
and stage inventories in one transaction before it exclusively creates the
private stage file. When exact-lease cleanup is acknowledged, an exclusive-open
failure retires only the registration without unlinking the path, while an error
after exclusive creation targets that registered random stage for removal.
Lost-lease or failed cleanup leaves the registration for takeover. Successful
materialization requires the exact metadata and stage paths, lease ID, and
fencing token, then performs an atomic rename, syncs
the project directory where the platform supports it, marks the canonical row
materialized, removes the stage row, and verifies the resulting immutable file
against its byte-length, digest, schema, identity, and revision descriptor.
Every catalog reference must have a materialized inventory row. Only then does it
publish an exact +1 catalog revision through the existing fenced journal, so a
reader observes the old or new complete project-and-catalog pair.
The main-only host serializes commits and renews its lease while it drains
admitted work during close.

After journal recovery and before the host is exposed, main-only startup
maintenance walks the authoritative project and stage inventories by monotonic
row IDs. It captures independent cycle high-waters, persists both cursors and an
alternating schedule, and scans at most 100,000 total rows per invocation in
at-most-64-row batches. It reports canonical, stage, live-stage, protected, and
reclaimed counts plus whether both bounded cycles completed. Every destructive
batch holds an immediate SQLite writer transaction and revalidates the exact
live lease before and after filesystem work. A current exact-lease stage remains
live. A stale registered regular stage is removed, a missing attempt retires,
and a non-regular target or non-direct parent remains untouched and inventoried.
Canonical rows owned by the current lease or referenced by any outstanding
stage remain ineligible. When stage retirement could unblock a canonical row
already passed by its cursor, a persisted rescan flag atomically restarts the
canonical high-water cycle before completion is reported.

Canonical batches rebuild portable case-folded reachability from the
integrity-checked current catalog plus both previous and next snapshots of any
pending prepared or committed journal. Only registered canonical unreachable
regular immutable project files and their deterministic noncatalogable
quarantine paths are eligible. Unregistered stage-looking, canonical, forged
quarantine, and foreign files do not consume inventory budget and remain
untouched. A real 100,001-row fixture proves successive bounded passes reach the
suffix; later inserts above a captured high-water wait for the next cycle. The
collector renames an eligible canonical file to its deterministic quarantine
before unlinking it, so a crash is retryable and a higher fencing token can
safely reuse the canonical path. It yields between batches for lease renewal and
cancellation. A static symlinked project root and corrupt catalog or journal
metadata fail closed; malformed names, non-regular or symlinked entries, and
managed media remain untouched. Collector state is visible in the host snapshot.
A tested reclamation failure during startup stops renewal and releases its
still-owned lease; any cleanup failure is reported.

The main identity service and owner-scoped IPC expose only bounded project
summaries, canonical documents and bundles, project identities, delete results,
and managed-source descriptors and chunks for canonical PCM and retained
original video. The main process strips catalog
implementation fields; navigation, renderer loss, and window close fence new
work for that renderer owner, abort its managed-source upload sessions, and
drain operations admitted before revocation. Main and preload repeat the
non-raiseable 256 MiB UTF-8 document, 4 KiB project-ID, 10,000-summary, 64 GiB
managed-source, and 4 MiB chunk ceilings; main additionally admits at most four
active managed-source upload sessions and four active managed-source reads
across the bridge service. Upload capacity remains charged until publication or
abort settles, and service disposal waits for finishing publications. Neither
layer exposes a path or fencing value.

The renderer repository repeats the same maintained-persistence-domain exact-V9
validation as defense in depth and canonically reserializes the document before
local mutation. The shared catalog is authoritative for latest loads and
summary lists, while
product-local IndexedDB retains revision history, source records, and media
bytes. A remote commit failure therefore leaves a retryable local shadow;
identical same-revision retry is a catalog no-op. A shared delete commits
remotely first and reports, rather than reverses, failed local cleanup. A
detected desktop with an incomplete shared-project bridge fails closed instead
of falling back to its former product-private project catalog. Ordinary project
saves publish only the canonical document; they do not copy source bytes into
the shared library.

An explicit managed-handoff path covers canonical PCM and retained original
video. After flushing the current exact-schema-9 project, the
sender enumerates at most 4,094 logical sources, deduplicates compatible
same-kind physical bindings, rejects conflicting geometry, and preflights one
aggregate 64 GiB expanded-byte budget across canonical audio archive bytes and
original-video bodies plus the 65,536-PCM-chunk ceiling before the first
source-body read or bridge body transfer. Canonical PCM receives two full
digesting source reads. Retained original video requires trusted exact-size
SHA-256 metadata and receives two full body-digest passes through 4 MiB windows
with metadata revalidation. When either binding is absent, the second audio or
video pass also streams at-most-4-MiB chunks through the pathless bridge.

Main admits at most four active uploads across that service through publication
or abort settlement. It validates the requested reachable source kind, identity,
and geometry against the exact current project revision, derives the catalog
document SHA-256 itself rather than accepting it from the renderer, and derives
the immutable media binding from the encoding, project identity, revision,
document digest, and storage-key/media geometry. The host repeats the exact
revision-and-document-digest check inside serialized publication, so a
prior-revision row or same-revision document variant is neither advertised by
the current bundle nor accepted as already present. Exact-present reuse also
requires the declared byte length and SHA-256 and reverifies the body. A new
upload must retain the same digest on both sender passes. After point-in-time
capacity admission, and before directory or stage creation, hard-link work, or
body consumption, main commits an authoritative canonical row and exact random
stage attempt. The canonical row binds the descriptor and its
encoding, project identity, exact revision, document digest, and storage key;
both rows carry the live lease ID and fencing token. Promotion accepts only that
registered regular stage, atomically renames it to its canonical path, syncs the
directory where supported, advances the row to materialized, and removes the
stage row under persisted before-and-after lease checks. Catalog preparation
requires every recognized managed descriptor to have an exact materialized or
published row, and catalog commit marks those rows published in the same SQLite
transaction as metadata publication. Stale revisions, immutable binding
conflicts, changed source bytes, malformed ranges, symlinked storage boundaries,
and incomplete bodies fail closed.

When the exact current binding is absent, main, not the renderer, may select a
canonical same-kind catalog donor with the same byte length and SHA-256. Main
fully verifies each donor, creates a random same-directory hard-link stage,
verifies the linked body, promotes it without overwriting a winning target,
syncs cleanup and directory state, and only then publishes a distinct
revision-bound descriptor. Unsupported linking, a missing or corrupt donor, or
an exhausted link count uses the normal bounded upload fallback; operational or
access failures fail closed. The renderer supplies neither a path nor a donor
selector. If catalog publication fails after an uploaded or linked immutable
body lands, an exact retry reverifies the inventoried body and publishes without
consuming another offered stream.

Each absent managed audio or video binding synchronously reserves its
prospective catalog row and metadata bytes together with other in-flight
reservations. It enforces the 50,000-row catalog ceiling, the 4 MiB metadata
ceiling, and a lower-only 64 GiB aggregate declared body bytes ceiling before
the first filesystem query, hard-link attempt, directory or stage creation, or
body consumption. A BigInt `statfs` query against the managed-media destination
then compares its available blocks with the aggregate in-flight declared bytes.
The reservation is held until descriptor publication settles and released
idempotently on every success, failure, or cancellation path. Publication
revalidates the prospective row and metadata against the current catalog. An
exact-present retry bypasses a new reservation and `statfs`, consumes no offered
body, and still reverifies the existing body.

This is point-in-time in-process admission, not an operating-system reservation
or an exact allocation or write-time capacity guarantee. It does not account
for allocation-unit rounding, SQLite or WAL overhead, external writers, or
other store instances or processes. Every binding is admitted independently;
the whole handoff is not reserved atomically. Charging declared bytes before
hard-link reuse is conservative and does not establish a portable capacity
claim for hard links.

After metadata-journal recovery and project-document reclamation, and before
host exposure, a separate managed-media collector first performs logical
retirement. For recognized inventoried descriptors, it removes catalog rows
whose exact project ID, revision, and document digest are no longer current;
unmanaged or opaque descriptors remain untouched. Retirement uses the normal
fenced metadata journal and must settle it before physical work. A recognized
descriptor that remains current but lacks an exact materialized or published
inventory row fails startup before managed-media filesystem mutation.

Physical managed-media reclamation uses independent persisted canonical and
stage high-waters plus an alternating schedule. It scans at most 100,000 total
inventory rows per startup in at-most-64-row transactions, rechecking the
unexpired lease before and after filesystem work and yielding between nonempty
batches. Stale registered regular upload and hard-link stages are removed;
missing stages retire their registration; non-regular targets and non-direct
parents remain untouched and inventoried. Stage cleanup requests a canonical
rescan so a newly unblocked row cannot be skipped. Catalog retirement restarts
the canonical cycle so a row already behind its cursor becomes eligible in the
same invocation. Current catalog descriptors are protected exactly. Eligible
registered canonical bodies are moved through deterministic noncatalogable
quarantine names before unlink, so crash-left promotion, quarantine, missing,
and hard-link-name states are retryable without deleting another live link.
Unregistered and legacy lookalikes, symlinks, foreign files, and unmanaged
catalog rows are neither adopted nor removed. Counts, logical retirements, and
bounded completion are exposed in the host snapshot, and startup failure
releases the still-owned lease.

This is startup-only cooperative-writer reclamation, not continuous runtime
cleanup or a hostile-filesystem sweep. More than 100,000 tracked rows require a
later startup pass. Empty directories, SQLite/WAL space, unregistered legacy
files, external-writer races, platform-specific power-loss behavior, and
write-time capacity remain unqualified. Structural inventory validation is
performed for exact references and bounded batches; it is deliberately not an
unbounded eager scan of arbitrary third-party database corruption.

Before local shadow save or activation, a latest exact-schema-9 source-bearing
shared load performs bounded sequential recipient-local admission. It collects
at most 4,094 unique logical sources reachable from timeline clips, Project Bin
clips, and rendered-fallback references. It deduplicates compatible same-kind
physical bindings and rejects conflicting geometry. One aggregate 64 GiB budget
charges canonical audio archive bytes and recipient-local or managed
original-video bodies, while a 65,536-PCM-chunk ceiling charges audio. Admission
completes those budgets before any body read, shared body transfer, or recipient
write. A fresh recipient may then acquire matching managed canonical-PCM and
original-video descriptors through bounded 4 MiB reads, with at most four
main-process reads active, into a staged product-local audio source or an owned
video-media writer. Each transfer must match descriptor identity, kind and
storage key, exact byte length, SHA-256, and canonical audio byte geometry
before atomic if-absent publication. Retained original video stays opaque and
is not decoded or probed for media geometry at this boundary. A writer that
loses that absence race deletes only its own staging and preserves the winner.
Partial acquisition, later admission failure, and conflicting recipient-local
bindings roll back in reverse order only the exact acquisition-owned audio
record or video publication and its source token, path, or media-chunk payload;
a concurrent replacement is preserved. Each source not acquired this
way still requires the pre-existing latest
recipient-local exact-schema-9 snapshot of the same project to bind its logical
ID, kind, physical storage key, MIME type, frame/sample geometry, and
kind-specific descriptor; names and opaque extensions are not provenance.
Compatible same-kind aliases of one physical key are read once, while
conflicting bindings reject and audio/video storage domains remain separate.
Declared payload geometry is capped at 65,536 PCM chunks, while one cumulative
64 GiB budget charges canonical audio archive bytes—including four framing
bytes per chunk—and recipient-local video metadata sizes together.

For maintained demand-loaded playback, an owned canonical-PCM provider passes
the source metadata already admitted for that provider into lazy session
opening. The store captures at most 4,094 cycle-free records from the requested
root through its linear root-to-base copy-on-write ancestry, retains the
observed metadata records, reads only their captured source token or path, and
serializes chunk requests. Before and after each chunk it checks every observed
generation by the stored identity tuple of source ID, storage kind, source
token or path, base-source ID, and PCM encoding version. Root or ancestry drift
is terminal for the session; per-request cancellation remains local,
on-access migration is suppressed, and store cleanup releases owned and
fallback sessions while aggregating failures.

This is a fence over the provider's expected root and the ancestry generations
observed at open. A copy-on-write record persists only its base source ID, not
the generation intended when the derived record was published, so a base
already replaced before opening can become the observed ancestry. The identity
tuple is not complete metadata equality, a content digest, storage retention or
a byte lease. Deletion or same-token/path byte mutation can still fail or evade
that metadata fence, and separate repository instances and processes are not
serialized into one byte snapshot.

One narrow linked-PCM managed-handoff exception is qualified here. Through an
explicitly injected Electron port, one point-in-time maintained PCM container no
larger than 512 MiB may remain in a main-private registry: RIFF/RF64 PCM or
IEEE-float WAV, first-party BW64 integer-PCM `.wav`, or classic FORM/AIFF signed
big-endian integer PCM at 8, 16, 24, or 32 bits, or canonical first-party
FORM/AIFC v1 `fl32` 32-bit floating point admitted only as exact `.aif` or
`.aiff` plus `audio/aiff`. Only that registry contains the absolute path and its
device, inode, size, modification time, and change time; the project and
renderer-side binding retain pathless locator and revision tokens plus scalar
canonical source geometry. The chooser and initial bind still materialize and
hash one whole source snapshot. After that binding commits, maintained Electron
canonical PCM reads instead acquire an owner-scoped `linked-audio-range-v1`
capability at the exact locator revision. Before container inspection or PCM
decoding, the renderer requires the exact byte length and MIME type, hashes the
complete opened handle sequentially through exact at-most-4-MiB `206` reads,
and rechecks the exact binding. The container inspector and chunk decoder then
use a range-backed source, so the session constructs no second whole-original
`Blob`, and release of the capability is owned by that read session. Classic
AIFF admission and every later read require bounded FORM/AIFF, COMM, and SSND
structure. The AIFF-C profile requires one four-byte FVER v1 (`0xA2805140`)
before an exact 44-byte COMM carrying 32-bit `fl32` and the exact Pascal
compression name `32-bit floating point`, plus structurally consistent SSND
geometry. The first-party label describes the maintained fixture, not
authenticated provenance: admission is producer-neutral and accepts any
producer emitting that exact tuple. Broader, compressed, and other AIFF-C
profiles reject; broader third-party interoperability and producer provenance
are unqualified. An available range operation that
reports unavailable, malformed, drifted, or corrupt data fails closed; a
generic platform port that does not implement the optional range operation
retains the prior whole-`Blob` source-reader fallback.
For maintained playback, one provider lazily owns one provider-owned stable PCM
read session. It reuses one full-container digest and one parsed descriptor across serialized random
or sequential chunk reads, and rechecks the complete alias group and exact
binding before and after every chunk. Per-read engine or stream cancellation is
local; drift, corruption, and provider retirement are terminal. Provider
replacement, failed activation, project switch, project or source deletion and
clear, rollback, and controller or store disposal retire the provider, await
exact-once release, and fence backing cleanup; bulk cleanup failures aggregate
with the primary failure.
The sender's owned PCM inventory remains empty.

Only explicit `prepareHandoff` performs the normal two canonical Float32 PCM
source-API passes and publishes their chunks through the maintained managed
`audio-f32le-chunks-v1` path. On Electron, both post-bind passes use the ranged
source lifecycle above; the handoff does not collapse them into one pass. A
fresh recipient acquires those chunks through its ordinary owned source writer
and can close and reopen the canonical PCM without the linked-original port or
locator. External container bytes and locator identity do not cross the
managed-media bridge or enter the shared catalog or recipient.

A binding-backed exact-content Project Bin linked-PCM relink resolves the
compound item to exactly one audio source with a current audio binding; it does
not use missing-source state as eligibility. The component fences its
asynchronous decision to the exact project revision and menu request. Its UI
handoff carries only the pathless selected `File`, opaque locator ID and
revision, and exact `{projectId, projectRevision}` target. A stale chooser scope
is released before dispatch. The service validates that target before starting
the shared audio/video relink task and releases a mismatch without cancelling
current work, then rechecks the target in storage publication admission. The
controller stops timeline transport and Project Bin preview, retires the
current source provider, and awaits its drain before storage. Storage proves
the old binding and platform snapshot are current, requires the selected bytes
to have the same byte length and SHA-256, and reloads the candidate at its exact
revision. One synchronous `assertCanPublish` runs inside the same compensated
memory batch or IndexedDB binding-and-provisional-root transaction and rechecks
the shared task, exact target, project generation, and writable editor state.
Project, source, clip, and history identity remain unchanged. After publication,
the controller invalidates stale source buffers, peaks, waveform state, and
analysis, then reactivates the replacement before publishing availability.

Recovery state is guarded by current audio-operation ownership plus the active
project and controller lifetime, rather than shared-task currentness. A
prepublication failure preserves the old binding, and recovery rechecks
operation ownership after metadata before activation of the old runtime. It
drains cleanup of only a distinct unused candidate. Shared video relink or
project-lock cancellation before publication can therefore restore the old
runtime while that audio operation still owns the active project. After
publication the new binding remains: when activation is incomplete the same
ownership guard retires and invalidates any partial runtime and records missing
state, while a completed owned activation publishes availability even if the
shared task was cancelled. A newer audio relink, project replacement, or
controller disposal prevents stale recovery. The displaced old locator waits
for bounded alias-aware startup reconciliation.

This exception does not qualify packaged executable or UI behavior,
operating-system file-dialog or path durability, changed-content or other-media
relink, automatic watch or discovery,
broader audio formats, arbitrary third-party BW64, new BW64 ADM preservation or
editing semantics, AIFF metadata preservation, broader or compressed AIFC,
third-party AIFC interoperability and provenance, the `.aifc` extension,
reference-scale evidence, or range support outside maintained post-bind
Electron linked-PCM source reads. The external path and stat tuple are a
point-in-time main-private identity. Moving or replacing the pathname after
range admission does not retarget the opened handle, but same-inode in-place
mutation during or after sequential digest verification is not fenced. The
capability is therefore not an operating-system bookmark, content-frozen or
durable immutable byte lease, restart-stable identity, or cross-process snapshot.

A deliberately narrow linked retained-video path is qualified at this same
boundary. A local binding joins the exact project ID, logical video source ID,
physical storage key, MIME type, byte length, SHA-256, and maintained
frame/sample/video geometry to an opaque locator ID and opaque locator
revision. Neither locator value appears in the project document. IndexedDB
database version 8 and the memory backend retain a closed scalar-only binding
record, including scalar source-shape fields, a compare-and-swap token, and a
canonical timestamp; they retain no linked body, `Blob`, filesystem path, URL,
platform handle, or persisted playback lease.

The maintained Electron source now supplies that platform port. Its native
chooser accepts exactly one non-empty regular video no larger than 512 MiB and
registers it in a product-local schema-1 file under main-owned `userData`. That
private atomically replaced registry admits at most 128 locator records and
64 GiB of declared files. Only it contains the raw absolute path plus the
selected file's device, inode, size, modification time, and change time. The
sandboxed renderer receives only random pathless 64-hex locator and revision
tokens with bounded display metadata. An ordinary body load rechecks the
persisted stat identity around a fresh owner-scoped `materialized-v1` descriptor,
so a moved, deleted, replaced, or changed pathname fails closed at that
point-in-time boundary. Binding and import, document-only shared-load
resolution, and explicit handoff still materialize a complete `Blob` through
the 512 MiB tier. Their later 4 MiB digest windows do not bound provider
allocation, decoder memory, or process RSS.

Maintained Electron visual activation takes a separate route when there is no
owned video asset. It requests the exact locator revision and main grants an
owner-scoped `linked-video-range-v1` pathless capability backed by an opened
handle matching the persisted device, inode, size, modification time, and
change time. Admission permits at most 128 such
capabilities and 64 GiB of aggregate declared bytes, with a 512 MiB per-file
ceiling, at most 16 active range requests, and at most 4 MiB in one response.
The renderer verifies exact response status, range, length, and MIME while
performing a full sequential SHA-256 in at-most-4-MiB ranges, then rechecks the
binding before exposing the pathless media URL. The visual service owns that
playback lease together with any poster and thumbnail object URLs and awaits
release on replacement, cancellation, supersession, project switch, project
deletion, project clear, source replacement, import rollback, media-element
failure, and controller disposal. Release is owner-scoped and fences later
range requests; admitted cancellation drains the current file read before its
request slot is reused.

A pathname move or replacement after admission does not retarget the open
handle, so the live lease continues to read the admitted inode. Same-inode
in-place mutation during or after verification is not fenced, however, and the
lease is not content-frozen. The persisted locator therefore remains a
point-in-time identity rather than an operating-system bookmark, automatic
watch or moved-path-repair handle, or cross-restart playback identity. This is
bounded range transport for the maintained live visual only, not
reference-scale qualification. The whole-`Blob` import, shared-load, and
handoff routes remain unchanged; packaged executable/UI, operating-system, and
browser codec behavior remain unqualified.

The capability-gated Project Bin action passes that one pathless choice into the
maintained video importer. The importer may derive canonical audio and
disposable poster/thumbnail cache entries, but it skips the owned retained-video
asset write. It constructs the exact video source, hashes and publishes its
linked binding before visual activation and canonical project publication.
Failures before the canonical source lands retire the unused locator by its
exact ID and revision, conditionally unlink only the import's exact binding, and
roll back import-owned audio and previews. Once the canonical source has landed,
a later publication or reporting failure retains its binding, locator, audio,
and previews rather than attempting destructive rollback. Persistent-locator
release is a closed own-data `{ locatorId, locatorRevision }` request at both
preload and main; identifier-only, missing, malformed, accessor-backed, and
extra-field inputs reject. Main applies owner-scoped exact-revision
compare-and-swap retirement. A stale or missing pair and an already-revoked
owner return `false` without a registry write. A failed persistence write
restores the in-memory entry, while revocation observed after the deletion write
attempts a second persisted restore. A successful release removes only the
main-private registry metadata; no release path deletes the user-selected
external file.

The localized Project Bin Relink action is available for a missing
retained-video item when the linked-video capability exists. The controller
then requires a current binding, a compound A/V item that resolves to exactly
one video source, and editing that remains writable. It snapshots the old
binding token, stops Project Bin preview, revokes the current visual, and
revalidates project, task, missing-source, and editing state. The UI passes only
the selected `File` and pathless locator ID and revision. Storage first requires
that file to match the existing byte length and SHA-256, then requires the
exact-revision platform snapshot to match the selection before a same-source
compare-and-swap publishes the replacement binding and provisional root.
The synchronous controller guard runs inside that same memory or IndexedDB
binding-and-provisional-root CAS immediately before publication and rechecks
task, project, writable, and missing-source state. The project document,
source, and history remain unchanged. Verified visual activation then clears
the missing state and publishes the view.

A wrong-content, stale, superseded, cancelled, or disposed attempt before
publication keeps the old binding current and releases only a distinct unused
candidate. If activation fails after publication, the new binding and missing
state remain for retry. The displaced prior locator is deliberately not
released immediately; it remains eligible for later bounded startup
reconciliation. That pass preserves submitted same-store aliases; cross-store,
cross-profile, and cross-process coordination remains unqualified.

After durable IndexedDB opens and before project loading, the
maintained store obtains one point-in-time authoritative project-summary
snapshot from its active project repository. In Electron that authority is the
shared catalog rather than a stale product-local shadow. For a
reconciliation-capable port, the repository projects every summary to closed
own-data `{ id, revision }`, validates the exact project identity and
non-negative safe-integer revision, rejects duplicates, and enforces the 10,000
summary maximum before opening a binding transaction. Memory fallback returns
before requesting the catalog, mutating a binding, or invoking main-process
reconciliation. A durable load-only injected port may request the catalog
snapshot but performs no binding mutation or reconciliation IPC.

One readwrite transaction over local current projects, retained revisions, and
linked-original bindings then walks at most 100,000 closed binding rows,
validates every authoritative binding key, identity, and storage alias. The
generic mixed-kind pass admits at most 128 unique exact locator/revision pairs
across the full inventory. The legacy video-only fallback still validates all
rows and storage aliases, but applies reference cardinality and deletion only to
video while preserving audio rows. A malformed row, conflicting revision or
storage alias, exceeded applicable bound, or deletion failure rejects
reconciliation and rolls the transaction back before IPC, including when every
offending managed row belongs to a project absent from the catalog.

Every binding whose project is absent from the catalog is unreachable. For a
catalog-live project, source-level pruning runs only when the product-local
current document is exact schema 9 at the catalog revision and at most 64 exact
retained revisions include that current revision. The pass conservatively
unions kindful timeline, Project Bin, and every feature-fallback source across
the current and retained graphs without publisher gating. Missing, older,
newer, malformed, incomplete, or over-bound local graph state retains all
bindings for that catalog-live project. More than 100,000 aggregate roots across
otherwise verifiable projects suppresses all source-level pruning while leaving
catalog-absent deletion eligible. Only after the complete scan does the same
transaction apply its binding deletions. Any surviving same-store alias keeps
the shared locator live.

The maintained bootstrap submits the surviving exact references over the
closed preload/IPC boundary. Main's serialized pass removes only startup-loaded
metadata absent from that positive inventory and retains runtime-created
records. It can retry after failure and completes at most once per
store/process. A failed first registry write restores the in-memory inventory;
owner revocation after publication attempts a second persisted restore and
surfaces either failure. The pass rewrites locator metadata only and never
stats or deletes the external files. On the next successful full bootstrap it
retires startup-loaded chooser metadata with no durable binding and metadata
whose binding rows were durably removed as project-absent or source-unreachable
under the exact catalog-revision fence.

Within one live `AudioEditorProjectStore` instance in one renderer process, a
separate coordinator serializes binding publication, exact unlink, unused
locator release, startup reconciliation, project deletion, and whole-store
clear. Each complete before/after binding inventory admits at most 100,000
closed rows and 128 unique exact locator/revision pairs; its pending cleanup set
is also capped at 128. After a project deletion or clear has committed its local
project and binding removal, the coordinator rescans the same store and releases
only a candidate with no surviving same-store alias. Clear's local-commit signal
is published after the memory or IndexedDB binding store is cleared and before
fallible OPFS cleanup. A failure before that signal preserves the bindings and
does not admit their locators for retirement; a later physical-cleanup failure
does not undo the committed local deletion.

Thrown platform-release failures are reported as committed cleanup errors and
retain the exact reference for a later serialized retry. Every retry first
rescans current same-store aliases, so a rebound alias suppresses retirement.
Either fulfilled `true` or `false` settles the pending exact reference because
`false` cannot retire a stale, missing, or revoked replacement. Reporting or
release failure never rolls back the local commit, and locator cleanup still
never stats, writes, or deletes the external video file.

An opt-in maintained controller save or a terminal successful writable
activation makes kindful source-level cleanup a separate part of that same
live-store lifecycle. Maintained queued autosaves, flushes, inactive-tab saves,
and project-switch or analysis explicit saves capture the complete live-session
roots when the queued write executes, after any earlier queued save has settled
rather than when an autosave timer is scheduled. Activation maintenance runs
only after engine and session activation, state publication, and source garbage
collection have succeeded. It is limited to a durable IndexedDB-backed store
and skips a read-only or failed activation, an activation using `options.save`,
and a memory or degraded store.

The activation pass enters the linked-original lifecycle and
latest-project-mutation locks in that order. Inside both serialized scopes it
revalidates the controller lifetime and activation admission, the active project
and write-lock identity, and both the controller and original lock's writable
state. If ownership has changed, it returns no roots and suppresses destructive
maintenance. Otherwise it collects the current live-session roots inside that
serialized ownership window rather than using a pre-lock snapshot. For either
route, the resulting frozen, deduplicated kindful references derive exactly
from every open tab's present, Undo, and Redo clip and fallback references, the
session clipboard's media kind, an audio recording in progress, and audio clip
time/pitch render-cache protection. The same textual source ID in audio and
video remains distinct, and a wrong-kind root does not retain a binding.
`protectedLinkedVideoSourceIds` remains a compatibility facade for direct
callers. Direct store callers that omit authoritative kindful roots still save
normally but perform no destructive source-level cleanup: no project binding is
pruned on that save.

After an opted-in save has published the current project and compacted its
retained revision set, or during serialized maintenance after a successful
activation, the reachability repository validates the current exact-schema-9
project plus every retained exact-schema-9 revision. Each revision must have its
canonical key, project identity, and revision identity, and the set must contain
an exact revision matching the current project. Current and retained graphs are
conservatively unioned even if two validated documents at the same revision
diverge. Durable audio and video roots include timeline clips, Project Bin
clips, and every feature-requirement fallback, without first-party or
third-party provenance gating. Caller-supplied live roots and transient import
roots are retention roots for this pass but do not become durable project roots.

The pass admits at most 64 retained revisions, 100,000 aggregate durable,
caller, provisional, and exact-owner source roots, 100,000 complete binding
rows, 100,000 complete provisional-root rows, and 128 unique exact
locator/revision references. A malformed, older-schema,
future-schema, identity-mismatched, missing-current-revision, or over-bound current or
retained revision state suppresses cleanup before any binding deletion. The
public save option instead rejects malformed, duplicate, noncanonical, or more
than 100,000 caller roots before project publication. Once binding inventory
begins, every row must be closed and authoritative; malformed or conflicting
rows and row or exact-reference overflow fail the maintenance pass without a
partial deletion.

For memory storage, save-triggered unreachable target-project bindings and
their roots are removed as one compensated mutation batch;
activation-triggered maintenance is a no-op there and in degraded storage. For
IndexedDB, current project, retained revisions, complete binding and root
validation, and pair removals share one readwrite transaction. This atomic
binding prune runs only after the
project/revision save and retained-revision compaction have committed or after
the terminal activation has reached its post-garbage-collection maintenance
point. On Desktop, a save-triggered pass runs only after the shared bridge
returns an exact canonical remote acknowledgement. A successful activation
does not publish another remote document; its maintenance instead finishes
under the same latest-project-mutation lock, so a following latest load, save,
delete, or activation cannot interleave with the prune. A rejected or inexact
remote publication never starts save maintenance. Project publication and this
later prune are nevertheless separate commits.

Every maintained new or replacement binding and copied alias also publishes a
closed scalar provisional root containing only its schema version, binding key,
project, kind, source, and binding token. It contains no locator, path, or body.
The binding and root use the same compensated memory mutation or IndexedDB
readwrite transaction; exact unlink and determinate rollback delete the pair.
The complete root inventory is validated under its 100,000-row ceiling before
mutation. This closes the same-database bind-before-canonical-import window
against independent cleanup.

A rooted binding remains protected until an exact durable current or retained
graph or its exact owner token consumes the root. A caller wildcard live root
retains the binding for one pass but does not consume the root. A stale owner
settles its prior in-memory reference without consuming a replacement root or
protecting an unrooted replacement. Suppressed and failed maintenance consume
no root. Startup has no owner token: a catalog-live rooted binding remains when
the local graph says it is unreachable or unverifiable, exact durable graph
membership consumes the root, and catalog absence deletes the binding/root
pair. Project deletion validates the complete root inventory before pair
deletion, and whole-store clear removes all roots. Roots have no time expiry, so
interruption safely leaves a bounded metadata leak. The version-8 upgrade does
not backfill existing pre-root binding rows.

An unreachable binding deletion returns only sorted, deduplicated exact locator
references. Before exact release, the coordinator re-inventories all current
same-store bindings; any surviving project/source alias suppresses retirement.
A project-binding prune failure is reported as committed cleanup while the
project save or activation remains successful, safely leaves the binding and
locator live, and lets a later opted-in save or writable activation retry the
prune. Locator-release failure retains the exact ID/revision pair for the
existing serialized retry path. A previously failed pending exact release that
rejects again is attempted once before an activation prune and excluded from
that activation's later release batch, so it does not starve unrelated
activation pruning or retry twice during one activation. Reachability inventory
and release perform no external-file
stat, write, deletion, or body load; a successful exact release changes only
main-private locator registry metadata and never the user-selected media. The
memory and IndexedDB acceptance witness proves that a no-owned-PCM linked WAV
survives after its last durable revision ages out while a live audio root keeps
it canonically readable. When the last root disappears, the next maintained
save or writable activation removes the binding and releases its exact locator
once while leaving the external WAV untouched.

The binding/root transaction is qualified within the same IndexedDB database,
including independent browser connections. Different databases or profiles,
the project catalog, and the main locator registry are not coordinated by that
transaction. Restart and crash windows, power loss, and hostile-row authority
do not qualify, and the stated count bounds do not qualify arbitrary hostile-row
clone cost or process RSS. Project publication, the memory or IndexedDB binding
prune, alias re-inventory, and main-process exact release are not one
cross-boundary transaction; interruption between them may safely leak metadata
until a later maintained save or writable activation. Coordination beyond the
same-database provisional-root window, relink or watch, range support outside
maintained post-bind Electron linked-PCM source reads, packaged executable or
operating-system qualification, third-party activation gating, and legacy
private libraries are outside this claim.

That same lifecycle coordinator now serializes project duplication with binding
publication, exact unlink, startup reconciliation, project deletion, and
whole-store clear for one live `AudioEditorProjectStore` in one renderer
process. Duplication reads the source project first; the desktop repository uses
an exact canonical shared-document read that performs no managed-media
resolution. A subsequent point-in-time catalog check must still contain the
source ID and must not contain the destination ID. The duplicate receives a new
project ID, revision 0, a requested non-empty title or the source title plus
` copy`, and fresh creation and update timestamps. Reachable source collection
is capped at 4,094 references. No linked body, source body, media body, locator,
or playback capability is loaded, released, staged, or copied by this operation.

Before project publication, the alias repository scans and validates the
complete binding inventory, capped at 100,000 closed rows and 128 unique exact
locator/revision references. It rejects malformed or conflicting inventory, an
already-bound destination project, an over-capacity prospective row set, and a
reachable source binding whose storage key, MIME type, or maintained source
geometry does not exactly match the project source. For each reachable video
source that has a source-project binding, it publishes a destination-project
alias to the same pathless locator ID and revision, byte length, and digest, but
with a fresh binding token and timestamp. An unbound reachable video receives no
alias. IndexedDB publishes the complete alias set in one readwrite transaction;
the memory backend compensates a partial synchronous publication. This alias
publication is separate from, and not atomic with, project publication.

The normal project-publication admission runs after alias publication. The
create-only project repository then checks the current-project row, the exact
revision key, and every revision for the destination before atomically writing
only the project and its revision-0 record. It does not publish or adopt staged
source or media records. On a determinate later failure, alias compensation
first validates the complete current inventory and removes only the exact fresh
binding tokens; a missing alias is already settled, while any replacement makes
cleanup fail without partially deleting the requested set. Desktop local-shadow
compensation likewise requires the exact returned snapshot plus its persisted
creation fence, removes only project and revision rows, and preserves an
identical later publication, a changed project, and every binding.

Desktop duplication checks remote destination absence, creates that fenced
local shadow, verifies its exact canonical document, and then requests the
shared commit. An exact acknowledgement succeeds. If commit or acknowledgement
handling fails, one remote reread treats the exact expected document as success,
proven absence as a determinate failure eligible for exact local and alias
compensation, and a divergent or unreadable result as
`ProjectDuplicationIndeterminateError`; the last case retains the local shadow
and aliases because the remote outcome cannot be proved safe to undo.

There is no durable duplication receipt or restart reconciliation for these
multi-store steps. The exact local-delete capability is process-local even
though its revision fence is persisted, so abrupt interruption after local
shadow creation can leave a hidden shadow and aliases that block retry; startup
linked-locator reconciliation does not retire that shadow. Cross-store,
cross-profile, cross-process, and project-catalog races are not serialized by
this guarantee. The concurrency evidence covers two calls through one memory
store facade, not overlapping browser IndexedDB connections, and there is no
crash, restart, power-loss, or packaged interactive duplication qualification.

The project-catalog snapshot, local binding transaction, and main reconciliation
are separate, not atomic. A catalog mutation after its snapshot may be observed
only later. If binding deletion commits before IPC or main rejects, the binding
deletion remains committed; a later startup retry can prune the now-unreferenced
locator. Catalog absence remains an authoritative deletion root regardless of a
product-local shadow. Catalog presence admits source-level pruning only through
the bounded product-local exact-schema-9 current and retained graphs whose
current revision equals the catalog summary. Missing, stale, structurally
invalid, incomplete, or over-bound graph state retains the project's bindings.
The summary revision is not a document-content digest, so this is a cooperative
revision fence rather than authentication of same-revision local graph content.
Current-process records abandoned outside the maintained startup, binding,
save, successful writable activation, delete, and clear lifecycle may still
wait for a later main-process restart. Main validates the DTO and exact
revisions but cannot authenticate inventory or local-graph completeness, so a
compromised renderer can omit live references and delete startup locator
metadata. This is cooperative availability maintenance, not a
compromised-renderer integrity control. Cleanup beyond one live store's bounded
startup and maintained save/successful-writable-activation/delete/clear
lifecycle, cross-store, cross-profile, or cross-process mutation serialization,
abrupt-crash or power-loss durability, and a total cloned-byte or process-RSS
bound for one hostile IndexedDB row are not implemented. Packaged executable/UI
and operating-system behavior remain unqualified as described above.

With this explicitly injected platform port, a fresh document-only latest shared
load can admit a complete exact linked-video alias group without a prior local
project snapshot or managed descriptor. Binding and group inspection performs
no privileged body read. The declared linked byte length participates in the
complete logical-source, 64 GiB byte, and PCM-chunk preflight above; only after
that aggregate preflight succeeds does the first body request reload the opaque
locator at its expected revision, require the exact byte length, hash through
at-most-4-MiB windows, and recheck every binding token. The ordinary load may
then save the authoritative local shadow and trust those exact sources without
reading, writing, or copying an owned media asset. Malformed, incomplete,
conflicting, replaced, stale-revision, wrong-size, or wrong-digest bindings fail
closed before shadow publication.

Only an explicit `prepareHandoff` turns that verified linked body into owned
media: an exact linked-session overlay supplies the whole `Blob` to the existing
managed original-video sender, which retains its normal aggregate preflight,
digest, bounded-transfer, and publication contract. The playback lease neither
copies media nor changes this whole-`Blob` handoff. This handoff path adds no
product chooser, relink or watch flow, durable operating-system handle,
background copy/consolidation beyond the bounded same-store scalar-alias
duplication above, or an alternate publishing protocol.
Generic linked audio beyond the narrow linked-PCM managed-handoff exception,
every other linked or unmanaged original, authored proxies, other video
rendered-fallback roles and authoring, packaged executable/UI behavior, and
browser codec playback remain unqualified. The maintained role-defined
whole-project video and first-party clip fallback activation rule below is
separate from this linked-original contract. The separate source- and
component-tested chooser and import described above still lacks packaged and
operating-system qualification, cleanup beyond the bounded startup binding
inventory, and fallback acquisition or handoff outside the closed maintained
roles. The range route has no packaged executable/UI, operating-system, or
browser codec playback qualification.

For a successfully qualified body, admission snapshots metadata before and
after it, consumes the exact sequential PCM chunk count and ordered
`Float32Array` channel/frame geometry, requires any supplied chunk index or
frame count to match, and requires a syntactically valid trusted recipient-local
SHA-256 before any video body read. It then fully reads each genuine exact-size
video `Blob`, hashes it with SHA-256 through 4 MiB windows, and its body digest
must match. Legacy PCM-on-read migration and media-digest backfill are
disabled during shared admission. Digestless legacy video therefore fails
closed before body read, local shadow save, or activation; it must first use
ordinary local loading to complete trusted digest backfill before retry.
Every source binding, budget, metadata, geometry, body, or digest failure
detected before shadow publication leaves the recipient's latest local shadow
and revision history unchanged and prevents bootstrap activation. Cancellation
first observed after the exact shadow is durable still rejects the load before
activation, but retains that shadow and any acquired managed media it references. This
does not describe the later controller-owned rendered-fallback-declaration
digest check, which follows repository shadowing.
Source-free latest loads perform zero source or media I/O. Bootstrap propagates
its lifetime signal; one repository instance keeps latest load, save, and
delete serialized per project; and publication and retention resolve logical
references to physical storage keys.

A real-store fixture qualifies recipient audio and video bytes already present
under nontrivial storage keys and bound by the pre-existing latest local
snapshot. Composed cross-product evidence separately proves the source-free
Soundscaper-to-Framescaper success path and a source-bearing
missing-recipient-PCM refusal that preserves the pre-existing revision without
activation. A maintained explicit-audio fixture additionally proves managed PCM
acquisition by a fresh Framescaper store.

A composed headless Soundscaper-to-fresh-Framescaper-to-Soundscaper fixture
publishes canonical PCM and retained original video, acquires both into the fresh
profile, activates with an empty missing-source set, verifies exact audio engine
buffers and video blob-URL bytes, exercises transport play, edits, and saves. Its
explicit return handoff gives both unchanged bodies distinct revision-bound
bindings backed by the same inodes without renderer body chunks. Reopening the
original Soundscaper profile returns the exact edited document and preserves its
product-local revision history with zero bridge body I/O and no duplicate local
media. This headless evidence does not qualify executable/UI launch coordination
or browser video-element codec playback.

A narrower composed Soundscaper-to-fresh-Framescaper fixture roots an exact
schema 9 role-defined audio whole-mix fallback for the unknown canonical
`org.example.future-mixer` feature solely through its requirement. The sender is
intrinsically read-only only because of that feature-requirement report and
still owns the current writable project lock, so explicit handoff publishes the
unchanged active snapshot without flushing. Declared read-only, future-schema,
missing- or stale-lock, and lock-contended projects remain refused. The empty
recipient acquires the fallback and editable original as canonical managed PCM
plus the exact canonical shadow, remains intrinsically read-only, and activates
the transient fallback with exact engine samples and no missing source. Managed
acquisition verifies its descriptor and body SHA-256. The separate fallback
digest declared by the project manifest remains controller-owned after shadow
publication and before activation.

A parallel composed headless Framescaper-to-fresh-Soundscaper fixture carries
an exact schema 9 editable retained original alongside a manifest-only
`project-video-render-v1` fallback for the unknown canonical
`org.example.future-video-pipeline` feature. Explicit managed whole-`Blob`
transfer moves the two exact video bodies into the empty recipient. It publishes
the exact canonical shadow, leaves the recipient intrinsically read-only, and
separately verifies the manifest fallback digest in the controller after shadow
publication and before transient activation. After activation, replacing the
local fallback with corrupt same-shaped bytes proves that stale activation-time
admission cannot authorize delivery: maintained video export rejects before
FFmpeg or output publication. Restoring the exact body allows fresh
selector-bound operation-time verification to return the exact size- and
digest-verified native `Blob`. Delivery reuses that same immutable `Blob`
directly as its only video input without a second fallback storage read, while
the exact canonical shadow remains unprojected. The fixture has no canonical
audio, and embedded fallback-video audio is not used. This headless,
whole-`Blob` evidence does not qualify codec or browser behavior, a packaged
runtime, range or reference-scale transfer, fallback authoring, other-role or
simultaneous fallbacks, third-party feature-code activation, linked-only or
unmanaged delivery, a durable byte lease, broad export or offline-render parity,
or whole-handoff atomicity.

Recipient-local admission for unmanaged sources remains a bounded sequential
readability check, not an atomic snapshot or publisher authentication. The
owned canonical-PCM session above narrows provider-generation drift after
admission but does not turn admission itself into a durable byte lease.
Unmanaged audio is availability and geometry qualified, not
authenticated against a prior content digest. Selected metadata is reread
around each body, but body reads are not transactionally bound to that metadata;
same-metadata replacement during the sequential observations can go undetected,
and replacement or deletion afterward is not fenced. Injected
non-cooperative providers may continue work after cancellation rejects; shadow
save is not abort-atomic once begun; and separate repository instances and
processes are not serialized. Source-bearing saves and explicit local revision
loads bypass this admission. Explicit managed handoff supplies automatic
fresh-recipient acquisition for canonical PCM—including the maintained exact
schema 9 role-defined unavailable-or-unknown audio whole-mix fallback—and
retained original video. The
qualified video slice also covers the maintained exact schema 9 manifest-only
unknown-feature whole-project video fallback when handed off alongside its
editable retained original from Framescaper to a fresh Soundscaper store as
described above.
The maintained pathless desktop linked retained-video slice and narrow
linked-PCM managed-handoff exception described above are also qualified. Other
linked audio and every other linked or unmanaged original, authored proxies,
rendered-fallback authoring and transfer semantics beyond the closed audio
whole-mix and maintained video roles, relink beyond these exact-content
retained-video and linked-PCM Project Bin flows and automatic watch behavior, general
copy/consolidate beyond the bounded same-store project-alias duplication above,
source-level linked-locator cleanup outside maintained same-store saves and
successful writable activations, general linked-locator cleanup beyond the
bounded startup and same-store save/activation/delete/clear inventories,
packaged chooser/import qualification, managed-media
runtime cleanup beyond the startup-bounded tracked inventory, recipient-local or
whole-handoff capacity reservation, stable playback identity beyond the
maintained owned canonical PCM, linked-PCM, and retained-video lifecycles,
content-frozen identity against same-inode mutation,
browser codec playback, packaged executable and UI two-product source-bearing
handoff, portable hard-link capacity qualification, and a shared cross-product
revision journal and undo/redo history remain unqualified.
Product-local bounded revision history is the only history proven by the
composed return fixture.
Rendered-fallback digest verification remains controller-owned after repository
shadowing and before activation side effects. The video-delivery slice repeats
that verification independently at operation time as described below.

A composed source-free editor fixture creates and autosaves in Soundscaper,
closes its fenced host, discovers and bootstrap-reopens the same identity and
revision from a fresh Framescaper-local store, and commits the next revision in
Framescaper. It also proves a higher fencing token without stale takeover and
an empty shared media catalog. This composes the real controller, default
Soundscaper desktop-store selection, renderer repository, main service, and
host.

A maintained dedicated Linux x64 CI job builds two separate unpacked packages
and runs them sequentially as Soundscaper → Framescaper → Soundscaper. The
processes share only one isolated appData root, use separate product profiles,
and the final process reuses the original Soundscaper profile. After the
renderer-ready signal, each packaged executable drives the bounded pathless
preload IPC, exact-SHA-256 verifies its expected canonical source-free schema 9
document, commits revisions 1, 2, and 3, and checks both the renderer summary
and the main-only catalog row. Each stage requires clean recovery, no stale
takeover, a strictly higher fencing token, an increasing catalog revision, and
the expected preferred product. The runner awaits process exit and lease
release before launching the next stage.

Combined with the composed editor fixture, that closes only the generic packaged
source-free preload/IPC/multi-process/executable lifecycle gap. It does not
qualify packaged controller autosave or tab activation; source-bearing bytes,
playback, or managed media; concurrent opens; crash or stale takeover;
interruption or power loss; parent-, database-, or project-root path identity;
installers or file associations; or Windows, macOS, or ARM64. Third-party
activation gating and legacy Soundscaper library migration remain deliberately
separate from this slice.

This catalog rule is current-only. Activation-specific feature-capability
evaluation remains editor-owned. Explicit managed canonical PCM and retained
original video are the fresh-recipient source-byte transfers provided by this
library; this includes a maintained exact-schema role-defined unavailable-or-
unknown audio whole-mix fallback when its manifest is the only reference.
Ordinary saves remain
document-only. The maintained pathless desktop linked retained-video slice and
narrow linked-PCM managed-handoff exception described above are additionally
qualified. Other linked audio and every other linked or unmanaged original,
authored proxies, rendered-fallback authoring and transfer semantics beyond the
closed audio whole-mix and maintained video roles, general
copy/consolidate beyond the bounded same-store project-alias
duplication above, relink beyond these exact-content retained-video and
linked-PCM Project Bin flows and automatic watch behavior, source-level linked-locator cleanup
outside maintained same-store saves and successful writable activations,
general linked-locator cleanup beyond the bounded startup and same-store
save/activation/delete/clear inventories, packaged chooser/import qualification,
managed-media runtime cleanup beyond the startup-bounded tracked inventory,
recipient-local or whole-handoff capacity reservation, content-frozen or
cross-restart playback identity, executable/UI and
browser-codec qualification, portable hard-link capacity
behavior, and shared cross-product revision or undo history remain outside it.
The remaining platform and fault matrix includes
per-platform parent- and database-path identity, power-loss durability, and
interrupted foreign collisions at registered random stage paths.
Unregistered or legacy pre-inventory stage-looking files are deliberately
foreign content and are not adopted or deleted.
Existing V1–V8 raw-project migrations remain maintained. Compatibility beyond
those retained raw-document migration paths—especially migration from the prior
shared `v1` scope or product-private Soundscaper libraries—is not a current
priority and remains deferred and unsupported by this contract. Audacity
project interchange is a separate boundary.

## Project feature requirements

Schema 9 establishes the raw-project declaration and evaluation foundation. Its
root-level `featureRequirements` value is a bounded, normalized manifest. The
current nested manifest schema 2 has canonical namespaced feature identifiers,
unique requirement IDs, closed bypass or rendered-fallback dispositions, and
bounded display strings. Its closed rendered-fallback roles are
`project-audio-mix-v1`, `audio-track-render-v1`, `project-video-render-v1`, and
`video-clip-render-v1`. Every descriptor references an existing project source
of the declared audio or video kind and carries a canonical lowercase SHA-256
string; the clip role also carries one canonical target clip ID and the track
role one canonical target track ID. The track role is restricted to
`audioEffects` and validates its target at normalization: exactly one audio
track with an active effect rack, at least one enabled effect, and a non-empty
clip lane whose clips are audio, carry exact timeline placement, and do not
reference the fallback source, whose `frameCount` must equal the lane extent.
Manifest normalization therefore receives the project tracks at every
validation, creation, clone, commit, remap, and inspection call site, and a
caller that supplies no tracks fails closed for the track role. Nested manifest
schema 1 remains a narrow compatibility input and deterministically normalizes
audio and video descriptors to the corresponding whole-project roles. It cannot
declare the clip or track relationship. These checks validate descriptor
syntax and source identity; they do not hash or authenticate the referenced media bytes.

Schemas 1 through 8 begin migration with the canonical empty publisher manifest
rather than inventing publisher requirements. Maintained exact-schema-9 create,
load, clone, and commit paths then reconcile the editor-owned
`soundscaper.audio-effects` bypass requirement when a maintained first-party
processor exists in a non-label or non-video track, mixer group, mixer send, or
master rack, and the editor-owned `soundscaper.video-effects` bypass requirement
when a maintained first-party video effect exists on a timeline or Project Bin
video clip. Disabled effects and inactive audio racks still require
preservation; missing or foreign effect types and video-effect stacks on
non-video clips do not. An explicit publisher declaration for the same
capability wins without duplication, while conflicting use of either reserved
owned requirement ID rejects. Retained-schema migration applies that same
reconciliation after starting from the empty publisher manifest.

The pure evaluator compares a normalized manifest with caller-declared known
and available feature IDs and reports available,
unavailable, and unknown entries. Each item retains its declared bypass or
rendered-fallback disposition separately from its effective native, bypassed,
or rendered-fallback disposition. Unknown feature IDs remain declarative data and
cannot activate code. Malformed current-schema manifest state fails validation;
a newer outer project schema is instead cloned opaquely and returned read-only
before current-manifest normalization.

At the controller boundary, explicit stable broad capability IDs map one-to-one
to the maintained keys in each selected product profile. The controller snapshots that
profile at construction: only a strict `true` value makes a registered feature
available, a registered non-true value is unavailable, and an unregistered ID
is unknown. It evaluates exact schema 9 from the actual project history that
will be activated, before activation side effects. A report containing an
unavailable or unknown requirement makes the project intrinsically read-only.
When an existing same-ID tab wins, its stored read-only declaration also wins
over the ignored incoming document's flags.
The report is retained per tab, remains deeply frozen across session metadata
clones, and is exposed on the document snapshot. Future schemas produce no
feature report, and their `featureRequirements` value is not traversed.

For the maintained first-party audio-effect slice, the controller derives a
transient playback projection from that authoritative activation project and
report before activation side effects. Projection requires exact schema 9 and a
registered audio-effects item that is unavailable, declares bypass, and has the
effective bypassed disposition. Active, enabled, not-already-bypassed maintained
processors in non-label and non-video track, mixer-group, mixer-send, and master
racks become minimal bypassed copies only for editor engine loading. Inactive
racks, disabled or already-bypassed effects, and missing or foreign effect types
remain untouched. Stable IDs and effect types are bounded, a count above 4,096
rejects rather than truncates, and future schemas return
unchanged before rack traversal.

The canonical project, history, source loading, persistence, and save paths do
not receive that projection. Deeply frozen per-tab session metadata and the
document snapshot identify each affected scope, owner ID, effect ID, and effect
type without reading or retaining effect params, context, state, or other
payloads.

The maintained exact schema 9 audio whole-mix fallback is defined by the closed
`project-audio-mix-v1` role rather than a producer allowlist. It activates only
when exactly one report item has a canonical namespaced feature ID, is
unavailable or unknown with declared and effective `rendered-fallback`
dispositions, and has an audio descriptor that exactly matches the canonical
manifest. The closed role supplies only fixed media semantics; the feature ID
remains opaque identity, and Soundscaper does not discover, load, or execute its
feature code. The referenced source must be mono or stereo, cover a safe
positive frame range, and match the project sample rate and master channel
count. ADM and surround projects, ambiguous candidates, descriptor drift,
missing sources, unsafe geometry, and collisions with the reserved synthetic
track or clip IDs reject rather than guessing.

The closed `audio-track-render-v1` role is the track-local sibling of that
whole-mix contract and of the clip-local video relationship. The audio playback
umbrella qualifies at most one audio rendered fallback of either closed audio
role; more reject as ambiguous. The track branch accepts only an exact
registered `audioEffects` item reported unavailable with declared and effective
`rendered-fallback` dispositions whose descriptor exactly matches the canonical
manifest by requirement ID, feature ID, role, target track ID, audio kind,
source ID, and SHA-256; because the capability is always registered, unknown
availability never qualifies this role. The projection rechecks the manifest
contract and the source geometry — the fallback source must be audio, mono or
stereo, and match the project sample rate, its frame count must equal the lane
extent, ADM routing rejects, and a collision with the reserved rendered lane
clip ID rejects — and then replaces only the target lane with one neutral
rendered clip from frame zero to the lane extent while neutralizing only that
track's effect rack. The track keeps its identity, gain, pan, mute, solo, and
envelope, so native mixing and routing still apply over the rendered lane, and
every other track, clip, mixer group, mixer send, master rack, source, and
Project Bin entry stays canonical. The required fallback source is staged
privately exactly like the whole-mix role, while ordinary lanes still load
their ordinary sources; the playback reapply path skips ordinary source loading
only when the whole-mix role is the projection's sole audio surface. Admission
capture binds the target track's type, rack activity, effect identity and
inertness flags, lane membership, and exact lane placement, so target drift
fails currentness, and a lane or rack change that breaks the declared geometry
fails admission capture itself, which the currentness fence reports as an
admission change.

On explicit desktop handoff, manifest reachability retains this fallback even
when no timeline or Project Bin clip references it. A real Soundscaper sender
using the unknown canonical `org.example.future-mixer` feature is intrinsically
read-only solely because of the feature-requirement report, but it retains the
current writable project lock. The controller therefore publishes the unchanged
active snapshot without flushing; declared read-only, future-schema, missing-
or stale-lock, and lock-contended projects still reject. A fresh Framescaper
recipient acquires the canonical original and fallback PCM as exact managed
bodies plus the canonical project shadow.
That transfer authenticates each managed descriptor and body digest; the
controller then separately verifies the manifest fallback digest before
read-only activation. The engine alone receives the synthetic whole-mix
projection and exact fallback samples, while the document snapshot remains the
publisher's canonical project.

The track-local relationship reaches the same explicit desktop handoff. Its
sender stays compatible and editable because the registered rack is available,
and an ordinary save stays document-only; the explicit handoff publishes the
target-lane and native-lane originals plus the digest-bound track render as
exact managed bodies. A fresh recipient that reports the registered
`audioEffects` capability unavailable acquires all three bodies
digest-verified, preserves the byte-exact canonical shadow, and admits the
relationship by role, target track ID, source ID, and SHA-256 before the
target-lane-only projection plays. Delivery on that recipient refuses
corrupted recipient-local render PCM before render or download and, after
exact repair, mixes the native lane with the verified private provider into
exact WAV output while the canonical project stays unchanged.

`org.example.future-mixer` supplies this unknown-feature composed
Soundscaper-to-fresh-Framescaper witness. The canonical manifest, frozen
metadata, and localized source/component UI stay bound to the exact feature ID
and requirement ID without exposing fallback internals. Its operation-time
export selector cross-binds the exact requirement ID and feature ID with the
audio kind, source ID, and SHA-256.
Corrupt same-shaped recipient-local PCM after activation triggers tamper refusal
and rejects delivery before rendering or output; exact repair restores the exact
PCM and produces a final-mix float WAV containing the expected fallback samples
while the canonical project and stored project shadow remain unchanged.

For editor playback, that source becomes one neutral whole-mix clip using its
full frame range from frame zero. The transient projection removes every
canonical audio clip and track and neutralizes mixer and master processing to
prevent double playback, while retaining video and label timing. Initial
activation and later engine reapplies use the same playback-project service.
Fallback-only sources are required explicitly and their stored metadata is
rechecked. Short sources are decoded and their buffer geometry must match
exactly; oversized sources must expose a streamable chunk provider. Readiness
does not prefetch or revalidate streamed chunks, so a later provider failure
remains possible. Initial activation stages only the required fallback source's
decoded buffer or stream-provider candidate privately before obtaining the
activation reservation, without changing shared buffer, provider, or engine
chunk-source state. Metadata, audio-context, and decoded-body stalls race the
controller-lifetime signal; cancellation rejects promptly with the exact signal
reason, and late settlement cannot publish buffers, chunk providers, engine
chunk sources, missing-source state, or status. If post-preparation currentness
or reservation fails, the stage is discarded and the prior buffer and provider
identities, engine chunk-source state, active project, tab, and lock remain
unchanged. After currentness and reservation succeed, ordinary-source loading
excludes the required fallback. Ordinary transient buffers and the staged
required representation are composed into private source-buffer and
chunk-source snapshots; the staged required representation wins a conflicting
transient before those snapshots reach the engine. After the engine callback
succeeds and the lifetime signal remains active, commit runs its caller-supplied
synchronous project-identity or activation-admission assertion immediately
before shared publication, with no intervening await; only then do the shared
source maps change.
Each canonical playback reapply owns one replaceable controller-lifetime task.
A newer reapply or a successful project switch aborts stalled metadata,
audio-context, or decoded-body source preparation with the exact signal reason;
the switch does so before teardown. Late settlement is fenced from
buffer, provider, engine-source, missing-source, and status publication. In the
tested stalled-preparation race, only the newest source-ready projection enters
the engine.
The standalone audio-delivery projection invokes only the
audio rendered fallback. It does not compose the video rendered fallback or
either bypass projection, and a simultaneous rendered fallback rejects
instead of delivering a partial projection. Maintained final-video delivery
is the separate composed path: it may compose one audio whole-mix fallback
with one maintained video fallback through a single joint integrity
admission, described with the video slice below. Standalone audio delivery
accepts normalized final-mix audio only. Stems, BW64, and any ADM setting
reject before fallback verification, export planning, destination selection,
storage preflight, or rendering.

Under the owned export signal and task, project-generation, and operation
currentness fences, fresh operation-time verification binds an exact selector
to the active requirement ID, feature ID, audio kind, source ID, and SHA-256,
together with the closed audio role and, for the track role, the exact target
track ID, in the canonical project; selection, currentness, and
conflicting-claim comparison all include that relationship. Selector mode performs a full canonical chunk scan of
only that selected source's `audio-f32le-chunks-v1` sequence, checks its source
geometry and aggregate digest, and builds an admission-time per-chunk digest
table. It returns a private chunk provider with the exact admitted source
geometry before planning or any other export work. In maintained final-video
delivery that same audio selector is passed alongside the video selector to one
joint verification: their cumulative non-raiseable 64 GiB preflight applies
before both fallback body reads, this audio chunk scan runs first, and
nonselected fallback bodies are not read.

For the whole-mix role, the delivery clone receives an empty private
audio-buffer map and that provider as its sole chunk render source. Global
source buffers, providers, and cache state remain unchanged, and whole-mix
fallback delivery does not prepare committed time/pitch caches. Every provider
read rereads one exact stored chunk, copies
its `Float32Array` channels, and checks canonical geometry and the admission-time
chunk digest under currentness and cancellation fences. A changed storage body,
geometry, or digest becomes the stable audio-fallback integrity error; an
offline integrity failure does not retry through realtime rendering. Ordinary
audio export keeps its existing source and renderer contracts.

The track render composes instead of standing alone. Its delivery clone
receives ordinary source buffers and chunk providers with the fallback source
removed from both, so the fallback bytes are readable only through the
operation-time digest-bound private provider, which replaces any ordinary
provider or cached buffer for that source; committed time/pitch caches are
prepared for the native lanes, and missing ordinary sources still refuse
export. Stems, BW64, and any ADM setting reject for both audio roles before
export side effects, and the same role-keyed composition reaches the audio side
of maintained final-video delivery through one shared recipe.

The canonical project, history, persistence, and save paths never receive the
playback or delivery projection and remain unchanged by final-mix output.

Deeply frozen per-tab and document-snapshot metadata retains the selected
feature ID, requirement ID, and source ID and drives one localized
active-during-editor-playback source/component UI indicator. The UI matches the
exact feature and requirement without reading or exposing the audio kind,
source ID, or digest; operation-time export separately binds the exact audio
kind and SHA-256 from the canonical manifest. More than one qualifying audio
rendered fallback of either closed audio role across any
feature identities rejects as ambiguous, and
non-audio roles never qualify for this projection. Simultaneous audio/video
rendered fallbacks reject for standalone final-audio delivery; maintained
final-video delivery instead applies the active audio rendered-fallback
projection of either closed audio role
whenever it qualifies, so the delivered video audio renders through its
digest-bound private chunk provider even when no video rendered fallback is
active, and may compose that one audio whole-mix or track render with one
maintained video fallback through a single joint integrity admission, while
anything beyond that exact one-audio/one-video composition rejects. Future
schemas and earlier Soundscaper schemas remain outside this slice. Linked-only
and unmanaged delivery, fallback authoring, freeze and proxy relationships,
publisher authenticity, and third-party code activation remain unqualified, as
do stems, BW64 or ADM delivery and ADM or surround playback. Packaged runtime
or UI workflows, operating-system behavior, browser audio behavior beyond the
maintained portable-open witness, reference-scale evidence, and a durable byte
lease remain unqualified. The separate maintained video slice below does not
broaden that boundary.

The maintained exact schema 9 video rendered-fallback projection has two closed
relationships. `project-video-render-v1` accepts any canonical namespaced feature
ID reported unavailable or unknown. `video-clip-render-v1` remains restricted to
exact `videoEffects` reported unavailable. Exactly one item may qualify, and it
must have declared and effective `rendered-fallback` dispositions. Its video
descriptor must exactly match the canonical manifest by requirement ID, feature
ID, disposition, relationship role, optional target clip ID, video kind, source
ID, and SHA-256. The separate controller fallback-integrity admission verifies
the local body before activation side effects. Maintained final-video delivery
then runs one joint operation-time integrity verification over the active audio
and video selectors it derives. The video selector binds the requirement ID,
feature ID, relationship role, target clip ID, video kind, source ID, and
SHA-256; an active audio fallback of either closed audio role contributes the
separate role- and target-bound audio selector
described above. Their cumulative non-raiseable 64 GiB preflight applies before
both fallback body reads. A composed audio chunk scan runs first and returns its
digest-bound private chunk provider; the selected video body is then loaded
under the export-task signal, size-checked and hashed as its canonical native
`Blob`, and retained as that exact immutable `Blob`. Nonselected fallback bodies
are not read, and verification completes before the video plan, storage
preflight, audio render, FFmpeg call, or publication.

`project-video-render-v1` retains the whole-project behavior. Its source must
have the exact video kind, match the project sample rate, carry positive
safe-integer frame count, width, and height, and carry a positive finite frame
rate. Its transient projection replaces all timeline video clips and tracks
with one neutral clip and track using the fallback's full source from frame zero.
It preserves audio and label clips and tracks, Project Bin, sources, and every
other canonical field. Missing or duplicate sources, descriptor drift, invalid
geometry, or a reserved synthetic track or clip collision reject.

`video-clip-render-v1` is a closed `videoEffects`-only relationship. It binds one
exact target clip ID whose timeline video clip contains an enabled maintained
effect. The fallback source must be different from the target's canonical
source, declare `hasAudio: false`, have frame count equal to the target clip
duration, and match that canonical source's sample rate, width, height, and
frame rate. The transient projection replaces only that target timeline clip.
Its source starts at frame zero, source duration becomes the target duration,
trim values become zero, speed becomes one, and video effects become empty.
Track membership, timeline placement, duration, group, A/V link, layer and
transition context, every unaffected clip and source, and the canonical project
and history remain unchanged. The manifest-only fallback becomes an explicit
required source before engine or preview entry, and preview lookup follows the
projected clip's exact source identity rather than assuming canonical clip state.

The maintained video-delivery projection applies the active audio
rendered-fallback projection — the audio whole-mix or the track render —
first and then the selected video rendered fallback. It represents at most one
audio and one video rendered fallback and applies no bypass projections;
unrepresented, duplicate same-kind, unsupported-role, or additional rendered
fallbacks reject instead of delivering a partial projection. Standalone
final-audio delivery does not compose and still rejects simultaneous rendered
fallbacks. The verified `Blob` is the whole-project plan's only video input or
the clip-local plan's selected target input. Ordinary video export and
composition consume the projected target alongside normally loaded unaffected
video, preserving its track and transition context. An active audio whole-mix
renders through an empty private audio-buffer map and its sole admitted chunk
source without committed time/pitch cache preparation; an active audio track
render instead keeps ordinary lane buffers and providers beside its private
fallback provider, which replaces any ordinary representation of the fallback
source, with committed time/pitch caches prepared for the native lanes;
otherwise canonical
audio clips and effects stay in the delivery snapshot and render into the
separately staged mix. Embedded fallback-video audio is not extracted or
mapped. The canonical project, history, persistence, and save state remain
read-only and unmodified.

Export checks project, task, generation, and operation currentness before and
after verification, binds admission to the canonical relationship, and checks
again after FFmpeg and publication. Refusal or cancellation begins no later
planning or media work. The relationship snapshot includes role, target clip ID,
canonical source and duration, maintained target effects, and required source
geometry. Role, target, context, or same-source relationship conflict rejects
before media use. This is exact point-in-time immutable-`Blob` reuse, not a
durable storage-record lease or cross-process replacement guarantee.

The `org.example.future-video-pipeline` unknown-feature headless witness carries
a whole-project fallback and retained original through explicit managed handoff.
A second headless `video-clip-render-v1` witness carries the canonical target,
unaffected video, and manifest-only fallback body to a fresh recipient, preserves
the target clip ID and digest-bound fallback body in the exact canonical shadow,
reopens that shadow, and performs relationship-bound admission before playback.
Portable `.scape` export and import preserve the same relationship; a copy
collision remaps only the fallback source ID and preserves the canonical target
clip ID. Ordinary video export, portable `.scape` collision handling, and
managed handoff therefore share the same closed relationship rather than
inventing route-local identities.

Deeply frozen per-tab and document-snapshot metadata and the localized
source/component UI bind only the exact feature ID and requirement ID without
exposing source ID or digest. The exact one-audio/one-video final-video
composition is qualified. More than one qualifying fallback rejects as
ambiguous. Multiple clip fallbacks, duplicate same-kind fallbacks, and other
mixed fallback relationships are unqualified. Audio-kind descriptors of either
closed audio role never qualify for this video projection; the delivery layer
admits an audio fallback only through its separate exact role, and noncanonical
feature IDs fail manifest admission. Unknown canonical feature IDs qualify only
for the whole-project role and do not activate third-party feature code. Future
schemas remain outside this slice. Generic fallback authoring and other
relationship roles are unqualified. Linked or unmanaged delivery is
unqualified, as is simultaneous rendered fallback delivery beyond that exact
composition; standalone final-audio delivery still rejects simultaneous
fallbacks. Freeze, proxy, relink, embedded fallback audio, and broader render
parity are unqualified. Packaged runtime workflows are unqualified, browser
behavior is unqualified, codec qualification is unqualified, and
reference-scale evidence is unqualified. Earlier Soundscaper
project schemas are not a compatibility target for this slice beyond retained
outer migrations and deterministic nested manifest-schema-1 whole-project
normalization. Whole-handoff atomicity and a durable storage or cross-process
byte lease remain unqualified.

For the maintained first-party video-effect slice, the controller likewise
derives a transient activation projection only for exact schema 9 when the
registered video-effects item is unavailable, declares bypass, and has the
effective bypassed disposition. Enabled maintained effects on timeline and
Project Bin video clips become minimal disabled copies; disabled effects and
missing, foreign, or wrong-kind stacks remain untouched. Stable clip and effect
IDs are bounded to 256 characters, effect types to 128 characters, the combined
count above 4,096 rejects rather than truncates, and future schemas return
unchanged before clip or Project Bin traversal.

Only transient engine loading receives the video project projection. The WebGL
preview filters exact affected effects from timeline stacks using trusted
metadata, caches the selector, and preserves unchanged stack references.
Canonical project, history, source loading, persistence, save, export, and
offline-render paths do not receive the projection. Each placeholder entry in
the deeply frozen per-tab session metadata and document snapshot identifies
only location, clip ID, effect ID, and effect type without reading or retaining
params, context, state, or other opaque payloads.
This exact-schema-9 bypass slice does not attempt compatibility with earlier
Soundscaper project schemas. Its separate rendered-fallback rule above does not
broaden that boundary.

For an incompatible active document, the maintained active workspace consumes
`featureRequirementsCompatibility` directly and derives a separate frozen
structured notice containing only unavailable and unknown requirements. A
persistent, non-dismissible document-level localized region shows recomputed
counts, bounded display names, stable feature IDs, availability, and the
declared disposition while that active tab is selected; the effective
disposition remains structured metadata rather than being mislabeled as the
declaration. The region is keyboard-focusable when its bounded list scrolls.
It does not render the evaluator's message, read fallback internals, expose an
activation control, or claim feature-code loading. For the role-defined audio
and closed video rendered-fallback slices it shows only
each metadata-bound active-playback indicator described above. For
qualifying audio- or video-effects items with bypass metadata, the same notice
matches the corresponding frozen projection metadata to one requirement and nests
persistent localized, control-free affected-effect placeholders. Audio rows use
the maintained effect label and canonical track, group, send, or master owner;
video rows use the maintained effect label and canonical Timeline or Project
Bin clip owner. Neither inventory reads effect payloads. A compatible or `null`
report produces no notice, tab switching follows the per-tab report, and the
workspace never traverses future-schema `featureRequirements` state.

A separate read-only affected-object pass names the canonical objects behind
each unavailable or unknown requirement, including publisher feature identities
the maintained first-party inventories cannot name, and says plainly when it can
name none. It runs only for exact schema 9 with a `soundscaper-project` report
whose `compatible` value is exactly `false`, and it returns one entry per report
item reported unavailable or unknown, or no index at all when no item qualifies.
A compatible report, an available-only report, an absent, item-less, or
differently formatted report, and every other schema return no index without
traversing the project. The pass reads canonical state and changes none of it:
it walks the live canonical current project but projects, mutates, bypasses, and
reprojects nothing and reaches no engine project or audio graph, and beyond the
containers it walks it reads only identity and inertness—track type, clip kind,
effect type, stable IDs, and the `effectsActive`, `enabled`, and `bypassed`
flags—never effect params, context, state, or other opaque payloads. From the
report it reads only the format and compatibility, each item's requirement ID,
feature ID, and availability, and the declared fallback role and target clip or
track ID;
evaluator messages, fallback source IDs, and digests stay unread. Every named
property it takes from project data goes through an own-data-property check, so
an accessor or inherited property in a named position is treated as absent
rather than invoked or thrown on. That guarantee covers named reads only: array
membership is reached by ordinary element access, so a getter installed on an
index of `tracks`, `clips`, or an effect stack is still invoked.

Attribution has three channels, and it follows the declared descriptor rather
than the outcome of playback qualification or integrity admission. An item whose
manifest declares a rendered fallback is attributed from that declared role
alone: `project-audio-mix-v1` names every non-label, non-video track rack, every
mixer group and send, the master rack under its fixed `master` identity, and
every non-video timeline clip; `project-video-render-v1` names every video track
as well as every timeline video clip, because the projection collapses both and
naming only the clips would leave a video-track-only project reporting nothing
while every video track was discarded; `audio-track-render-v1` names the
declared target track together with each timeline clip its lane anchors,
because the projection replaces that lane and rack wholesale; and
`video-clip-render-v1`—like any other
role reaching this pass—names at most the one timeline clip whose ID equals the
declared target clip ID. Because the role is taken as declared, a
`video-clip-render-v1` descriptor on an item reported unknown is still indexed,
and its target clip is still labelled as replaced during editor playback, even
though that clip role qualifies for editor playback only when the item is
unavailable and carries the maintained video-effects capability ID. That label
reports a declared relationship, not an admitted or qualified substitution.

An item that declares no fallback and carries the maintained audio-effects
capability ID is instead attributed effect by effect across every non-label,
non-video track rack, every mixer group and send, and the master rack; the
maintained video-effects capability ID is attributed likewise across every
timeline and Project Bin video clip. Both channels collect only effect types
outside the maintained registry, so every entry they produce is flagged
unregistered: a registered type already has its own first-party placeholder
section above, and collecting it would spend the shared ceiling on rows the
notice discards. Both also apply the same inertness gates as the sibling bypass
projections—the audio channel skips a rack whose `effectsActive` is `false` and
an effect whose `enabled` is `false` or whose `bypassed` is `true`, and the
video channel skips an effect whose `enabled` is `false`, which is its whole
gate because a persisted video effect carries no bypass flag. The two channels
are not equally reachable. Persisted audio-effect validation admits any
non-empty type string, so an unregistered rack processor is an ordinary schema-9
occurrence; video effect stacks are normalized against the maintained video
registry when the project opens, so a foreign video effect type cannot exist in
a project that opens at all, and the video-effect channel is reachable in
principle but not by any project that opens.

A requirement is marked attributable only once a channel has actually named an
object, and a requirement no channel could name one for is explicitly
unattributable, carrying an empty object list rather than a guess. That is the
normal outcome for an arbitrary publisher feature ID with no fallback
descriptor, and equally the outcome for a maintained effect capability whose
project holds no active unregistered effect in scope and for a declared fallback
that matches nothing—a target clip ID no timeline clip carries, or a video role
on a project with no video track and no video clip. An object the shared ceiling
dropped still counts as named; a candidate whose identity could not be read does
not. The notice renders an unattributable requirement as one explicit line
stating that its affected objects cannot be identified, instead of an empty list
or nothing at all.

Stable IDs are bounded to 256 characters and object types to 128 while schema-9
validation bounds neither, so a valid document can carry an identity longer than
either bound. Exceeding a bound does not reject: this pass runs on the
document-snapshot path, where a throw would blank the editor, so a missing,
empty, or over-long stable ID or object type skips the object instead of
truncating the value or failing snapshot construction. Disclosure of those skips
is uneven. An effect whose type is a readable non-empty string but whose stable
ID is missing, empty, or over-long, or whose type exceeds 128 characters, is
counted in its requirement's omitted count; a track, mixer bus, or clip whose
own ID is unreadable is dropped silently by the traversal, taking every effect
it would have anchored with it, so a list can be short by an unnamed object
without saying so. A clip whose kind is not a readable bounded string is still
listed, defensively, under the generic object type `clip`.

One shared, lower-only 4,096-object ceiling is spent across the whole index in
report order, so a large early requirement can starve a later one, whose objects
then survive only as an omitted count. Exhaustion truncates rather than rejects:
the pass records the object in that requirement's omitted count, marks the index
truncated, and continues. The sibling first-party audio- and video-effect bypass
passes reject above that same 4,096 count instead, and the divergence is
intentional—truncating a bypass would leave a maintained effect audible, while
truncating a read-only advisory list leaves nothing audible, so a large project
must degrade this list rather than fail its open to produce one. The ceiling
bounds the retained list, not the traversal: enumeration continues after
exhaustion, every remaining rack, clip, and effect stack is still walked, and
the whole index is recomputed on every document snapshot for as long as an
incompatible schema-9 document is active, so an oversized project pays that walk
each time. Raising the ceiling, or supplying a negative or non-integer seam,
rejects with a `RangeError`, and that rejection is the pass's only one;
everything else about it is total.

The controller derives the index in the document snapshot from the live
canonical current project together with the retained activation-time report, so
the named objects follow later edits while each entry's availability stays fixed
by activation. It is computed from the canonical project rather than from any
playback or bypass projection, is frozen at every level, is not persisted, and
is not stored in per-tab session metadata. The workspace hands it to the same
post-open notice, which nests one persistent localized, control-free
affected-object section under the matching requirement, rendered only for a
requirement with a listed object or a nonzero omitted count. Each row shows the
object ID, the object type, and one of two localized labels—replaced during
editor playback on the rendered-fallback channel, otherwise a type this editor
does not recognize—and is keyed by channel, location, scope, owner, and object
ID, because schema 9 enforces ID uniqueness only within a collection and a track
and a clip may legitimately share one. The section shows only newly visible
state, namely the canonical objects a declared rendered fallback names and
effects whose type is outside the maintained registry; because the effect
channels never collect a registered type at all, the notice's registered-effect
filter is a redundant safeguard rather than a live deduplication. A nonzero
omitted count adds one line stating that further affected objects are not
listed, without distinguishing a ceiling-dropped object from an unreadable one.
No row exposes a control.

Beyond that disclosure the pass adds no behavior. It introduces no bypass:
bypass remains exactly the two maintained first-party audio- and video-effect
slices, and generic per-feature bypass controls remain unimplemented. It makes
no previously invisible object controllable, selectable, or actionable, and the
post-open notice stays control-free and informational. It does not change
activation, read-only enforcement, the engine project, persistence, offline
render, export, or delivery, and it verifies or authenticates no bytes. It
grants no new capability to third-party or unknown features: naming the objects
a requirement affects is not discovery, loading, or execution of publisher
feature code, and is not a claim about what the unavailable feature would have
done to a named object.

Raw and stored-project controller activation has a separate integrity admission
step for exact schema 9. The maintained role-defined audio and closed
video delivery slices invoke the same body verifier at export-operation time,
independently of activation admission; standalone audio delivery invokes it with
only its audio selector, while composed final-video delivery makes one joint
invocation carrying both selectors. Activation
verifies the authoritative project that would be activated, including existing
same-ID tab history, before project-generation invalidation, recording or engine
shutdown, lock changes, session publication, ordinary engine-source loading, or
normal activation persistence. Admission reads explicitly disable on-access PCM
migration scheduling and retained-media digest claim/backfill, so verification
itself does not publish storage maintenance. Audio fallbacks are read from their
local `storageKey` and hashed as the canonical
`audio-f32le-chunks-v1` sequence: a four-byte little-endian frame count followed
by planar little-endian Float32 channel bytes for each checked project chunk.
That path shares `.scape` export's PCM geometry validation and cumulative
65,536-chunk ceiling. Video fallbacks resolve their retained original-media
`storageKey`, require a genuine immutable `Blob`, and hash its actual body
sequentially through the non-raiseable 4 MiB media-digest window. Identical
source claims are hashed once. Unique claimed audio bytes and video sizes share
a non-raiseable 64 GiB cumulative ceiling that rejects before fallback body
reads. Conflicting digests reject before storage reads, and a missing,
malformed, or mismatched local asset rejects activation. The controller binds
existing-tab verification to an opaque session-owned history token. After
verification it upgrades that token—or the still-absent project ID—to one
exclusive session activation reservation before the first activation side
effect. The reservation rejects target history replacement, close/reopen, and
competing active-project publication through synchronous session publication,
and is released in `finally`. The controller-lifetime signal is propagated
through verification, and maintained
store operations cooperate with it to cancel and close an active audio
iterator. Read-only video-metadata preflight is raced against cancellation, so
an injected provider that ignores its signal may continue after the admission
has rejected. A provider-stalled fallback body read can instead delay
cancellation settlement and iterator cleanup. Empty manifests and future
schemas perform no asset reads, and future `featureRequirements` state is not
traversed.

Audio delivery selects the exact active requirement ID, feature ID, audio kind,
source ID, SHA-256, closed audio role, and, for the track role, target track ID
under the owned export signal. Selector mode scans only
that source's complete canonical chunk sequence and returns a private provider
bound to the exact source geometry and admission-time per-chunk digests. Each
render read checks a fresh owned copy of the stored chunk against those bounds;
the provider never becomes a global engine source. Verification and operation
currentness complete before planning or rendering, and a mismatch or
cancellation reaches no output work.

Video delivery passes the owned export-task signal to a fresh verification of
the canonical project with the exact requirement ID, feature ID, video kind,
source ID, and SHA-256 selected by the maintained delivery projection, together
with the exact audio selector when that projection also represents an audio
fallback of either closed audio role. One joint selector-mode verification
applies the cumulative 64 GiB
ceiling before both fallback body reads, scans any composed audio source first,
returns the canonical native `Blob` whose exact size and digest it verified, and
does not read or admit nonselected fallback bodies.
Export checks task, project-generation, and operation currentness before that
verification, asserts the returned admission against the same canonical project
and selectors, and repeats those fences after verification. It reuses that same
immutable `Blob` directly as the whole-project plan's only video input or the
clip-local plan's selected target input, without a second fallback storage
read; any unaffected clip-local video input still loads through ordinary storage
reads. It then checks currentness again after FFmpeg and across output
publication. Verification completes before video planning, storage preflight,
audio rendering, FFmpeg, or output publication. A mismatch or cancellation
reaches none of that later delivery work.

These are exact point-in-time provider and immutable-`Blob` admissions at the
maintained controller boundary, not durable leases over the underlying managed
storage binding. Calling `store.loadProject()` directly does not verify fallback
bytes, and admission does not prevent later low-level or cross-process
replacement of that storage binding, verify a nonselected fallback body, or
establish publisher authenticity. Admission itself does not
substitute fallback media at runtime; the separate exact-schema-9 role-defined
audio whole-mix, audioEffects-only track-target,
role-defined whole-project video, and videoEffects-only
clip-target projections described above perform their narrow editor-playback and
delivery uses.
Initial required-source preparation is
lifetime-abortable and occurs before activation reservation and side effects.
A signal-ignoring metadata, context, or decoded-body operation may continue
internally after cancellation, but its late settlement is fenced from buffer,
provider, engine-source, missing-source, and status publication. An engine
application already entered is not abortable or transactional and can leave
engine-side effects after callback failure or cancellation. A later activation
failure after a successful commit does not roll back committed shared source
state or earlier activation effects. Ordinary-source loading remains outside
this required-source staging transaction, and short-buffer retention after
engine application remains subject to cache-fit policy. Readiness does not
prefetch or revalidate streamed chunks. The maintained projections do not
provide generic per-feature bypass controls, rendered-fallback roles beyond the
closed audio and maintained video relationships, authored freeze or proxy
relationships, publisher authentication or
third-party feature-code activation, simultaneous fallback delivery beyond the
exact one-audio/one-video final-video composition, linked-only or unmanaged
fallback delivery, whole-video fallback audio handling, ADM or surround
fallback playback, broad export or offline-render parity, future-schema
preservation, earlier Soundscaper-schema compatibility, reference-scale or
browser/packaged codec qualification, or a complete third-party activation gate.

The same selected product service now powers a programmatic current-format `.scape`
inspection report. The composition root snapshots the selected product
and injects its evaluator as provider-owned state, so caller options cannot
override it. After archive integrity and project-source validation, exact schema
9 fallback claims are bound by source ID, kind, and SHA-256 to their canonical
manifest asset before evaluation and any project collision lookup. The deeply
frozen `featureRequirementsCompatibility` report therefore follows descriptor
binding, but inspection does not read or hash asset bodies and performs no
import, persistence, or activation. Future project schemas return `null`, and
their `featureRequirements` value is not traversed. This report does not claim
body verification or activate rendered fallbacks, and it is not a third-party
activation gate.

The maintained normal no-collision open workflow now turns an incompatible
exact-schema-9 report into an explicit choice: **Open read-only** or **Cancel**.
If the imported ID also collides, the dialog presents the compatibility report
and the collision together with **Open as read-only copy** or **Cancel** as a
single decision. Compatible collisions offer the safe **Open as copy** or
**Cancel** choices. A future-schema `null` report does not enter this feature
decision. The low-level native-open API remains outside this maintained-UI rule
and retains its caller-supplied collision policy; third-party activation is
likewise not gated here.

The decision belongs to one replaceable request lifecycle from inspection
through user settlement. Cancel resolves before import, persistence, or
activation and late settlement after replacement, project switching, caller
abort, or disposal cannot open the archive. The localized dialog shows each
affected feature's bounded display name, stable feature ID, availability, and
declared disposition; it does not render the evaluator's fallback-use message
or claim that fallback bytes were verified. Incompatible decisions initially
focus Cancel, and Escape dismisses the dialog and restores focus.

Acceptance carries no trusted read-only flag into the importer. It maps the
accepted no-collision or combined choice to the existing copy policy, then the
controller evaluates the actual project history again before activation and
enforces its intrinsically read-only result. This second evaluation also keeps
same-ID session history authoritative and makes the UI decision a consent
boundary rather than a capability override.

Current-schema and current-format `.scape` preservation is now part of this
contract. A rendered-fallback descriptor makes its source an independent
retention root even when no timeline or Project Bin clip references it. Project
and history compaction therefore retain that source metadata, current-format
export includes its source asset with the full manifest, and reopen preserves
the normalized manifest and its evaluation semantics. The portable archive
retains the relationship and exact target track ID of a track-render descriptor
just as it retains a clip-render descriptor's target clip ID, and import
revalidates each against the extracted project including its tracks. When a
copy import
rewrites colliding source identity, it rewrites the known fallback descriptor
reference through the same mapping while preserving the digest and the
canonical target clip or track ID.

The maintained export plan snapshots the admitted project root and complete
source records before its first asynchronous asset operation, then serializes
those same source records and the same bounded normalized fallback manifest into
`project.json`. Project-root and source-record accessors and callable `toJSON`
hooks are rejected without invocation rather than allowed to rewrite that
admitted serialization. Export hashes the actual canonical audio or video asset
output and rejects a claim-to-descriptor mismatch before writing the manifest or
committing a destination. Inspection and import perform the same
claim-to-manifest descriptor binding before compatibility evaluation, collision
lookup, or transactional storage. Import additionally hashes each extracted
asset body against that descriptor before source or project publication. Thus
inspection remains metadata-only; descriptor binding there does not read or
hash the potentially reference-scale asset bodies.

Blob-backed and random-access `.scape` reads now share the same canonical
archive-structure admission. A private witness retains at most 69,271,649 bytes
of admitted end, central, local-header, name/extra/comment, and descriptor data,
then replays those bytes while reading only payload gaps from the provider. This
ceiling exactly follows the maintained writer/export profile; archives that use
otherwise legal but noncanonical aggregate local-extra expansion are not a
compatibility target. The transport seam does not yet raise the desktop 512 MiB
selected-file materialization ceiling.

This archive evidence is deliberately limited to schema 9 and `.scape` format
1. It does not establish arbitrary future-schema archive preservation,
generic affected-object unavailable-feature placeholders or per-feature bypass
controls beyond the maintained first-party audio- and video-effect slices, or
third-party feature activation. The separate read-only affected-object index
described above is not archive evidence either: it names objects from the
activated project and its report, and it adds no bypass control, no runtime
substitution, and no activation route. After archive acceptance and import, the
separate maintained controller admission described above verifies the local
bytes referenced by the authoritative exact-schema-9 activation project. That
does not make metadata-only inspection a body-verification route and does not
cover direct store loads. Runtime use belongs only to the separate role-defined
audio whole-mix, audioEffects-only track-target, role-defined whole-project
video, and videoEffects-only
clip-target editor-playback and bounded operation-verified delivery paths.
Rendered-fallback roles beyond those closed relationships and authored fallback
relationships remain planned. The remaining
outcomes stay governed by the planned compatibility rows and roadmap exit gate.

## Opaque state

Binary opaque state and JSON-compatible opaque preservation are type-specific.

- Unknown JSON-compatible fields from schema 1 are collected under
  `opaqueExtensions.legacyV1`. Maintained JSON-compatible
  `opaqueExtensions` survive migration and current-schema `.scape` reopen
  semantically unchanged.
- A newer raw core document is structured-cloned, so typed arrays can remain
  typed arrays inside that in-memory read-only result.
- Before `JSON.parse`, every project schema receives an iterative raw-JSON
  structural preflight bounded to 101,536 values and depth 130 in production.
  The extra 1,536 values and two levels are the maximum tagged-descriptor
  allowance needed to keep the bounded exact-schema-9 binary representation
  round-trip closed; tests may only lower the underlying limits.
- Exact schema 9, format 1 `.scape` export preserves `Uint8Array` values,
  including only the addressed bytes of an offset view, and `ArrayBuffer`
  values through the reserved `$soundscaperOpaqueBinary` tag. Its descriptor is
  closed and versioned, identifies the restored type, declares an exact byte
  length, and carries canonical base64. Encoding and post-parse decoding each
  independently enforce the logical limits of 100,000 traversed nodes and
  depth 128, plus at most 256 payloads, 4 MiB per payload, and 8 MiB in
  aggregate. Import and inspection validate every descriptor, unique positive
  payload ID, base64 form, declared length, collision, and aggregate budget
  before allocating decoded bytes or starting collision and persistence work.
  Serialization copies the bytes and rejects reserved-tag collisions,
  project-container accessors, cycles, and callable container `toJSON` hooks
  rather than activating project code. Other `ArrayBuffer` views are
  unsupported and reject instead of being converted silently.
- Future-schema tag-shaped data is structurally counted by the all-schema raw
  preflight but is neither decoded nor interpreted as a binary descriptor;
  unchanged future `.scape` re-export remains a separate planned guarantee.

Unknown fields and unavailable features must never be interpreted as executable
code. Preservation does not imply activation.

## Disposable video preview relationships

Imported-video posters and filmstrip thumbnails are reproducible local cache
records. Each maintained record is related to a trusted retained original by
its storage key and SHA-256 digest, the poster or thumbnail type and normalized
timestamp, and a versioned recipe. For an owned original the repository derives
the current local generation token. For a linked original the maintained storage
facade refuses caller-supplied provenance, derives a generation token from the
normalized exact project/source binding, and checks that binding before and
after save, list, and load operations. Publication revalidates the applicable
owned original or linked binding around committing the payload and scalar
companion; loading requires that pair to agree and verifies the exact output
size and SHA-256. A different recipe revision can coexist, while an unbound
legacy record, replacement owned original, or changed linked binding is a cache
miss or refusal.

The reproducible preview cache records and bodies—including previews captured
while importing a linked original—are not project history, `.scape` media, or
managed handoff payloads. New video sources and maintained
read-write `.scape` imports keep their nullable preview locators clear;
maintained source-update commands cannot author them, desktop recipient binding
ignores old locator values, and managed source declarations omit them. The
nullable schema fields remain readable for old and opaque future documents.
Archive export includes only its canonical source assets, not derivative cache
entries. By contrast, rendered fallbacks and their referenced sources remain
durable project, retention, and portable-archive state under the fallback rules
below. The maintained exact-schema role-defined audio whole-mix fallback is
separately qualified for fresh-recipient managed acquisition and activation.
The maintained role-defined whole-project video render and one closed
videoEffects-only clip-target render relationship are separately qualified for
controller activation and bounded video delivery after their independent
route-specific relationship, source, and digest admissions. Other video fallback
and proxy relationships remain unqualified.

Posters and thumbnails are not editorial proxies. They provide no relink,
watch, freeze, export, decoder-isolation, browser-heap, or process-RSS guarantee;
those original/proxy relationships and decoder qualifications remain later
milestone work.

## Freeze and proxy fallback

Unavailable capabilities follow this order once their owning milestones land:

1. retain the editable source and opaque feature state unchanged;
2. show a named unavailable-feature placeholder and an explicit bypass state;
3. use a digest-linked frozen render or reproducible proxy when one exists;
4. keep relink/unfreeze information with the project; and
5. report every omission or fallback during interchange and delivery.

The maintained first-party audio- and video-effect bypass slices now implement
the first two steps for active known effects during editor playback only. The
exact-schema-9 mono/stereo role-defined audio whole-mix, role-defined video
whole-project, one first-party audio-effects track-target, and
one first-party video-effects clip-target slice implement
narrow forms of step 3 during editor playback and maintained delivery after
fresh operation-time integrity admission. The clip and track relationships are
durable publisher state, but Soundscaper does not create them. These slices do not freeze,
unfreeze, relink, watch, or refresh a fallback, and the bypass slices do not
generalize to unknown or third-party effects. Fallback authoring and selection
beyond the closed audio and maintained video roles, simultaneous fallback
delivery beyond the exact one-audio/one-video final-video composition, and
authored proxy workflows remain planned;
broad video-export and offline-render parity remain outside the bounded
video-delivery projection.

Video proxy relationships are owned by milestone 3. Canonical audio freeze,
unfreeze, commit, relink, and freshness semantics are owned by milestone 4. The
narrow playback and delivery relationships above do not supply those broader
document models, and their absence must not be hidden behind a compatibility
claim.

## Schema retirement

Schema migrations are not removed automatically because of age, file count, or
maintenance cost. The minimum readable version remains 1 until a separate
versioned policy change proves every condition in the machine-readable matrix:

- an offline upgrader handles the retiring schema without an account or network;
- the oldest retained fixture reaches the current schema and reopens at every
  required gate;
- at least two stable release cycles carried a published deprecation notice;
- compatibility documentation identifies the first unsupported release; and
- no state representable by the retired schema lacks a lossless current form.

The retirement change must preserve archived fixtures and the upgrader after
the in-product migration is removed. Telemetry is neither required nor used to
justify removal.

## Deferred compatibility backlog

These are recorded residual items, not milestone requirements. No current exit
gate depends on them, and none of them may be treated as an implicit
prerequisite without a deliberate scope change.

- **Versioned capability catalogue for forward opens.** Forward compatibility is
  currently decided from one monotonic `schemaVersion`: a newer raw project is
  structured-cloned and returned read-only with reason `newer-schema`, and a
  newer archive `formatVersion` is rejected outright. Neither decision consults
  what the project actually requires, even though `featureRequirements` already
  declares required capabilities and the report already resolves each one to
  `available`, `unavailable`, or `unknown`. A versioned catalogue of released
  capability sets would let an older or less capable build decide from those
  declarations whether it can open a project at all, degrade it to read-only, or
  refuse — instead of inferring capability from a version number that rises for
  unrelated reasons. This would also give schema retirement and the
  first-unsupported-release notice a machine-readable basis. Deferred: it
  expands the compatibility boundary and needs its own non-goals, refusal
  semantics, and evidence before any of it becomes a requirement.

## Change control

The compatibility matrix test checks the source schema constants, archive
format, retained migration list, evidence paths, fallback ownership, and
fail-closed forward behavior. A code change that strengthens or weakens one of
these guarantees updates the matrix, this document, fixtures, and the roadmap
status in the same atomic change.
