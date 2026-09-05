/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSetVideoKeyframesCommand } from '../src/common/editor/commands.js';
import {
	reconcileFramescaperProjectFeatureRequirementsRetime,
} from '../src/framescaper/editor-project-feature-requirements-retime.ts';
import {
	applyFramescaperProjectCommandRetime,
	isFramescaperVideoKeyframesCommandRetime,
	normalizeFramescaperProjectCommandRetime,
	snapshotFramescaperProjectCommandRetime,
	type FramescaperProjectCommandRetime,
} from '../src/framescaper/editor-project-retime-commands.ts';
import {
	createFramescaperVideoRetimeConstantCommandRetime,
	createFramescaperVideoRetimeFreezeCommandRetime,
	createFramescaperVideoRetimeRampCommandRetime,
	createFramescaperVideoRetimeResetCommandRetime,
	createFramescaperVideoRetimeReverseCommandRetime,
	createFramescaperVideoRetimeSetCommandRetime,
	isFramescaperVideoRetimeCommandRetime,
	resolveFramescaperVideoRetimeMapRetime,
	snapshotFramescaperVideoRetimeCommandRetime,
} from '../src/framescaper/editor-project-retime-retime-command.ts';
import {
	FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-retime-profile.ts';
import { createFramescaperProjectRetime } from '../src/framescaper/editor-project-retime.ts';
import { framescaperV20Options, opacityKeyframes } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;
type Rational = Readonly<{ readonly num: number; readonly den: number }>;

const BINDING = Object.freeze({ sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10 });
const CLIP = 'video-clip';
const FORWARD_POINTS = Object.freeze([
	{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } }, { outerFrame: 10, sourceFrame: { num: 10, den: 1 } },
]);

test('every authored retime factory defaults its scope to the timeline and freezes its snapshot', () => {
	const authored = { clipId: CLIP, expectedRetimeMap: null };
	const commands = [
		createFramescaperVideoRetimeResetCommandRetime(authored),
		createFramescaperVideoRetimeConstantCommandRetime(authored),
		createFramescaperVideoRetimeReverseCommandRetime(authored),
	];
	assert.deepEqual(commands.map((command) => command.type), [
		'video-retime/reset', 'video-retime/constant', 'video-retime/reverse',
	]);
	assert.ok(commands.every((command) => command.scope === 'timeline' && Object.isFrozen(command)));
	assert.ok(commands.every((command) => isFramescaperVideoRetimeCommandRetime(command)));
});

test('an explicit scope is retained while an unknown scope and a stray field are refused', () => {
	const reset = (value: unknown) => () => createFramescaperVideoRetimeResetCommandRetime(value as never);
	assert.equal(reset({ scope: 'project-bin', clipId: 'bin-video', expectedRetimeMap: null })().scope,
		'project-bin');
	assert.throws(reset({ scope: 'bin', clipId: CLIP, expectedRetimeMap: null }),
		/scope must be timeline or project-bin/u);
	assert.throws(reset({ type: 'video-retime/reset', clipId: CLIP, expectedRetimeMap: null }),
		/unsupported or missing field/u);
	assert.throws(reset({ clipId: CLIP }), /unsupported or missing field/u);
});

test('a retime command must be a plain record with a canonical clip id and data fields', () => {
	const reset = (value: unknown): (() => unknown) => () => (
		createFramescaperVideoRetimeResetCommandRetime(value as never)
	);
	for (const value of [null, [], 'reset', new Date(0)]) {
		assert.throws(reset(value), /must be a plain record/u);
	}
	for (const clipId of ['', ' video-clip', 'video-clip ', 7]) {
		assert.throws(reset({ clipId, expectedRetimeMap: null }), /clipId must be a canonical non-empty string/u);
	}
	assert.throws(reset(Object.defineProperty({ clipId: CLIP }, 'expectedRetimeMap', {
		enumerable: true, get: () => null,
	})), /expectedRetimeMap must be an own enumerable data property/u);
});

test('a set command deep-freezes its wire map and refuses a null one', () => {
	const command = createFramescaperVideoRetimeSetCommandRetime({
		clipId: CLIP, expectedRetimeMap: null, retimeMap: forwardCurve() as never,
	});
	assert.ok(Object.isFrozen(command.retimeMap.points[0]));
	assert.equal(command.expectedRetimeMap, null);
	assert.throws(() => createFramescaperVideoRetimeSetCommandRetime({
		clipId: CLIP, expectedRetimeMap: null, retimeMap: null as never,
	}), /requires a non-null retimeMap/u);
});

test('a retime wire map accepts only finite canonical JSON values', () => {
	const wire = (retimeMap: unknown): (() => unknown) => () => (
		createFramescaperVideoRetimeSetCommandRetime({
			clipId: CLIP, expectedRetimeMap: null, retimeMap: retimeMap as never,
		})
	);
	assert.throws(wire({ ...forwardCurve(), version: Number.NaN }), /finite and canonical/u);
	assert.throws(wire({ ...forwardCurve(), version: -0 }), /finite and canonical/u);
	assert.throws(wire({ ...forwardCurve(), points: new Uint8Array(2) }), /only JSON values/u);
	assert.throws(wire({ ...forwardCurve(), version: new Date(0) }), /plain records and arrays/u);
	assert.throws(wire({ ...forwardCurve(), [Symbol.for('retime')]: 1 }), /enumerable string data/u);
	assert.throws(wire(Object.defineProperty(forwardCurve(), 'hidden', {
		enumerable: false, value: 1,
	})), /enumerable string data/u);
});

test('freeze and ramp commands canonicalize their rationals and refuse invalid ones', () => {
	assert.deepEqual(createFramescaperVideoRetimeFreezeCommandRetime({
		clipId: CLIP, expectedRetimeMap: null, sourceFrame: rational(4, 2),
	}).sourceFrame, { num: 2, den: 1 });
	assert.deepEqual(createFramescaperVideoRetimeRampCommandRetime({
		clipId: CLIP, expectedRetimeMap: null, direction: 'forward',
		startVelocity: rational(0), endVelocity: rational(4, 2), sourceStartFrame: rational(0),
	}).endVelocity, { num: 2, den: 1 });
	const freeze = (sourceFrame: unknown): (() => unknown) => () => (
		createFramescaperVideoRetimeFreezeCommandRetime({ clipId: CLIP, expectedRetimeMap: null, sourceFrame } as never)
	);
	assert.throws(freeze(rational(4, 0)), /den must be positive/u);
	assert.throws(freeze(rational(1, 1.5)), /den must be a canonical safe integer/u);
	assert.throws(freeze(rational(-0, 1)), /num must be a canonical safe integer/u);
	assert.throws(freeze({ num: 1 }), /sourceFrame contains an unsupported or missing field/u);
});

test('a ramp command refuses an unknown direction and a negative velocity', () => {
	const ramp = (overrides: Data): (() => unknown) => () => (
		createFramescaperVideoRetimeRampCommandRetime({
			clipId: CLIP, expectedRetimeMap: null, direction: 'forward',
			startVelocity: rational(0), endVelocity: rational(2), sourceStartFrame: rational(0),
			...overrides,
		} as never)
	);
	assert.throws(ramp({ direction: 'backward' }), /direction must be forward or reverse/u);
	assert.throws(ramp({ startVelocity: rational(-1) }), /startVelocity must be non-negative/u);
	assert.throws(ramp({ endVelocity: rational(-3, 2) }), /endVelocity must be non-negative/u);
});

test('a serialized retime command round-trips only with its exact closed field set', () => {
	const authored = createFramescaperVideoRetimeFreezeCommandRetime({
		scope: 'project-bin', clipId: 'bin-video', expectedRetimeMap: null, sourceFrame: rational(4),
	});

	assert.deepEqual(snapshotFramescaperVideoRetimeCommandRetime(authored), authored);
	const snapshotWire = (value: unknown): (() => unknown) => () => (
		snapshotFramescaperVideoRetimeCommandRetime(value)
	);
	assert.throws(snapshotWire({ ...authored, type: 'video-retime/slip' }), /type is unsupported/u);
	assert.throws(snapshotWire({ ...authored, type: 'video-retime/reset' }),
		/unsupported or missing field/u, 'a serialized wire keeps the field set its own type declares');
	const { scope: _scope, ...withoutScope } = authored;
	assert.throws(snapshotWire(withoutScope), /unsupported or missing field/u);
});

test('resolving a reset, constant or reverse command maps onto the persisted binding', () => {
	assert.equal(resolve(createFramescaperVideoRetimeResetCommandRetime({
		clipId: CLIP, expectedRetimeMap: null,
	})), null);
	const constant = resolve(createFramescaperVideoRetimeConstantCommandRetime({
		clipId: CLIP, expectedRetimeMap: null,
	}));
	assert.deepEqual(constant?.points, FORWARD_POINTS);
	assert.deepEqual(constant?.segments, [{ mode: 'constant-forward' }]);
	const reverse = resolve(createFramescaperVideoRetimeReverseCommandRetime({
		clipId: CLIP, expectedRetimeMap: null,
	}));
	assert.deepEqual(reverse?.points.map((point) => point.sourceFrame), [
		{ num: 10, den: 1 }, { num: 0, den: 1 },
	]);
	assert.deepEqual(reverse?.segments, [{ mode: 'constant-reverse' }]);
});

test('resolving freeze, ramp and set commands honours the authored operation', () => {
	const freeze = resolve(createFramescaperVideoRetimeFreezeCommandRetime({
		clipId: CLIP, expectedRetimeMap: null, sourceFrame: rational(4),
	}));
	assert.deepEqual(freeze?.points.map((point) => point.sourceFrame), [
		{ num: 4, den: 1 }, { num: 4, den: 1 },
	]);
	assert.deepEqual(freeze?.segments, [{ mode: 'freeze' }]);
	const forward = resolve(createFramescaperVideoRetimeRampCommandRetime({
		clipId: CLIP, expectedRetimeMap: null, direction: 'forward',
		startVelocity: rational(0), endVelocity: rational(2), sourceStartFrame: rational(0),
	}));
	assert.deepEqual(forward?.points.at(-1)?.sourceFrame, { num: 10, den: 1 });
	assert.deepEqual(forward?.segments, [{
		mode: 'ramp-forward', startVelocity: { num: 0, den: 1 }, endVelocity: { num: 2, den: 1 },
	}]);
	const backward = resolve(createFramescaperVideoRetimeRampCommandRetime({
		clipId: CLIP, expectedRetimeMap: null, direction: 'reverse',
		startVelocity: rational(2), endVelocity: rational(0), sourceStartFrame: rational(10),
	}));
	assert.equal(backward?.segments[0]?.mode, 'ramp-reverse');
	assert.deepEqual(backward?.points.at(-1)?.sourceFrame, { num: 0, den: 1 });
	assert.deepEqual(resolve(createFramescaperVideoRetimeSetCommandRetime({
		clipId: CLIP, expectedRetimeMap: null, retimeMap: forwardCurve() as never,
	})), { ...forwardCurve(), points: FORWARD_POINTS });
});

test('resolving a retime command validates its persisted binding', () => {
	const reverse = createFramescaperVideoRetimeReverseCommandRetime({
		clipId: CLIP, expectedRetimeMap: null,
	});
	for (const [binding, message] of [
		[{ sequenceFrameCount: 10 }, /binding contains an unsupported or missing field/u],
		[{ ...BINDING, sequenceFrameCount: 0 }, /sequenceFrameCount must be positive/u],
		[{ ...BINDING, sourceInFrame: -1 }, /sourceInFrame must be non-negative/u],
		[{ ...BINDING, sourceInFrame: Number.MAX_SAFE_INTEGER }, /source bound exceeds the safe-integer/u],
	] as const) {
		assert.throws(() => resolveFramescaperVideoRetimeMapRetime(reverse, binding), message);
	}
	assert.throws(() => resolve(createFramescaperVideoRetimeRampCommandRetime({
		clipId: CLIP, expectedRetimeMap: null, direction: 'forward',
		startVelocity: rational(Number.MAX_SAFE_INTEGER),
		endVelocity: rational(Number.MAX_SAFE_INTEGER), sourceStartFrame: rational(0),
	})), /exceeds the persisted rational range/u);
});

test('both command type guards read only own enumerable type carriers', () => {
	const guards: readonly (readonly [(value: unknown) => boolean, string])[] = [
		[isFramescaperVideoRetimeCommandRetime, 'video-retime/ramp'],
		[isFramescaperVideoKeyframesCommandRetime, 'video-keyframes/set'],
	];
	for (const [guard, match] of guards) {
		assert.equal(guard(null), false);
		assert.equal(guard([{ type: match }]), false);
		assert.equal(guard({ type: 'clip/add' }), false);
		assert.equal(guard(typeAccessor(match)), false, 'an accessor never carries a command type');
		assert.equal(guard({ type: match }), true);
	}
});

test('normalizing one retime-owned command routes detach, retime and keyframe wires apart', () => {
	assert.equal(normalizeFramescaperProjectCommandRetime(detachCommand()).type,
		'framescaper/video-proxy-detach');
	assert.equal(normalizeFramescaperProjectCommandRetime(
		retimeWire('video-retime/reverse', CLIP),
	).type, 'video-retime/reverse');
	assert.equal(normalizeFramescaperProjectCommandRetime(
		createSetVideoKeyframesCommand(CLIP, opacityKeyframes(), opacityKeyframes()),
	).type, 'video-keyframes/set');
	assert.throws(() => normalizeFramescaperProjectCommandRetime({ type: 'project/rename', title: 'x' }),
		/video keyframes command/u);
});

test('snapshotting a command tree closes its batches and refuses malformed types', () => {
	const snapshot = snapshotFramescaperProjectCommandRetime({
		type: 'batch',
		commands: [batch([rename('Inner')]), retimeWire('video-retime/reset', CLIP)],
	}) as unknown as Data;
	assert.ok(Object.isFrozen(snapshot.commands));
	assert.deepEqual((snapshot.commands as readonly Data[]).map((child) => child.type), [
		'batch', 'video-retime/reset',
	]);
	assert.throws(() => snapshotFramescaperProjectCommandRetime({ type: 42 }), /type must be a non-empty string/u);
	assert.throws(() => snapshotFramescaperProjectCommandRetime([]), /must be an object/u);
	assert.throws(() => snapshotFramescaperProjectCommandRetime({ type: 'batch', commands: [] }), /commands/u);
	const cyclic: Data = { type: 'batch', commands: [] };
	(cyclic.commands as unknown[]).push(cyclic);
	assert.throws(() => snapshotFramescaperProjectCommandRetime(cyclic), /Cyclic Framescaper retime command/u);
});

test('a command tree past its ordered execution boundary limit is refused', () => {
	const resets = (length: number): Data => batch(
		Array.from({ length }, () => retimeWire('video-retime/reset', CLIP)),
	);

	assert.doesNotThrow(() => snapshotFramescaperProjectCommandRetime(resets(128)));
	assert.throws(() => snapshotFramescaperProjectCommandRetime(resets(129)),
		/ordered execution boundary limit/u);
});

test('applying a command authenticates the retime profile and the persisted project first', () => {
	const reverse = createFramescaperVideoRetimeReverseCommandRetime({
		clipId: CLIP, expectedRetimeMap: null,
	});
	assert.throws(() => applyFramescaperProjectCommandRetime({}, project(), reverse),
		/authenticated Framescaper 1.0 runtime profile is required/u);
	assert.throws(() => applyFramescaperProjectCommandRetime(PROFILE, { schemaVersion: 1 }, reverse),
		TypeError);
});

test('a timeline retime command is refused on a locked track but a bin occurrence is not', () => {
	const locked = project((options) => {
		const tracks = options.tracks as Data[];
		tracks[0] = { ...tracks[0], locked: true };
	});
	const reverse = (scope: string, clipId: string): unknown => (
		createFramescaperVideoRetimeReverseCommandRetime({ scope, clipId, expectedRetimeMap: null } as never)
	);

	assert.throws(() => apply(locked, reverse('timeline', CLIP), '2026-09-01T00:00:00.000Z'),
		/Locked track video-track cannot edit video clip video-clip/u);
	const binned = apply(locked, reverse('project-bin', 'bin-video'), '2026-09-01T00:01:00.000Z');
	assert.notEqual(clipOf(binned, 'bin-video', 'project-bin').retimeMap, null);
	assert.equal(clipOf(binned, CLIP).retimeMap, null);
});

test('a retime command needs its expected map to match the persisted occurrence', () => {
	const reversed = apply(project(), createFramescaperVideoRetimeReverseCommandRetime({
		clipId: CLIP, expectedRetimeMap: null,
	}), '2026-09-01T00:02:00.000Z');
	const persisted = clipOf(reversed, CLIP).retimeMap;
	const reset = (expectedRetimeMap: unknown): unknown => (
		createFramescaperVideoRetimeResetCommandRetime({ clipId: CLIP, expectedRetimeMap } as never)
	);

	assert.throws(() => apply(reversed, reset(null), '2026-09-01T00:03:00.000Z'),
		/stale expected retime map/u);
	const cleared = apply(reversed, reset(persisted), '2026-09-01T00:04:00.000Z');
	assert.equal(clipOf(cleared, CLIP).retimeMap, null);
	assert.equal(cleared.revision, Number(reversed.revision) + 1);
});

test('a retime command against an unknown or non-video occurrence is refused', () => {
	const owner = project();
	const reverse = (clipId: string): (() => unknown) => () => apply(
		owner,
		createFramescaperVideoRetimeReverseCommandRetime({ clipId, expectedRetimeMap: null }),
		'2026-09-01T00:05:00.000Z',
	);
	assert.throws(reverse('missing-clip'), /Unknown timeline video clip missing-clip/u);
	assert.throws(reverse('audio-clip'), /Clip audio-clip is not a video occurrence/u);
});

test('a video-keyframes command commits against the persisted curves and refuses a stale expectation', () => {
	const owner = project();
	const expected = clipOf(owner, CLIP).videoKeyframes;
	const next = opacityKeyframes();
	const set = createSetVideoKeyframesCommand(CLIP, expected, next);
	const keyframed = apply(owner, set, '2026-09-01T00:06:00.000Z');

	assert.deepEqual(clipOf(keyframed, CLIP).videoKeyframes, next);
	assert.equal(keyframed.revision, Number(owner.revision) + 1);
	assert.throws(() => apply(keyframed, set, '2026-09-01T00:07:00.000Z'),
		/keyframes changed before the edit was committed/u);
});

test('a proxy detach command clears a matching attachment and refuses a stale or absent one', () => {
	const owner = projectWithProxy();
	const detach = (target: Data, sourceId: string, now: string): (() => Data) => () => (
		apply(target, detachCommand(sourceId), now)
	);
	const detached = detach(owner, 'video-source', '2026-09-01T00:08:00.000Z')();
	assert.equal(videoSource(detached).proxyAttachment, null);
	assert.equal(detached.revision, Number(owner.revision) + 1);
	assert.throws(detach(detached, 'video-source', '2026-09-01T00:09:00.000Z'),
		/stale expected proxy attachment/u);
	assert.throws(detach(owner, 'audio-source', '2026-09-01T00:10:00.000Z'), /is not a video source/u);
	assert.throws(detach(owner, 'nope', '2026-09-01T00:11:00.000Z'), /Video source nope does not exist/u);
});

test('a batch of purely inherited commands publishes exactly one revision', () => {
	const owner = project();
	const renamed = apply(owner, batch([rename('First'), rename('Second')]), '2026-09-01T00:12:00.000Z');

	assert.equal(renamed.title, 'Second');
	assert.equal(renamed.revision, Number(owner.revision) + 1);
	assert.equal(renamed.updatedAt, '2026-09-01T00:12:00.000Z');
});

test('a batch mixing inherited and retime commands still publishes exactly one revision', () => {
	const owner = project();
	const mixed = apply(owner, batch([
		rename('Segmented'), retimeWire('video-retime/reverse', CLIP), rename('Segmented twice'),
	]), '2026-09-01T00:13:00.000Z');

	assert.equal(mixed.title, 'Segmented twice');
	assert.equal(mixed.revision, Number(owner.revision) + 1);
	assert.equal(mixed.updatedAt, '2026-09-01T00:13:00.000Z');
	assert.deepEqual((clipOf(mixed, CLIP).retimeMap as Data | null)?.segments,
		[{ mode: 'constant-reverse' }]);
});

test('a refused command inside an ordered batch publishes no revision at all', () => {
	const owner = project();

	assert.throws(() => apply(
		owner,
		batch([rename('Doomed'), retimeWire('video-retime/reset', 'missing-clip')]),
		'2026-09-01T00:14:00.000Z',
	), /Unknown timeline video clip missing-clip/u);
	assert.equal(owner.title, 'Framescaper V20');
	assert.equal(owner.revision, 0);
});

test('a fresh video occurrence is initialized with neutral keyframes over its own duration', () => {
	const owner = project();
	const added = apply(owner, addVideoClip('video-clip-2', 10), '2026-09-01T00:15:00.000Z');

	assert.deepEqual(clipOf(added, 'video-clip-2').videoKeyframes, {
		schemaVersion: 1,
		timeDomain: {
			authoredDuration: { num: 10, den: 1 },
			viewStart: { num: 0, den: 1 }, viewDuration: { num: 10, den: 1 },
		},
		curves: [],
	});
	assert.deepEqual(clipOf(added, CLIP).videoKeyframes, clipOf(owner, CLIP).videoKeyframes);
	assert.equal(added.revision, Number(owner.revision) + 1);
});

test('a batch adding two fresh video occurrences segments them into one published revision', () => {
	const owner = project();
	const added = apply(owner, batch([
		addVideoClip('video-clip-2', 10), addVideoClip('video-clip-3', 20),
	]), '2026-09-01T00:16:00.000Z');

	assert.deepEqual((added.clips as readonly Data[]).map((clip) => clip.id), [
		CLIP, 'audio-clip', 'video-clip-2', 'video-clip-3',
	]);
	assert.ok(['video-clip-2', 'video-clip-3'].every((id) => (
		(clipOf(added, id).videoKeyframes as Data).curves as unknown[]).length === 0));
	assert.equal(added.revision, Number(owner.revision) + 1);
	assert.equal(added.updatedAt, '2026-09-01T00:16:00.000Z');
});

test('a video-composition/set command rewrites the composition and keeps the keyframes', () => {
	const owner = project();
	const clip = clipOf(owner, CLIP);
	const composition = { ...(clip.videoComposition as Data), opacity: 0.5 };
	const composed = apply(owner, {
		type: 'video-composition/set', clipId: CLIP,
		expectedComposition: clip.videoComposition, composition,
	}, '2026-09-01T00:18:00.000Z');

	assert.equal((clipOf(composed, CLIP).videoComposition as Data).opacity, 0.5);
	assert.deepEqual(clipOf(composed, CLIP).videoKeyframes, clip.videoKeyframes);
	assert.equal(composed.revision, Number(owner.revision) + 1);
});

test('the command timestamp accepts a Date, an ISO string or the wall clock but nothing invalid', () => {
	const owner = project();
	const command = (): FramescaperProjectCommandRetime => (
		createFramescaperVideoRetimeReverseCommandRetime({ clipId: CLIP, expectedRetimeMap: null })
	);
	assert.equal(apply(owner, command(), new Date('2026-09-01T00:17:00.000Z')).updatedAt,
		'2026-09-01T00:17:00.000Z');
	assert.ok(!Number.isNaN(Date.parse(String(apply(owner, command()).updatedAt))));
	assert.throws(() => apply(owner, command(), 'not-a-date'),
		/valid retime video-retime command timestamp is required/u);
});

function apply(target: unknown, command: unknown, now?: string | Date): Data {
	return applyFramescaperProjectCommandRetime(
		PROFILE, target, command as never, now === undefined ? {} : { now },
	) as unknown as Data;
}

function rational(num: number, den = 1): Rational {
	return Object.freeze({ num, den });
}

function resolve(command: Parameters<typeof resolveFramescaperVideoRetimeMapRetime>[0]) {
	return resolveFramescaperVideoRetimeMapRetime(command, BINDING);
}

function batch(commands: readonly Data[]): Data {
	return { type: 'batch', commands };
}

function rename(title: string): Data {
	return { type: 'project/rename', title };
}

function retimeWire(type: string, clipId: string): Data {
	return { type, scope: 'timeline', clipId, expectedRetimeMap: null };
}

function typeAccessor(type: string): object {
	return Object.defineProperty({}, 'type', { enumerable: true, get: () => type });
}

function forwardCurve(): Data {
	return {
		feature: 'video-retime', version: 2,
		points: FORWARD_POINTS.map((point) => ({ ...point })),
		segments: [{ mode: 'constant-forward' }],
	};
}

function addVideoClip(id: string, sequenceStartFrame: number): Data {
	return {
		type: 'clip/add', trackId: 'video-track',
		clip: {
			kind: 'video', id, sourceId: 'video-source', title: id, sequenceId: 'main-sequence',
			sequenceStartFrame, sequenceFrameCount: 10, sourceInFrame: 0,
			sourceFrameCount: 10, retimeMap: null,
		},
	};
}

function project(mutate?: (options: Data) => void): Data {
	const options = framescaperV20Options();
	mutate?.(options);
	return createFramescaperProjectRetime(PROFILE, options as never) as unknown as Data;
}

function clipOf(value: unknown, id: string, scope: 'timeline' | 'project-bin' = 'timeline'): Data {
	const owner = value as Data;
	const clips = (scope === 'timeline' ? owner.clips : (owner.projectBin as Data).clips) as readonly Data[];
	const clip = clips.find((candidate) => candidate.id === id);
	if (!clip) throw new Error(`The retime branch fixture needs clip ${id}.`);
	return clip;
}

function videoSource(value: unknown): Data {
	const source = ((value as Data).sources as readonly Data[]).find(({ id }) => id === 'video-source');
	if (!source) throw new Error('The retime branch fixture requires its video source.');
	return source;
}

function projectWithProxy(): Data {
	const owner = structuredClone(project()) as Data;
	videoSource(owner).proxyAttachment = attachment();
	owner.featureRequirements = reconcileFramescaperProjectFeatureRequirementsRetime(PROFILE, owner);
	return owner;
}

function detachCommand(sourceId = 'video-source'): Data {
	return { type: 'framescaper/video-proxy-detach', sourceId, expectedAttachment: attachment() };
}

function attachment(): Data {
	const proxySha256 = '34'.repeat(32);
	const timingSha256 = '56'.repeat(32);
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${proxySha256}`,
		mimeType: 'video/mp4', byteLength: 1_024, sha256: proxySha256,
		originalSha256: '12'.repeat(32), originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1,
		recipeId: 'framescaper-video-proxy-h264-540-v1', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${timingSha256}`,
			sha256: timingSha256, sourceSha256: proxySha256, byteLength: 112,
			frameCount: 10, timescale: 1_000, finalFrameDurationTicks: '100',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}
