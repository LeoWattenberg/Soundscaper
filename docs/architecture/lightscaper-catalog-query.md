<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Bounded catalog queries

This L3 packet adds globally ordered text, attribute and live smart-collection
queries. It does not add presentation, full-text ranking, pixel processing or
new original custody. Photo and Scape documents retain family version 1.

Budgets recorded before implementation: a query step visits at most 64 rows and
returns at most 64 existing 4 KiB summaries. One derived query row is at most
512 KiB; one continuation is at most 2 KiB. The current root is at most 2 MiB.
Evaluation retains one candidate and its normalized projection plus the root
and output page, never an array of source documents or a catalog-wide result.
These are serialized payload bounds, not an exact JavaScript heap prediction.
The existing smart-query bound remains 256 nodes and 16 levels.

Database version 2 adds metadata-only query rows and resumable build states.
Ordered compound indexes cover photo ID, folded filename, local capture time
and rating, with photo ID breaking ties. Capture queries visit the known-time
bucket before the unknown-time bucket in both directions. They compare local
wall time without inventing missing timezone offsets. Literal case-insensitive
text search covers authored filename, title, caption, creator and location and
assigned keyword names. Individual fields cannot create cross-field matches.

Every step closes its transaction before returning. Sparse queries may return
no matches with a non-null continuation. Consumers continue with cancellation
and task yields; they do not interpret an empty step as collection exhaustion.
Continuations bind the exact query, catalog/index revision and ordered cursor.
Changed photo or root state requires a fresh enumeration.

The schema upgrade creates stores without scanning photos. Existing catalogs
refuse new queries until a resumable rebuild completes. One rebuild transaction
processes at most 16 photos and 8 MiB of validated document bytes, retaining at
most one source document and one derived row. Progress and rows commit together.
An over-budget next candidate remains for the next step. Normal publications
and edits maintain query rows atomically, including while rebuilding, so writes
behind a persisted cursor cannot disappear. Original bytes and documents are
not rewritten. Legacy ID-order summary pages remain supported; a smart filter
cannot pretend to be an empty manual collection.

Build state keeps a scalar indexed-row count. A point lookup distinguishes new
rows from edits; the row and count change in the same transaction. Final
readiness compares that scalar with the catalog photo count and performs no
catalog-wide count scan. Root reads use the canonical 2 MiB document validator.

The deterministic native fixture has 100,000 photos with crossed ID/name/time/
rating order and sparse matches. Its first, distant and sparse steps target a
250 ms p95 bound, and count delivered rows and forbidden aggregate/full reads.
Setup directly seeds at most 1,000 template-derived rows per transaction, each
below 2 KiB and at most 2 MiB together; independent goldens prove equivalence to
production photo projection. Setup timing is reported separately from queries.
This fixture qualifies query indexing, not the complete L3 import/scroll soak.
Stop when focused correctness, transactional migration, native scale, strict
TypeScript, changed lint and size gates pass. If the target fails, stop for
reassessment instead of raising it or replacing global order with page sorting.

Substring and arbitrary Boolean predicates use bounded ordered scans. Their
total cost can be linear in catalog size; a later measured need may justify an
inverted text index. This packet does not claim constant-time arbitrary search.
No manual **Update AI assets** run is required.
