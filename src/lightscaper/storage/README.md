# Photo media storage

`PhotoMediaStoreV1` owns one durable shared-media database connection, one
retention session, and one OPFS repository for the Lightscaper origin. It uses
the existing shared storage version 2 without constructing a timeline project
store. The default database, OPFS directory, and worker names are independent
Lightscaper namespaces. Test overrides retain the `lightscaper-` prefix and use
at most 128 ASCII letters, digits, dots, underscores, or hyphens.

Its frozen media port exposes original writers, loaders, scalar metadata,
explicit deletion, and catalog custody. Derivative and inventory APIs require
a separate product owner with its own work lifecycle.

| Boundary | Budget |
| --- | --- |
| Database opening | One shared pending attempt; a failed attempt permits a later retry |
| Backend | Durable IndexedDB required; unavailable or denied storage never falls back to process-local media |
| Original verification | One metadata lookup by immutable original storage key; compare trusted SHA-256 and exact byte length, with cancellation checked before and after the lookup |
| Catalog custody | Shared scalar roots remain at most 2 KiB; mutate at most 16 roots per transaction and read indexed pages of at most 64 rows |
| Import journal | One scalar active-import pointer per catalog, at most 1 KiB; its importing owner enforces the shape and size and serializes import/recovery with the authoritative project Web Lock |
| Close | One terminal promise; synchronously refuse new admission, abort and join admitted media work, join admitted settings/verification calls, release the retention session, close OPFS, and close the actual database connection |

Opening is lazy; `ready()` explicitly opens the database and acquires its
retention session. Close during an open waits for the opening result and closes
any resulting handle. A blocked request's late success is closed by the shared
database opener. A version change starts the same terminal close lifecycle and
requires a new owner instance. Cleanup continues after individual failures and
reports all failures after attempting every resource release.

The exposed settings port has scalar get, put, delete, and exact-value CAS
operations, with no inventory operation. Publication remains the import owner's
responsibility. This composition adds no UI, capabilities, decoder, or engine
behavior, and does not require a manual **Update AI assets** run.
