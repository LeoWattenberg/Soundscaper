# Milestone 3B-6c-c1b: dormant Framescaper runtime capability profile

> **Implemented dormant authority — no maintained production behavior or
> selection is authorized.** Contract `2f6b9a64`, RED `91bcb998`, production
> `c1c70639`, and proof hardening `8a27e1df` and `cada0058` delivered one
> opaque, unreachable Framescaper capability token. It freezes the current 28
> Framescaper key-to-feature-ID availability decisions plus private
> `videoProxy: false`; it does not register that capability globally, compose
> c1a, select V18, or change Soundscaper.

## Dependency and boundary

Implemented dormant c1a deliberately omitted `capabilityProfile` because the
global feature-ID registry and structural product capability map are not token
authority. This packet creates that authority without importing either owner.
The later final runtime-profile creator must authenticate and retain the exact
c1a prerequisite token and this exact token identities; it must not accept or
reparse either definition snapshot.

This profile is an isolated declaration, not capability availability in any
maintained application. In particular, `videoProxy: false` makes the future
Framescaper feature known-but-unavailable only after the full atomic c-c
selector lands. It makes nothing known to Soundscaper now.

## Exact generic API

Add `src/common/editor/project-feature-capability-profile.ts`, exporting only:

```ts
interface EditorProjectFeatureCapabilityProfileDefinition {
	readonly owner: string;
	readonly registrations: readonly Readonly<{
		readonly key: string;
		readonly featureId: string;
		readonly available: boolean;
	}>[];
}

type EditorProjectFeatureCapabilityProfile = /* opaque nominal token */;

createEditorProjectFeatureCapabilityProfile(
	definition: unknown,
): EditorProjectFeatureCapabilityProfile;

editorProjectFeatureCapabilityProfileDefinition(
	profile: unknown,
): Readonly<EditorProjectFeatureCapabilityProfileDefinition>;
```

These are exactly two type declarations and two runtime value exports. The
generic module has no imports. It does not know any product, capability key,
feature ID, registry, requirement, compatibility rule, or callback.

## Closed snapshot law

The definition is a plain `Object.prototype` or null-prototype record with
exactly own enumerable data `owner` and `registrations` properties. `owner` is
1..64 lowercase ASCII characters matching `^[a-z][a-z0-9-]{0,63}$`.

`registrations` is a plain dense array of 1..128 entries with only canonical
indices and `length`. Each entry is a plain record with exactly own enumerable
data properties `key`, `featureId`, and `available`:

- `key` is 1..64 ASCII lower-camel alphanumeric, matching
  `^[a-z][A-Za-z0-9]{0,63}$`;
- `featureId` is 1..256 ASCII characters and matches the existing canonical
  namespaced ID grammar
  `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$`;
- `available` is exactly boolean; and
- entries are strictly increasing by code-unit `key`, with no duplicate key or
  duplicate `featureId`.

Snapshot in this exact order: top-level prototype, keys, and both descriptors;
registration-array prototype, keys, length descriptor, then each element
descriptor; then each entry's prototype, keys, and three descriptors. Never
perform an ordinary property get. Accessors, symbols, holes, extra keys,
non-enumerables, foreign prototypes, out-of-bound lengths, malformed values,
unsorted/duplicate registrations, trap failures, and nonconforming Proxy
results refuse. Descriptor-conforming input Proxies are allowed, but later
input/trap mutation cannot change the result.

Return a detached deeply frozen snapshot: fresh frozen registrations array and
fresh frozen entry records. No raw input identity or alias survives.

## Opaque authentication

Each successful creation returns a fresh, frozen, null-prototype, zero-key
token. A private `WeakMap` binds the identity to its snapshot. Equal definitions
produce distinct tokens. The accessor performs only the private lookup before
observing the candidate. Forged, spread, serialized, structured-cloned, and
Proxy-wrapped tokens refuse with `TypeError`; forgery Proxies execute zero
prototype/key/descriptor/get traps. The token is process- and JS-realm-local,
never wire authority.

## Exact Framescaper owner

Add `src/framescaper/editor-project-feature-capability-profile-v18.ts`. It
exports only `FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE`, created once
with `owner: 'framescaper'` and these exact 29 sorted literal registrations:

| key | featureId | available |
|---|---|---:|
| `audioAnalysis` | `org.soundscaper.capability.audio-analysis` | false |
| `audioEffects` | `org.soundscaper.capability.audio-effects` | false |
| `audioGenerators` | `org.soundscaper.capability.audio-generators` | false |
| `audioImport` | `org.soundscaper.capability.audio-import` | true |
| `audioMacros` | `org.soundscaper.capability.audio-macros` | false |
| `audioMixing` | `org.soundscaper.capability.audio-mixing` | true |
| `audioPlayback` | `org.soundscaper.capability.audio-playback` | true |
| `audioRecording` | `org.soundscaper.capability.audio-recording` | false |
| `audioSampleEditing` | `org.soundscaper.capability.audio-sample-editing` | false |
| `audioSpectralEditing` | `org.soundscaper.capability.audio-spectral-editing` | false |
| `audioTimelineEditing` | `org.soundscaper.capability.audio-timeline-editing` | true |
| `audioWarp` | `org.soundscaper.capability.audio-warp` | false |
| `musicalTimeline` | `org.soundscaper.capability.musical-timeline` | false |
| `project` | `org.soundscaper.capability.project` | true |
| `projectBin` | `org.soundscaper.capability.project-bin` | true |
| `sequenceTiming` | `org.soundscaper.capability.sequence-timing` | true |
| `sourceCharacteristics` | `org.soundscaper.capability.source-characteristics` | true |
| `takeComp` | `org.soundscaper.capability.take-comp` | false |
| `timelineAnnotations` | `org.soundscaper.capability.timeline-annotations` | false |
| `trackFolders` | `org.soundscaper.capability.track-folders` | false |
| `videoCompositing` | `org.soundscaper.capability.video-compositing` | true |
| `videoEffects` | `org.soundscaper.capability.video-effects` | true |
| `videoExport` | `org.soundscaper.capability.video-export` | true |
| `videoImport` | `org.soundscaper.capability.video-import` | true |
| `videoPlayback` | `org.soundscaper.capability.video-playback` | true |
| `videoProxy` | `org.soundscaper.capability.video-proxy` | false |
| `videoRetime` | `org.soundscaper.capability.video-retime` | false |
| `videoTimelineEditing` | `org.soundscaper.capability.video-timeline-editing` | true |
| `videoTimingAssets` | `org.soundscaper.capability.video-timing-assets` | true |

Exactly 15 registrations are available. The 28 registrations other than
`videoProxy` are a literal audit snapshot of current Framescaper parity, not a
runtime derivation. The product module imports only the generic creator; it
must not import
`project-feature-capabilities.ts`, `product.js`, `products.js`,
`product-capabilities.js`, configuration inventories, c1a, or Soundscaper.

No barrel re-exports the constant. Only the focused test imports it. No app,
bootstrap, route, common product owner, project/schema, compatibility,
controller, archive, repository, desktop, UI, c1a, or Soundscaper module
imports or selects it.

## Strict RED and acceptance

Before production, add one strict TypeScript Node test below 600 lines proving:

- four named TypeScript declarations, exactly two generic runtime exports, and
  the sole exact product export, including compile-time nominality;
- exact owner, all 29 sorted literals, 15 available, and private
  `videoProxy: false`; the production product module consults no global or
  structural product owner;
- test-only parity proving the 28 non-proxy rows exactly equal every current
  `PROJECT_FEATURE_CAPABILITY_IDS` key-to-ID registration and strict boolean in
  `FRAMESCAPER_PROFILE.capabilities`; neither product profile nor the global ID
  map owns `videoProxy`, both current global product snapshots and V17
  compatibility treat `org.soundscaper.capability.video-proxy` as unknown, and
  the global ID, audio-eligibility, and video-eligibility predicates all refuse
  it;
- fresh frozen zero-key tokens, stable accessor identity, deeply frozen
  detached snapshots, input mutation isolation, and null-prototype inputs;
- exact top/array/entry descriptor order and bounded trap counts, zero ordinary
  gets, throwing and nonconforming Proxy refusal at every level;
- exhaustive prototype/key/symbol/enumerability/accessor/density/length bounds,
  key and feature-ID grammar boundaries, boolean strictness, sorting, and both
  uniqueness laws;
- forged/cloned/wrapped token refusal with zero candidate traps; and
- exhaustive source/path/reference dormancy: no barrel, c1a, common,
  Soundscaper, app, selector, capability registry, product profile, archive,
  controller, desktop, UI, or ambient `productId` consumer.

Run the focused test, every TypeScript configuration, focused ESLint,
architecture/file-size and dependency checks, `git diff --check`, then
canonical `npm run check`. No browser row is required.

## Hard stops

The implemented slice contains only the generic opaque owner, exact dormant
Framescaper singleton, and focused proof. It authorizes no
maintained consumer or behavior, global registry or product-profile edit,
c1a mutation, selector, V18 schema or archive behavior, requirement
registration, compatibility change, proxy storage/attachment/use, desktop v10,
UI/menu, or Soundscaper change. Separately reviewed c1c may import and
authenticate this exact token solely inside an unreachable final profile. The
first reachable use and selector remain the full atomic c-c transition, whose
strict RED must be separately reviewed before production changes. The next
contract-first decomposition is the dormant final
[Framescaper runtime profile](milestone-3b-framescaper-runtime-profile.md),
which remains unreachable and grants no selection authority.

## Implementation evidence

The focused TypeScript proof passes all 11 cases and keeps both production
modules unreachable outside that proof. The final canonical `npm run check`
passed 5,812 tests (5,810 passed and 2 reference-scale rows skipped), with
90.22% statement and line coverage, 81.79% branch coverage, and 91.33%
function coverage. The architecture gate covered 1,019 modules and 2,803
dependencies. The production build emitted 115 JavaScript chunks; the largest
was 428,990 bytes. No browser row was required because no maintained consumer,
UI, or behavior imports either token.
