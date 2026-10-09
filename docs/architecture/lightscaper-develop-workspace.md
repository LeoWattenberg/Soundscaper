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
The Develop menu and workspace presentation are a subsequent integration step.
