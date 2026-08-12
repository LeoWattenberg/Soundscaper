# Milestone 3B-6b: exact video-proxy relationship proof

> **Ready for implementation.** This is the next dormant, schema-neutral slice after
> [3B-6a timing conformance](milestone-3b-video-proxy-timing-conformance.md). It proves
> one candidate relationship in memory. It adds no project field, repository row,
> publication, command, menu, preview consumer, offline claim, capability availability,
> or compatibility-rule flip. Packet 3B-6 remains **In progress**.

## Outcome and delivery boundary

3B-6b owns one uninterrupted operation: capture an exact current V16 target and
reject its retimed references before media I/O; observe the current original;
generate, hash, and exactly probe one canonical candidate `Blob`; consume an
authentic 3B-6a proof; then recheck the project and original generation before
issuing an opaque relationship proof. No caller may splice together a digest,
timing token, probe result, or conformance proof obtained elsewhere.

Implement two strict modules under 600 lines each:

- `video-proxy-candidate-observation.ts` owns trusted generation, canonical
  candidate bytes, SHA-256, exact timing observation, and the private candidate
  timing token; and
- `video-proxy-relationship.ts` owns exact V16 target admission, the original
  lease, 3B-6a conformance, currentness, cleanup, and relationship proofs.

3B-6c remains the first persisted slice. It must separately define V17, owned
proxy media, atomic publication/rollback, clone/history/clipboard/archive and
handoff behavior, an owned requirement, and a still-unavailable capability.

## Composition and trust boundary

Only a privileged application composition root constructs a relationship
authority. It installs:

- `getProject`, `captureTask` plus `assertTaskCurrent`, and an authentic
  `BoundVideoSourceTimingView` resolver for the captured source;
- a repository-owned original observer; and
- one authentic candidate observer configured with the maintained generator and exact timing backend.

The public proof request is a closed own-data record containing only
`sourceId` and optional `AbortSignal`. It cannot carry a project, original
`Blob`, fingerprint, generator, probe, digest, timing result, timing token,
candidate observation, or earlier proof.

Factory-installed ports are trusted code capabilities, not self-authenticating
data. Tests with fake ports prove orchestration only. Arbitrary callback
injection, structural `VideoTimingProbePort` values, disposable
`VideoDerivativeIdentity`, public media metadata, and caller-supplied results
are never described as repository or byte provenance. The maintained
composition must use a repository-owned observer and exact probe adapter before
any product consumer may import these modules.

The original observer opens one lease for the exact captured project/source.
Its private observation contains a canonical genuine original `Blob` and a
closed fingerprint:

```text
authority, projectId, sourceId, storageKey, mimeType,
byteLength, sha256, generationToken
```

Owned media derives `sha256` and `generationToken` from the full trusted asset
record, including `mediaContentToken`; public `mediaAssetMetadata` is
insufficient because it removes that token. Linked media derives them from the
complete normalized binding and active locator lease, including `bindingToken`
and `locatorRevision`. Do not reuse the cache-only
`linkedVideoDerivativeOriginal`. The observer exposes an idempotent currentness
check and release; the relationship always releases exactly once.

The source's persisted `contentSha256`, MIME, IDs, and storage key must exactly
match the observation. An existing changed-content linked relink therefore
fails closed until a later transaction updates canonical source identity or
invalidates proxy state. Exact-content relink may be reconsidered only through
a fresh observation; an old process proof becomes stale when generation
changes.

The observer must bind its canonical `Blob` to that same fingerprint while its
repository generation is held: size, MIME, digest, identity, and generation may
not come from separate reads. This slice trusts that privileged adapter contract
and then checks its closed result; it does not redundantly hash the original.

## Public strict seam

Use these stable public names; additional state accessors between the two owning
modules are `@internal` and must authenticate their opaque inputs first:

```ts
export const VIDEO_PROXY_CANDIDATE_MAXIMUM_BYTES = 512 * 1024 * 1024;
export const VIDEO_PROXY_CANDIDATE_MAXIMUM_TIMING_PROBES = 8;

export interface VideoProxyCandidateObserver { readonly kind: 'video-proxy-candidate-observer'; readonly version: 1 }
export function createVideoProxyCandidateObserver(
	dependencies: VideoProxyCandidateObserverDependencies,
): VideoProxyCandidateObserver;

export interface VideoProxyRelationshipAuthority { readonly kind: 'video-proxy-relationship-authority'; readonly version: 1 }
export interface VideoProxyRelationship { readonly kind: 'video-proxy-relationship'; readonly version: 1 }
export interface VideoProxyRelationshipRequest { readonly sourceId: string; readonly signal?: AbortSignal }
export interface PreparedVideoProxyRelationship { readonly relationship: VideoProxyRelationship; readonly candidate: Blob }
export function createVideoProxyRelationshipAuthority(
	dependencies: VideoProxyRelationshipAuthorityDependencies,
): VideoProxyRelationshipAuthority;
export function proveVideoProxyRelationship(
	authority: VideoProxyRelationshipAuthority,
	request: VideoProxyRelationshipRequest,
): Promise<PreparedVideoProxyRelationship>;
export function assertVideoProxyRelationshipCurrent(
	authority: VideoProxyRelationshipAuthority,
	relationship: VideoProxyRelationship,
	request: VideoProxyRelationshipRequest,
): Promise<void>;
export function videoProxyRelationshipInfo(
	relationship: VideoProxyRelationship,
): VideoProxyRelationshipInfo;
```

Both factory results are fresh frozen tokens authenticated through private
`WeakMap`s; forged authorities refuse before invoking dependencies. The
candidate factory dependencies are one closed generator/recipe and a dense bounded
exact-probe list. Relationship dependencies are closed `getProject`, `captureTask`,
`assertTaskCurrent`, `resolveOriginalTiming`, `observeOriginal`, and authentic
`candidateObserver` fields. `captureTask()` returns one opaque operation token and
`assertTaskCurrent(token)` is monotonic across same-project mutations. Capture every
function/identity once; reject accessors, extra keys, unstable proxies, or unbranded
candidate observers. The original lease is a closed result containing only its
canonical `Blob`, frozen fingerprint, currentness check, and idempotent release.

## Synchronous target admission

`proveVideoProxyRelationship` is a non-`async` wrapper. Before returning its
inner `Promise` or starting any original, generator, digest, body, or probe work:

1. validate exact current V16 and snapshot the project/task generation;
2. descriptor-snapshot the one matching canonical video source and reject
   missing, duplicate, non-video, accessor-backed, or projection state;
3. authenticate and bind the source's current timing token to that snapshot;
4. descriptor-scan both `project.clips` and `project.projectBin.clips`; and
5. for every occurrence with the target `sourceId`, require an own enumerable
   data `retimeMap` whose value is exactly `null`.

Unrelated-source retime curves do not block the operation. Retain one frozen
target fingerprint covering the full captured source record, source timing
identity, each target clip record, its timeline-or-bin store, and owning IDs.
Do not retain the project object. Exact V16 validation supplies the existing
100,000-node and depth-128 structural ceilings.

After each high-level asynchronous boundary, check cancellation, the monotonic
task fence, and the original lease. Immediately before proof publication,
revalidate the current project from `getProject`, repeat the descriptor scan,
and require exact target-fingerprint equality. This catches same-revision
in-place source, membership, retime, or timing drift as well as project
replacement; change-then-restore is caught by the task fence.

## Candidate observation

The candidate observer captures and validates its configured generator,
recipe, and exact probe identities at authority construction. IDs are printable,
pathless strings of at most 128 characters and versions are positive safe
integers. At most eight maintained timing probes may be configured. The
generator receives only the canonical original `Blob`, its frozen scalar
identity, the recipe, signal, and currentness callback.

Canonicalize the generator result with `canonicalMediaContentBlob`, bypassing
`Blob` subclass overrides. Require a nonempty genuine `video/*` `Blob` no
larger than `VIDEO_PROXY_CANDIDATE_MAXIMUM_BYTES = 512 * 1024 * 1024`; a
lower-only test/host override may reduce but never raise that ceiling. Hash that
same canonical object with `digestMediaContent` and its existing 4 MiB chunk
bound. Then give the same object to the captured timing-probe composition.

Only `decision: 'timing-asset'` is exact evidence. The CFR fallback branch,
zero successful probes, malformed probe output, and more than eight probes
refuse. Create an in-memory timing publication bound to the computed candidate
SHA-256, validate its bytes, build an ephemeral distinct video-source timing
token, and retain neither a global timing registration nor persisted timing
asset. The synthetic source ID is private and never becomes a project or proxy
asset ID.

The opaque candidate observation is authenticated in a module-private
`WeakMap`. Private state may live only until the relationship operation consumes
it and contains the canonical candidate `Blob`, authentic timing token, and
frozen scalar facts. It must not expose raw probe output, an index, timing bytes,
or a public token-construction path. The candidate `Blob` is returned separately
for 3B-6c publication; the final relationship proof never retains it.

The 512 MiB ceiling bounds the candidate byte sequence and hash traversal, not
generator, demuxer, decoder, browser-heap, process-RSS, temporary-file, or
FFmpeg-WASM memory. Those remain unqualified and are a hard stop before a
maintained attachment workflow.

## Relationship proof and public facts

Authenticate the original timing token and consumed candidate observation,
then call `proveVideoProxyTimingConformance`. Retain the authentic 3B-6a proof,
not reconstructed info. On success and only after the final target/original
checks, issue a fresh minimal frozen relationship object authenticated by a
private `WeakMap`.

Expose a separately frozen `VideoProxyRelationshipInfo` containing only:

- kind/version and rule
  `exact-original-generation-proxy-content-and-timing-v1`;
- project ID, original source ID/SHA-256, and original authority kind;
- candidate SHA-256, byte length, canonical MIME type;
- generator and recipe IDs/versions plus exact timing backend ID;
- timing rule, frame count, and boundary count from 3B-6a; and
- audio policy `ignore-proxy-container-audio-v1`.

The proof's private state retains only scalar original/target fingerprints and
the authentic 3B-6a proof. It retains no project/source object, original or
candidate `Blob`, repository row/path/locator, lease, generator, callback,
probe result/index/bytes, timing token, or candidate observation. Cloned,
spread, serialized, shape-compatible, and wrong-type proof values refuse.

Return `{ relationship, candidate }` as a frozen preparation.
`assertVideoProxyRelationshipCurrent` authenticates both inputs, validates the current
project and timing, opens one fresh original observation, compares retained
fingerprints, and releases once. It never regenerates the candidate or revives a proof
from info.
Proxy container audio is ignored and cannot replace canonical extracted audio,
source monitoring, delivery, or export.

## Strict red and acceptance

Start with `tests/audio-editor-video-proxy-relationship.test.ts`, extracting
fixtures before the 600-line ceiling. Prove:

- success uses one canonical candidate object for digest and exact probe,
  consumes authentic 3B-6a evidence, freezes fresh proof/info/preparation, and
  ignores reported candidate audio;
- target timeline and Project Bin retime refuse synchronously with zero original,
  generator, digest, body, or probe work, while unrelated retime is irrelevant;
- unavailable/stale original timing, exact-probe fallback, interior/final/count
  drift, malformed candidate MIME/size, subclass overrides, and every cap at
  and above its independently reachable boundary refuse;
- project replacement, same-revision source/clip/membership/retime drift, and
  every original fingerprint/generation change refuse after deferred work;
- cancellation preserves its exact reason, all faults release once, inputs stay
  unchanged, and no Blob/project/index/port/result is retained;
- closed requests and factory records reject extra keys/accessors before work;
  proof forgeries refuse without getter invocation; and
- source audit pins the pre-I/O scan, same-Blob digest/probe path, exact-only
  timing branch, one 3B-6a call, final recheck, dormancy, and no derivative-cache
  or global timing-registration dependency.

Run the focused red/green tests, all TypeScript configs, focused lint,
architecture/file-size, diff/link/roadmap checks, and `npm run check`. No browser
row is required because no maintained consumer imports either module.

## Non-goals and hard stops

- No V17, persistence/publication, storage cleanup, clone/history/undo/clipboard,
  `.scape`, desktop/shared handoff, relink mutation, command, Project Bin menu,
  preview role, offline substitution, export, capability/requirement/register
  change, multicam, cloud media, or default-visible UI.
- Stop if exact timing depends on CFR fallback, floats, duration-only inference,
  a caller digest/probe/result/proof, unverified timing bytes, or target retime.
- Stop if the maintained composition cannot provide a repository-owned original
  observation and exact candidate probe, if a candidate exceeds the byte cap,
  if cleanup/currentness is ambiguous, or if any consumer would treat this
  dormant proof as durable attachment or source authority.
