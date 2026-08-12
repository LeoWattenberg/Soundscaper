# Milestone 3B-6c-c0: dormant Framescaper storage profile

> **Contract draft — production is not yet authorized.** This prerequisite may
> add one opaque shared storage-profile capability and thread an explicitly
> supplied authentic token through existing generic persistence seams. It does
> not select a profile in any app, product, bootstrap, controller, or ordinary
> fixture. It opens no store, creates no directory or worker, acquires no lock,
> persists no proxy, and changes no Soundscaper behavior.

## Generic capability owner

Add one strict TypeScript owner:

```text
src/common/editor/storage/project-storage-profile.ts
```

It exports only generic types and this API:

```ts
interface EditorProjectStorageProfileNames {
	readonly databaseName: string;
	readonly opfsDirectoryName: string;
	readonly opfsWorkerName: string;
	readonly projectLockPrefix: string;
}

type EditorProjectStorageProfile = /* opaque nominal token */;

createEditorProjectStorageProfile(
	names: unknown,
): EditorProjectStorageProfile;

editorProjectStorageProfileNames(
	profile: unknown,
): Readonly<EditorProjectStorageProfileNames>;
```

The implementation owns a private `WeakMap` from token identity to normalized
names. Creation returns a fresh, frozen, null-prototype token with zero own
keys; no name or brand property is observable. Only a token created by this
module is authentic. The names accessor performs only the private identity
lookup, refuses every forged, cloned, wrapped, or cross-realm value with a
`TypeError`, and returns the detached frozen names snapshot. It never inspects
the candidate token's prototype, keys, descriptors, or properties. A Proxy
around an authentic token is a different identity and refuses with zero traps.

The generic module imports no product owner and exports no product constant.
It is not serializable authority and must never be accepted by structural
typing, object shape, a copied name record, or a caller-created symbol.

## Exact Framescaper owner

Add one product-owned strict TypeScript module:

```text
src/framescaper/editor-project-storage-profile-v18.ts
```

It exports only `FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE`, created once through
the generic constructor from these exact names:

```ts
{
	databaseName: 'kw-media-framescaper-editor-v18',
	opfsDirectoryName: 'framescaper-editor-v18-sources',
	opfsWorkerName: 'framescaper-editor-v18-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v18-lock:',
}
```

No barrel re-exports it and no maintained production consumer imports it. A
later separately reviewed Framescaper bootstrap transition must own its first
selection. Shared and Soundscaper owners must not import `src/framescaper`.

## Closed names and identifier law

The constructor input is a plain record with `Object.prototype` or `null`
prototype and exactly the four own enumerable data properties above. Arrays,
class instances, primitives, missing or extra string/symbol keys,
non-enumerables, and accessors refuse. Snapshot `getPrototypeOf` and `ownKeys`
once and each declared property once with `getOwnPropertyDescriptor`; never
perform an ordinary property get. Getter bodies are never invoked. Trap
failures and nonconforming results refuse, while a descriptor-conforming Proxy
remains valid constructor input. Later input or Proxy mutation cannot change
the stored snapshot.

Every value is an ASCII string no longer than 128 characters. Database,
directory, and worker names match:

```text
^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$
```

The 2..128-character lock prefix contains exactly one mandatory final colon;
the preceding identity matches:

```text
^[a-z0-9](?:[a-z0-9-]{0,125}[a-z0-9])?:$
```

Thus empty, uppercase, whitespace, slash, backslash, dot, control, Unicode,
leading/trailing hyphen, interior colon, and over-limit names refuse.

## Narrow opt-in threading

`createProjectStore({ projectStorageProfile })` is the only new project-store
option. An absent property or own value exactly `undefined` uses the existing
defaults. A non-`undefined` value must be an authentic profile, resolved
synchronously before any IndexedDB, memory, OPFS, worker, repository-factory,
or desktop-bridge activity. An authentic profile combined with an own
`databaseName` property, including one whose value is `undefined`, throws a
synchronous `TypeError`; there is never split database/memory identity. The
resolved database name owns both IndexedDB and degraded-memory selection.

Thread only the resolved OPFS directory and worker names through
`createStorageRepositories`, `OpfsRepository`, `OpfsSyncRepositoryBridge`, and
`OpfsSyncWorkerClient`. The directory owner calls
`root.getDirectoryHandle(name, { create: true })` with the exact name. Change
the optional worker seam to `workerFactory(name)`: it is invoked with the exact
resolved name, and the default factory passes that name to the existing module
`Worker` options. Existing factories that ignore arguments remain compatible;
no owner performs an ambient product lookup.

`acquireProjectLock(projectId, { projectStorageProfile, ...options })` treats
absent or exact `undefined` as legacy and otherwise authenticates the token
before requesting a navigator lock or touching local storage or a broadcast
channel. Every navigator-lock name, lease key, channel name, owner probe,
force/takeover path, queued handoff, retry, heartbeat, and release uses the
resolved `projectLockPrefix + projectId`. Internal option copies preserve the
token. The profile grants no new lock authority.

## Exact legacy preservation

With no effective profile, all observable identities stay byte-for-byte
unchanged:

```text
database / degraded-memory key: kw-media-audio-editor
OPFS directory:                 audio-editor-sources
OPFS worker name:               soundscaper-opfs-storage
project-lock prefix:            kw-media-audio-editor-lock:
```

Existing `databaseName` callers remain accepted and affect only database and
degraded-memory selection. No default, repository construction order,
error/fallback behavior, OPFS path, worker URL/type, lock protocol/timing,
store version, or return shape changes. No Soundscaper callsite passes a
profile.

These names isolate records, directories, workers, and locks, but OPFS and
`StorageManager` quota, persistence grants, eviction pressure, and origin usage
remain origin-global browser concerns. c-c0 creates no independent quota or
maintenance claim; later product selection must budget and test that shared
origin boundary explicitly.

## Reds and acceptance

Start with one strict focused Node test below 600 lines. Prove:

- exact generic exports and the exact separately owned Framescaper constant;
- fresh frozen zero-key tokens, frozen detached names, equal-name/different-token
  creation, input-mutation isolation, and null-prototype name admission;
- exhaustive closed-name refusal, zero getters, one descriptor traversal, zero
  ordinary gets, and throwing/nonconforming constructor-Proxy refusal;
- forged plain/class/array/function/symbol/cloned tokens and a Proxy around an
  authentic token all refuse; every forgery Proxy records zero prototype, key,
  descriptor, and get traps;
- every name-grammar boundary, including minimum, 128, 129, hyphen, casing,
  whitespace, slash/backslash, colon, dot, control, and Unicode;
- own `projectStorageProfile: undefined` remains legacy; every non-`undefined`
  forgery refuses before side effects; authentic profile plus any own
  `databaseName`, including `undefined`, refuses before side effects;
- exact routing to IndexedDB/degraded memory, OPFS directory,
  `workerFactory(name)`, default worker name, and every lock/lease/channel route;
- omitted profiles retain all four legacy identities and explicit
  `databaseName` behavior; two authentic profiles have disjoint instrumented
  namespaces, subject to the documented origin-global quota caveat; and
- static dormancy: only the focused test imports the Framescaper constant; no
  app, bootstrap, controller, UI, capability, archive, desktop, schema, proxy,
  shared, or Soundscaper owner selects or imports it.

Run the focused test, every TypeScript configuration, focused lint,
architecture/file-size and dependency checks, `git diff --check`, then
canonical `npm run check`. No browser row is required. `storage.js` is already
adjacent to the 600-line ceiling; extract a focused option adapter rather than
growing it past the limit.

## Hard stops

c-c0 does not select V18, change project/schema/archive compatibility, consume
proxy preparation, import the attachment normalizer, stage or claim a body, add
a store/table/root, define cleanup/reconciliation, alter a budget, add desktop
persistence/handoff, register a capability, or add UI. Namespace separation
alone does not prove independent maintenance or quota isolation.

Packet 3B-6 remains **In progress**. Durable proxy storage and atomic c-c
adoption remain unauthorized until a later reviewed Framescaper product owner
selects the opaque profile and proves maintenance, claims, settlement,
preservation, and every cross-surface V18 invariant. Soundscaper work remains
owned elsewhere.
