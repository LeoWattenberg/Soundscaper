/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createVideoRetimeRuntimeMapper } from '../src/common/editor/video-retime-runtime-mapping.ts';

const MAPPING_SOURCE_URL = new URL('../src/common/editor/video-retime-runtime-mapping.ts', import.meta.url);
const V16_SOURCE_URL = new URL('../src/common/editor/video-retime-v16.ts', import.meta.url);

test('maps all N+1 local sequence boundaries and exact interior coordinates across every mode', () => {
	const mapper = createVideoRetimeRuntimeMapper(videoClip(fiveModeCurve()));

	assert.equal(mapper.sequenceStartFrame, 101);
	assert.equal(mapper.sequenceEndFrame, 111);
	assert.equal(mapper.outerFrameCount, 10);
	assert.equal(mapper.sourceInFrame, 8);
	assert.equal(mapper.sourceOutFrame, 16);

	const expectedBoundaries = [
		fraction(10n), fraction(11n), fraction(12n), fraction(25n, 2n),
		fraction(14n), fraction(14n), fraction(14n), fraction(27n, 2n),
		fraction(12n), fraction(11n), fraction(10n),
	];
	assert.equal(expectedBoundaries.length, mapper.outerFrameCount + 1);
	for (const [outerFrame, expected] of expectedBoundaries.entries()) {
		assert.deepEqual(mapper.mapOuterFrame(outerFrame), expected, `outer boundary ${String(outerFrame)}`);
	}
	assert.deepEqual(mapper.mapOuterFrame({ num: 7, den: 2 }), fraction(105n, 8n));
	assert.deepEqual(mapper.mapOuterFrame({ numerator: 7n, denominator: 2n }), fraction(105n, 8n));

	const identity = createVideoRetimeRuntimeMapper(videoClip(uniformCurve(14), {
		sequenceStartFrame: 0,
		sequenceFrameCount: 14,
		sourceInFrame: 0,
		sourceFrameCount: 14,
	}));
	const exactRampOutput = mapper.mapOuterFrame({ num: 7, den: 2 });
	assert.deepEqual(identity.mapOuterFrame(exactRampOutput), exactRampOutput);

	const ntsc = createVideoRetimeRuntimeMapper(videoClip(uniformCurve(30_000), {
		sequenceStartFrame: 0,
		sequenceFrameCount: 30_000,
		sourceInFrame: 0,
		sourceFrameCount: 30_000,
	}));
	assert.deepEqual(
		ntsc.mapOuterFrame({ num: 30_000, den: 1_001 }),
		fraction(30_000n, 1_001n),
	);
});

test('preserves exact point, inclusive freeze range, crossing brackets, and inverse policies', () => {
	const mapper = createVideoRetimeRuntimeMapper(videoClip(fiveModeCurve()));

	assert.deepEqual(mapper.invertSourceFrame({ num: 11, den: 1 }, { policy: 'all' }), [
		{ kind: 'point', outerFrame: 1 },
		{ kind: 'point', outerFrame: 9 },
	]);
	assert.deepEqual(mapper.invertSourceFrame({ num: 12, den: 1 }, { policy: 'all' }), [
		{ kind: 'point', outerFrame: 2 },
		{ kind: 'point', outerFrame: 8 },
	], 'shared moving endpoints are emitted only once');
	assert.deepEqual(mapper.invertSourceFrame({ num: 14, den: 1 }, { policy: 'all' }), [
		{ kind: 'range', startOuterFrame: 4, endOuterFrame: 6 },
	]);
	assert.deepEqual(mapper.invertSourceFrame({ num: 13, den: 1 }, { policy: 'all' }), [
		{ kind: 'bracket', beforeOuterFrame: 3, afterOuterFrame: 4 },
		{ kind: 'bracket', beforeOuterFrame: 7, afterOuterFrame: 8 },
	]);
	assert.deepEqual(mapper.invertSourceFrame({ numerator: 13n, denominator: 1n }, {
		policy: 'earliest',
	}), [{ kind: 'bracket', beforeOuterFrame: 3, afterOuterFrame: 4 }]);
	assert.deepEqual(mapper.invertSourceFrame({ num: 13, den: 1 }, { policy: 'latest' }), [
		{ kind: 'bracket', beforeOuterFrame: 7, afterOuterFrame: 8 },
	]);
	assert.deepEqual(mapper.invertSourceFrame({ num: 11, den: 1 }, {
		policy: 'nearest-cell', outerHint: 5,
	}), [{ kind: 'point', outerFrame: 1 }], 'equal distance selects the earlier occurrence');
	assert.deepEqual(mapper.invertSourceFrame({ num: 11, den: 1 }, {
		policy: 'nearest-cell', outerHint: Number.MAX_SAFE_INTEGER,
	}), [{ kind: 'point', outerFrame: 9 }], 'an outer hint is not a mapped or clamped query');
	assert.deepEqual(mapper.invertSourceFrame({ num: 11, den: 1 }, {
		policy: 'nearest-cell', outerHint: Number.MIN_SAFE_INTEGER,
	}), [{ kind: 'point', outerFrame: 1 }]);
	const empty = mapper.invertSourceFrame({ num: 15, den: 1 }, { policy: 'all' });
	assert.deepEqual(empty, []);
	assertDeepFrozen(empty);
	assert.throws(
		() => mapper.invertSourceFrame({ num: 11, den: 1 }, { policy: 'nearest-cell' }),
		/hint|outerHint/iu,
	);
	assert.throws(
		() => mapper.invertSourceFrame({ num: 11, den: 1 }, {
			policy: 'all', outerHint: 1,
		}),
		/hint|outerHint|policy/iu,
	);
	assertDeepFrozen(mapper.invertSourceFrame({ num: 13, den: 1 }, { policy: 'all' }));
});

test('publishes contiguous immutable dispatch partitions with stable identities and exact endpoint laws', () => {
	const mapper = createVideoRetimeRuntimeMapper(videoClip(fiveModeCurve()));
	const partitions = mapper.partitions;
	const expectedModes = [
		'constant-forward', 'ramp-forward', 'freeze', 'ramp-reverse', 'constant-reverse',
	];
	const expectedOuter = [0, 2, 4, 6, 8, 10];
	const expectedSource = [fraction(10n), fraction(12n), fraction(14n), fraction(14n), fraction(12n), fraction(10n)];

	assert.strictEqual(mapper.partitions, partitions);
	assert.equal(partitions.length, expectedModes.length);
	for (const [index, partition] of partitions.entries()) {
		assert.equal(partition.segmentIndex, index);
		assert.equal(partition.mode, expectedModes[index]);
		assert.equal(partition.startOuterFrame, expectedOuter[index]);
		assert.equal(partition.endOuterFrame, expectedOuter[index + 1]);
		assert.ok(partition.startOuterFrame < partition.endOuterFrame);
		assert.deepEqual(partition.startSourceFrame, expectedSource[index]);
		assert.deepEqual(partition.endSourceFrame, expectedSource[index + 1]);
		assert.deepEqual(mapper.mapOuterFrame(partition.startOuterFrame), partition.startSourceFrame);
		assert.deepEqual(mapper.mapOuterFrame(partition.endOuterFrame), partition.endSourceFrame);
		assert.strictEqual(mapper.partitions[index], partition);
		assert.strictEqual(mapper.partitions[index]?.startSourceFrame, partition.startSourceFrame);
		assert.strictEqual(mapper.partitions[index]?.endSourceFrame, partition.endSourceFrame);
		if (index > 0) {
			const previous = required(partitions[index - 1]);
			assert.equal(previous.endOuterFrame, partition.startOuterFrame);
			assert.strictEqual(previous.endSourceFrame, partition.startSourceFrame);
		}
	}
	assert.equal(partitions[0]?.startOuterFrame, 0);
	assert.equal(partitions.at(-1)?.endOuterFrame, mapper.outerFrameCount);
	assertDeepFrozen(mapper);
	assertDeepFrozen(partitions);
	assert.equal(Object.hasOwn(partitions[1] ?? {}, 'coefficient'), false);
	assert.equal(Object.hasOwn(partitions[1] ?? {}, 'samples'), false);
});

test('binds only a non-null exact V16 video shape and refuses hostile or unsafe inputs without getters', () => {
	const curve = fiveModeCurve();
	const accepted = videoClip(curve, {
		id: 'project-bin-video',
		unrelatedPersistedField: Object.freeze({ retained: true }),
	});
	assert.equal(createVideoRetimeRuntimeMapper(accepted).outerFrameCount, 10);

	for (const [name, input, error] of [
		['audio clip', videoClip(curve, { kind: 'audio' }), /video|kind/iu],
		['null map', videoClip(null), /retime|map|null/iu],
		['legacy map', videoClip({
			feature: 'video-retime', points: [{ outer: 0, source: 10, mode: 'forward' }],
		}), /version|map|wire|unsupported/iu],
		['resolved runtime projection', videoClip(curve, {
			coordinateDomain: 'resolved-samples',
			timelineStartFrame: 101,
			durationFrames: 10,
			sourceStartFrame: 8,
			sourceDurationFrames: 8,
		}), /runtime|projection|coordinateDomain|resolved|derived/iu],
		['unsafe sequence end', videoClip(curve, {
			sequenceStartFrame: Number.MAX_SAFE_INTEGER, sequenceFrameCount: 10,
		}), /safe|sequence|range|end/iu],
		['unsafe source end', videoClip(curve, {
			sourceInFrame: Number.MAX_SAFE_INTEGER, sourceFrameCount: 4,
		}), /safe|source|range|end/iu],
	] as const) {
		assert.throws(() => createVideoRetimeRuntimeMapper(input), error, name);
	}

	const missing = videoClip(curve);
	delete missing.sequenceFrameCount;
	assert.throws(() => createVideoRetimeRuntimeMapper(missing), /sequenceFrameCount|required|own/iu);

	for (const field of [
		'kind', 'sequenceStartFrame', 'sequenceFrameCount',
		'sourceInFrame', 'sourceFrameCount', 'retimeMap',
	] as const) {
		let getterCalls = 0;
		const accessor = videoClip(curve);
		Object.defineProperty(accessor, field, {
			enumerable: true,
			get() {
				getterCalls += 1;
				return undefined;
			},
		});
		assert.throws(
			() => createVideoRetimeRuntimeMapper(accessor),
			/accessor|data property|enumerable|own/iu,
			field,
		);
		assert.equal(getterCalls, 0, field);
	}
});

test('refuses invalid outer queries and preserves the algebra exact-work ceiling', () => {
	const mapper = createVideoRetimeRuntimeMapper(videoClip(fiveModeCurve()));
	for (const query of [-1, 11, Number.NaN, { num: 2, den: 2 }, { num: 1, den: 0 }]) {
		assert.throws(() => mapper.mapOuterFrame(query), /outer|domain|safe|canonical|denominator/iu);
	}
	const oversized = fraction(1n << 4_096n, 1n << 4_096n);
	assert.throws(() => mapper.mapOuterFrame(oversized), /4096|bit|complexity|exact/iu);
	assert.throws(
		() => mapper.invertSourceFrame(oversized, { policy: 'all' }),
		/4096|bit|complexity|exact/iu,
	);
});

test('reads raw curve arrays once, snapshots caller state, and never revisits it from mapper operations', () => {
	const points = trackedArray([
		{ outerFrame: 0, sourceFrame: { num: 10, den: 1 } },
		{ outerFrame: 2, sourceFrame: { num: 12, den: 1 } },
	]);
	const segments = trackedArray<{ mode: string }>([{ mode: 'constant-forward' }]);
	const retimeMap: Record<string, unknown> = {
		feature: 'video-retime', version: 2, points: points.proxy, segments: segments.proxy,
	};
	const rawClip = videoClip(retimeMap, {
		sequenceStartFrame: 3,
		sequenceFrameCount: 2,
		sourceInFrame: 10,
		sourceFrameCount: 2,
	});
	const mapper = createVideoRetimeRuntimeMapper(rawClip);

	assert.equal(points.ownKeyReads(), 1);
	assert.equal(segments.ownKeyReads(), 1);
	assert.equal(Object.isFrozen(rawClip), false);
	assert.equal(Object.isFrozen(points.target), false);
	assert.deepEqual(mapper.mapOuterFrame(1), fraction(11n));
	assert.deepEqual(mapper.invertSourceFrame({ num: 11, den: 1 }, { policy: 'all' }), [
		{ kind: 'point', outerFrame: 1 },
	]);
	void mapper.partitions;
	assert.equal(points.ownKeyReads(), 1);
	assert.equal(segments.ownKeyReads(), 1);

	points.target[1] = { outerFrame: 2, sourceFrame: { num: 10, den: 1 } };
	segments.target[0] = { mode: 'freeze' };
	retimeMap.feature = 'audio-warp';
	rawClip.sequenceStartFrame = 9;
	assert.deepEqual(mapper.mapOuterFrame(1), fraction(11n));
	assert.equal(mapper.sequenceStartFrame, 3);
	assert.deepEqual(mapper.partitions[0]?.endSourceFrame, fraction(12n));
	assert.equal(points.ownKeyReads(), 1);
	assert.equal(segments.ownKeyReads(), 1);
});

test('keeps maximum outer extents logarithmic and materializes only bounded segment partitions', () => {
	const maximum = Number.MAX_SAFE_INTEGER;
	const mapper = createVideoRetimeRuntimeMapper(videoClip({
		feature: 'video-retime',
		version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } },
			{ outerFrame: maximum, sourceFrame: { num: 1, den: 1 } },
		],
		segments: [{
			mode: 'ramp-forward',
			startVelocity: { num: 0, den: 1 },
			endVelocity: { num: 2, den: maximum },
		}],
	}, {
		sequenceStartFrame: 0,
		sequenceFrameCount: maximum,
		sourceInFrame: 0,
		sourceFrameCount: 1,
	}));
	const atOne = mapper.mapOuterFrame(1);
	assert.deepEqual(atOne, fraction(1n, BigInt(maximum) ** 2n));
	assert.deepEqual(mapper.mapOuterFrame(atOne), fraction(1n, BigInt(maximum) ** 6n));
	assert.deepEqual(mapper.invertSourceFrame(atOne, { policy: 'all' }), [
		{ kind: 'point', outerFrame: 1 },
	], 'inverse must not enumerate a Number.MAX_SAFE_INTEGER outer domain');
	assert.equal(mapper.partitions.length, 1);

	const bounded = createVideoRetimeRuntimeMapper(videoClip(linearCurve(4_096), {
		sequenceStartFrame: 0,
		sequenceFrameCount: 4_096,
		sourceInFrame: 0,
		sourceFrameCount: 4_096,
	}));
	assert.equal(bounded.partitions.length, 4_096);
	assert.deepEqual(bounded.invertSourceFrame({ num: 2_048, den: 1 }, { policy: 'all' }), [
		{ kind: 'point', outerFrame: 2_048 },
	]);
});

test('source ownership keeps compilation in the V16 binding helper and evaluation in mapper closures', async () => {
	const [mappingSource, v16Source] = await Promise.all([
		readFile(MAPPING_SOURCE_URL, 'utf8'),
		readFile(V16_SOURCE_URL, 'utf8'),
	]);

	assert.equal(callCount(v16Source, 'compileVideoRetimeCurve'), 1);
	assert.equal(callCount(mappingSource, 'compileVideoRetimeCurveV16'), 1);
	assert.ok(callCount(mappingSource, 'evaluateVideoRetimeCurve') >= 1);
	assert.ok(callCount(mappingSource, 'invertVideoRetimeCurve') >= 1);
	assert.doesNotMatch(mappingSource, /\bnormalizeVideoRetimeCurveV16\b/u);
	assert.doesNotMatch(mappingSource, /\bcompileVideoRetimeCurve\b/u);
	assert.match(mappingSource, /\bconst\s+compiled\s*=[^;]*\bcompileVideoRetimeCurveV16\s*\(/u);
	assert.match(mappingSource, /\bevaluateVideoRetimeCurve\s*\(\s*compiled\s*,/u);
	assert.match(mappingSource, /\binvertVideoRetimeCurve\s*\(\s*compiled\s*,/u);
});

function fiveModeCurve() {
	return {
		feature: 'video-retime',
		version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 10, den: 1 } },
			{ outerFrame: 2, sourceFrame: { num: 12, den: 1 } },
			{ outerFrame: 4, sourceFrame: { num: 14, den: 1 } },
			{ outerFrame: 6, sourceFrame: { num: 14, den: 1 } },
			{ outerFrame: 8, sourceFrame: { num: 12, den: 1 } },
			{ outerFrame: 10, sourceFrame: { num: 10, den: 1 } },
		],
		segments: [
			{ mode: 'constant-forward' },
			{ mode: 'ramp-forward', startVelocity: { num: 0, den: 1 }, endVelocity: { num: 2, den: 1 } },
			{ mode: 'freeze' },
			{ mode: 'ramp-reverse', startVelocity: { num: 0, den: 1 }, endVelocity: { num: 2, den: 1 } },
			{ mode: 'constant-reverse' },
		],
	};
}

function linearCurve(segmentCount: number) {
	return {
		feature: 'video-retime',
		version: 2,
		points: Array.from({ length: segmentCount + 1 }, (_, outerFrame) => ({
			outerFrame,
			sourceFrame: { num: outerFrame, den: 1 },
		})),
		segments: Array.from({ length: segmentCount }, () => ({ mode: 'constant-forward' })),
	};
}

function uniformCurve(frameCount: number) {
	return {
		feature: 'video-retime',
		version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } },
			{ outerFrame: frameCount, sourceFrame: { num: frameCount, den: 1 } },
		],
		segments: [{ mode: 'constant-forward' }],
	};
}

function videoClip(retimeMap: unknown, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		id: 'video-clip',
		kind: 'video',
		sourceId: 'video-source',
		sequenceId: 'main',
		sequenceStartFrame: 101,
		sequenceFrameCount: 10,
		sourceInFrame: 8,
		sourceFrameCount: 8,
		retimeMap,
		...overrides,
	};
}

function trackedArray<Value>(target: Value[]) {
	let ownKeyReads = 0;
	return {
		target,
		proxy: new Proxy(target, {
			ownKeys(value) {
				ownKeyReads += 1;
				return Reflect.ownKeys(value);
			},
		}),
		ownKeyReads: () => ownKeyReads,
	};
}

function fraction(numerator: bigint, denominator = 1n) {
	return Object.freeze({ numerator, denominator });
}

function callCount(source: string, name: string): number {
	return [...source.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'gu'))].length;
}

function required<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new Error('Expected a bounded fixture value.');
	return value;
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
	if (value === null || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	assert.equal(Object.isFrozen(value), true);
	for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}
