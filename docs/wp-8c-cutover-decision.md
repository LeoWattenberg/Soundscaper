# WP-8+C cutover and permanent handoff decision

Status: approved and implemented for the family-v1 release line.

| Field | Decision |
| --- | --- |
| Work package | WP-8+C |
| Decision date | 2026-08-29 |
| Product topology | Separate origins: `soundscaper.org` and `framescaper.org` |
| Legacy population | None |
| Legacy retention | None; retire the old cohost immediately |
| Transfer lifetime | Permanent product route |

There is no legacy user population or retained pre-release storage promise to
migrate. The Soundscaper deployment therefore stops serving a Framescaper app
shell immediately. Its finite old Framescaper document routes redirect to the
equivalent Framescaper origin route; old worker URLs return not found, and no
worker tombstone, retention interval, removal date, telemetry, or legacy-store
enumeration is introduced.

The `/transfer/send/` and `/transfer/receive/` endpoints are not legacy
retention surfaces. They remain on both origins as the permanent transport for
the explicit File-menu cross-product action and for manual recovery. Transfer
never deletes or mutates the sender project.

The File-menu action creates an editable copy, not a schema-family relabel. An
exact owning family-v1 project remains byte-authoritative and unchanged. Each
new invocation mints a distinct destination-family v1 project identity;
retries of that invocation reuse the same intent and identity. The owning
family validates and reads its source, the destination family constructs and
validates the copy, and the ordinary bounded Scape v1 archive transport carries
the result as the destination family's `.sscape` or `.fscape` file.

Every persisted source root has one closed disposition: copy,
materialize-fallback, omit-with-report, or refuse. A conversion that cannot
authenticate or safely materialize a required root refuses before receiver
publication. A successful copy carries a closed report bound to the transfer
entry, archive SHA-256, and byte length, identifying the source, destination,
and each root disposition. The same report is verified before receiver
publication and saved beside a manual or desktop archive. Product-specific
visual-only state may be omitted from a Framescaper-to-Soundscaper copy only
when reported; timing authority that changes retained audio must be
materialized or refused.
Unsupported Soundscaper mastering, take/comp, or native-effect authority is
never silently presented as Framescaper-native editable state.

One canonical archive-bound companion JSON ledger is identical across live
transfer metadata, browser download fallback, matching manual import, and
desktop save. The receiver exposes that ledger only after it recognizes the
contract and either imports the exact bound archive or verifies the resident
project's closed invocation identity on an exact retry; failed, mismatched, or
unrecognized imports publish no report. A manually selected archive remains an
ordinary native archive when its companion is not selected; no conversion
ledger is inferred or exposed from an absent file.

Desktop conversion uses the same File-menu-owned progress task, exposes a
File-menu cancel action while active, and keeps the live edit lock. Browser
preparation flushes and releases the lock as the editor navigates to its
permanent sender route, so the launch intent is bound to the exact flushed
source revision and refuses if that revision changes before export. Cancellation
or failure never mutates either project library. An external archive may already
exist if its separate companion write then fails or is cancelled; that outcome
is explicitly reported as partial, names the saved archive, and requires the
visitor to retry the companion save.

This decision does not create a new Scape format or project schema version.
Family-v1 and Scape format version 1 remain frozen; the RC line may not take a
second schema, storage, or archive clean break. MIDI remains outside stable 1.0.
