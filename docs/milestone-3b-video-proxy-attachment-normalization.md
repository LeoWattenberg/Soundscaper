# Milestone 3B-6c-b1: dormant V18 proxy-attachment normalization

> **Implemented on 2026-08-12.** Contract `5a59a796`, strict RED
> `e9687c0c`, production `189e901f`, and proof hardening `692fee74` delivered
> this slice. This is
> a Framescaper-only milestone slice at the domain boundary. It defines one
> pure V18 attachment value but does not make V18 current, consume proxy
> preparation material, write or read storage, add a project field, register a
> capability, or create a product/UI consumer. Soundscaper product work remains
> out of scope.

## Outcome and ownership

Add one strict TypeScript owner:

```text
src/common/editor/video-proxy-attachment-v18.ts
```

It exports only the closed `VideoProxyAttachmentV18` type, the
`VIDEO_PROXY_MAXIMUM_BODY_BYTES` constant, and:

```ts
normalizeVideoProxyAttachmentV18(
	value: unknown,
): Readonly<VideoProxyAttachmentV18>;
```

The function validates and detaches one persisted scalar relationship. It is a
wire normalizer, not a project validator, body proof, relationship proof,
storage plan, or adoption authority. The module lives beside the video domain,
not under `storage/`, and imports the lightweight timing-reference owner
directly from `video-timing-asset-reference.ts`. It must not import timing
encoding/hashing, candidate observation, relationship, project validators,
repositories, controllers, app/UI, capability, archive, or desktop owners.

The dormant module has no barrel export and no maintained consumer. A future
Framescaper-selected V18 validator may own its project-level use only after the
separate product-isolation transition is reviewed.

## Exact closed value

The input has exactly these 19 own enumerable data properties:

```ts
interface VideoProxyAttachmentV18 {
	readonly kind: 'video-proxy-attachment';
	readonly version: 1;
	readonly rule: 'exact-original-generation-proxy-content-and-timing-v1';
	readonly storageKey: string;
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

The outer value is a plain record with `Object.prototype` or `null` prototype.
Arrays, class instances, primitives, symbols, missing or extra properties,
non-enumerables, and accessors refuse. Snapshot `getPrototypeOf` and `ownKeys`
once, then read each declared value exactly once with
`getOwnPropertyDescriptor`; never use ordinary property gets. Perform all later
work on the private snapshot.

Apply the same law to the nested timing reference before passing its detached
eight-field record to `normalizeVideoTimingAssetReference`. Getters are never
invoked. Trap failures or nonconforming trap results refuse. A
descriptor-conforming Proxy is observationally valid input; do not claim that
JavaScript can identify every Proxy. Post-snapshot mutation or changing `get`
behavior cannot affect the result because no raw input is retained or reread.

Return a fresh plain value with a fresh nested timing reference. Deep-freeze
both records. Repeated normalization of the same input yields equal values but
distinct identities. Mutating the input or a nested alias after return cannot
change either result.

## Scalar and cross-field law

Require:

- exact `kind`, `version`, `rule`, `timingRule`, and `audioPolicy` literals;
- lowercase hexadecimal 64-character `sha256` and `originalSha256`;
- `storageKey === "video-proxy-sha256:" + sha256`;
- `byteLength` is a safe integer in `1..536870912`, and the exported constant
  equals 512 MiB;
- `mimeType` is lowercase, parameterless canonical `video/*`, begins its
  subtype with an ASCII alphanumeric, uses only the existing admitted subtype
  punctuation, and is at most 128 characters;
- `originalAuthorityKind` is exactly `owned` or `linked`;
- generator, recipe, and timing-backend IDs are 1..128 printable ASCII
  characters, contain neither slash nor backslash, and do not accept leading or
  trailing whitespace;
- generator/recipe versions and frame/boundary counts are positive safe
  integers;
- checked arithmetic proves `boundaryCount === frameCount + 1` without an
  unsafe intermediate;
- the normalized timing reference has
  `sourceSha256 === attachment.sha256`; and
- its `frameCount === attachment.frameCount`.

`normalizeVideoTimingAssetReference` continues to own the exact timing
encoding, digest-addressed key, byte length, frame count, timescale, and final
duration grammar. The attachment normalizer must first descriptor-snapshot the
nested record so that the timing owner never receives raw hostile input.

The normalizer does not hash or load bytes and therefore cannot prove that a
body exists, has a media role, or matches either digest. Provenance strings and
the attach-time authority kind remain diagnostic scalar state, not publisher
or current ownership authority.

## Deliberately deferred owner laws

This slice cannot validate facts that are absent from one attachment. Defer all
of the following to the future Framescaper V18 project/adoption owner:

- `originalSha256 === source.contentSha256` and current original authority;
- attachment and timing counts against the owning source;
- at least one timeline or Project Bin occurrence and every occurrence's exact
  `retimeMap === null` closure;
- canonical-source ID/storage-key collision checks;
- agreement among attachments sharing proxy or timing storage keys;
- owned-requirement reconciliation and capability admission;
- relationship/preparation authentication, currentness, or generator
  attestation;
- body presence, media-row kind/encoding/private identity, digest verification,
  claims, leases, quota, retention, cleanup, or publication; and
- archive, desktop, clipboard, history, relink, UI, preview, or export behavior.

In particular, c-b1 does not consume
`PreparedVideoProxyRelationship`. Consuming the one-use preparation before a
durable claim/root can be installed would strand its candidate and timing
publication on failure.

## Storage stop and later packet split

Durable body staging is not authorized in this slice. The current default
store, OPFS directory, lifecycle coordinator, clear/maintenance paths, and
retention roots are shared with Soundscaper. `OwnedMediaAssetPublication`
intentionally hides the full row identity and exposes only stripped metadata
plus `discardIfCurrent`; current media writers refuse occupied immutable keys
and release staging ownership when a row publishes. There is no durable proxy
claim/reuse capability.

Adding claim rows to today's shared `mediaAssetStaging` store would make
Soundscaper maintenance observe or remove Framescaper work. The exact
Framescaper IndexedDB/memory/OPFS/worker/lock namespace, private full-row claim
authority, bounded reconciliation, and cleanup tombstones therefore remain
part of the product-isolated c-c composition. A generic primitive may be
reviewed with that owner, but c-b1 wires none of it.

The previously proposed standalone adoption lease is likewise folded into
c-c. Only the atomic V18 coordinator can distinguish precommit failure,
authoritative commit, and indeterminate settlement while holding the original
lease. c-b1 makes no settlement claim.

## Reds and acceptance

Start with one strict Node test under 600 lines. Prove:

- the exact golden 19-field value, all literals, and a fully normalized nested
  timing reference;
- fresh top-level/nested identities, deep freeze, input mutation isolation, and
  equal-value repeat normalization;
- every missing and extra field, string/symbol extra key, non-enumerable, and
  accessor refusal at both levels with zero getter calls;
- primitive, array, class-instance refusal and null-prototype acceptance;
- exactly one prototype/key/descriptor snapshot traversal and zero ordinary
  `get` traps for descriptor-conforming Proxies;
- every literal, digest, storage-key, byte limit, MIME, ID, version, count,
  boundary, timing-source, timing-frame, and nested-reference failure;
- exact admission at 512 MiB and refusal at +1; and
- static dormancy: no import from V17/current project constructors or
  validators, storage/repository/controller/app/UI/capability/archive/desktop
  owners, and no maintained owner imports the new module.

Run the focused test, every TypeScript configuration, focused lint,
architecture/file-size and dependency checks, `git diff --check`, then
canonical `npm run check`. No browser row is required because the module is
dormant and has no product consumer.

Production `189e901f` and proof-hardening `692fee74` completed the normalizer on
2026-08-12. Canonical `npm run check` passed with 5,744 tests (5,742 passed and
2 skipped), 90.17% statement and line coverage, 81.69% branch coverage, and
91.3% function coverage; architecture covered 1,011 modules, 2,790
dependencies, and 2,189 maintained files; and the build emitted 115 JavaScript
chunks with a 428,990-byte largest chunk. The exact three-export module remains
dormant: no maintained consumer imports it, and it adds no persistence,
preparation consumption, project/schema owner, capability, UI, browser row, or
Soundscaper change.

Packet 3B-6 remains **In progress**. This normalizer does not authorize body
staging, V18 adoption, capability availability, proxy use, or any Soundscaper
work. Durable storage and c-c remain hard-stopped on the separately reviewed
Framescaper product-isolation transition.
