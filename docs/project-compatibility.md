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

A deliberately narrow linked retained-video path is qualified at this same
boundary. A local binding joins the exact project ID, logical video source ID,
physical storage key, MIME type, byte length, SHA-256, and maintained
frame/sample/video geometry to an opaque locator ID and opaque locator
revision. Neither locator value appears in the project document. IndexedDB
database version 7 and the memory backend retain a closed scalar-only binding
record, including scalar source-shape fields, a compare-and-swap token, and a
canonical timestamp; they retain no linked body, `Blob`, filesystem path, URL,
platform handle, or playback lease.

With an explicitly injected platform port, a fresh document-only latest shared
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
media: an exact linked-session overlay supplies the body to the existing
managed original-video sender, which retains its normal aggregate preflight,
digest, bounded-transfer, and publication contract. This adds no product
chooser, relink or watch flow, durable operating-system handle or playback
lease, background copy/consolidation, or alternate publishing protocol. Linked
audio, every other linked or unmanaged original, authored proxies, generic or
video rendered fallbacks, packaged executable/UI behavior, and browser codec
playback remain unqualified.

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
schema 9 first-party audio whole-mix fallback solely through its feature
requirement. Explicit handoff publishes that fallback and the editable original
as canonical managed PCM; the empty recipient acquires both absent bodies and
the exact canonical shadow, remains intrinsically read-only, and activates the
transient fallback with exact engine samples and no missing source. Managed
acquisition verifies its descriptor and body SHA-256. The separate fallback
digest declared by the project manifest remains controller-owned after shadow
publication and before activation.

Recipient-local admission for unmanaged sources remains a bounded sequential
readability check, not an atomic snapshot, publisher authentication, or a
durable byte lease. Unmanaged audio is availability and geometry qualified, not
authenticated against a prior content digest. Selected metadata is reread
around each body, but body reads are not transactionally bound to that metadata;
same-metadata replacement during the sequential observations can go undetected,
and replacement or deletion afterward is not fenced. Injected
non-cooperative providers may continue work after cancellation rejects; shadow
save is not abort-atomic once begun; and separate repository instances and
processes are not serialized. Source-bearing saves and explicit local revision
loads bypass this admission. Explicit managed handoff supplies automatic
fresh-recipient acquisition for canonical PCM—including the maintained exact
schema 9 first-party audio whole-mix fallback—and retained original video.
Only the injected-port linked retained-video slice described above is also
qualified. Linked audio and every other linked or unmanaged original, authored
proxies, generic and video rendered fallbacks, product chooser/relink/watch
behavior, general copy/consolidate, managed-media
runtime cleanup beyond the startup-bounded tracked inventory, recipient-local or
whole-handoff capacity reservation, a stable byte lease through playback,
browser codec playback, packaged executable and UI two-product source-bearing
handoff, portable hard-link capacity qualification, and a shared cross-product
revision journal and undo/redo history remain unqualified.
Product-local bounded revision history is the only history proven by the
composed return fixture.
Rendered-fallback digest verification remains controller-owned after repository
shadowing and before activation side effects.

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
library; this includes a maintained exact-schema first-party audio whole-mix
fallback when its manifest is the only reference. Ordinary saves remain
document-only. Only the injected-port linked retained-video slice described
above is additionally qualified. Linked audio and every other linked or
unmanaged original, authored proxies, generic and video rendered fallbacks,
general copy/consolidate, product chooser/relink/watch behavior,
managed-media runtime cleanup beyond the startup-bounded tracked inventory,
recipient-local or whole-handoff capacity reservation, stable playback leasing,
executable/UI and browser-codec qualification, portable hard-link capacity
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
root-level `featureRequirements` value is a bounded, normalized manifest with a
closed manifest version, canonical namespaced feature identifiers, unique
requirement IDs, closed bypass or rendered-fallback dispositions, and bounded
display strings. A rendered-fallback descriptor must reference an existing
project source of the declared audio or video kind and carry a canonical
lowercase SHA-256 string. That validates descriptor syntax and source identity;
it does not hash or authenticate the referenced media bytes.

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

The maintained exact schema 9 first-party audio-effects rendered fallback is a
separate, narrower playback projection. It activates only when exactly one
registered `audioEffects` report item is unavailable with declared and effective
`rendered-fallback` dispositions and its audio descriptor exactly matches the
canonical manifest. The referenced source must be mono or stereo, cover a safe
positive frame range, and match the project sample rate and master channel
count. ADM and surround projects, ambiguous candidates, descriptor drift,
missing sources, unsafe geometry, and collisions with the reserved synthetic
track or clip IDs reject rather than guessing.

On explicit desktop handoff, manifest reachability retains this fallback even
when no timeline or Project Bin clip references it. A real Soundscaper sender
publishes the canonical original and fallback PCM, and a fresh Framescaper
recipient acquires both exact managed bodies plus the canonical project shadow.
That transfer authenticates each managed descriptor and body digest; the
controller then separately verifies the manifest fallback digest before
read-only activation. The engine alone receives the synthetic whole-mix
projection and exact fallback samples, while the document snapshot remains the
publisher's canonical project.

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
The canonical project, history, persistence, save, export, and offline-render
paths never receive this projection.

Deeply frozen per-tab and document-snapshot metadata drives one localized
active-during-editor-playback indicator bound to the exact report requirement;
the UI does not read or expose the source ID or digest. This narrow slice is not
generic fallback selection and does not activate video, unknown, or third-party
requirements.

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
This exact-schema-9 slice does not attempt compatibility with earlier
Soundscaper project schemas.

For an incompatible active document, the maintained active workspace consumes
`featureRequirementsCompatibility` directly and derives a separate frozen
structured notice containing only unavailable and unknown requirements. A
persistent, non-dismissible document-level localized region shows recomputed
counts, bounded display names, stable feature IDs, availability, and the
declared disposition while that active tab is selected; the effective
disposition remains structured metadata rather than being mislabeled as the
declaration. The region is keyboard-focusable when its bounded list scrolls.
It does not render the evaluator's message, read fallback internals, expose an
activation control, or claim generic rendered-fallback substitution or
third-party loading. For the exact first-party audio rendered-fallback slice it
shows only the metadata-bound active-playback indicator described above. For
qualifying audio- or video-effects items with bypass metadata, the same notice
matches the corresponding frozen projection metadata to one requirement and nests
persistent localized, control-free affected-effect placeholders. Audio rows use
the maintained effect label and canonical track, group, send, or master owner;
video rows use the maintained effect label and canonical Timeline or Project
Bin clip owner. Neither inventory reads effect payloads. A compatible or `null`
report produces no notice, tab switching follows the per-tab report, and the
workspace never traverses future-schema `featureRequirements` state.

Raw and stored-project controller activation has a separate integrity admission
step for exact schema 9. It verifies the authoritative project that would be
activated, including existing same-ID tab history, before project-generation
invalidation, recording or engine shutdown, lock changes, session publication,
ordinary engine-source loading, or normal activation persistence. Admission
reads explicitly disable on-access PCM migration scheduling and retained-media
digest claim/backfill, so verification itself does not publish storage
maintenance. Audio fallbacks are read from their local `storageKey` and hashed
as the canonical
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

This is a point-in-time guarantee at the maintained controller admission
boundary, not a durable byte lease. Calling `store.loadProject()` directly does
not verify fallback bytes, and admission does not continuously bind them against
a later low-level source replacement or establish publisher authenticity.
Admission itself does not substitute fallback media at runtime; the separate exact-schema-9
first-party audio whole-mix projection described above performs the narrow
editor-playback substitution. Initial required-source preparation is
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
provide generic
per-feature bypass controls, generic or video rendered-fallback substitution,
ADM or surround fallback playback, export or offline-render substitution,
future-schema preservation, earlier Soundscaper-schema compatibility, or a
complete third-party activation gate.

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
the normalized manifest and its evaluation semantics. When a copy import
rewrites colliding source identity, it rewrites the known fallback descriptor
reference through the same mapping while preserving the digest.

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
third-party feature activation. After archive acceptance and import, the
separate maintained controller admission described above verifies the local
bytes referenced by the authoritative exact-schema-9 activation project. That
does not make metadata-only inspection a body-verification route and does not
cover direct store loads. Runtime use belongs only to the separate first-party
audio whole-mix editor-playback slice; generic and video fallback remain
planned. The remaining outcomes stay governed by the planned compatibility
rows and roadmap exit gate.

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
timestamp, and a versioned recipe. Publication revalidates the current original
before committing the payload and scalar companion; loading requires that pair
to agree and verifies the exact output size and SHA-256. A different recipe
revision can coexist, while an unbound legacy record or replacement original is
a cache miss.

The reproducible preview cache records and bodies are not project history,
`.scape` media, or managed handoff payloads. New video sources and maintained
read-write `.scape` imports keep their nullable preview locators clear;
maintained source-update commands cannot author them, desktop recipient binding
ignores old locator values, and managed source declarations omit them. The
nullable schema fields remain readable for old and opaque future documents.
Archive export includes only its canonical source assets, not derivative cache
entries. By contrast, rendered fallbacks and their referenced sources remain
durable project, retention, and portable-archive state under the fallback rules
below. The maintained exact-schema first-party audio whole-mix fallback is
separately qualified for fresh-recipient managed acquisition and activation;
generic and video fallbacks remain unqualified.

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
exact-schema-9 mono/stereo first-party audio whole-mix slice implements a narrow
form of step 3 during editor playback. It does not create, freeze, unfreeze,
relink, export, or offline-render that fallback, and neither behavior
generalizes to unknown or third-party effects. Generic and video fallback or
proxy use remains planned; video export and offline render remain outside the
video preview bypass.

Video proxy relationships are owned by milestone 3. Canonical audio freeze,
unfreeze, commit, relink, and authored rendered-fallback document state are
owned by milestone 4. The narrow playback-only projection above does not supply
those document models, and their absence must not be hidden behind a broader
compatibility claim.

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

## Change control

The compatibility matrix test checks the source schema constants, archive
format, retained migration list, evidence paths, fallback ownership, and
fail-closed forward behavior. A code change that strengthens or weakens one of
these guarantees updates the matrix, this document, fixtures, and the roadmap
status in the same atomic change.
