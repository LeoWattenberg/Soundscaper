# Lightscaper photo library session

This L3 packet connects the durable catalog and original owners to a menu-owned
browser workflow. It adds no timeline controller or default workspace controls.
The product composition creates resources only after a library or import menu
request. Presentation receives a narrow shared port; product domain code does
not import React or UI modules.

| Resource | Bound |
| --- | --- |
| Displayed page | At most 64 scalar summaries; replacing pages never accumulates the catalog |
| Page cursor | At most 1 KiB of JSON; validated again by the catalog repository |
| Selected import | Existing admission: 64 files, 64 MiB per file, 512 MiB total before preparation |
| Import bridge | One prepared original at a time and at most 64 scalar selected-file outcomes |
| Keyword resolution | Existing 10,000-definition root and 1,024 memberships per photo; no original byte changes |
| Paging browser fixture | 65 copies of one sub-1 KiB 2 × 2 PNG in two gestures of 64 and 1; only one scalar page and at most 64 receipts remain displayed |
| Capacity regression fixture | One root up to 2 MiB, 7,000 virtual folders and three 3-byte originals; no camera media or unbounded catalogs |
| Culling attribute patch | Three optional scalar fields (rating, flag, color label), validated before storage; one acknowledged per-photo command |
| Active writer | One session mutation, protected by the shared catalog Web Lock |
| Photo history | One selected photo owner, 20 entries; switching photos releases the previous session history |

Preparation failures keep their selected-file indexes. Successful preparation
passes only the exact photo/original pair to managed publication; transient
decode artifacts are released rather than claimed as persisted preview tiers.
Source keyword facts remain immutable. Valid display names become catalog
memberships under the import's writer lease before photo publication. Names that
cannot fit the authored catalog remain in extracted facts and produce a notice.

Closing cancels and joins session work, then drains its optional preview scheduler
before closing both resource owners. Preview scheduler creation is lazy and
shared by the session; a UI factory replacement joins the old session close
before creating its replacement. Background preview requests reuse the same
owner as foreground edits without changing the foreground busy state. Only
original-free pixel descriptors/bodies and bounded scalar cache notices cross
the preview port; catalog custody bindings and raw storage errors stay inside
the product owner.
Reopening settles an interrupted managed import before exposing the catalog.
Storage failure is reported as failure and never presented as an empty library.

Culling flags and labels use the same selected-photo command owner as ratings.
The File menu owns their Photo submenu entry points. Each acknowledged change
preserves immutable original/source facts. With the default library view, writes
update its displayed scalar rows and invalidate the snapshot continuation.
An active query instead refreshes from its first candidate page after imports
and acknowledged attribute or metadata edits, so membership and global order
reflect the durable catalog. Empty candidate steps yield through cancellable
tasks. If that refresh fails, the acknowledged edit remains visible, the old
continuation stays invalidated, and the workflow reports the refresh error.
View refresh requests a new snapshot using the same active query.


The metadata packet exposes one explicit File → Photo → Edit metadata dialog.
Its outcome is an authored filename, description or capture-time edit over the
L2 read model, with a durable per-photo revision acknowledgment. Invariants are
unchanged original bindings, extracted source facts, and no file-system rename.
Acceptance covers strict closed patches before storage, revision conflicts,
failed-write retry, native menu editing and persistence after reload. This
packet stops at one-photo descriptive editing; batch rename, import presets,
relink and archive backup remain separate L3 packets.

| Metadata resource | Bound |
| --- | --- |
| Loaded document | One photo under the existing 2 MiB document limit; no original body read |
| Presentation | One immutable metadata/source-facts projection, at most 1 MiB serialized |
| Editable patch | Seven descriptive fields; field bounds come from L2 normalization |
| UI | One opt-in dialog and one form draft; source facts are read-only |

A dialog carries the photo revision it read. Publication reloads the current
photo under the writer lease and refuses a stale revision, including when a
selected-photo history owner was cached. The form reports only the acknowledged
snapshot. Capture time retains a nullable timezone offset; editing never invents
a timezone or changes decode orientation. Native datetime-local minute values
receive explicit zero seconds before the L2 timestamp validator; seconds and
fractional seconds already supplied by the browser are preserved. Authored filename changes update the
catalog summary only; the retained original name and bytes remain unchanged.

## Inspecting and restoring retained originals

File → Inspect and restore originals opens a lazy dialog and admits one explicit
inspection page. Each demand scans at most 64 committed roots, then the current
import's provisional roots through an explicit continuation. Pages replace one
another; no automatic catalog scan or original inventory runs at startup. The
scalar page stays within 2 MiB and its continuation within 2 KiB. Inspection
loads one canonical photo at a time and authenticates its actual retained body
against the immutable length and SHA-256 binding in slices of at most 4 MiB.

This opt-in operation can initialize the catalog before normal import recovery
succeeds. A published photo whose provisional root survives a missing media row
therefore remains inspectable. Ordinary library readiness still performs strict
recovery; inspection neither promotes roots nor retires an import intent.
Custody, permission, backend and unsupported-layout errors remain failures.
Only proven absent bodies or actual length/digest mismatches become missing or
damaged rows.

Restoration selects one missing or damaged row and one source File. The native
picker captures the exact page, target and factory generation before opening;
its change snapshots and rearms the input immediately. A stale picker result
cannot retarget a different photo. The selected filename does not replace the
retained original's name or the authored photo metadata. The product reloads
the catalog revision, active import, canonical photo revision and exact
immutable binding before the shared media owner reads selected bytes.

The shared repair authenticates the selection before staging and publishes the
new locator only while every retained root agrees on the captured private
identity, digest and size. A missing media row preserves the retained identity;
ordinary media publication cannot recreate a key protected by those roots.
Photo documents, extracted facts, develop state and other owners' custody are
unchanged. Repair leaves the previous locator in place for existing readers.

A body acknowledgement is independent of catalog readiness. The Session
returns its writer lease before the UI retries strict library recovery. Failed
or cancelled recovery cannot revoke a restored-body receipt. A failure releasing
the catalog lease after acknowledged repair produces a separate cleanup notice.
Close hides the dialog while its stable workflow owner continues. Cancel joins
native inspection, hashing, staging and publication; factory replacement joins
that work before closing the borrowed Session. Bounded page and receipt owners
are fenced separately so a new factory never adopts the old catalog's scalar
state from an operation-phase notification.
