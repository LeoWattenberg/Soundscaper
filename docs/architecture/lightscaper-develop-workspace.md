# Lightscaper develop history and snapshots

Each photo version may carry an optional `workspace` with its own version 1
contract. It contains ordered history entries, a selected-entry cursor, and
named snapshots. The existing `develop` field must equal the selected entry's
settings. A snapshot captures settings once; neither later edits nor restoring
the snapshot changes its captured content. Snapshots do not create virtual
copies, alter the active version, or donate original or catalog identities.

History entries carry a display label, UTC event time, and the complete shared
develop state. Legacy `set-develop` commands have no event clock, so their time
is explicitly `null`. New `record-develop` and snapshot commands require an
injected canonical UTC timestamp. No normalizer reads a clock or changes a
process version. Every retained state passes the owning develop normalizer,
including geometry, ordered effects, masks, and bindings.

The closed workspace validator refuses unknown fields, accessors, invalid
cursors, duplicate snapshot IDs, unsupported workspace versions, and unsupported
develop process versions. Clone and JSON parsing produce detached, deeply frozen
settings. Parsing checks the 2 MiB UTF-8 budget before decoding. Normalization
checks the accumulating entry and snapshot bytes before reading the rest of the
inventory, then checks the complete serialized workspace.

An edit discards the history after the selected cursor and appends one state.
Identical settings add no entry. History retains at most 100 entries and evicts
the oldest entries under the workspace byte budget. Named snapshots are never
automatically evicted: at most 100 may be retained, and an explicit deletion
releases one. If current settings and snapshots cannot fit, the command refuses
without mutating its input. The owning 2 MiB photo document budget also applies
across every version. Snapshot capacity or byte-budget failures require an
explicit deletion; they do not silently discard captured settings.

The command vocabulary is `record-develop`, `select-develop-history`,
`save-develop-snapshot`, `delete-develop-snapshot`, and
`restore-develop-snapshot`. Each accepts an optional version ID; omission selects
the active version. Selecting history retains redo entries. Restoring a snapshot
records an ordinary new history state. An existing settings or clipboard command
joins history after that version opts in. New virtual copies begin with the
source's current settings and their own independent workspace when first opened.

Commands remain drafts until the ordinary photo command owner receives the
repository's durable compare-and-swap acknowledgment. Failed writes preserve
the previous photo, history, snapshots, original digest, and revision. Whole-photo
undo and redo continue to restore the version workspace as authored state.
Closing and reopening discards session undo but retains version history and
snapshots in the photo row.

Legacy version records omit `workspace` when the field is absent, so their
canonical serialized bytes remain unchanged. There is no inferred migration.
Explicit workspace commands create an initial history entry from existing
settings. Future workspace versions are rejected rather than coerced to version
1; readers must preserve the surrounding archive through the existing opaque
Scape custody path when they cannot author its contents.

Scape photo packs serialize the complete photo document, including each
workspace, beside the retained original bytes. The normalizer validates the
workspace on import and restore. Deleting a virtual copy removes that version's
workspace; deleting a photo removes all of its workspaces through ordinary
catalog deletion. No separate store, original-asset publication, media
permission, or AI runtime closure is introduced by this model.

This foundation has focused tests for generated ordered stacks, history
branching, byte retention, detached snapshots, legacy serialization, version
isolation, durable reopen, failed publication, and actual Scape round trips.
The optional `PhotoLibrarySessionPortV1.develop` capability connects this model
to presentation. Its version 1 read packet selects one photo and optionally one
version. The result contains current shared-effect settings and scalar version,
history, and snapshot summaries; it contains no catalog document, original
locator, metadata donor, or media body. Reading a legacy version presents an
initial history entry without persisting a workspace or changing its revision.

Every mutation binds the expected photo revision and explicitly names the
target version (or the source version for a new virtual copy). The closed command
subset admits workspace actions and virtual-copy create, activate, rename, and
delete. It refuses metadata and attribute commands. Complete settings and
command text are validated and detached before lazy initialization or a write
lease. Complete normalized workspace commands also pass the 2 MiB UTF-8 byte
budget before acquiring those resources. The existing Session owns the single writer, cancellation, and retirement;
the facade creates no new storage or lifetime owner. A stale revision refuses
after the owning photo has reloaded, before any draft is published.

Read cancellation joins the borrowed repository read before refusing late
publication. Edits preserve the ordinary photo owner's durable acknowledgment:
if cancellation or Close arrives after the native save completed, the result
still reports the committed revision and settings. The apply result wraps the
snapshot in an acknowledgment with bounded notices: a lease cleanup failure
after persistence retains that snapshot and adds `cleanup-failed`. Failures
before acknowledgment still reject. Failed saves retain the
previous history. Focused Session tests cover these boundaries using the actual
catalog repository and held read/save completion. The Develop menu and workspace
presentation remain a subsequent integration step.

The scoped `withPhotoDevelopProxyV1` processor evaluates an already-oriented
preview derivative without reading an original or reapplying EXIF orientation.
Source admission is UNORM8 encoded sRGB, at most 2048 pixels per side and
16 MiB. Geometry may produce its natural crop/rotation extent, at most 4096
pixels per side, 8,388,608 pixels, and 32 MiB; it uses no Frame delivery canvas
or letterboxing. These are per-call bounds, not measured interaction budgets.

The complete normalized settings and source pixels detach before the first
await. Existing photo geometry runs first; the shared white-balance, tone,
and geometry effects then run in authored order. Geometry uses the dimensions
produced by the preceding stage. Each successful stage replaces and wipes its
predecessor, rather than nesting callbacks and retaining a frame per effect.
A staged copy is also wiped if its kernel cancels after the copy callback.
The processor captures the backing before the consumer can shadow its view,
and wipes it after consumer settlement, including cancellation or failure.

The final histogram measures the rendered bytes and follows the shared
visible-sample/clipping contract. Only scalar histogram data may outlive that
scope; output pixels are borrowed. Unsupported enabled operations and mask
bindings refuse explicitly. Disabled known effects remain in authored settings
without being evaluated. Additional global operations, mask evaluation, full
resolution zoom/export, workspace presentation, and latency qualification
remain outstanding; this processor does not mark the Develop milestone done.

The optional `develop.settings` capability provides the domain foundation for
Copy settings, Paste settings, Sync, Auto-sync, and relative quick Develop.
Its settings picker names shared effect types, legacy geometry, and whether
to include local adjustments. Excluding local adjustments selects only
unmasked instances and leaves the target's masked instances intact. A full
selection replaces the complete recipe. A partial selection replaces the
selected group at its first target position, preserving source order within
that group and target order elsewhere. An empty source group clears the
corresponding target group. Effect and mask ID collisions are remapped
deterministically, with bindings updated together. Masks used by retained
effects and independently authored unbound masks remain; masks owned only
by replaced effects retire. Repeating a paste does not accumulate masks.

Packets contain only normalized, process-versioned authored settings and
their selection. External raster/alpha mask references require a separately
authenticated adapter and refuse here. Imported packets cannot carry settings
outside their selection. Relative white-balance/tone edits add deltas to the
first enabled, unmasked instance, clamping at the shared parameter ranges;
other instances keep their order. If none exists, a new enabled instance uses
shared defaults. Zero deltas and unchanged pastes preserve revision/history.

Each batch binds the catalog, up to 64 unique photos, explicit versions, and
expected revisions. Admission detaches the entire request before initialization
and checks its 2 MiB byte budget. One existing Session writer/lease applies
one revision-fenced history command per changed photo; the batch is serial,
with explicit partial outcomes rather than an all-or-nothing transaction.
Conflicts and missing versions cannot overwrite a newer recipe or borrow the
currently active version. Other selected photos may still complete.

Every selected slot appears in a scalar receipt, including unattempted slots
after interruption. Only acknowledged or verified unchanged slots carry
revision/history cursor values; recipes and catalog documents do not enter the
receipt, whose UTF-8 bound is 64 KiB. Close and cancellation join a held save
and retain any durable acknowledgment. A separate cleanup error remains visible
even if cancellation also arrived. Menu integration and batch interaction
qualification remain part of the Develop workspace work.

The process-1 recipe and pure settings operations have one product-neutral owner
under `common/editor/imaging/`. Photo's existing types and functions are narrow
aliases; its serialized effect order, parameter defaults, geometry, masks,
bindings, packet kind, and scalar limits remain unchanged. The constants/types
contract is separate from normalization, so reading catalog limits does not
acquire the effect evaluator.

Full and partial preset bodies use the same selection and merge rules. A preset
contains an existing `VideoVisualPresetV1` identity with model kind
`adjustment-layer`, plus normalized selected settings. The identity's SHA-256
binds the complete canonical settings packet, including its selector and explicit
process version. Admission recomputes that digest, rejects unsupported fields
and external mask references, and detaches the body. JSON parsing checks the
2 MiB UTF-8 budget before interpretation; creation and serialization also bound
the complete wrapper. Renaming the identity does not reinterpret the settings.
Preset storage, menu entry points, and browser interaction qualification remain
subsequent workspace integration work.
