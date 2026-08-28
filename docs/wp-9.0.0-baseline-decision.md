# WP-9.0.0 baseline decision

Status: approved for the `1.0.0-rc.1` candidate. Stable 1.0 admission remains
blocked on the outstanding Milestone 9 evidence.

| Field | Decision |
| --- | --- |
| Work package | WP-9.0.0 |
| Approver | Leo Wattenberg |
| Decision date | 2026-08-28 |
| Source commit | `PENDING_IMPLEMENTATION_COMMIT_SHA` |
| Source commit timestamp | `PENDING_IMPLEMENTATION_COMMIT_RFC3339_TIMESTAMP` |
| Candidate | `1.0.0-rc.1` |

The first-release project baseline consists of exactly two independent
identities:

- `{ schemaFamily: 'soundscaper', schemaVersion: 1 }`
- `{ schemaFamily: 'framescaper', schemaVersion: 1 }`

Neither family retains a migration source earlier than v1. Pre-release project
documents, archives, browser stores, desktop libraries, and project-coupled
native state remain untouched but unsupported by the candidate. A numeric-only
document raises the shared typed `REIMPORT_REQUIRED` error. An older build may
still be used to recover its bytes; the baseline provides no reader, migration,
cleanup, or rescue path for that data.

The first supported successor of either family must migrate from that family's
v1 baseline. A later version of the selected family and the other known family
receive opaque read-only custody, with byte-exact Save Copy for a retained
archive. Unknown or malformed identities fail admission.

Scape is frozen at `formatVersion: 1`, with the manifest project descriptor
repeating both identity fields. Family-less format 1 and every pre-release
format 2 archive require re-import. File suffixes remain routing hints and do
not override the archive identity.

This decision freezes schema and storage identity for the RC line. Later RCs
and stable 1.0 may correct implementation defects but may not introduce another
clean schema or storage break. It does not close signing, platform, hardware,
accessibility, security, licensing, or release-qualification rows; those remain
fail-closed under the release policy.
