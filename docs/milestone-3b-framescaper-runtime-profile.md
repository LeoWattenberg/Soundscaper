# Milestone 3B-6c-c1c: Framescaper runtime profile

> **Implemented as a dormant runtime profile in `ace30ac1` on 2026-08-13, then
> admitted only by the reviewed isolated V18 domain during atomic c-c.** Contract
> `90b66b61`, authority reviews `dbc9b807` and `39c02557`, strict RED
> `a2e1ee03`, and proof hardening `6f82c3c2` and `758705ac` delivered one opaque,
> originally unreachable Framescaper composition. Its closed consumers are now
> limited to isolated V18 project/command/history ownership, desktop v10
> current-project admission, and their focused proofs. It does not expose a
> structural profile, register a capability, or change Soundscaper.

## Dependency and boundary

The implemented c1a prerequisite authenticates the exact V18, archive,
desktop, and c-c0 storage identity. The implemented c1b profile authenticates
the exact private Framescaper capability identity. Neither token is selectable.
The final profile creator must retain those exact child-token identities; it
must not copy, flatten, reparse, or reconstruct their definition snapshots.

This dormant composition closes only the final process-local identity needed by
the atomic c-c transition. The later selector must accept the one exact
Framescaper singleton before resolving children or causing side effects, then
bind every V18 owner in one reviewed change. Any fresh runtime token, including
one created from the same exact child singletons, does not gain product
selection authority.

## Exact generic API

Add `src/common/editor/project-runtime-profile.ts`, exporting only:

```ts
interface EditorProjectRuntimeProfileDefinition {
	readonly prerequisite: EditorProjectRuntimeProfilePrerequisite;
	readonly capabilityProfile: EditorProjectFeatureCapabilityProfile;
}

type EditorProjectRuntimeProfile = /* opaque nominal token */;

createEditorProjectRuntimeProfile(
	definition: unknown,
): EditorProjectRuntimeProfile;

editorProjectRuntimeProfileDefinition(
	profile: unknown,
): Readonly<EditorProjectRuntimeProfileDefinition>;
```

These are exactly two type declarations and two runtime value exports. The
module imports only the two generic child-profile modules and their existing
authentication accessors. The public accessor returns only the stable frozen
pair after authenticating the final token. It grants no child selection
authority: maintained consumers must receive and capture the final runtime
token, never separately supplied extracted children or child overrides. The
module has no product, schema, storage implementation, archive, compatibility,
controller, desktop, UI, or callback dependency.

## Closed composition law

The definition is an `Object.prototype` or null-prototype record with exactly
own enumerable data properties `prerequisite` and `capabilityProfile`.
Snapshot in this exact order:

1. top-level prototype;
2. top-level own keys;
3. `prerequisite` descriptor;
4. `capabilityProfile` descriptor;
5. authenticate the prerequisite token through its existing accessor;
6. only after that succeeds, authenticate the capability token through its
   existing accessor; and
7. last, require the two authenticated snapshots to have the same exact
   `owner`.

Never perform an ordinary property get on caller input or either child token.
Accessors, symbols, missing or extra keys, non-enumerables, arrays, foreign
prototypes, nonconforming Proxy results, forged children, and different child
owners refuse with `TypeError`. Thrown Proxy-trap errors propagate unchanged. A
descriptor-conforming definition Proxy is allowed, but later input or trap
mutation cannot alter the result.

Authentication reads only the immutable `owner` values for consistency. It
does not copy or revalidate any other child fact; the c1a and c1b owners and
proofs remain authoritative for those details. A prerequisite failure performs
no capability authentication, a capability failure occurs only after a valid
prerequisite, and construction performs no later raw input read.

The frozen definition snapshot is a fresh ordinary `Object.prototype` record.
Its exact own-key order is `prerequisite`, then `capabilityProfile`; both are
enumerable data properties made non-writable and non-configurable by freezing.
It retains the exact two child token identities, does not expose either child
definition, flatten literals, or retain the caller's container, and the
accessor returns this same snapshot identity on every call.

## Opaque authentication

Each successful creation returns a fresh, frozen, null-prototype, zero-key
token. A private `WeakMap` binds that identity to the frozen composition
snapshot. The accessor performs only the private lookup before observing the
candidate. Forged, spread, serialized, structured-cloned, and Proxy-wrapped
tokens refuse with `TypeError`; forgery Proxies execute zero prototype, key,
descriptor, and get traps. The token is process- and JS-realm-local and is never
wire or cross-realm authority.

## Exact Framescaper owner

Add `src/framescaper/editor-project-runtime-profile-v18.ts`. It exports only
`FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE`, created once from exactly:

```ts
{
	prerequisite: FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	capabilityProfile: FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE,
}
```

The product module imports only the generic creator and those exact two child
singletons. It does not import storage directly, inspect child snapshots, or
derive anything from a product profile, global capability map, route,
configuration, or ambient `productId`.

No barrel re-exports the constant. Only the focused proof imports it. No app,
bootstrap, route, common product owner, project/schema, compatibility,
controller, archive, repository, desktop, UI, Soundscaper, or existing child
profile module imports or selects it. The existing c1a and c1b dormancy proofs
may admit the exact new product module and focused test for product constants,
and the generic c1c module for the generic child paths/APIs, as their only
narrow successor references.

## Strict RED and acceptance

Before production, add one strict TypeScript Node test below 600 lines proving:

- four named TypeScript declarations, exactly two generic runtime exports, and
  the sole exact product export, including compile-time nominality;
- the exact singleton retains both exact child-token identities and their
  authenticated matching Framescaper owner without flattening them; predecessor
  suites remain the detailed proof for c1a/c1b facts;
- fresh frozen zero-key runtime tokens, stable accessor identity, a detached
  frozen composition snapshot, and null-prototype input support;
- exact top-level descriptor order, bounded trap counts, and zero ordinary
  gets;
- exhaustive prototype/key/symbol/enumerability/accessor and malformed-proxy
  refusal, with trap failures propagated unchanged;
- both top descriptors captured before child authentication; prerequisite
  failure short-circuits capability authentication, capability failure follows
  only a valid prerequisite, owner comparison is last, and no raw reads follow;
- forged/wrapped child refusal with zero child traps, same-owner acceptance,
  and cross-owner refusal;
- fresh authentic same-owner children with equal definitions may create a
  generic profile but cannot reproduce or equal the exact Framescaper
  singleton;
- a fresh authentic profile built from the exact Framescaper c1a and c1b
  singleton tuple is still distinct from and cannot reproduce the exact
  Framescaper final singleton;
- forged/cloned/wrapped runtime-token refusal with zero candidate traps; and
- exhaustive source/path/reference ownership: only the explicit isolated V18
  project domain, desktop v10 current-project admission, and focused proofs may
  consume the singleton; no barrel, common, Soundscaper, app, bootstrap,
  product-profile, UI, or ambient `productId` path may import it.

Run the focused c1a, c1b, and c1c tests, every TypeScript configuration,
focused ESLint, architecture/file-size and dependency checks,
`git diff --check`, then canonical `npm run check`. Browser qualification is
owned by the later reachable product composition, not this isolated boundary.

## Hard stops

The original c1c slice contained only the generic opaque composition owner and
exact Framescaper singleton. Atomic c-c now authorizes its exact identity only
through the closed isolated V18 project/command/history and desktop v10
current-project boundaries. It still authorizes no app selector, bootstrap
option, c-c0 storage selection, capability registration or flip, archive
format 2, preservation, retention, repository claim, controller wiring,
cross-realm operational handshake, proxy staging/attachment/use, UI/menu, or
Soundscaper change.

Stop if the token reaches app/bootstrap selection outside the atomic c-c
composition, if child authority is flattened or structural, or if any existing
global V17/Soundscaper owner changes.

## Implementation evidence

The focused c1c proof passes all 10 cases, while the combined c1a/c1b/c1c suite
passes 34/34. The final canonical `npm run check` passed 5,822 tests (5,820
passed and 2 reference-scale rows skipped), with 90.22% statement and line
coverage, 81.8% branch coverage, and 91.33% function coverage. Architecture
covered 1,021 modules and 2,808 dependencies; the size gate covered 2,205
maintained files. The production build emitted 115 JavaScript chunks, with a
428,990-byte largest chunk. No browser row was required because no maintained
consumer, UI, or behavior imports the final token.
