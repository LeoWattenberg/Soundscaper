# Bounded photo batch rename presentation

The existing File > Photo menu owns Rename selected photos and Undo last batch
rename. Both operate on authored catalog display names. They do not rename
retained originals, files, extracted facts, media keys or develop versions. The
library and dialogs remain opt-in; no default control or second session owner
is introduced.

## Captured selection and preview

Menu activation freezes the selected IDs in their current page order, with at
most 64 entries. The dialog opens while the existing session reads one scalar
selection snapshot: catalog ID, photo ID, exact current display name and photo
revision. Full metadata and extracted facts never cross that reader. Changing
selection later cannot silently replace this captured batch.

The template, sequence start and padding fields are shared with import.
Planning remains in the product's synchronous planner. Explicit Preview admits
every expansion before any edit, preserving Unicode, case, extension spelling
and each selected sequence position. Editing a field invalidates the preview.
Apply uses that exact frozen plan; it does not reread names, retry conflicts or
renumber surviving entries.

## Receipts and bounded undo

The existing workflow owns one pending capture, rename or undo operation.
Cancellation stops remaining work and preserves known durable results. Failed
or unattempted entries cannot be described as renamed. Per-item failures remain
visible even when the batch's completion is finished. A refused plan retains
the dialog's recipe and captured snapshot.

The workflow retains the latest durable receipt before refreshing the library.
The old cursor is invalidated, and a failed refresh retains the changed names
and receipt with a refresh notice. A late abort cannot revoke a returned durable
result. Closing or replacing the factory aborts the observer and fences late UI
publication; the session still owns and joins native work.

Undo last batch rename uses only the remaining scalar inverse generated from
changed durable acknowledgments. Its names and revisions are compared before
each restoration. Failed, stale or unattempted inverses remain available;
successful restorations are removed. A pre-save failure or all-no-op rename
does not erase the previous inverse. A changed rename replaces it with that
batch's inverse. This is bounded restoration through ordinary photo commands,
without whole-catalog snapshots or batch redo.

## Presentation resource contract

| Owned presentation value | Bound |
| --- | --- |
| Captured IDs, snapshot rows, preview and result rows | 64 each |
| Snapshot and admitted plan | 256 KiB each |
| Receipt, including bounded failure messages | 1 MiB |
| Remaining inverse | 256 KiB |
| Template and each current or planned name | 256 UTF-16 units |
| Each failure message | 2,048 UTF-16 units |
| Combined scalar serialized-equivalent allowance | 2 MiB |
| Concurrent operations and queued requests | One active; no queue |

The sum of snapshot, plan, receipt and inverse caps is 1.75 MiB, leaving 256 KiB
for the recipe and ID list. JSON escape expansion belongs to the byte caps;
presentation does not serialize these values or allocate payload-sized JSON
copies. Immutable strings may be shared between detached scalar containers.
The allowance excludes DOM node and engine overhead. At most 64 DOM result rows
display the separately bounded names and messages. Opening another capture or
starting an admitted rename or undo retires the previous presentation receipt
before awaiting the next receipt; its remaining inverse survives. The dialog
and library display that receipt in one location at a time.

The product's existing one-photo document, history and writer budgets remain
separate. No metadata aggregate, original Blob, pixel buffer, decode request or
64-owner history inventory is retained by this presentation. Stop rather than
raise these caps if the maximal valid scalar fixtures or native workflow fail.

## Qualification

The 92 related Node and strict React tests cover explicit preview, draft
invalidation, Unicode, refusals, partial cancellation, remaining undo, factory
retirement, delayed initial focus and actual menu selection capture. Focused
strict TypeScript, lint and the editor-copy inventory pass.

Four production menu cases pass in English and German on Chromium and Firefox.
They verify exact retained source bytes, digests, identities and extracted facts
through preview, rename, undo, a peer's revision conflict and reopen. Every case
also verifies that no timeline editor-copy chunk is requested. All three product
builds pass their existing chunk and startup budgets after shared field and
semantic ownership extraction. WebKit catalog Blob and OPFS custody qualification
remains deferred. Other L3 library requirements retain their roadmap owners.
