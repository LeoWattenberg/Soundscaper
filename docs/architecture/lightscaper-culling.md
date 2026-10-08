# Lightscaper filmstrip and culling

Filmstrip is an opt-in View menu layout of the current library page. Auto advance
is an independent, initially disabled Photo menu choice. Neither adds a default
panel or toolbar. The grid and filmstrip share one set of row and canvas owners;
changing the layout must not mount a second preview set.

The shared selection controller retains at most 64 unique photo IDs, a selected
subset, and three optional IDs for focus, primary selection and the range anchor.
Each ID is an inert string of at most 256 UTF-16 code units. Page and session
generation identities are opaque comparison tokens, never traversed. Selection
is session-local presentation state, not catalog metadata or a persisted group.
Focus is separate from selection so Ctrl/Cmd navigation and native focus do not
collapse a multi-selection. Plain selection replaces the selected subset,
Ctrl/Cmd toggles one ID, Shift extends a page-local anchored range, and
Ctrl/Cmd+A selects only the visible page. Escape clears the selected subset.

The culling controller admits one pending single-photo edit and no queued keys.
It receives a scalar receipt only after the existing workflow has received the
durable repository acknowledgement. A saved receipt carries the page object
published by the workflow, or a `refresh-failed` notice if the subsequent query
refresh failed. Failed, cancelled-before-acknowledgement and busy receipts do not
advance. Cancellation after acknowledgement does not relabel a durable edit as
cancelled. A failed refresh preserves the successful edit and pauses advance.
While a query refresh is pending, the workflow keeps the prior page until it
publishes the final query page, or the acknowledged fallback after failure.
It does not publish an intermediate page that would invalidate the captured
identity. The auto-advance menu choice is disabled during a pending cull.
Observer exceptions cannot revoke published scalar state or hide the joined
durable save receipt.

Auto advance applies only to one selected photo. It captures successor IDs from
the pre-edit page order, then chooses the first surviving successor in the
acknowledged page. It never advances by a post-sort array offset. Manual
selection/focus changes, an unrelated page identity, or a replaced session fence
the old edit's presentation effect. At the last row, or when none of the captured
successors survives, it stops. It does not reuse a revision-stale continuation
cursor, restart at the first row, or silently select a row from a different page.
Page navigation remains explicit in this bounded slice.

Pause aborts the injected edit observer and joins its pending work. The workflow
continues to own database writes, the existing session, its lifetime and busy
authority. A replacement generation cannot admit another cull until the prior
operation settles. React retains at most 64 button references, releases them on
detachment, and observes scalar snapshots; it receives no catalog documents,
original media bytes, frames or preview bodies through this selection API.

## Compare

View → Compare selected photos captures two through 64 selected IDs in current
page order. It opens one reference and one distinct candidate; Previous/Next
walk the captured subset without wrapping or selecting new query results.
Swap exchanges the pair, and promoting the candidate selects the next captured
photo when available. Grid selection remains independent of review navigation.
Focused panes accept rating and flag shortcuts; their native form controls keep
their own keys. Ratings, flags and color labels use the existing catalog session.

One scalar Compare owner excludes queued gestures and captures page, query and
session-generation identities. A successful cull reconciles only its exact
acknowledged page, whether React publishes that page before or after the save
promise settles. Auto advance follows the captured candidate's surviving
successor. An unrelated page retires the pair; a new query, hidden library,
factory or backup-runtime loader retires the gesture and its callbacks.

A saved edit followed by failed refresh retains its durable acknowledgement
independently of page retirement. A fallback row grants no new Compare page
authority: the modal stays paused with the saved notice and a Close action.
Closing aborts and joins borrowed work; a late durable acknowledgement remains
saved without reopening the dialog. Reopening waits for the prior cull to settle.

Compare uses the existing pixel presenter in an explicit two-fit profile.
Ordinary thumbnails and loupe targets detach before the Compare pair attaches;
closing restores the user's opted-in ordinary previews. Once activated, the
same presenter stays mounted through view transitions, including hiding the
library, and joins an old body/stage before reading any new one.

## Survey

View → Survey selected photos captures two through 64 selected IDs in page
order and opens a review mosaic. One focused tile uses a fit-screen preview;
the other tiles use thumbnails. Left/Right changes focus without wrapping.
Ratings, flags and color labels borrow the existing catalog workflow. Native
form controls keep their own keys. Compare and Survey share a current menu
admission fence, including retained handlers invoked before React publishes
the first gesture, so they cannot create two active review dialogs.

Remove from review and Delete change only temporary review membership. They
never delete a photo, change grid selection, write a catalog group or persist
culling attributes. Removing the focused tile selects its next survivor, then
its previous survivor. One remaining photo stays reviewable; removing every
photo leaves the dialog open with Restore removed photos and Close. Restore
uses the original captured order and only IDs still available to this review.

An exact saved receipt reconciles the previous available survivors with its
acknowledged page. New matching query rows and captured photos excluded by an
earlier saved receipt cannot enter the review later. Local removals survive
both page-before-receipt and receipt-before-layout publication. Original
captured IDs remain bounded scalar provenance, not authority to restore a
filtered-out photo. A failed refresh retains the saved acknowledgement and
pauses review. Unrelated page, query, hidden-library, factory and loader
replacement retire the old gesture. Close cancels and joins borrowed work;
late saved receipts cannot reopen it.

## Memory and ownership

This slice adds only bounded scalar state and button references. It retains no
photo aggregate snapshots, history copies, Blob bodies or decoded frames. The
existing presentation owner remains the sole pixel owner: 64 thumbnail surfaces
at 1 MiB each plus one fit-screen surface at 16 MiB, for at most 80 MiB of declared
settled RGBA backing. Filmstrip changes layout rather than adding surfaces. The
existing serial preparation and presentation phases and their 112/272/336 MiB
accounting remain as documented in [preview presentation](lightscaper-preview-presentation.md).

Root composition owns the existing menu, App, panel, workflow and session port.
The new shared controllers own selection and receipt fencing; the focused React
hook owns button registration and scalar subscriptions. The current photo
command owner remains authoritative for revision-fenced persisted attributes.
No catalog schema, original custody, storage body format or runtime asset changes
are needed. A manual **Update AI assets** run is not required.

## Verification and remaining scope

Node tests exercise the 64-ID admission boundary, detached snapshots, modifier
selection, focused versus selected IDs, range anchors and page reconciliation.
Receipt tests cover failed/conflicted/cancelled saves, acknowledgement followed
by refresh failure, reordered or filtered pages, late receipts after manual
selection/page/factory changes, reentrant cancellation and the one-pending rule.
React and native tests cover StrictMode cleanup, focus delivery and keyboard
modifiers without changing preview ownership. Root menu integration tests use
real catalog/media stores in Chromium and Firefox, including a 65-photo boundary,
reopen and original digests. The existing three-engine raw canvas qualification
continues to cover the unchanged pixel route; it is not a WebKit storage claim.

Survey's maintained native menu workflow checks full mosaic pixel bytes after
each culling acknowledgement, temporary removal through zero survivors,
restoration, eviction regeneration, reopen and original custody. Its focused
Node tests exercise temporary removal, zero/one survivors, monotonic query survivors,
observer reentry, saved receipt ordering, stale callbacks and exclusive review
menu admission. Library stacks remain separate L3 work.
Library stacks need an explicit grouping contract, indexed
membership and archive/migration rules; per-photo develop versions are not
library groups. The full L3 keyboard loop and large-library CI budgets remain
open until their separate integration gates pass.
