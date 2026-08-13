# Milestone 3B-6c-c1a: dormant Framescaper runtime-profile prerequisite

> **Implemented as a dormant prerequisite in `13f80172` on 2026-08-12; no
> selector or production behavior is authorized.** This slice adds one opaque,
> unreachable token that freezes the reviewed Framescaper V18 runtime identity
> around the implemented c-c0 storage token. It is not the final selectable
> runtime profile, persists nothing, and changes no Soundscaper schema,
> capability, archive, storage, desktop, or UI behavior.

## Dependency and split

The reviewed
[Framescaper V18 product-isolation boundary](milestone-3b-framescaper-v18-product-isolation.md)
requires one indivisible selected profile before durable c-c work. Most of that
profile's literal identity can be frozen now, and c-c0 already supplies an
authentic [Framescaper V18 storage token](milestone-3b-framescaper-storage-profile.md).
The separately implemented c1b profile now supplies an authenticated but
unreachable Framescaper capability token. The global structural map in
`project-feature-capabilities.ts` and product metadata remain non-authoritative.

This slice therefore owns a **prerequisite token**, not
`EditorProjectRuntimeProfile`. It contains every currently authentic static
field and the exact c-c0 child token, but no `capabilityProfile` field. The
later atomic c-c transition must create the final runtime profile from the
exact c1a prerequisite and c1b capability-token identities. That final creator
authenticates and retains both token identities; it does not accept, reparse,
copy, or reconstruct authority from the prerequisite definition snapshot. An
equal definition, `null`, `undefined`, a boolean, a callback, or a structural
capability object must never fill that missing authority.

## Exact generic API

Add one strict TypeScript owner:

```text
src/common/editor/project-runtime-profile-prerequisite.ts
```

It exports only this API:

```ts
interface EditorProjectRuntimeProfilePrerequisiteDefinition {
	readonly owner: string;
	readonly projectSchemaVersion: number;
	readonly storageProfile: EditorProjectStorageProfile;
	readonly priorSchemaPolicy: 'reimport-required';
	readonly futureSchemaPolicy: 'opaque-read-only';
	readonly scapeFormatVersions: readonly number[];
	readonly attachedScapeFormatVersion: number;
	readonly desktopLibrarySchemaVersion: number;
	readonly desktopProjectSchemaVersion: number;
	readonly desktopDatabaseUserVersion: number;
	readonly desktopLibraryScope: readonly string[];
}

type EditorProjectRuntimeProfilePrerequisite = /* opaque nominal token */;

createEditorProjectRuntimeProfilePrerequisite(
	definition: unknown,
): EditorProjectRuntimeProfilePrerequisite;

editorProjectRuntimeProfilePrerequisiteDefinition(
	profile: unknown,
): Readonly<EditorProjectRuntimeProfilePrerequisiteDefinition>;
```

These are exactly four named TypeScript declarations: two type-only exports and
the two runtime value exports `createEditorProjectRuntimeProfilePrerequisite`
and `editorProjectRuntimeProfilePrerequisiteDefinition`. The imported
`EditorProjectStorageProfile` type is not re-exported.

The common owner imports only the generic c-c0 storage-profile type and
authenticator. It imports no product module, schema constructor, archive,
capability map, controller, desktop owner, or callback.

## Closed definition law

The constructor accepts only an `Object.prototype` or null-prototype record
with exactly the eleven own enumerable data properties shown above. Missing or
extra string/symbol keys, non-enumerables, accessors, arrays, class instances,
functions, and primitives refuse. Snapshot the prototype and own keys once and
each declared descriptor once; never perform an ordinary property get.

After the top-level descriptor snapshot, authenticate `storageProfile` through
`editorProjectStorageProfileNames` before requesting either nested array's
prototype, keys, length, element descriptors, or any other trap. A forged,
cloned, serialized, or Proxy-wrapped storage token refuses without observing
that candidate and before any nested-array behavior. The authentic child
identity is retained; its names are neither copied into nor exposed from this
prerequisite.

The remaining fields obey these rules:

- `owner` is 1..64 lowercase ASCII characters and matches
  `^[a-z][a-z0-9-]{0,63}$`;
- every version is a positive safe integer, and
  `desktopProjectSchemaVersion === projectSchemaVersion`;
- both policy values are the exact literals declared by the interface;
- `scapeFormatVersions` is a plain dense array of 1..16 strictly increasing,
  unique positive safe integers, and `attachedScapeFormatVersion` is a member;
- `desktopLibraryScope` is a plain dense array of 1..8 strings; each is 1..128
  lowercase ASCII characters matching
  `^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$`; and
- nested arrays have only their canonical index and `length` properties, no
  symbols, accessors, holes, or extra keys. Their prototype, keys, length, and
  element descriptors are snapshotted once without ordinary gets.

Trap failures and nonconforming descriptor results refuse. A
descriptor-conforming constructor-input Proxy may be accepted, but later input
or trap behavior cannot affect the stored value. The returned definition is a
detached, deeply frozen snapshot; its arrays are fresh frozen copies and its
`storageProfile` is the same authentic token identity.

## Token authentication

Each successful creation returns a fresh, frozen, null-prototype token with
zero own keys. A private `WeakMap` binds that identity to the normalized
definition. Equal definitions produce distinct tokens.

The definition accessor performs the private lookup before inspecting any
candidate property, prototype, key, or descriptor. Plain objects, functions,
arrays, symbols, spreads, serialization results, structured clones, and a
Proxy around an authentic token all throw `TypeError`; forgery Proxies execute
zero traps. Tokens and snapshots are process- and JS-realm-local and are never
wire authority.

## Exact Framescaper owner

Add one product-owned strict module:

```text
src/framescaper/editor-project-runtime-profile-v18-prerequisite.ts
```

It exports only
`FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE`, created once with this
exact definition:

```ts
{
	owner: 'framescaper',
	projectSchemaVersion: 18,
	storageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE,
	priorSchemaPolicy: 'reimport-required',
	futureSchemaPolicy: 'opaque-read-only',
	scapeFormatVersions: [1, 2],
	attachedScapeFormatVersion: 2,
	desktopLibrarySchemaVersion: 10,
	desktopProjectSchemaVersion: 18,
	desktopDatabaseUserVersion: 12,
	desktopLibraryScope: ['kw.media', 'scape-project-library', 'v10'],
}
```

No barrel re-exports it. Only its focused test may import the exact constant.
Implementation `13f80172` updates c-c0's focused exact storage-token reference
allowlist to admit this one product-owned module as the storage token's sole
dormant production consumer while retaining the exhaustive source scan. No
app, bootstrap, common product profile, route, UI, controller, project/schema,
archive, compatibility, repository, lock, worker, file, desktop, capability,
or Soundscaper module imports or selects either prerequisite.

## Strict RED and acceptance

Before production, add one strict focused Node test below 600 lines proving:

- the four named generic TypeScript declarations, exactly two runtime value
  exports, and the sole exact product runtime export;
- exact Framescaper values and exact c-c0 child-token identity;
- fresh frozen zero-key tokens and deeply frozen, detached definitions;
- closed top-level and nested descriptor traversal, null-prototype input,
  bounded conforming-Proxy traps, zero getters, and input-mutation isolation;
- every scalar, version relationship, array density/order/uniqueness, scope
  grammar, length boundary, extra key, symbol, accessor, and prototype refusal;
- storage-child authentication precedes nested traversal, and forged/cloned/
  wrapped prerequisite or storage tokens refuse with zero candidate traps;
- equal definitions do not grant the exact product singleton's identity; and
- exhaustive static dormancy: the product constant has no maintained consumer,
  the c-c0 token's only new production reference is this dormant owner, neither
  token reaches a selector, and common/Soundscaper owners import no Framescaper
  module; the same implementation updates the c-c0 contract and exact static
  reference list to record that narrow successor without relaxing either
  audit.

Run the focused test, every TypeScript configuration, focused lint,
architecture/file-size and dependency checks, `git diff --check`, then
canonical `npm run check`. No browser row is required because the token is
unreachable and has no UI or behavior.

Implementation `13f80172` passed both focused dormant profile suites (2/2),
`tsconfig.json`, `tsconfig.tests.json`, `tsconfig.desktop-runtime.json`, and
`tsconfig.tooling.json`, targeted ESLint, `git diff --check`, and the
architecture/file-size gate over 1,017 modules, 2,802 dependencies, and 2,199
maintained files. Static proof finds no selector or maintained consumer beyond
the exact dormant Framescaper owner, and no common or Soundscaper owner imports
the product token. The full Node suite passed 5,798 tests (5,796 passed and 2
reference-scale rows skipped), and the canonical `npm run check` completed
lint, typecheck, architecture, audits, coverage, and the production build. The
separately reviewed dormant
[Framescaper runtime capability
profile](milestone-3b-framescaper-runtime-capability-profile.md) is implemented
through `c1c70639`, without composition, selection, or production authority.

## Hard stops

This slice authorizes only the generic prerequisite owner, exact product token,
and their strict proof. It does not authorize `EditorProjectRuntimeProfile`, a
capability token or registration, a selector, bootstrap/app option, V18
constructor or validator, c-c0 storage selection, archive format 2, retention,
repository claims, controller wiring, cross-realm handshake, desktop v10,
proxy staging or attachment, menu/UI, or Soundscaper change.

The first maintained selector remains the full atomic c-c transition. Stop if
the prerequisite becomes reachable, if a structural capability placeholder is
introduced, or if any existing global V17/Soundscaper owner changes.
