# Milestone 3B-6c-c1: Framescaper V18 product isolation

> **Historical selection record:** this document proves the isolated V18
> foundation that the selected V27 activation candidate retains. V27 now uses
> Framescaper desktop library V18, SQLite `user_version` 20, scope `v18`,
> clipboard V11, and unified render plan V13. Its local implementation is
> complete, while guided-local sign-off and external qualification remain open;
> V20/V18 route-selection wording below is not the current product status.

> **Production selection is implemented.** The maintained Framescaper bootstrap
> selects the exact c1a/c1b/c1c runtime identity before constructing its V18
> schema, storage, archive, controller, compatibility, retention, and desktop
> owners. The separate V10 desktop handshake and exact V18 local shadow are
> composed for desktop create/load/save. Soundscaper remains exact V17, and V18
> cross-product transfer is copy-only preservation rather than activation.

## Stop condition and atomicity law

At contract review time the web bootstrap passed only `productId`; the controller always created
the default store and injects the global V17 constructor and migration owners.
The current schema aliases, command/history validation, session admission,
retention, `.scape` format 1, and product-neutral desktop v9 library are shared.
Selecting only c-c0 storage would therefore create a V18-named store driven by
V17 semantics. Raising any global current constant would instead change
Soundscaper.

**There is no safe schema-first or storage-first production rollout.** The
implemented first maintained selection therefore binds V18 project semantics,
c-c0 storage, archive, compatibility, retention, repository, controller, and
desktop V10 together. Mismatched composition still stops before operational I/O.

## One authenticated runtime profile

Add one generic strict owner at
`src/common/editor/project-runtime-profile.ts`. It exports an opaque
`EditorProjectRuntimeProfile`, a descriptor-snapshotting creator, and an
identity-authenticating definition accessor. Tokens are fresh, frozen,
null-prototype, zero-key objects held by a private `WeakMap`. The accessor does
the private lookup before inspecting public data; clones, spreads,
serialization, structured clones, and Proxy wrappers refuse with zero traps.

The closed definition contains only authenticated child tokens, never copied
literals, generic callbacks, or independently selectable booleans:

```ts
{
	prerequisite: FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE;
	capabilityProfile: FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE;
}
```

The accessor returns only the stable frozen child-token pair after
authenticating the final token; it grants no independently supplied child or
override authority. The prerequisite's authenticated snapshot owns the exact
owner, V18, archive, desktop, and c-c0 storage literals. Shared consumers must
capture the final token and may resolve its children only from it; no flattened
definition grants authority.

The exact product-owned singleton lives under `src/framescaper/` and is not
barrel-exported. It composes the exact c1a and c1b tokens; c1a transitively
authenticates the exact c-c0 storage token. Equal definitions, other authentic
children, and a fresh token over the same exact children do not grant the
singleton's selection authority. That identity is process-local
and JS-realm-local; it is never serialized, cloned, or sent over IPC. Each
Framescaper main, preload, renderer, worker, or browser realm owns or receives
its own maintained singleton through its composition root. Cross-realm
agreement uses a separate closed, versioned handshake whose exact owner,
schema, archive, storage, and desktop contract literals are authenticated at
both endpoints before either side performs non-handshake operational I/O or
mutates state.

The independently landed contract-first precursor was the
[Framescaper runtime-profile
prerequisite](milestone-3b-framescaper-runtime-profile-prerequisite.md),
implemented in `13f80172` on 2026-08-12. It freezes the fields above except
`capabilityProfile` around the exact c-c0 token. The authenticated Framescaper
capability owner followed through `c1c70639`, and the final profile through
`ace30ac1`. Those precursor commits granted no production authority by
themselves; the maintained composition now selects their exact identities, and
a copied or reparsed definition still grants no authority.
The
[Framescaper runtime capability
profile](milestone-3b-framescaper-runtime-capability-profile.md) remains an
authenticated child rather than an independent selector. Its successor is the
[final runtime-profile composition](milestone-3b-framescaper-runtime-profile.md),
which authenticates the exact c1a and c1b identities and is selected only by
the Framescaper composition root.

## Selection and non-interference

The first selector is a Framescaper-owned bootstrap adapter. It supplies the
one exact token once, before store, session, controller, archive, lock, file,
or desktop construction. It rejects every other token identity before resolving
children or causing side effects. Shared owners may consume the authenticated resolved
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

The implementation does not change the meaning or value of the global
`AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION`, `project-current.ts` aliases,
`migrateAudioEditorProject`, `SCAPE_FORMAT_VERSION`, global project-feature
schema owner, desktop v9 constants, or existing `[mvt]` managed-media grammar.
Nested-sequence and multicamera IDs are deliberately global known capabilities
with product-specific availability. The proxy capability remains only in the
authenticated Framescaper profile and is unavailable; adding it globally would
make it known in Soundscaper.

## Exact Framescaper V18 semantics

The selected profile owns separate V18 create, clone, load, validate, migrate,
runtime, command, and history functions. V18 is the closed additive successor
of V17 described by the durable proxy contract. New projects are exact all-null
V18. Exact V17 returns typed `REIMPORT_REQUIRED` before traversing nested data;
there is no migration. V19 and later are descriptor-snapshotted opaque
read-only documents. Soundscaper continues to create and edit exact V17 and to
treat V18 as its existing future read-only schema.

## Reviewed pre-code compatibility decision

V18 is authoritative for Framescaper. The implemented
`m2-handoff-packaged-roundtrip` acceptance and its browser and packaged desktop
witnesses remain historical legacy shared-schema-17 evidence; the Electron
portion is specifically desktop-library-v9 evidence. They do not authorize
Framescaper V17 activation after the V18 selector lands. Selected Framescaper
returns typed `REIMPORT_REQUIRED` for exact V17 before nested traversal, and
desktop v10 rejects V17 entirely.

Cross-product V18 transfer is copy-only preservation. Neither Soundscaper's future-schema read-only
handling nor a byte-preserving archive copy grants edit, save, migration,
history, media activation, or desktop-library adoption authority. The closure
register, compatibility rules, and the browser witness carry this exact
boundary. Production selection uses the indivisible transition and its strict
proofs below.

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

## Remaining hard stops

The historical atomic selection, V18 validator/runtime, registered nested and
multicamera capabilities, archive formats, claim-bound storage, controller
wiring, desktop V10 path, and their menu-reached editorial workflows were
implemented at this boundary. It authorized neither retime activation nor
proxy consumption by itself. Selected V27 now supplies those locally
implemented web-core retime and proxy routes under separate exact capability
and project profiles; guided-local, resource, and external qualification remain
open, and delivery stays original-authoritative.
