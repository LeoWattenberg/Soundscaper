# Milestone 3B-6a: exact video-proxy timing conformance

> **Ready for implementation.** This is the first dependency-correct slice of
> [3B-6](milestone-3b-work-packets.md#3b-6--proxies-relink-and-multicamera).
> It is schema-neutral and dormant: no relationship, project field, storage
> publication, command, menu, preview choice, offline fallback, export change,
> capability availability, or compatibility-rule flip lands here. Packet 3B-6
> remains planned until a maintained workflow exists.

## Outcome and dependency order

3B-6a adds one strict pure authority that proves two authenticated video timing
views have exactly the same picture-ordinal presentation boundaries. The result
is an opaque process-local proof with separately readable frozen information.
Only direct unit tests consume it in this slice; it is not JSON or `.scape`
state and does not make a candidate usable as a proxy.

The rest of 3B-6 stays in this order:

1. **3B-6a — timing conformance:** the dormant proof seam below.
2. **3B-6b — exact proxy relationship:** snapshot original identity and both
   clip collections before I/O, reject target-source retime curves, bind proxy
   content/generation provenance to a fresh original fingerprint after I/O,
   and consume an authenticated 3B-6a proof. This remains dormant.
3. **3B-6c — V17 durable attachment:** one atomic revision persists the
   reviewed relationship, preservation paths, owned-state requirement, and
   unavailable capability registration.
4. **3B-6d — proxy lifecycle:** lazy Project Bin menu attachment/removal,
   adaptive preview, predictable offline degradation, and exact relink
   invalidation/revalidation. Only the complete native workflow may flip
   `video-proxy-fallback`.
5. **3B-6e — multicamera:** synchronized groups and sample-canonical sub-frame
   offsets follow proxy lifecycle qualification.

The split keeps 3B-5's exact-executor hard stop unchanged. The relationship
slice will reject any target-source occurrence with non-null `retimeMap` before
candidate-media I/O; conformance neither reads clips nor weakens that stop.

## Authority boundary

- A proxy remains a replaceable presentation choice, never a media source.
  Original source identity, timing, source-frame coordinates, extracted audio,
  edit decisions, timecode, relink, and export remain authoritative.
- This proof says only that the two views have identical presentation
  boundaries. It proves neither content derivation nor perceptual equivalence.
  Later slices own full-container digests, generator provenance, display
  geometry, colour, alpha, field order, decoder support, and quality policy.
- Proxy audio is ignored. It cannot replace, conform, or validate the canonical
  audio extracted from the original; the maintained preview policy remains a
  later contract.
- Posters/thumbnails and `VideoDerivativeIdentity` remain disposable cache.
  They are not proxy relationship, storage, lifecycle, or archival state.

## Exact conformance rule

For authenticated original view `O`, authenticated candidate view `P`, and
common picture count `N`, conformance means:

```text
O.frameCount = P.frameCount = N
and for every integer i in 0..N: time(O, i) = time(P, i)
```

`time(view, i)` is the exact canonically reduced rational returned by the
existing bound timing authority for picture boundary `i`; `i = N` includes the
final picture's duration. Equality is direct numerator-and-denominator identity
between those reduced results. Do not form a new cross-product that could exceed
the timing authority's 4,096-bit work ceiling. Equality never uses `Number`,
seconds, epsilon, accumulated deltas, nominal-rate comparison, timestamp repair,
or sampling.

Representation is not identity. Equal CFR and uniformly spaced VFR views
conform, as do VFR views expressed at different timescales, when all `N + 1`
exact boundaries agree. An unequal interior boundary or final duration refuses
even when frame count, total duration, or nominal rate agrees.

Both inputs must be authentic `BoundVideoSourceTimingView` tokens produced by
the existing timing binding authority. Shape-compatible objects and cloned,
serialized, spread, or forged tokens refuse. The later relationship/controller
must additionally prove that candidate timing came from a complete exact probe
of the candidate bytes; this algebra cannot infer candidate provenance from a
timing token alone.

## Public dormant seam

Own the implementation in a new strict module under 600 lines,
`src/common/editor/video-proxy-timing-conformance.ts`:

```ts
export const VIDEO_PROXY_TIMING_MAXIMUM_FRAMES = 2_000_000;

export interface VideoProxyTimingConformanceInfo {
	readonly kind: 'video-proxy-timing-conformance';
	readonly version: 1;
	readonly rule: 'exact-presentation-boundaries-v1';
	readonly originalSourceId: string;
	readonly proxySourceId: string;
	readonly frameCount: number;
	readonly boundaryCount: number;
}

export interface VideoProxyTimingConformance {
	readonly kind: 'video-proxy-timing-conformance';
	readonly version: 1;
}

export function proveVideoProxyTimingConformance(
	original: BoundVideoSourceTimingView,
	proxy: BoundVideoSourceTimingView,
): VideoProxyTimingConformance;

export function videoProxyTimingConformanceInfo(
	proof: VideoProxyTimingConformance,
): VideoProxyTimingConformanceInfo;
```

`proveVideoProxyTimingConformance` first authenticates both tokens through the
existing bound timing authority, snapshots their source IDs, kinds, and frame
counts, enforces equal positive counts no greater than the exported two-million
ceiling, then applies the exact rule. Source IDs must be nonempty and different:
a proxy candidate is not the original token under a second label.

For two CFR views, compare the frame count and one exact frame duration in O(1);
linearity then proves all boundaries. If either view is VFR, compare all `N + 1`
boundaries in ordinal order and stop at the first mismatch. This is O(N) time
and O(1) additional working storage, within the timing asset's existing
two-million-frame admission ceiling. Do not allocate a boundary array, copy VFR
indexes, or expose their bytes.

Keep that complexity split statically legible. One private
`assertSameExactBoundary(original, proxy, boundary)` helper reads the two
canonical exact times and compares their numerator and denominator directly.
The explicit CFR/CFR branch calls it once at boundary `1`. The other branch has
one ascending `boundary = 0..N` loop and calls it once per iteration; its first
mismatch throws from the helper and therefore short-circuits. Do not hide either
branch in a callback, iterator, generated boundary collection, or production
instrumentation seam.

On success, allocate a fresh minimal frozen proof object and a separate closed,
deeply frozen info snapshot. Authenticate the proof and associate its info in a
module-private `WeakMap`; `videoProxyTimingConformanceInfo` accepts only that
exact live proof identity. The returned graph retains neither input token nor
raw timing state. Equivalent calls may return distinct proofs. No public
constructor, normalization-from-data path, JSON revival, or test escape hatch
exists.

`boundaryCount` is exactly `frameCount + 1`. It and every info field are
diagnostic facts, not later persistence authority. The later relationship must
hold and authenticate the proof itself when it publishes, not reconstruct one
from `VideoProxyTimingConformanceInfo`.

## Strict red and acceptance

Start red only in
`tests/audio-editor-video-proxy-timing-conformance.test.ts`; the first failure
is the missing strict module/export. Prove:

- exact CFR/CFR conformance at integer and NTSC rates, O(1) boundary calls, the
  two-million-frame limit, info values, fresh proofs, deep freeze, and proof
  identity authentication;
- CFR/uniform-VFR and rescaled-timescale VFR/VFR acceptance through exact
  rational equality;
- refusal for unequal counts, first/interior/final boundary drift, including
  equal total duration with one shifted interior boundary and equal preceding
  boundaries with only the last VFR duration changed;
- a source audit of the explicit CFR/CFR single-call branch and the single
  ascending `0..N` non-CFR loop, proving first-mismatch throw, exactly `N + 1`
  successful-path comparisons, O(1) working storage, and no production test
  counter; plus no input/index mutation or retained input;
- forged, spread, cloned, serialized, shape-compatible, wrong-type, and
  unauthenticated timing/proof objects refuse; and
- candidate/original identity aliasing refuses while two distinct source IDs
  with exactly equal timing succeed.

Use only verified timing-asset bytes and the public timing binders to construct
test tokens. Read the production source for the narrow complexity audit; do not
add a production test counter or injection seam. Run the focused test, both
TypeScript configurations, focused lint, architecture, file-size,
roadmap/link/diff checks, and `npm run check`. No Chromium row is required
because no maintained path imports this module.

## Non-goals and stop conditions

- No project/clip scan, `retimeMap` policy, content digest, byte length, recipe,
  provenance, relationship, V17 schema, validator, clone/history/clipboard/
  `.scape`/desktop/archive path, repository, generator, upload, relink mutation,
  command, menu, preview selection, offline fallback, export use, capability or
  requirement registration, compatibility flip, multicam, audio proxy, cloud
  media, or default-visible UI.
- Stop if equality needs floating point, epsilon, nominal-rate or duration-only
  inference, partial VFR sampling, repaired timestamps, unauthenticated timing,
  more than O(1) retained working state, or work beyond the admitted frame cap.
- Stop if a proof can be forged or revived from data, if it retains raw timing,
  if any product consumer must import it, or if its existence makes proxy state
  authoritative or available.
