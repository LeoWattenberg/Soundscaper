# Photo catalog query workflows

This bounded L3 packet connects committed catalog queries to an opt-in View
menu dialog. It adds product-owned scalar query and definition projections,
and common UI dialogs receiving neutral ports and explicit copy props. Session,
workflow, application menus and resource lifetimes remain composition-owned.

## Contract and budgets recorded before implementation

One query step visits at most 64 indexed candidates and returns at most 64
scalar rows, with a strictly validated continuation of at most 2 KiB. Literal
search is at most 256 code units after folding. Sorting uses the committed
global indexes for photo ID, filename, capture time and rating, in either
direction; unknown capture times remain last. The dialog exposes text and one
existing scope or attribute filter. Compound predicates remain the complete
smart collection grammar; this packet does not replace it with presets.

Composition drains only empty nonterminal query steps, serially, checking
cancellation and yielding an actual browser task between persisted steps. It
stops at the first nonempty candidate page or a null continuation, never drops
overflow while trying to fill a display page, and retains only one page and
cursor. Stale, foreign and future continuations are errors; restarting a query
requires an explicit user action.

Query migration runs only after explicit Build/Resume index demand. Each
persisted step reads at most 16 source documents and 8 MiB; composition yields
and checks cancellation between steps. Opening the product or dialog does not
start an automatic whole-catalog migration.

Definition selectors retain one page of at most 64 scalar rows, one selected
row, and one current-parent row. Root/Up navigation supports every legal
hierarchy depth without accumulating ancestor pages. Definition continuations
are at most 1 KiB and bind kind, parent, catalog and root revision. Selection
and parent labels come from the same freshly validated root as the page.

The repository's existing bounds admit one canonical root at most 2 MiB, one
candidate query row at most 512 KiB and presented summaries at most 256 KiB;
engine object overhead is separate. No original bytes or pixel bodies enter
these dialogs. The literal text draft remains editable while a probe or
publication is pending; Apply and Build remain disabled until acknowledgment.
Closing or changing a selector aborts its request and fences
late results; errors remain visible until explicit reload.

## Validation and stop condition

Test first for global ordering, live smart membership, sparse pages,
continuation refusal and cancellation; exercise more than 64 definitions,
nested navigation, late completion and revision conflicts. Pure React tests
cover submit/cancel and bounded selection without product imports. Native
Chromium and Firefox menu workflows follow stable composition and its build;
storage-independent dialog behavior may also run in WebKit.

The native menu witness seeds exactly 80 photos in two admitted gestures of
64 and 16 genuine, small PNG Files through shared preparation and managed
custody. It creates 70 root folders and one nested folder, one keyword and
manual/smart collections, with deterministic authored query facts. Test-only
derived-index invalidation visits at most 128 keys in one isolated catalog;
observation reads at most 64 selected photos and independently hashes their
retained original Blobs. Native setup has a fixed 90-second test deadline and
never mutates built output or production storage APIs.

All new source files stay below 550 lines and browser specifications below
750. Focused Node tests, strict TypeScript, changed lint, file-size and diff
checks must pass. Stop after this packet and its composition validation;
organizer authoring, memberships and the full smart-query editor are separate
atomic work. No overall L3 completion or new decoder capability is claimed.
