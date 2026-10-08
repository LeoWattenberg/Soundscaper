# Photo library diagnostics

The L3 synthetic catalog contains 20,000 photo documents, generated in the
repository's existing 16-document publication batches. Every document refers
to the same digest-pinned 163-byte, 2 by 2 PNG original. The generator admits
that exact source geometry, digest and byte length, one initial master version
and a revision-zero template. Each fixture document is limited to 16 KiB,
giving a 256 KiB serialized document bound per publication batch, separate from
engine object overhead. It never retains a whole catalog of documents.

Photo and master-version identities derive from the zero-based fixture index.
Display filenames run in reverse index order. Ratings, flags, color labels,
local capture times with unknown offsets, and folder/keyword/manual-collection
memberships have deterministic distributions. One search title occurs only in
the last photo, beyond any initial presentation or candidate page. The same
fixture therefore exercises global ordering, sparse search and indexed filters.

Native setup retains real original custody and publishes catalog rows through
the production repositories. It may reuse the already decoded original during
fixture construction; that setup time is separate from the measured ordinary
managed-import gesture into the populated catalog. Tiny repeated media isolates
catalog scaling. It does not measure large-image decoding, heterogeneous camera
formats, representative working sets, raw processing or hardware performance.

The browser diagnostic exercises the existing opted-in library and menu query
workflows. Correct result identities, original digests and finite publication,
candidate and presentation page counts are blocking correctness measurements.
Import, scroll, filter and search timing observations describe only the browser
and runner actually measured, using one attempt and no retry-to-pass. The
quality register owns thresholds; timings remain observational under the
existing quality-diagnostics policy. The fixture alone does not close L3.
