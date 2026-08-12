/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	videoRetimeExportOutputBoundary,
} from '../src/common/editor/video-retime-export-domain.ts';
import {
	createVideoRetimeExportIntentV6,
} from '../src/common/editor/video-retime-export-plan.ts';
import { createVideoRetimeOutputCadence } from '../src/common/editor/video-retime-output-cadence.ts';
import type { BoundVideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import {
	assertDeepFrozen, baseInput, bindCfrTiming, bindVfrTiming, blackTopology,
	createFiveModeIntent, curveRow, decimal, decimalByteCount, fiveModeCurve,
	linearCurve, NTSC, RATE_1, RATE_24, rejectGet, required, topology, videoClip,
} from './helpers/video-retime-export-fixtures.ts';

const EXPORT_PLAN_SOURCE_URL = new URL('../src/common/editor/video-retime-export-plan.ts', import.meta.url);

test('serializes one null-map clip as exact uniform wall-clock intent without curve fields', () => {
	const timing = bindCfrTiming('source-1', 20, RATE_24);
	const clip = {
		kind: 'video',
		id: 'clip-1',
		sourceId: 'source-1',
		sequenceId: 'sequence-1',
		sequenceStartFrame: 0,
		sequenceFrameCount: 4,
		sourceInFrame: 10,
		sourceFrameCount: 4,
		retimeMap: null,
		unrelatedPersistedField: Object.freeze({ retained: true }),
	};
	const intent = createVideoRetimeExportIntentV6({
		sampleStart: 0,
		sampleDuration: 8,
		sampleRate: 48,
		sequenceBinding: { id: 'sequence-1', rate: RATE_24 },
		topology: [{ startSample: 0, endSample: 8, layers: [{ clips: [{ clipId: 'clip-1' }] }] }],
		canonicalClips: [clip],
	}, new Map([['source-1', timing]]));
	assert.equal(intent.kind, 'video-retime-export-intent');
	assert.equal(intent.version, 6);
	assert.equal(intent.outputFrameCount, 4);
	assert.deepEqual(intent.limits, {
		topologyRecordCount: 3,
		compiledSegmentCount: 0,
		geometricCandidateCount: 1,
		serializedIntersectionCount: 1,
		decimalByteCount: 28,
	});
	assert.deepEqual(intent.intersections, [{
		index: 0,
		topologyIntervalIndex: 0,
		layerIndex: 0,
		clipIndex: 0,
		clipId: 'clip-1',
		sourceId: 'source-1',
		sequenceStartFrame: 0,
		outerFrameCount: 4,
		sourceInFrame: 10,
		sourceOutFrame: 14,
		startSample: 0,
		endSample: 8,
		startOutputFrame: 0,
		endOutputFrame: 4,
		mapping: 'uniform-wall-clock',
		clipStartSample: 0,
		clipEndSample: 8,
		sourceStartTime: { numerator: '5', denominator: '12' },
		sourceEndTime: { numerator: '7', denominator: '12' },
		clippedSourceStartTime: { numerator: '5', denominator: '12' },
		clippedSourceEndTime: { numerator: '7', denominator: '12' },
	}]);
	assert.equal(Object.hasOwn(intent.intersections[0] ?? {}, 'segmentIndex'), false);
	assert.equal(Object.hasOwn(intent.intersections[0] ?? {}, 'drawableStartTime'), false);
	assert.equal(Object.isFrozen(intent), true);
	assert.equal(Object.isFrozen(intent.intersections), true);
	const stableJson = JSON.stringify(intent);
	clip.id = 'mutated-after-construction';
	clip.sourceInFrame = 0;
	assert.equal(JSON.stringify(intent), stableJson);
	assert.deepEqual(JSON.parse(JSON.stringify(intent)), intent);
});

test('keeps irregular VFR null mapping on exact wall-clock progress at an NTSC sample slice', () => {
	const timing = bindVfrTiming('vfr-source', [0n, 1n, 4n, 5n], 4n, 1);
	const clip = videoClip('vfr-clip', 'vfr-source', null, {
		sequenceStartFrame: 1,
		sequenceFrameCount: 4,
		sourceInFrame: 0,
		sourceFrameCount: 4,
	});
	const intent = createVideoRetimeExportIntentV6(baseInput({
		sampleStart: 4_805,
		sampleDuration: 1,
		sampleRate: 48_000,
		sequenceBinding: { id: 'sequence-1', rate: NTSC },
		topology: topology(4_805, 4_806, 'vfr-clip'),
		canonicalClips: [clip],
	}), new Map([['vfr-source', timing]]));
	assert.equal(intent.outputFrameCount, 1);
	assert.deepEqual(intent.intersections, [{
		index: 0,
		topologyIntervalIndex: 0,
		layerIndex: 0,
		clipIndex: 0,
		clipId: 'vfr-clip',
		sourceId: 'vfr-source',
		sequenceStartFrame: 1,
		outerFrameCount: 4,
		sourceInFrame: 0,
		sourceOutFrame: 4,
		startSample: 4_805,
		endSample: 4_806,
		startOutputFrame: 0,
		endOutputFrame: 1,
		mapping: 'uniform-wall-clock',
		clipStartSample: 1_602,
		clipEndSample: 8_008,
		sourceStartTime: decimal(0),
		sourceEndTime: decimal(9),
		clippedSourceStartTime: decimal(9, 2),
		clippedSourceEndTime: decimal(14_418, 3_203),
	}]);
	const row = required(intent.intersections[0]);
	for (const forbidden of [
		'mode', 'segmentIndex', 'startOuterCell', 'clippedSourceStart',
		'drawableStartTime', 'drawableEndTime',
	]) assert.equal(Object.hasOwn(row, forbidden), false);
	assert.equal(intent.limits.decimalByteCount, decimalByteCount(intent.intersections));
	assertDeepFrozen(intent);
});

test('serializes all five curve modes with original coefficients and exact drawable windows', () => {
	const timing = bindCfrTiming('curve-source', 20, RATE_1);
	const intent = createVideoRetimeExportIntentV6(baseInput({
		sampleStart: 0,
		sampleDuration: 10,
		sampleRate: 1,
		sequenceBinding: { id: 'sequence-1', rate: RATE_1 },
		topology: topology(0, 10, 'curve-clip'),
		canonicalClips: [videoClip('curve-clip', 'curve-source', fiveModeCurve(), {
			sequenceFrameCount: 10,
			sourceInFrame: 10,
			sourceFrameCount: 5,
		})],
	}), new Map([['curve-source', timing]]));
	assert.deepEqual(intent.intersections, [
		curveRow(0, 'constant-forward', 10, 12, 10, 12),
		curveRow(1, 'ramp-forward', 12, 14, 12, 13, [0, 2]),
		curveRow(2, 'freeze', 14, 14, 14, 15),
		curveRow(3, 'ramp-reverse', 14, 12, 13, 14, [0, 2]),
		curveRow(4, 'constant-reverse', 12, 10, 10, 12),
	]);
	assert.deepEqual(intent.limits, {
		topologyRecordCount: 3,
		compiledSegmentCount: 5,
		geometricCandidateCount: 5,
		serializedIntersectionCount: 5,
		decimalByteCount: decimalByteCount(intent.intersections),
	});
	const atBreakpoint = createVideoRetimeExportIntentV6(baseInput({
		sampleStart: 2, sampleDuration: 1, sampleRate: 1,
		topology: topology(2, 3, 'curve-clip'),
		canonicalClips: [videoClip('curve-clip', 'curve-source', fiveModeCurve(), {
			sequenceFrameCount: 10, sourceInFrame: 10, sourceFrameCount: 5,
		})],
	}), new Map([['curve-source', timing]]));
	const breakpoint = required(atBreakpoint.intersections[0]);
	assert.equal(breakpoint.mapping, 'curve');
	if (breakpoint.mapping !== 'curve') assert.fail('Expected a curve intersection.');
	assert.deepEqual({
		segmentIndex: breakpoint.segmentIndex,
		startOuterCell: breakpoint.startOuterCell,
		clippedSourceEnd: breakpoint.clippedSourceEnd,
	}, { segmentIndex: 1, startOuterCell: 2, clippedSourceEnd: decimal(25, 2) });
	assert.equal(JSON.stringify(createFiveModeIntent()), JSON.stringify(intent));
	assertDeepFrozen(intent);
});

test('counts cadence-collapsed candidates without serializing dropped interiors or output-sized state', () => {
	const timing = bindCfrTiming('curve-source', 20, RATE_1);
	const sparse = createVideoRetimeExportIntentV6(baseInput({
		sampleStart: 0,
		sampleDuration: 100,
		sampleRate: 100,
		sequenceBinding: { id: 'sequence-1', rate: { num: 10, den: 1 } },
		outputRate: RATE_1,
		topology: topology(0, 100, 'curve-clip'),
		canonicalClips: [videoClip('curve-clip', 'curve-source', fiveModeCurve(), {
			sequenceFrameCount: 10,
			sourceInFrame: 10,
			sourceFrameCount: 5,
		})],
	}), new Map([['curve-source', timing]]));
	assert.equal(sparse.limits.geometricCandidateCount, 5);
	assert.equal(sparse.limits.serializedIntersectionCount, 1);
	assert.equal(sparse.intersections.length, 1);
	const row = required(sparse.intersections[0]);
	assert.equal(row.mapping, 'curve');
	if (row.mapping !== 'curve') assert.fail('Expected a curve intersection.');
	assert.deepEqual({
		startSample: row.startSample,
		endSample: row.endSample,
		startOutputFrame: row.startOutputFrame,
		endOutputFrame: row.endOutputFrame,
		segmentStartOuterCell: row.segmentStartOuterCell,
		segmentEndOuterCell: row.segmentEndOuterCell,
		startOuterCell: row.startOuterCell,
		endOuterCell: row.endOuterCell,
		clippedSourceStart: row.clippedSourceStart,
		clippedSourceEnd: row.clippedSourceEnd,
	}, {
		startSample: 0,
		endSample: 20,
		startOutputFrame: 0,
		endOutputFrame: 1,
		segmentStartOuterCell: 0,
		segmentEndOuterCell: 2,
		startOuterCell: 0,
		endOuterCell: 1,
		clippedSourceStart: decimal(10),
		clippedSourceEnd: decimal(11),
	});
	const huge = createVideoRetimeExportIntentV6(baseInput({
		sampleDuration: 1,
		sampleRate: 1,
		outputRate: { num: 2_000_000, den: 1 },
		topology: [{ startSample: 0, endSample: 1, layers: [] }],
		canonicalClips: [],
	}), new Map());
	assert.equal(huge.outputFrameCount, 2_000_000);
	assert.deepEqual(huge.intersections, []);
	assert.equal(Object.hasOwn(huge, 'frames'), false);
	assert.ok(JSON.stringify(huge).length < 1_000);
});

test('admits exact compiled and geometric limits and refuses limit plus one', () => {
	const sourceId = 'limit-source';
	const curve = linearCurve(4_096);
	const timing = bindCfrTiming(sourceId, 4_096, RATE_1);
	const clip = (id: string, map = curve, count = 4_096) => videoClip(id, sourceId, map, {
		sequenceFrameCount: count, sourceFrameCount: count,
	});
	const clips = ['a', 'b', 'c', 'd'].map((id) => clip(id));
	const clipRefs = (ids: readonly string[]) => [{
		startSample: 0, endSample: 1,
		layers: [{ clips: ids.map((clipId) => ({ clipId })) }],
	}];
	const atSegmentLimit = createVideoRetimeExportIntentV6(baseInput({
		topology: clipRefs(['a', 'b', 'c', 'd']), canonicalClips: clips,
	}), new Map([[sourceId, timing]]));
	assert.equal(atSegmentLimit.limits.compiledSegmentCount, 16_384);
	assert.throws(() => createVideoRetimeExportIntentV6(baseInput({
		topology: clipRefs(['a', 'b', 'c', 'd', 'e']),
		canonicalClips: [...clips, clip('e', linearCurve(1), 1)],
	}), new Map([[sourceId, timing]])), /16.?384|compiled|segment|limit/iu);

	const repeated = (count: number) => [{
		startSample: 0, endSample: 4_096,
		layers: [{ clips: Array.from({ length: count }, () => ({ clipId: 'a' })) }],
	}];
	const atCandidateLimit = createVideoRetimeExportIntentV6(baseInput({
		sampleDuration: 4_096, sampleRate: 1, outputRate: { num: 1, den: 4_096 },
		topology: repeated(4), canonicalClips: [required(clips[0])],
	}), new Map([[sourceId, timing]]));
	assert.equal(atCandidateLimit.limits.geometricCandidateCount, 16_384);
	assert.throws(() => createVideoRetimeExportIntentV6(baseInput({
		sampleDuration: 4_096, sampleRate: 1, outputRate: { num: 1, den: 4_096 },
		topology: repeated(5), canonicalClips: [required(clips[0])],
	}), new Map([[sourceId, timing]])), /16.?384|candidate|geometric|limit/iu);
});

test('owns J range edges, huge curve envelopes, and final VFR drawable duration', async () => {
	const cadence = createVideoRetimeOutputCadence({
		sampleStart: 10, sampleDuration: 10, sampleRate: 5,
		sequenceRate: RATE_1, outputRate: { num: 2, den: 1 },
	});
	assert.deepEqual([-1, 10, 15, 20, 21].map((sample) => (
		videoRetimeExportOutputBoundary(sample, cadence)
	)), [0, 0, 2, 4, 4]);

	const hugeCurve = {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } },
			{ outerFrame: 1_000_000, sourceFrame: { num: 1, den: 1 } },
		],
		segments: [{ mode: 'constant-forward' }],
	};
	const huge = createVideoRetimeExportIntentV6(baseInput({
		sampleDuration: 1_000_000,
		topology: topology(0, 1_000_000, 'huge'),
		canonicalClips: [videoClip('huge', 'huge-source', hugeCurve, {
			sequenceFrameCount: 1_000_000, sourceFrameCount: 1,
		})],
	}), new Map([['huge-source', bindCfrTiming('huge-source', 1, RATE_1)]]));
	const hugeRow = required(huge.intersections[0]);
	assert.equal(hugeRow.mapping, 'curve');
	if (hugeRow.mapping !== 'curve') assert.fail('Expected a curve intersection.');
	assert.deepEqual([hugeRow.startOuterCell, hugeRow.endOuterCell], [0, 1_000_000]);
	const source = await readFile(EXPORT_PLAN_SOURCE_URL, 'utf8');
	assert.equal([...source.matchAll(/\.ownedFrameAt\s*\(/gu)].length, 2);

	const vfr = createVideoRetimeExportIntentV6(baseInput({
		sampleDuration: 2,
		topology: topology(0, 2, 'vfr-curve'),
		canonicalClips: [videoClip('vfr-curve', 'vfr-curve-source', linearCurve(2), {
			sequenceFrameCount: 2, sourceFrameCount: 2,
		})],
	}), new Map([['vfr-curve-source', bindVfrTiming('vfr-curve-source', [0n, 2n], 5n, 1)]]));
	const vfrRow = required(vfr.intersections.at(-1));
	assert.equal(vfrRow.mapping, 'curve');
	if (vfrRow.mapping !== 'curve') assert.fail('Expected a curve intersection.');
	assert.deepEqual(vfrRow.drawableEndTime, decimal(7));
});

test('charges every repeated decimal token occurrence through the public intent seam', () => {
	const intent = createVideoRetimeExportIntentV6(baseInput({
		sampleDuration: 1,
		topology: [{
			startSample: 0,
			endSample: 1,
			layers: [
				{ clips: [{ clipId: 'repeat-a' }] },
				{ clips: [{ clipId: 'repeat-b' }] },
			],
		}],
		canonicalClips: [
			videoClip('repeat-a', 'repeat-source', null),
			videoClip('repeat-b', 'repeat-source', null),
		],
	}), new Map([['repeat-source', bindCfrTiming('repeat-source', 1, RATE_1)]]));
	assert.equal(intent.intersections.length, 2);
	const firstDecimalBytes = decimalByteCount(required(intent.intersections[0]));
	const secondDecimalBytes = decimalByteCount(required(intent.intersections[1]));
	assert.equal(firstDecimalBytes, secondDecimalBytes);
	assert.equal(
		intent.limits.decimalByteCount,
		firstDecimalBytes + secondDecimalBytes,
	);
	for (const row of [...intent.intersections, ...createFiveModeIntent().intersections]) {
		assert.ok(Buffer.byteLength(JSON.stringify(row), 'utf8') > 2 * decimalByteCount(row));
	}
});

test('descriptor-snapshots the complete V2 wire without invoking changing Proxy getters', () => {
	const tracker = { gets: 0 };
	const sourceStart = rejectGet({ num: 0, den: 1 }, tracker);
	const sourceEnd = rejectGet({ num: 2, den: 1 }, tracker);
	const points = rejectGet([
		rejectGet({ outerFrame: 0, sourceFrame: sourceStart }, tracker),
		rejectGet({ outerFrame: 2, sourceFrame: sourceEnd }, tracker),
	], tracker);
	const segments = rejectGet([
		rejectGet({ mode: 'constant-forward' }, tracker),
	], tracker);
	const map = rejectGet({
		feature: 'video-retime', version: 2, points, segments,
	}, tracker);
	const clip = rejectGet(videoClip('proxy-clip', 'proxy-source', map, {
		sequenceFrameCount: 2,
		sourceInFrame: 0,
		sourceFrameCount: 2,
	}), tracker);
	const intent = createVideoRetimeExportIntentV6(baseInput({
		sampleDuration: 2,
		topology: topology(0, 2, 'proxy-clip'),
		canonicalClips: [clip],
	}), new Map([['proxy-source', bindCfrTiming('proxy-source', 2, RATE_1)]]));
	assert.equal(tracker.gets, 0);
	assert.equal(intent.limits.compiledSegmentCount, 1);
	assert.equal(intent.intersections.length, 1);
	const row = required(intent.intersections[0]);
	assert.equal(row.mapping, 'curve');
	if (row.mapping !== 'curve') assert.fail('Expected a curve intersection.');
	assert.deepEqual(row.clippedSourceEnd, decimal(2));
});

test('refuses forged authority, projected clips, accessors, unsafe counts, and exact admission excess', () => {
	const timing = bindCfrTiming('secure-source', 4, RATE_1);
	const clip = videoClip('secure-clip', 'secure-source', null, {
		sequenceFrameCount: 4,
		sourceFrameCount: 4,
	});
	const input = baseInput({
		sampleDuration: 4,
		topology: topology(0, 4, 'secure-clip'),
		canonicalClips: [clip],
	});
	assert.throws(
		() => createVideoRetimeExportIntentV6(input, new Map([[
			'secure-source', Object.freeze({ ...timing }) as BoundVideoSourceTimingView,
		]])),
		/bound|timing|token|authentic/iu,
	);
	assert.throws(
		() => createVideoRetimeExportIntentV6(input, new Map([[
			'secure-source', bindCfrTiming('different-source', 4, RATE_1),
		]])),
		/source|identity|timing|match/iu,
	);
	assert.throws(
		() => createVideoRetimeExportIntentV6({
			...input,
			canonicalClips: [{ ...clip, timelineStartFrame: 0 }],
		}, new Map([['secure-source', timing]])),
		/canonical|persisted|projection|timelineStartFrame/iu,
	);
	assert.throws(
		() => createVideoRetimeExportIntentV6({
			...input,
			sequenceBinding: { id: 'other-sequence', rate: RATE_1 },
		}, new Map([['secure-source', timing]])),
		/sequence|match|binding/iu,
	);

	let getterCalls = 0;
	const accessorInput = baseInput({ canonicalClips: [] });
	Object.defineProperty(accessorInput, 'sampleStart', {
		enumerable: true,
		get() { getterCalls += 1; return 0; },
	});
	assert.throws(
		() => createVideoRetimeExportIntentV6(accessorInput, new Map()),
		/accessor|data property|enumerable|sampleStart/iu,
	);
	assert.equal(getterCalls, 0);
	let unopenedClipReads = 0;
	const unopenedClip = new Proxy(videoClip('unopened', 'secure-source', null), {
		getOwnPropertyDescriptor(target, key) {
			unopenedClipReads += 1;
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	});
	assert.throws(() => createVideoRetimeExportIntentV6(baseInput({
		sequenceBinding: { id: '\\'.repeat(4_194_304), rate: RATE_1 },
		topology: topology(0, 1, 'unopened'), canonicalClips: [unopenedClip],
	}), new Map([['secure-source', timing]])), /byte|json|limit|size/iu);
	assert.equal(unopenedClipReads, 0);

	assert.throws(() => createVideoRetimeExportIntentV6(baseInput({
		sampleDuration: 1,
		outputRate: { num: 2_000_001, den: 1 },
	}), new Map()), /2.?000.?000|count|output/iu);

	const atTopologyLimit = createVideoRetimeExportIntentV6(baseInput({
		sampleDuration: 16_384,
		sampleRate: 16_384,
		topology: blackTopology(16_384),
	}), new Map());
	assert.equal(atTopologyLimit.limits.topologyRecordCount, 16_384);
	let oversizedTopologyTraversals = 0;
	const oversizedTopology = new Proxy(blackTopology(16_385), {
		ownKeys(target) { oversizedTopologyTraversals += 1; return Reflect.ownKeys(target); },
		getOwnPropertyDescriptor(target, key) {
			if (key !== 'length') oversizedTopologyTraversals += 1;
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	});
	assert.throws(() => createVideoRetimeExportIntentV6(baseInput({
		sampleDuration: 16_385,
		sampleRate: 16_385,
		topology: oversizedTopology,
	}), new Map()), /16.?384|topology|record|limit/iu);
	assert.equal(oversizedTopologyTraversals, 0);

	let timingIterations = 0;
	const extraTiming = new Map([['unused-source', timing]]);
	const inheritedEntries = extraTiming.entries.bind(extraTiming);
	Object.defineProperty(extraTiming, 'entries', {
		value: () => { timingIterations += 1; return inheritedEntries(); },
	});
	assert.throws(
		() => createVideoRetimeExportIntentV6(baseInput(), extraTiming),
		/active|exact|source|timing/iu,
	);
	assert.equal(timingIterations, 0);

	const byteIntent = (clipId: string) => createVideoRetimeExportIntentV6(baseInput({
		topology: topology(0, 1, clipId),
		canonicalClips: [videoClip(clipId, 'secure-source', null)],
	}), new Map([['secure-source', timing]]));
	const small = byteIntent('x');
	const fixedBytes = Buffer.byteLength(JSON.stringify(small), 'utf8')
		- Buffer.byteLength(JSON.stringify('x'), 'utf8');
	const atLimitId = '\\'.repeat(Math.floor((8_388_608 - fixedBytes - 2) / 2));
	const atByteLimit = byteIntent(atLimitId);
	assert.ok(Buffer.byteLength(JSON.stringify(atByteLimit), 'utf8') <= 8_388_608);
	assert.throws(() => byteIntent(`${atLimitId}\\`), /8.?388.?608|byte|json|limit|size/iu);
});
