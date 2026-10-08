# Photo catalog organization

This bounded L3 packet adds opt-in catalog definition authoring and one-photo
memberships. The product owns admission, projections and durable commands;
common dialogs receive neutral ports and copy props. Application menu/session
composition remains root-owned, with entry points in the existing File/Photo
or View menus and no new default controls.

## Contract and budgets recorded before implementation

Definition reads retain one freshly validated catalog root of at most 2 MiB,
one selected definition and one scalar page of at most 64 immediate children.
Root/Up navigation retains no ancestor pages or depth cap beyond the canonical
hierarchy model. Create, rename, reparent and delete-empty-node commands use
the expected root revision and saveCatalog CAS. Collection updates preserve
manual/smart kind; deletion retains existing referenced-membership refusal.
No filesystem access follows virtual folder or keyword definitions.

Smart queries cross the UI boundary as JSON text limited to 2 MiB UTF-8 before
parsing. Existing normalization supports the complete all/any/not, rating,
flag, label, keyword, folder, file-name and capture-time grammar, with at most
256 nodes and depth 16. Reference IDs are visible in the organizer. Capture
intervals remain local wall time with inclusive from/exclusive to; no timezone
is invented. Invalid or conflicting edits retain their draft until explicit
reload. No scripts, regular expressions or reduced preset grammar are added.

The organizer presents ten immutable, valid JSON examples for the existing
node kinds and an immutable capture interval example. Syntax and property
names remain literal code; surrounding explanation is translated prose.
These examples explain the complete grammar and do not restrict the editable
JSON field to presets. Tests parse them through the canonical normalizer.

Authoring retains the admitted input string, current root, draft and bounded
validation/publication copies: a conservative 16 MiB envelope of equivalent
serialized payload, separate from engine object overhead. Each mutation performs one catalog CAS rather
than scanning photo documents. Existing reverse membership indexes own safe
deletion checks and the repository owns final document byte limits.

Memberships retain one canonical photo at most 2 MiB and its scalar authored
folder ID plus at most 1,024 keyword IDs and 1,024 manual collection IDs. UI
changes explicitly add/remove a selected definition or replace the folder;
unseen memberships are retained. Smart collection membership is evaluated
from its predicate and cannot be assigned manually. The expected photo
revision fences the injected, already selected PhotoCommandOwner; this packet
never creates a second owner. Existing savePhoto transactions validate current
root references and publish indexes together. Original custody, source facts,
develop state and unrelated authored fields stay under existing invariants.
The selected owner's existing bounded history is accounted separately.

Membership presentation resolves names only for its current at-most-64 IDs.
One app-owned shared controller reader serializes borrowed definition snapshots
across modal reopen, factory replacement, kind, offset and acknowledged-photo
changes, with one active read and at most one
pending demand. Obsolete pending demand is removed on abort; an active read
must settle before the next port call. Names retain at most 64 bounded scalar
strings (16,384 code units, at most 32 KiB of UTF-16 payload before engine
overhead), plus one transient neutral definition snapshot within the existing
document bound. No originals, media bodies or
ancestor pages are read. Missing/unreadable definitions use an explicit
failure label with their stable ID; successful labels display their names.

Admission refuses malformed/future/oversized commands and hostile getters
before initialization. Native cancellation uses the shared intrinsic signal
guard. Reads check cancellation after awaits; a durable mutation acknowledgment
is retained even if cancellation arrives before its continuation. Closing a
dialog fences late readers; drafts and selection IDs do not create pixel or
original-body resources.

## Validation and stop condition

Test first for every definition command, stale-root/photo conflicts,
membership deletion refusal, complete smart grammar round trips and limits,
getter/abort refusal before ports, late read cancellation and acknowledgment
after late abort. Pure React tests cover paged selection, explicit action
callbacks, full JSON editing, preserved memberships and busy/conflicting
drafts. Native menu workflows follow root composition and a stable build.

The native witness reuses the qualified 80-photo seed, imported serially in
64/16-file gestures. Its observer retains at most four photo documents and 128
catalog definitions, reads one retained original of at most 1 KiB at a time,
and independently hashes its exact bytes. Four English/German Chromium/Firefox cases have a fixed
120-second deadline and exercise actual menus, all ten smart query node kinds,
revisioned definition/membership publication, reload and source preservation.
The fixture compiles only to an in-memory routed module; browser diagnostics
use a distinct organization output directory and are not committed.

New source files stay below 550 lines and browser specs below 750. Focused Node
tests, strict TypeScript, changed lint, file-size and diff checks must pass.
Stop at the reviewed organizer/membership packet and root integration gates;
no bulk edits, culling/selection changes, RAW support or overall L3 completion
is claimed. Runtime engine bytes and inventories are unchanged, so no manual
Update AI assets run is required.
