# Milestone 3B-6c: durable V18 video-proxy attachment

> **Reviewed split contract — 3B-6c-a1 is implemented; later slices remain
> unauthorized.** 3B-6a and
> 3B-6b prove exact timing and one uninterrupted original-to-candidate
> relationship, but intentionally persist nothing. This packet owns the first
> durable proxy state: an exact V18 source attachment, its immutable proxy and
> timing bodies, preservation and transport, and unavailable-capability
> admission for the Framescaper milestone-3B track. Soundscaper product work is
> explicitly out of scope and remains owned by its separate track. This packet
> adds no menu, preview selection, playback, source-monitor,
> offline substitution, relink, delivery, export, proxy audio, adaptive policy,
> or multicamera behavior.

## Outcome and dependency order

One canonical video source may own one nullable proxy attachment. The proxy is
derived media, never another canonical source and never editorial authority.
All clip bounds, source timing, extracted audio, relink identity, and delivery
continue to refer to the original.

Delivery is ordered without ever admitting a dangling persisted pointer:

1. **3B-6c-a1 — current-target preparation material — implemented in
   `c195a8c1` on 2026-08-12:** supersede 3B-6b's
   now-historical V16 target admission with exact current V17 admission, then
   retain the exact candidate timing publication already created from the
   canonical candidate `Blob`. A private authenticated consumer yields the same
   candidate, timing reference/bytes, relationship, and scalar facts once, then
   erases them. Public proof/info surfaces do not expose timing bytes, lease
   tokens, or a token-construction path. This schema-neutral dormant slice is
   complete. It adds no schema, storage, capability, UI, or Soundscaper change.
2. **3B-6c-a2 — folded into atomic adoption:** no standalone adoption-lease API
   lands. The current V17 proof seam cannot fence the future all-null V18 base,
   authenticate storage settlement, or distinguish prepublication cleanup from
   committed work. The c-c coordinator therefore owns the fresh exact original
   lease together with the Framescaper V18 target authority and authenticated
   attachment compare-and-swap, holds it through the authoritative outcome and
   required reconciliation, releases it exactly once, and exposes no raw
   repository token or general callback seam.
3. **3B-6c-b1 — dormant attachment wire:** first add
   the pure dormant [V18 attachment
   normalizer](milestone-3b-video-proxy-attachment-normalization.md) without
   consuming preparation or touching storage. Durable staging remains folded
   behind c-c's isolated repository; only c-b1 normalization is authorized.
   That later owner verifies both bodies, holds currentness, and discards only
   new exact publications while retaining opaque full-row claims and roots.
4. **3B-6c-c — atomic V18 adoption:** in one separately reviewed semantic transition,
   add a Framescaper-selected current-schema/archive/repository profile after V17,
   requirements/capabilities, preservation, retention, conditional `.scape`
   format 2 for attached projects,
   fresh Framescaper desktop persistence/handoff, policy evidence, and the
   dedicated pointer-publication path. It remains unauthorized and hard-stopped
   on the separately reviewed product-isolation transition. No earlier commit
   may load, save, or transfer a non-null project attachment.

The merged milestone-3A work already owns shared V17 for take/comp state,
desktop library metadata 9/project 17/database 11, and `.scape` format 1. This
packet must not redefine or mutate that released wire. Slice c-a1 therefore
updated only the dormant proxy authority to accept exact V17, including its
canonical `takeGroups`, and retained no take/comp state. Durable attachment is a
future exact V18 layer; fresh desktop and archive numbers are reserved only by
the separately reviewed c-c transition.

3B-6b proof admission moved in c-a1 from exact V16 to exact V17. The final c-c
transition gives the Framescaper-selected profile exact-current V18 and requires
the selected source's attachment to be `null`. A proof may inspect a preservation-only V18 document containing
unrelated attachments, but the pointer-publication coordinator starts only
from an all-null, writable exact V18 base. The existing synchronous timeline
and Project Bin retime refusal remains. At the Framescaper boundary, V17 is
typed `REIMPORT_REQUIRED` and V19+ is opaque read-only; there is no migration.
Only the attachment coordinator may author a new non-null pointer, while
authenticated import, handoff, duplicate, and preservation transactions may
reproduce an already validated pointer.

The user's implementation scope is Framescaper. c-c requires a selected-profile
prerequisite injected through every Framescaper V18 constructor, migration,
compatibility, archive, controller, retention, and repository boundary; it may
not rebind a global current constant or a Soundscaper entrypoint. Shared domain/storage changes
may land only when unavoidable for Framescaper preservation; no Soundscaper
menu, authoring, playback, proxy selection, capability enablement, policy
outcome, or browser workflow is part of this packet. Because schema and portable
formats are shared today, c-c remains hard-stopped until a separate review owns
the product-selected Framescaper isolation and preservation behavior.

That isolation is physical as well as semantic. The future Framescaper V18
profile owns IndexedDB and degraded-memory key
`kw-media-framescaper-editor-v18`, OPFS directory
`framescaper-editor-v18-sources`, project-lock prefix
`kw-media-framescaper-editor-v18-lock:`, and an OPFS sync-worker, budget, and
maintenance namespace derived only from that profile. It never opens, clears,
prunes, reconciles, or publishes through the existing
`kw-media-audio-editor` database, `audio-editor-sources` directory, default
memory key, or audio-editor lock namespace. A same-origin product switch and
either product's clear or maintenance path cannot enumerate or delete the
other profile's records or payloads. These exact injected names are a c-c
prerequisite; c-a1 creates or opens no store.

## Exact V18 wire

V18 is a closed additive successor of exact V17 and preserves every V17 field
and invariant, including mandatory canonical `takeGroups` and all merged
milestone-3 state.

Every V18 video source has one own enumerable data property
`proxyAttachment`; constructors and source imports default it to `null`, while
raw V18 input must explicitly contain it. Audio sources must not carry the
field. A non-null value is this closed wire:

```ts
interface VideoProxyAttachmentV18 {
	readonly kind: 'video-proxy-attachment';
	readonly version: 1;
	readonly rule: 'exact-original-generation-proxy-content-and-timing-v1';
	readonly storageKey: string; // video-proxy-sha256:<sha256>
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly originalSha256: string;
	readonly originalAuthorityKind: 'owned' | 'linked';
	readonly generatorId: string;
	readonly generatorVersion: number;
	readonly recipeId: string;
	readonly recipeVersion: number;
	readonly timingBackendId: string;
	readonly timingRule: 'exact-presentation-boundaries-v1';
	readonly frameCount: number;
	readonly boundaryCount: number;
	readonly timingAsset: VideoTimingAssetReference;
	readonly audioPolicy: 'ignore-proxy-container-audio-v1';
}
```

The normalizer descriptor-snapshots exact closed plain data once, rejects
accessors, symbols, non-enumerables, extra keys, and nonconforming Proxy trap
results, then retains no raw alias or post-snapshot behavior and returns a
deeply frozen detached value. Candidate bytes are
`1..512 MiB`; MIME is canonical `video/*` and at most 128 characters; SHA-256
is lowercase hexadecimal; generator/recipe/backend IDs are printable,
pathless, and at most 128 characters; versions and counts are positive safe
integers. `storageKey` must equal `video-proxy-sha256:${sha256}`.

The structural owner supplies identity, so the wire omits project/source IDs
and process generation tokens. `originalAuthorityKind` records the immutable
owned-or-linked authority observed at attachment time; import, duplication, and
ownership changes preserve it, and no validator or relink path interprets it as
the current authority. Require:

- `originalSha256 === source.contentSha256`;
- `frameCount === source.sourceFrameCount` and
  `boundaryCount === frameCount + 1` without unsafe addition;
- `timingAsset.sourceSha256 === sha256` and its frame count equals both;
- at least one timeline or Project Bin occurrence of the source; and
- every such occurrence has an own enumerable data `retimeMap === null`.

The timing reference and body preserve every interior boundary and final-frame
duration. Counts and provenance strings are diagnostic, never timing
authority. Timing-body identity is its encoding/storage key/digest/length and
summary, not `sourceSha256`: original and proxy references may legitimately
share identical timing bytes while binding them to different media digests.
Across one project, attachments that share a proxy `storageKey` must agree on
`sha256`, `byteLength`, and `mimeType`; timing references that share a timing
storage key must agree on body encoding, digest, byte length, frame count,
timescale, and final duration while deliberately ignoring per-reference
`sourceSha256`. Neither a proxy nor its nested timing storage key may equal any
canonical source `id` or `storageKey`. Its local media row has the distinct closed role
`kind: 'video-proxy'` and `encoding: 'video-proxy-v1'`; a canonical original
row is never adopted as a proxy row even when its bytes happen to match.
Released V17 validation remains unchanged and assigns no attachment semantics
to a same-named opaque extension. Framescaper's selected V18 admission rejects
every V17 before traversing it; V18 is writable only when all attachments are
null, and V19+ is opaque structured-clone read-only. Before c-c, shared current
schema stays V17 and no maintained route admits this wire.

## Preparation, bodies, and publication

3B-6b already hashes and probes one canonical candidate, creates exact timing
bytes bound to that candidate digest, validates them, and proves all N+1
boundaries. 3B-6c-a1 keeps that publication only in the preparation's private
WeakMap state. Cloned, spread, serialized, replayed, forged, or twice-consumed
preparations refuse before storage work. The final relationship proof still
retains no `Blob`, timing bytes/index/token, port, or repository row.

The c-a1 public result stays the existing frozen
`PreparedVideoProxyRelationship { relationship, candidate }`; it gains no
enumerable field. Add only this direct owning-module internal seam:

```ts
interface VideoProxyRelationshipPreparationMaterial {
	readonly relationship: VideoProxyRelationship;
	readonly candidate: Blob;
	readonly timingPublication: VideoTimingAssetPublication;
	readonly info: VideoProxyRelationshipInfo;
}

consumePreparedVideoProxyRelationship(
	preparation: PreparedVideoProxyRelationship,
): VideoProxyRelationshipPreparationMaterial;
```

`VideoTimingAssetPublication` is the exact frozen reference plus the exact
`Uint8Array` created once by `createVideoTimingAssetPublication()` for the same
candidate SHA-256 and already byte-validated to build the conformance token. It
is not re-encoded, re-probed, reconstructed from timing info, or exposed through
the relationship proof/info. Candidate observation transfers that publication
into relationship preparation ownership exactly once. The preparation WeakMap
entry is installed only after original release and every final project/task/
timing/cancellation check succeeds. Consumption authenticates the preparation
identity before reading public fields, deletes the entry before returning, and
returns the same relationship, candidate, publication, and frozen info
identities. A second call and any clone/serialization/spread/forgery refuse;
failed proof or cleanup creates no entry. Distinct successful preparations do
not share mutable byte storage. WeakMap reachability permits an abandoned
preparation and its private publication to be collected.

c-a1 also replaces the relationship authority's historical
`validateAudioEditorProjectV16` dependency with exact
`validateAudioEditorProjectV17`, requires canonical `takeGroups`, and uses 17
in its private Scape target-fingerprint envelope. After validating only its
detached snapshot, this relationship-local seam also refuses any own
`proxyAttachment` member on any V17 source before original observation. It does
not change the released V17 validator or constructors, assign semantics to that
opaque extension in another product, inspect or retain take/comp state beyond
the bounded snapshot, or add a source schema, repository, capability, product,
or consumer dependency. V16, V18, and the reserved-name V17 case now refuse
synchronously before original observation, generation, hashing, or probing.
The later stager must independently digest- and summary-revalidate the consumed
publication bytes before any body work; the preparation retains no original
Blob or lease, timing index/view/token, repository row, or authority callback.

The proxy is an immutable owned media asset at the content-addressed proxy key;
it is not a source row, linked alias, derivative-cache entry, poster, or
thumbnail. Its timing bytes use the existing immutable video-timing asset
owner. Existing content-addressed bodies may be reused only after their full
metadata and bytes verify and the repository grants an authenticated
exact-generation lease; otherwise refuse the occupied key. An unowned pending
row may not be treated as reusable merely because its digest matches. Every
existing or new body remains covered by an exact row-generation lease through
commit; newly written bodies retain only the claim-aware cleanup capability
until pointer publication settles.

The generic stripped `OwnedMediaAssetPublication` is insufficient. Add a
private opaque attachment claim carrying the full expected storage record,
including media-content token and path/chunk identity, plus an assert-current
and one-use transaction hook. Each operation creates a durable provisional
claim/root for proxy and timing rows. Adoption consumes those claims in the
pointer transaction; cleanup removes only this operation's claims and deletes a
body only when no other claim, current/revision, editor-history, or pending-save
root exists. An immutable-key race aborts local staging, rereads and verifies
the occupied full row/body in bounded chunks, then acquires a claim or refuses.
Generic `ProjectRepository.save` may preserve a byte-identical attachment that
is already current, but must reject introduction/change and never blindly
promote a proxy-key pending row. `save`, `createIfAbsent`, archive import,
duplicate/remap, and desktop-shadow acquisition may introduce state only with a
repository-authenticated one-use preservation plan that binds every attachment
to exact proxy/timing claims. Such a plan proves integrity/preservation, not a
locally trusted generator attestation. Every pointer-introduction boundary,
including restore and shadow publication, enforces the same rule. Durable
duplicate, save-copy, and project-ID remap acquire exact row-generation leases
and provisional claims first, then atomically create and root their project and
initial revision while consuming those claims; they cannot race final-root
deletion into a dangling copy.

Reuse the existing kind-indexed `mediaAssetStaging` store rather than forcing a
destructive database upgrade. Add a closed `video-proxy-claim` record binding
an operation-plus-body-unique claim key, project/source, base fingerprint, body
key, expiry, generation, and a nested `rowIdentity` containing the full private
row identity; it contains no `Blob` and omits the indexed top-level
`mediaChunkToken` and `path` fields reserved for live writer leases. New-row publication
and claim creation are one metadata transaction after the operation-owned
physical payload has been staged and identified. Existing-row reuse first
captures the exact private row identity and inserts an unverified provisional
claim atomically; body hashing then runs outside IndexedDB under that root, and
a second transaction asserts the unchanged row/claim and marks it verified.
No IndexedDB transaction awaits OPFS or another external body stream. At most
100,000 claim records are scanned/retained; malformed or over-bound inventory
fails closed. Claims renew only while their operation and row leases are
current.

Bounded startup/maintenance reconciliation runs before project load or
retention cleanup: an exact committed attachment plus matching rows consumes
and promotes its claims; exact absence plus no other root atomically changes the
claim to a durable `cleanup-pending` tombstone retaining the complete row and
physical-payload identity, then detaches the metadata row and any IndexedDB
chunks. Idempotent OPFS cleanup runs afterward and deletes the tombstone only
on success; startup resumes every bounded tombstone. While present, the
tombstone exclusively reserves its storage key and physical path/chunk token:
staging, reuse, and publication must finish or resume cleanup, or refuse, never
publish a new generation into that identity. Immediately before physical
deletion, cleanup reasserts the unchanged tombstone and absence of every media
row, other claim, project/revision, editor-history, session, and pending-save
root; the reservation remains through idempotent deletion and is removed only
after success. Mixed, unreadable, or
cleanup-failed state remains rooted and reports a typed indeterminate outcome.
Retention, revision prune, project delete/discard, whole-store clear, and
prepublication cleanup all use this claim-aware ordering; callers never invoke
raw `discardIfCurrent` after a claim is acquired.

Timing retains the existing 2,000,000-frame and 16,000,032-byte ceilings.
Before body staging, checked storage admission accounts candidate bytes,
timing bytes, encoded base and next documents, the revision envelope, a
centrally owned worst-case row/chunk-staging allowance, and configured
headroom. A held same-store/process logical budget serializes participating
operations against one current capacity estimate; it is not a browser quota
reservation and does not exclude another tab/origin writer, estimate lag,
allocation overhead, or write-time quota failure. Unknown quota, nonpersistent
production storage, or an unsupported bound refuses before body staging or
publication; the prepared candidate has already been generated by 3B-6b.
Candidate generation/decoder/FFmpeg heap and RSS remain unqualified and are
still a hard stop for a maintained menu workflow.

The dedicated attachment coordinator must:

1. authenticate and consume one preparation and capture the exact current
   all-null V18 base, canonical project-document digest/identity, revision,
   monotonic task token, source, and a fresh authority-owned original adoption
   lease;
2. stream/verify the candidate under the 4 MiB chunk law, publish or verify its
   exact owned body, then publish or verify the exact timing body;
3. re-run relationship, task, source, occurrence/retime, original-generation,
   body metadata, and cancellation checks while the original lease remains
   held;
4. construct one normalized V18 result changing only the target
   `proxyAttachment` and reconciled owned requirement;
5. publish that result once through a dedicated compare-and-swap base-revision
   repository boundary, then release the lease; and
6. on determinate prepublication failure, atomically release only this
   operation's claims, then run claim-aware cleanup only for newly created,
   unrooted bodies through durable cleanup-pending tombstones; reused bodies
   remain untouched, and cleanup failure aggregates or reports indeterminate
   with durable evidence.

No project/history pointer may publish before both bodies exist. Existing
`ProjectRepository.save` is not by itself the admission seam: it blindly
promotes any pending row reachable by key and the memory path is sequential.
The coordinator must carry authenticated publication identities through the
pointer transition. One IndexedDB transaction spans the project, revision,
media-asset, attachment-claim, and applicable owned/linked-original identity
stores. It authenticates and consumes both provisional claims, then compares
the exact base project identity, canonical document digest, revision, and
target source. It also reads the existing base revision record and requires its
project digest to equal the flushed base; assigns exactly `baseRevision + 1`
after safe addition, captures one canonical `updatedAt`, and refuses a missing,
conflicting, or occupied base/next revision. It verifies the original private media token or
linked binding/locator tokens; verifies both rows' private tokens, digests,
lengths, MIME, storage payload identities, pending/owned state, and held
generation leases; writes the V18 project/revision; and promotes or adopts
those exact rows. The external linked-original locator lease stays held through
commit. Production durable attachment hard-stops on the memory/ephemeral
adapter; a compensated memory implementation is test-only.

Before this transaction, a new controller publication gate blocks competing
commands, undo/redo, project/tab open/switch/new/close/delete, relink/source
mutation, autosave, teardown, and attachment operations. After acquiring the
gate it cancels scheduled autosave, drains the queue, recaptures the exact
all-null base, and flushes it so active and durable predecessor identity agree.
It builds the next undo/history entry privately without exposing it. After
storage commit it reevaluates compatibility from that exact history and
atomically installs the committed tab/session snapshot with controller
read-only and `intrinsicReadOnly = true` before document publication, engine
apply, autosave, or gate release. There is no writable observable frame. Crash
or failure after durable commit but before installation is a
committed-reconciliation outcome; the stale writable base never resumes.

Only the committed snapshot may then replace the active project/history, and it
does so once. A post-commit uncertainty triggers exact reconciliation of the
project attachment and both private row identities. Fully committed returns the
committed result; fully absent rolls back; mixed or unreadable state returns a
dedicated indeterminate error and retains evidence rather than guessing. A
lease-release or later cleanup fault after an authoritative commit reports a
typed committed-cleanup outcome carrying the committed snapshot; it never
rolls the pointer back. Revision-limit pruning happens after the authoritative
commit and any failure is likewise `committed: true`. Operation plus cleanup
failure before commit is an `AggregateError`: cancellation/stale remains its
primary first member and `cause`, but cleanup failure is never hidden. No body
or claim rolls back after pointer commit.

## Capability and preservation

Add `videoProxy: org.soundscaper.capability.video-proxy` to a product-scoped
known-feature registry, not the current global enumeration, and do not add it
to the generic rendered-video fallback-eligibility set. Framescaper alone owns
the `videoProxy` profile key and reports the feature ID as known with value
`false`; Soundscaper owns no such key and its capability snapshot must not
report the ID as known. The shared wire validator may still enforce the
reserved requirement independently of either active product registry. This
product-scoping prerequisite is part of the separate c-c review; the currently
authorized c-a1 slice changes no capability registry or product profile. Add the
reserved owned requirement `framescaper.video-proxy`, display name
`Video proxy attachments`, disposition `bypass`, and `fallback: null`. Any
non-null V18 attachment requires exactly that declaration, and an all-null V18
project must not retain it. Publisher same-feature substitution, reserved-ID
conflict, or rendered fallback refuses.
Framescaper and its production capability map keep `videoProxy: false` in this
packet. No Soundscaper product profile, capability register, policy claim, UI,
playback, archive workflow, desktop admission, or browser flow changes here;
its product-specific capability treatment remains deferred to the Soundscaper
track.

The Framescaper compatibility dialog therefore names the known unavailable
feature, offers explicit read-only-or-cancel consent, and keeps the activated
document intrinsically read-only. Keep `video-proxy-fallback` **planned**; add a
separate implemented V18 preservation rule rather than claiming proxy use.

Whole-project clone/load, local history, retained revisions, duplicate/save
copy, and project-ID remap preserve a deeply detached attachment. Immutable
bodies may be shared across project copies. `collectProjectStorageKeys` roots
both proxy and nested timing keys in each durable project/revision. Runtime GC
also supplies every `editorHistoryProjects` snapshot and
`pendingSaveSnapshots` as protected projects; provisional claims cover the
pre-pointer interval. Keys release only after the final durable, session, save,
or claim root disappears.

Session clipboard is deliberately not a body-transfer format: copied source
metadata always canonicalizes `proxyAttachment` to `null` and creates no
retention root; normalization also removes the now-unneeded owned proxy
requirement from the clipboard document. Same-project paste may continue
referring to its already-owned source without replacing that source record.
Direct and arbitrarily nested
commands protect every attached source, target timeline/Project Bin clip,
ownership membership, both body references, and the attachment wire before
publication/history. Relink, changed-content relink, replace, reprobe,
reimport, detach, source removal, or reference rebinding refuses with zero
lease/storage/history/visual side effects until a later packet owns atomic
invalidation.

## Portable archive and desktop isolation

The future Framescaper `.scape` route supports `formatVersion: 2` while
retaining strict format-1 envelope parsing. Format 2 is required if and only if
the V18 project has at least one non-null attachment; an all-null V18 may remain
format 1 because it needs no new asset kind, while format 1 with any non-null
attachment refuses during manifest/project inspection before body reads. A
format-1 V17 project follows the normal typed `REIMPORT_REQUIRED` route after
V18 becomes current; it is not upgraded. Format 2 binds
`project.schemaVersion === 18` and adds one exact
proxy descriptor per unique body:

```text
sourceId = attachment.storageKey
kind = video-proxy
encoding = video-proxy-v1
entry = proxy/<sha256>/body
mimeType = attachment.mimeType
size = attachment.byteLength
sha256 = attachment.sha256
```

Format-2 descriptor ownership treats proxy and timing storage keys as their
derived-asset identities, outside the canonical-source-ID bijection; the
V18 validator nevertheless forbids either key from colliding with a
canonical source ID or storage key.

Proxy timing continues to use the existing `video-timing` kind and canonical
`timing/<sha256>.scti` entry. Framescaper export emits format 2 exactly for
attached V18 state. Format 1 cannot carry a proxy, and format >2 refuses before
persistence. No format-2 route lands in c-a1, c-a2, or c-b.

Every referenced unique proxy and timing body appears exactly once; orphan,
missing, duplicate, conflicting, changed-digest, wrong-kind/encoding/MIME, or
summary-mismatched entries refuse. Proxy body size is at most 512 MiB; source +
unique timing + unique proxy + metadata entries stay within 4,096 and the
existing 64 GiB expanded-byte budget. Inspect/open-decision reads bounded
manifest/project metadata only; Cancel performs no body read or store write.
After explicit read-only consent, import verifies and stages both bodies before
project publication. It creates exact provisional claims and consumes them
through a sibling claim-authenticated import transaction, not local adoption:
exact absent-base create, collision copy/remap, and replacement
compare-and-swap each atomically write the imported project/initial-or-next
revision and consume/promote every bound claim. They reuse the claim-validation
primitive but do not require an all-null predecessor or synthesize
`baseRevision + 1` for a new project. Generic `ProjectRepository.save` cannot
introduce the pointer. A determinate prepublication failure releases the
import operation's claims and cleans only newly created unrooted bodies through
the tombstone law; reused bodies remain, and cleanup failure retains evidence.
Source-ID remap never changes content-addressed proxy/timing keys. Save a copy
preserves exact descriptors and bodies through the same preservation
transaction family.

The merged V17 work already owns desktop schema/metadata 9, project schema 17,
scope `kw.media/scape-project-library/v9`, and database `user_version` 11.
Future c-c therefore requires a separate Framescaper-selected v10
contract/bootstrap with schema/metadata 10,
exact project schema 18, scope `kw.media/scape-project-library/v10`, and database
`user_version` 12; it rejects every non-Framescaper owner, while the existing
product-neutral/Soundscaper v9 remains untouched. Add a distinct managed
`video-proxy-v1` media role and exact proxy namespace:
`bindingId = 'p' + sha256(UTF8(JSON.stringify(['video-proxy-v1', projectId,
projectRevision, projectSha256, storageKey])))`, physical path
`proxy/${bindingId.slice(1, 3)}/${bindingId}.bin`, and category `proxy`.
This is the v10 proxy-specific counterpart of the existing managed-media
derivation; the digest is the project/revision/document/storage binding digest,
not the attachment content digest. Extend v10 inventory, IPC/preload, service
types, and SQL checks with that encoding, canonical proxy MIME, and binding
grammar rather than widening the existing `[mvt]` v9 namespace. The role flows
through inventory, IPC/preload, sender, acquisition, capacity, retention,
digest verification, and shadow publication. It is neither original video nor
video timing. Its closed descriptor is exactly `kind: video-proxy`,
`sourceId: attachment.storageKey`, `storageKey: attachment.storageKey`,
`encoding: video-proxy-v1`, the v10 authenticated opaque `bindingId`, and
the attachment's exact `mimeType`, `byteLength`, and `sha256`; the binding ID is
created and verified by the managed-media owner and is never project wire. The
nested timing body retains its canonical timing descriptor. If any host cannot
transfer both proxy and timing bodies, it must refuse before document/body
mutation; no dangling descriptor or silent drop.
Desktop publication is not the renderer IndexedDB transaction: the main owner
must stage managed bodies and commit its document/revision CAS plus media
journal atomically, then the renderer reconciles its local shadow. Until that
exact main-owned path exists, desktop attachment publication hard-stops even
though read-only preservation/transfer may be qualified.
Renderer shadow creation uses the same claim-bound one-use preservation plan as
archive import; ordinary `shadow.save` cannot introduce the attachment.

## Dormancy and later-use law

No Project Bin card/panel/menu, action facade, visual resolver, source monitor,
program preview, transport/engine, derivative cache, video export/delivery,
offline placeholder, relink UI, or proxy-audio path imports or reads the V18
attachment in 3B-6c. There is no attach/detach menu yet because the capability
is unavailable; 3B-6d will place opt-in actions only in the existing Project
Bin overflow menu.

Before any later consumer selects a locally trusted proxy, it must verify the proxy body's
length and digest, load and digest/summary-validate the exact timing bytes,
bind an ephemeral proxy timing view, resolve the current original timing, and
rerun 3B-6a conformance under current project/source/media-generation fences.
Missing/corrupt/stale evidence yields original-or-unavailable, never trust in
persisted counts. Persisted digests prove integrity, not publisher identity; a
project/archive/handoff attachment and its generator/rule strings therefore
remain preservation-only and cannot authorize pictures. Ordinary 3B-6b cannot
re-attest an already attached source because its target attachment must be
null. Before selection, 3B-6d must add a closed private existing-attachment
re-attestation authority that binds the exact persisted proxy SHA-256, byte
length, MIME, and current original identity/generation. Regeneration qualifies
only when its canonical candidate digest, length, and MIME exactly equal the
stored attachment; a different candidate never authorizes the pointer. The
authority must also load and validate the persisted timing reference/body,
bind its ephemeral proxy timing view, and rerun 3B-6a against current original
timing. Imported or handed-off state remains preservation-only until that
succeeds. A later collaboration threat model may additionally require a fresh
byte probe, but neither probe nor attestation can replace durable timing
evidence.

## Reds and acceptance

3B-6c-a1 was implemented in `c195a8c1` on 2026-08-12. Its strict dormant Node
coverage proves canonical V17 `takeGroups`, synchronous V16/V18 and
V17-reserved-name refusal with zero original/candidate work, one exact timing
publication transferred into private WeakMap preparation state, one-use
authenticated consumption, same public result/info identities, distinct
publication-byte storage across preparations, failure/cancellation/release
cleanup, and no timing token/index or maintained consumer retention. It adds no
schema, storage, capability, UI, or Soundscaper behavior. The canonical
`npm run check` passed with 5,736 tests (5,734 passed and 2 skipped), 90.15%
statement and line coverage, 81.66% branch coverage, and 91.29% function
coverage; architecture covered 1,010 modules, 2,789 dependencies, and 2,187
maintained files; and the build emitted 115 JavaScript chunks with a
428,990-byte largest chunk.

c-b1 normalization is reviewed and authorized; durable storage and c-c remain
hard-stopped, and a2 is folded into c-c. No generic
callback is an adoption boundary, and no pre-c-c slice may claim settlement or
own the original lease. c-b1 starts with focused reds; later work needs its
own contracts, including c-c's product-isolation review. The immediate next
step is contract review, not production code.
For eventual c-c, prove the full Framescaper cross-surface/platform set. Prove exact/null/deep-freeze wire validation; every binding and
cap boundary; unchanged V17 under the shared/Soundscaper profile, Framescaper
V17 re-import, V18 current, V19 read-only; forged and twice-consumed preparations; same candidate/timing objects and one-use
retention; missing/corrupt/substituted bodies; one interior PTS or final-duration
change; equivalent rescaled timing acceptance; and original/task/cancellation
drift with exact two-body rollback and no pointer.

Crash/interleaving reds prove detach-then-crash reserves the storage key/path
and blocks republish until restart cleanup settles, restart cleanup cannot
delete a newer generation, and a shared timing body or second claim/root is
never tombstoned.

Also prove owned requirement/substitution and the one false Framescaper profile; clone,
history, duplication, retention, clipboard stripping, direct/nested protected
closure, and relink/reprobe/replace refusal; format-1 compatibility plus
format-2 proxy/timing import/export/tamper/orphan/rollback/future rejection;
same-origin IndexedDB/memory/OPFS/lock/worker isolation and independent clear,
fresh Framescaper desktop isolation and exact proxy-binding derivation/body
handoff; and static
dormancy/source audits that prove Framescaper owns every reachable V18 route
without changing a Soundscaper entrypoint.

A focused Framescaper Chromium row opens a fixed V18/format-2 proxy archive:
Cancel preserves the active tab and performs zero body/storage work;
explicit consent names `Video proxy attachments`, activates intrinsically
read-only with the unavailable bypass declaration, shows no proxy UI/use, and
Save a copy round-trips both exact bodies. It makes no codec, picture, playback,
offline, relink, or export claim.

For each later authorized slice, run focused Node/browser tests, every
TypeScript configuration, lint,
architecture/file-size, local-link/roadmap/policy checks, narrative sync,
runtime-evidence repinning, and canonical `npm run check`. Packet 3B-6 stays
**In progress**; 3B-6d menu/lifecycle work remains blocked until all of 3B-6c
is green.
