# Catalog backup presentation and destination lifetime

File > Back up catalog opens a lazy dialog. Opening it loads only the browser
save facade and the archive owner's streaming capacity; it does not open another
catalog session. Save stays disabled until those ports are ready. Its click calls
the shared save controller synchronously, so a native picker retains user
activation. The existing workflow supplies its one lazy catalog session only
after the destination has been selected.

One inert save controller belongs to the application workflow, outside the
dialog and session factory generations. There is one active save, no backlog,
one pending runtime load per generation, and one scalar receipt. Closing the
dialog cancels before commit and joins any destination cleanup; reopening cannot
start a second save while the first native operation remains unsettled. Factory
replacement joins that same barrier before closing the old session and acquiring
its replacement. A late completed save remains the caller's truthful receipt,
while the retired generation cannot publish it into the replacement UI.

The exporter releases its catalog writer lease when the complete archive has
been staged and verified. The prepared file handle is an independent destination.
The workflow's foreground exclusion continues through its final native commit or
abort, including the interval after the catalog lease has been released. Thus
another library mutation cannot begin while this application still owns the save
action. Cancellation after commit begins joins its acknowledgment; it cannot
revoke a successful commit.

The UI retains no original bytes, archive Blob, writable stream, or file handle.
Its receipt contains catalog ID (128 code units), catalog name (256), delivered
filename (512), safe integer counts/bytes, a closed method/status, and at most one
cleanup notice. This is below 8 KiB of serialized scalar state even when every
string requires six-byte JSON escapes. The runtime carries three callable/scalar
ports; the dialog has no resource owner. Archive buffers remain governed by the
[catalog backup contract](lightscaper-catalog-backup.md), including the owning
streaming maximum and 512 MiB browser Blob fallback. Displaying those capacities
does not allocate their bytes or add a UI copy of the archive.

Only a successfully committed direct destination is reported as saved. A browser
anchor delivery reports that a download started and asks the user to check their
downloads; it supplies no durable-save claim. Picker dismissal and precommit
cancellation produce no saved receipt. Destination failures remain visible in
the opted-in dialog. The `.liscape` output contains authored catalog documents
and retained originals; disposable previews are omitted.

Focused React tests exercise synchronous picker activation, held picker and
commit exclusion, joined cancellation and retirement, stale publication, dialog
close/reopen, lazy menu admission, and distinct saved/download statuses. Native
menu qualification passes for English and German downloads in Chromium and
Firefox, plus Chromium's joined picker cancellation and genuine native file
writer. The selecting boundary returns an OPFS handle; this does not automate
the operating system's picker UI. Each resulting archive authenticates through
the owning importer, preserves exact originals and authored metadata, and leaves
the resident catalog unchanged. These tests qualify export; their in-memory
archive destination does not prove a production durable catalog restore path.
