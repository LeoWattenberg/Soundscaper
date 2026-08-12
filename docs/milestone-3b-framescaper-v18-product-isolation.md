# Milestone 3B-6c-c1: Framescaper V18 product isolation

> **Contract only — production selection is not authorized.** Dormant c-c0
> supplies an exact physical namespace token, and implemented dormant c1a
> freezes the non-capability runtime identity around it. Every maintained
> project, archive, controller, compatibility, and desktop owner still uses the
> shared exact-V17 runtime. This packet defines the indivisible Framescaper
> transition that must precede durable proxy storage. Soundscaper remains exact
> V17 and is not modified by this packet.

## Stop condition and atomicity law

Today the web bootstrap passes only `productId`; the controller always creates
the default store and injects the global V17 constructor and migration owners.
The current schema aliases, command/history validation, session admission,
retention, `.scape` format 1, and product-neutral desktop v9 library are shared.
Selecting only c-c0 storage would therefore create a V18-named store driven by
V17 semantics. Raising any global current constant would instead change
Soundscaper.

**There is no safe schema-first or storage-first production rollout.** Only an
unreachable opaque profile token may land independently. Its first maintained
selection must atomically bind V18 project semantics, c-c0 storage, archive,
compatibility, retention, repository, controller, and desktop v10. If that
composition cannot land and fail closed together, stop before selection.

## One authenticated runtime profile

Add one generic strict owner at
`src/common/editor/project-runtime-profile.ts`. It exports an opaque
`EditorProjectRuntimeProfile`, a descriptor-snapshotting creator, and an
identity-authenticating internal resolver. Tokens are fresh, frozen,
null-prototype, zero-key objects held by a private `WeakMap`. The resolver does
the private lookup before inspecting public data; clones, spreads,
serialization, structured clones, and Proxy wrappers refuse with zero traps.

The closed definition contains literals and authenticated child tokens, never
generic callbacks or independently selectable booleans:

```ts
{
	owner: 'framescaper';
	projectSchemaVersion: 18;
	storageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE;
	priorSchemaPolicy: 'reimport-required';
	futureSchemaPolicy: 'opaque-read-only';
	scapeFormatVersions: readonly [1, 2];
	attachedScapeFormatVersion: 2;
	desktopLibrarySchemaVersion: 10;
	desktopProjectSchemaVersion: 18;
	desktopDatabaseUserVersion: 12;
	desktopLibraryScope: readonly ['kw.media', 'scape-project-library', 'v10'];
	capabilityProfile: /* authenticated Framescaper-only capability token */;
}
```

The exact product-owned singleton lives under `src/framescaper/` and is not
barrel-exported. It composes the exact c-c0 storage token. Equal definitions do
not grant the singleton's selection authority. That identity is process-local
and JS-realm-local; it is never serialized, cloned, or sent over IPC. Each
Framescaper main, preload, renderer, worker, or browser realm owns or receives
its own maintained singleton through its composition root. Cross-realm
agreement uses a separate closed, versioned handshake whose exact owner,
schema, archive, storage, and desktop contract literals are authenticated at
both endpoints before either side performs non-handshake operational I/O or
mutates state.

The independently landable contract-first precursor is the
[dormant Framescaper runtime-profile
prerequisite](milestone-3b-framescaper-runtime-profile-prerequisite.md),
implemented in `13f80172` on 2026-08-12. It freezes the fields above except
`capabilityProfile` around the exact c-c0 token, but remains a separate
non-selectable type with no maintained consumer. No authenticated Framescaper
capability owner exists yet, so the final runtime profile remains deferred
rather than accepting a structural placeholder. Its eventual creator must
authenticate and retain the exact prerequisite and capability-token
identities; a copied or reparsed prerequisite definition grants no authority.

## Selection and non-interference

The first selector is a Framescaper-owned bootstrap adapter. It supplies the
one exact token once, before store, session, controller, archive, lock, file,
or desktop construction. Shared owners may consume the authenticated resolved
profile, but must not infer it from `productId`, routes, URLs, globals, or
ambient product state. `/en` and every Soundscaper/ordinary test path must not
import the Framescaper singleton. An absent or exact `undefined` profile keeps
all existing V17 behavior byte-for-byte.

The composed controller derives every child boundary from the captured token.
An explicit project/storage/archive/desktop/capability override, a structural
product object, or a store/bridge carrying another profile refuses
synchronously before any IndexedDB, memory, OPFS, worker, lock, archive body,
file, operational IPC, or controller side effect. Locally visible mismatches
refuse with zero calls. A remote main/preload/renderer/worker mismatch may use
only the bounded version-handshake IPC needed to discover it; after refusal it
has made zero operational IPC calls and no document, body, file, store, or
controller mutation. Internal copies retain the same token identity.

Do not change the meaning or value of the global
`AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION`, `project-current.ts` aliases,
`migrateAudioEditorProject`, `SCAPE_FORMAT_VERSION`, global project-feature
capability map, desktop v9 constants, or existing `[mvt]` managed-media
grammar. A proxy capability enters only the authenticated Framescaper
capability profile; adding it globally would make it known in Soundscaper.

## Exact Framescaper V18 semantics

The selected profile owns separate V18 create, clone, load, validate, migrate,
runtime, command, and history functions. V18 is the closed additive successor
of V17 described by the durable proxy contract. New projects are exact all-null
V18. Exact V17 returns typed `REIMPORT_REQUIRED` before traversing nested data;
there is no migration. V19 and later are descriptor-snapshotted opaque
read-only documents. Soundscaper continues to create and edit exact V17 and to
treat V18 as its existing future read-only schema.

Every maintained V18 consumer in one JS realm receives the same authenticated
profile:
new/open/switch/clone/history, command reconciliation, compatibility,
save/load/duplicate, Scape inspect/import/export/copy, retention and cleanup,
project locks, and desktop handoff. Generic V17 save/create/duplicate/shadow
paths must never introduce or change a proxy pointer.

## Archive, retention, and publication

The profile owns the project document binary codec as well as the envelope.
All-null V18 may use format 1; a non-null attachment requires format 2, and
format 2 requires exact V18. Format 1 plus an attachment, format 2 plus another
schema, and formats above 2 refuse during manifest/project inspection before
body reads. Cancel remains metadata-only and writes nothing. Format 2's proxy
and timing bodies use the claim-authenticated preservation transaction from the
durable V18 contract; the current sequential import plus generic publication
path is not admissible.

Profile-aware V18 retention roots proxy and nested timing bodies across current
and retained revisions, every tab history, pending saves, and provisional
claims. Do not teach the global V17 collector to interpret a same-named opaque
source member. Generic save, create, duplicate, archive, and shadow publication
require a repository-authenticated one-use preservation plan before reproducing
a non-null pointer.

The atomic controller gate and durable adoption transaction remain as defined
by the V18 contract: block commands, undo/redo, open/new/switch/close/delete,
autosave, source/relink/reprobe mutation, teardown, and competing attachment
work; drain saves and recapture the exact base. After durable commit, install
history, tab compatibility, document, `readOnly`, and `intrinsicReadOnly`
before engine work, publication, or gate release. A post-commit fault is a
committed reconciliation/cleanup result, never rollback.

## Desktop isolation

Framescaper V18 uses a separate desktop v10 host, path, database, IPC/preload,
renderer contract, metadata 10, project schema 18, database `user_version` 12,
and managed proxy `p…` binding grammar. It rejects non-Framescaper owners and
V17 documents. Existing product-neutral v9/schema17/user11 files, constants,
scope, services, and `[mvt]` grammar remain unchanged. A v10 renderer with a v9
main process, or the reverse, refuses before document or body mutation. This
packet claims only fresh Framescaper-to-Framescaper handoff, not cross-product
V18 transfer. The main, preload, and renderer do not compare opaque token
identity across realms; each authenticates its local singleton and completes
the same closed versioned v10 handshake before document, body, file, or IPC
publication.

## Strict RED order

Before production, prove:

- exact token exports, closed descriptor traversal, frozen zero-key identity,
  authenticated child tokens, detachment, and exhaustive forged/cloned/Proxy
  refusal with zero getter/trap execution;
- the exact Framescaper singleton owns every literal and has no maintained
  consumer before the atomic selection commit; no Soundscaper entry/build,
  common product profile, barrel, or ambient `productId` path imports it;
- omitted/undefined profile snapshots preserve V17 creation, migration,
  validation, format 1, default storage, capabilities, and desktop
  v9/schema17/user11 behavior exactly;
- one selected profile yields new all-null V18, typed V17 re-import before
  nested traps, exact all-null V18 writable, attached V18 intrinsically
  read-only while `videoProxy` remains unavailable, and opaque V19 read-only,
  while the same Soundscaper cases remain unchanged;
- every locally visible profile/product/store/bridge or explicit child
  override mismatch refuses before any store, OPFS, lock, archive, IPC, or
  controller call; a remote mismatch performs only the bounded handshake and
  then refuses with zero operational calls or side effects;
- the complete format-1/format-2 schema/attachment matrix, cancel-with-zero-I/O,
  descriptor tamper/orphan refusal, body claims, rollback, and preservation;
- command/history/clone/session/repository/retention roots and protection see
  the exact token, including histories, pending saves, and claim inventory;
- same-origin database/memory/OPFS/worker/lock separation and independent
  clear/prune/reconcile, while quota remains explicitly origin-global;
- desktop v9 remains byte-exact; v10 enforces owner/schema/scope/database/role
  identity and rejects every mixed renderer/main or V17/V18 pairing; and
- one static/composed reachability audit proves every maintained V18 boundary
  in each realm receives that realm's authentic profile, every cross-realm
  boundary completes the exact handshake, and no child is independently
  selectable.

Use strict TypeScript tests below 600 lines, split by token, web/runtime,
archive/repository, and desktop ownership. Run every TypeScript configuration,
focused lint, dependency/file-size checks, roadmap/local-link checks, canonical
`npm run check`, and focused Framescaper Chromium preservation evidence when
the first selector lands.

## Hard stops

This contract authorizes no V18 validator, final runtime token, profile
selector, capability registration, archive format, storage claim, controller
wiring, desktop v10 path, UI, menu, preview, or Soundscaper change. Dormant c1a
is implemented; the next executable step is a separately reviewed
Framescaper capability-token contract/RED. The first reachable selector remains
the full atomic c-c transition. Durable proxy storage, attachment authoring,
and 3B-6d remain blocked until that transition is green.
