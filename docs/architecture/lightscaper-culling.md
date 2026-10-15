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
the pre-edit page order. At the last row, the current workflow reads the next
nonempty page through its still-valid cursor before saving, retaining at most
64 detached successor IDs. After acknowledgement it chooses the first surviving
captured successor in an authenticated fresh page. It never advances by a
post-sort array offset or admits new arrivals as old successors. Manual
selection/focus changes, an unrelated page, a changed query or a replaced
session fence the old edit's presentation effect. At the end of the query, or
when none of the captured successors survives, advance stops without wrapping.

The current selected Session has a separate indexed destination capability.
Within native read transactions it authenticates the current Photo, summary,
derived query row, catalog/index state and query membership, then derives the
destination's inclusive sort key. Saved queries additionally authenticate their
definition and state; collapsed queries retain their grouping audit and current
representative proof. The ordinary scanners issue fresh continuations. Existing
external cursor shapes and revision checks stay unchanged: an old continuation
cannot gain authority by having its revision replaced. Sparse matches and large
stack audits yield between bounded phases and join cancellation; seeking does
not collect a resident catalog or search again from page one.

The workflow pins its displayed page, query, selected saved definition and
collapsed mode before awaiting. Saved-definition, root-smart-definition and
grouping state fences are checked across the acknowledged edit. It publishes
one final page, preserving the current visible window when the successor still
fits there. At a page boundary it publishes a fresh window containing the
captured destination. Ordinary ratings with advance disabled also refresh the
plain page's continuation, so a prior edit cannot strand later auto-advance.
Lookahead or refresh failure preserves the durable save and pauses navigation.
Compare and Survey continue to review only their captured selected subsets.

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
menu admission.

The maintained pagination qualification imports 80 actual originals in 64 + 16
batches and checks plain, filename-ordered, saved metadata-filter and collapsed-stack
boundary advance in English and German. It covers continuation after an earlier
manual rating, removal from a saved query, skipped non-cover members, within-page
selection, subsequent ratings, reopened definitions and groups, and immutable
original digests. Index candidates and grouping checks share the bounded page
work budget, so a page can contain fewer than 64 visible photos. Focused current-V2
workflow tests cover changed definitions, held readers, manual interaction and
retirement without losing the acknowledged save.
Library stacks have their separate grouping and archive owners; per-photo
develop versions are not library groups. The full L3 keyboard loop remains
open until its remaining integration gates pass.

## Current RAW preview source

View → RAW preview source selects neutral Original by default and offers camera
embedded preview by explicit choice. This preference belongs to the current
Session generation and resets when that generation changes or the app reloads.
It affects the existing culling presenter, including thumbnails, filmstrip,
loupe, Compare and Survey. Develop, export and handoff continue to authenticate
the retained Original through their separate native-depth readers.

The camera producer authenticates the complete Original before and after native
preview extraction. An embedded JPEG retains its independent crop and extent;
the JPEG EXIF orientation and native RAW flip compose without rotating twice.
The image fits inside the Original-derived 512-pixel thumbnail or 2048-pixel
fit-screen target using centered nearest sampling and opaque-black padding.
Missing previews and explicitly unsupported bitmap representations fall back to
neutral Original only after native extraction and JPEG work have retired.
Corruption, cancellation and cleanup failures remain errors. The neutral
fallback samples directly from the Original extent without a second fit.

Both choices share the existing bounded scheduler: one active job, at most 64
queued jobs and 65 pending subscribers. Source changes cancel and join prior
presentation demand before another acquisition. The camera recipe includes the
immutable Original binding, requested source and pinned LibRaw/orientation/fit
policy; it has a distinct key from the permanent neutral recipe. Both reuse the
same paired payload/inventory storage, private Original-content token fence,
128-MiB capacity and 1024-entry limit. A warm cache hit needs no RAW worker.
No additional catalog schema, persisted probe row or durable preference is added.

The producer's conservative one-GiB admission includes borrowed/private Original
storage, the bounded native heap and embedded payload, JPEG planes and a reserve.
Preparation separately bounds its source backing, snapshot, output and Blob at
192 MiB. These are separate phase limits, not a whole-application heap claim.
Temporary native/JPEG planes are wiped and native owners are joined before the
final scoped consumer. The oriented culling frame is wiped when that callback
settles; the existing presenter owns the settled display surfaces.

The selected Lightscaper regression passes 3068 cases across 353 files. Four
English/German Chromium/Firefox workflows use the actual menu, selected library,
RAW worker and decoder with the exact pinned WASM fetch routed locally. The
independent native/JPEG oracles check the real Canon D60's 2048×1360 embedded
JPEG against its 3088×2056 Original, exact thumbnail/loupe pixels, cache reuse,
rating/flag saves, native RAW Develop and reload without changing Original
custody. Node tests additionally cover all 64 JPEG-EXIF/RAW-orientation pairs,
sequential no-preview fallback, stale bindings, cancellation, physical retirement
and Session Close during a held cache read. This does not qualify broader camera
support, external RAW asset publication or the remaining L3/L7 exit gates.
