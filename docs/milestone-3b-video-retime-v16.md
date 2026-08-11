# Milestone 3B-5b: V16 video-retime curve persistence and preservation

> **Status: Implemented on 2026-08-11.** Commit `3fe50815` persists the exact
> curve algebra delivered in `fcff5eab` without adding a maintained consumer.
> This atomic raw project-schema revision and preservation packet adds no
> retime authoring, menu, control, playback, preview, export, capability
> availability, nested sequence shape, or fallback.

The canonical `npm run check` gate passed with 5,314 tests total, 5,312 passed
and 2 skipped; 90.14% statement and line coverage, 82.07% branch coverage, and
90.69% function coverage. Architecture passed with 891 modules, 2,481
dependencies, and 1,963 maintained files. The build emitted 104 production
JavaScript chunks; the largest, `aup4-worker`, was 400,636 bytes. Focused
Chromium V16 retime compatibility passed 1/1. Packet 3B-5 remains **In
progress**; the immediate pickup is the reviewed
[3B-5c exact clip-bound runtime mapping](milestone-3b-video-retime-runtime-mapping.md).

## Outcome boundary

V16 replaces the historical video `retimeMap` breakpoint-map wire with one
closed, JSON-safe V2 curve wire on video clips in both the timeline and Project
Bin. `null` remains the required default. A non-null curve is admitted,
validated against its owning clip, copied without semantic loss, and protected
from command mutation while both products preserve it read-only.

This revision is retime-only. It must not reserve a sequence-container kind,
nested source, sequence reference, graph edge, capability, or placeholder.
Nested sequences wait for a schema-neutral graph/time algebra contract and a
later schema revision after ownership, aliasing, cycles, audio, and flattening
semantics are closed.

## Persisted wire

The exact V16 clip field is `retimeMap: VideoRetimeCurveV16 | null`:

```ts
type VideoRetimeCurveV16 = Readonly<{
	feature: 'video-retime';
	version: 2;
	points: readonly Readonly<{
		outerFrame: number;
		sourceFrame: Readonly<{ num: number; den: number }>;
	}>[];
	segments: readonly VideoRetimeSegmentV16[];
}>;

type VideoRetimeSegmentV16 = Readonly<
	| { mode: 'constant-forward' | 'constant-reverse' | 'freeze' }
	| {
		mode: 'ramp-forward' | 'ramp-reverse';
		startVelocity: Readonly<{ num: number; den: number }>;
		endVelocity: Readonly<{ num: number; den: number }>;
	}
>;
```

`feature` retains first-party wire identity. `version` distinguishes this from
V15's `{ feature, points: [{ outer, source, mode }] }` map. V16 exact
validation rejects that old map; it never guesses, upgrades, or partially
normalizes it.

`sequenceFrameCount`, `sourceInFrame`, and `sourceFrameCount` on the clip are
the sole persisted curve bounds. The curve must not duplicate them or persist
a compiled cache, coefficient, inverse index, BigInt value, or resolved sample
coordinate.

## Exact validation and algebra adapter

Own this seam in `src/common/editor/video-retime-v16.ts`, separate from the
near-ceiling pure algebra module. It accepts only dense arrays, own enumerable
data properties, plain JSON records, exact closed keys, canonical reduced
nonnegative number rationals, and safe integers, and returns a deeply frozen
canonical wire snapshot.

There are 1 through 4,096 segments and exactly one more point than segment.
Outer frames increase strictly from `0` through `sequenceFrameCount`. Source
positions remain in the closed absolute range
`sourceInFrame..sourceInFrame + sourceFrameCount`; safe addition is proved
before compilation.

The adapter removes `feature` and calls `compileVideoRetimeCurve` with:

```ts
{
	version: 2,
	outerFrameCount: clip.sequenceFrameCount,
	sourceStartFrame: clip.sourceInFrame,
	sourceFrameCount: clip.sourceFrameCount,
	points: retimeMap.points,
	segments: retimeMap.segments,
}
```

All direction, freeze, ramp-velocity, exact integral endpoint, zero-crossing,
direction-change, denominator, and BigInt-work bounds come from the delivered
algebra rather than a second implementation. Runtime BigInt rationals never
enter V16 JSON.

Foundation validation selects its retime validator by exact raw schema. V10
through V15 retain their historical breakpoint-map validator and fixtures;
only V16 uses this adapter. Timeline and Project Bin traversal share the seam.

## Raw schema and compatibility boundary

- Add exact `project-v16.ts` and `project-v16-validation.ts` ownership, advance
  current aliases and constructors to 16, and preserve every non-retime V15
  field and invariant unchanged.
- Every created or imported video clip defaults `retimeMap` to `null`. A
  constructor accepts a non-null value only when it already satisfies V16;
  construction is not a raw V15 migration.
- Raw V15, including a V15 retime map, gets the established typed
  re-import-required outcome. V16 is the sole maintained raw writable schema.
  Raw V17 and later remain opaque structured-clone read-only documents.
- Ordinary V16 with all timeline and Project Bin curves `null` has no
  video-retime requirement and remains writable.

Any non-null curve requires the exact reserved requirement
`framescaper.video-retime` for
`org.soundscaper.capability.video-retime`, display name `Video retime maps`,
disposition `bypass`, and `fallback: null`. The reconciler must not let a
publisher-authored same-feature requirement suppress or replace it. A conflict
or any rendered fallback for this state rejects.

`videoRetime` remains `false` in Soundscaper, Framescaper, and the production
capability register. Either product therefore presents the existing explicit
read-only-or-cancel consent before opening a non-null curve and keeps the
activated document intrinsically read-only. This packet claims preservation,
not correct retimed pictures or sound.

## Preservation and command admission

Clone, load, local history, clipboard, current-format `.scape`, and desktop
round trips preserve both clip stores' V2 wires exactly and create no shared
mutable members. The clipboard descriptor and its codec preserve a copied V2
wire, but every paste, clip add, or Project Bin add that would introduce a
non-null curve refuses while the capability is unavailable. Equal bounds prove
only mathematical validity; they do not authorize retime-state creation or let
a writable session become incompatible without open-time consent.

The shared direct-command boundary snapshots every retimed clip, its
collection/track/sequence ownership, and its referenced source at transaction
start. Direct and arbitrarily nested commands must not erase, replace, move,
trim, slip, slide, roll, ripple, stretch, split, relink, rebind, or otherwise
change that protected closure while the capability is unavailable. Changing
`sequenceFrameCount`, `sourceInFrame`, or `sourceFrameCount` fails before
publication and before a history entry. There is no silent clamp, rebase,
curve drop, V15 rewrite, or partial commit.

At the low-level command seam, unrelated state may change only when the
protected clip wire, source record, membership, and ownership remain byte-exact.
The normal controller remains read-only for the whole incompatible document.

## Desktop and archive version decisions

V15's desktop v7 catalog cannot admit V16 rows: metadata validation binds every
row to one exact project schema. Follow the proven V14-to-V15 isolation model:

- set `DESKTOP_LIBRARY_SCHEMA_VERSION` to 8,
  `DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION` to 16, and the scope to
  `kw.media/scape-project-library/v8`;
- set SQLite `DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION`/`user_version` to 10;
- create a fresh metadata-schema-8 catalog and leave the v7/schema-15/user-9
  library untouched and ignored; and
- reject copied v7 metadata or a user-9 database placed in v8 without mutation,
  migration, adoption, or backfill.

The `.scape` envelope `formatVersion` and bounded binary descriptor schema stay
1. Only the admitted project document becomes V16. Archive/database layouts,
source-body rules, IPC budgets, and desktop qualification scope stay unchanged.

## Atomic production and policy work

Core ownership is:

- new `src/common/editor/project-v16.ts`,
  `src/common/editor/project-v16-validation.ts`, and
  `src/common/editor/video-retime-v16.ts`;
- `project-schema-version.ts`, `project-current.ts`,
  `project-current-runtime.ts`, `project-v10-foundation-validation.ts`,
  `project-v12-validation.ts`, `types.ts`, and
  `project-owned-feature-requirements.ts`, plus the exact-current pins in
  `track-folder-media-runtime.ts` and `frame-canonical-rate-stretch-planner.ts`;
  and
- new `commands/video-retime-preservation-admission.ts`, plus `commands.js`,
  `commands/shared-runtime.js`, and `commands/clipboard-runtime.js`.

Desktop ownership is `desktop/project-library-contract.ts`,
`desktop/project-library-database.ts`, `desktop/project-library-projects.ts`,
`desktop/project-library-editor-service.ts`,
`desktop/project-library-editor-media-service.ts`, and
`scripts/lib/desktop-project-library-runtime.mjs`, plus the existing renderer,
source-bearing, handoff, and Scape-reopen smoke fixtures. Do not grow the media
service; extract revision-specific validation.

Atomically update `config/project-compatibility.json`, its generated narrative
bindings, `config/production-security-matrix.json`,
`docs/project-compatibility.md`, and `docs/production-threat-model.md`. Edit
register prose, run `node scripts/sync-policy-narratives.mjs`, then run
`node scripts/repin-runtime-evidence.mjs`; never hand-edit fenced narratives or
digests. Commit the resulting `config/ffmpeg-runtime-manifest.json` pins with
the schema change. Capability booleans remain false.

## Red seams and acceptance

Start red in `tests/audio-editor-video-retime-v16.test.ts`,
`tests/audio-editor-project-v16.test.ts`,
`tests/audio-editor-video-retime-v16-preservation.test.ts`, and
`tests/desktop-project-library-v16-video-retime-roundtrip.test.ts`. Update the
historical router, owned-requirement, clipboard/history, `.scape`, desktop
library/service/smoke, compatibility-policy, security-evidence, and runtime-pin
suites that name exact V15 or v7.

The exact existing seams include `tests/audio-editor-project-v11.test.ts`,
`tests/audio-editor-project-v15.test.ts`,
`tests/audio-editor-scape-feature-requirements.test.ts`,
`tests/audio-editor-clipboard-edit-service.test.ts`,
`tests/audio-editor-scape-project.test.js`,
`tests/desktop-project-library.test.ts`,
`tests/desktop-project-library-editor-service.test.ts`,
`tests/project-compatibility-desktop-library-policy.test.js`, and
`tests/browser/audio-editor-scape-open-compatibility.spec.js`.

Acceptance proves:

- exact keys, null defaults, old-map refusal, 1/4,096 bounds, five segment
  modes, adapter/algebra agreement, deep freeze, and both clip stores;
- V15 typed re-import, ordinary writable V16, opaque read-only V17, and
  unchanged V10-through-V15 historical validation;
- clone, unrelated undo/redo, clipboard descriptor/codec, JSON/local store,
  `.scape`, fresh-v8 desktop save/reopen/handoff, and cross-product transfer
  preserve the curve exactly, while paste/add introduction refuses;
- protected-closure direct/nested commands reject with no mutation or history;
- the owned no-fallback requirement is present for either clip store,
  substitution rejects, both reports stay unavailable, and focused Chromium
  proves explicit read-only consent and preservation; and
- v7 stays untouched, copied-v7-in-v8 rejects, archive/binary versions stay 1,
  policy narratives and evidence pins verify, and the canonical gate passes.

## Non-goals and stop conditions

No retime command, menu, shortcut, default-visible UI, evaluator consumer,
playback/preview/export projection, audio warp, pitch policy, capability flip,
fallback, nested sequence, proxy, optical flow, or schema migration lands here.

Stop if persistence needs duplicated bounds, a cache, float or BigInt JSON,
silent V15 conversion, or more than 4,096 segments. Stop if a command must
reinterpret a curve rather than preserve or reject it. Stop if read-only
admission needs a fallback or native timing claim. Stop if desktop V16 must
mutate v7 in place. Stop and write graph algebra if a nested field is needed.
