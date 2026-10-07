<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Default photo catalog initialization

The product-owned initializer uses one closed scalar settings pointer, at most
1 KiB, with `schemaVersion: 1`, `kind: photo-library`, and one catalog ID. It
uses only scalar settings and catalog lookups, one empty catalog creation, and
one pointer CAS per initialization attempt. It never inventories catalogs or
photos. Catalog roots retain their existing 2 MiB serialized-document limit.

The authoritative shared Web Lock uses the fixed `photo-library-default` ID,
so independent windows initialize one default library. Catalog creation must
commit before pointer publication. A failed creation acknowledgement can be
reconciled only by reading the same ID and finding the matching empty initial
root. A crash before pointer publication can leave an unreferenced empty root;
it cannot leave a pointer to an unpublished catalog.

An existing pointer is never reset: invalid or future schemas, a missing root,
or a root whose identity disagrees with the pointer fail closed. A pointer CAS
loser opens the validated winning pointer and catalog. Cancellation stops work
before pointer admission; an acknowledged publication returns its committed
root. A lost pointer acknowledgement is reconciled by reading its durable
winner. Lookup failures remain failures and never trigger replacement.

The caller runs import recovery after this initializer returns, under the
actual catalog's write lock. It must not nest catalog recovery inside the
initialization lock. This foundation has no UI or capability activation and
does not change assistance runtime bytes or inventories.
