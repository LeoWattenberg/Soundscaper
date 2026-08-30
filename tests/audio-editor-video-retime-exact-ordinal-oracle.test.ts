/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoRetimeExactOrdinalOracle,
} from '../src/common/editor/video-retime-exact-ordinal-oracle.ts';
import {
	assertVideoRetimeExactExportFrame,
	assertVideoRetimeExactExportFrameSource,
	createVideoRetimeExactExportFrameSource,
	createVideoRetimeExactPreviewConsumer,
} from '../src/common/editor/video-retime-ordinal-consumers.ts';
import {
	assertVideoRetimeExactOrdinalAuthority,
	createVideoRetimeExactOrdinalAuthority,
} from '../src/common/editor/video-retime-exact-ordinal-authority.ts';
import { createVideoRetimeExportIntentV6 } from '../src/common/editor/video-retime-export-plan.ts';
import {
	baseInput,
	bindCfrTiming,
	bindVfrTiming,
	createFiveModeIntent,
	topology,
	videoClip,
} from './helpers/video-retime-export-fixtures.ts';

test('computes every V16 mode picture ordinal lazily with exact rational arithmetic', () => {
	const oracle = createVideoRetimeExactOrdinalOracle(
		createFiveModeIntent(),
		new Map([['curve-source', bindCfrTiming('curve-source', 20, { num: 1, den: 1 })]]),
	);
	assert.equal(oracle.outputFrameCount, 10);
	assert.deepEqual(
		Array.from({ length: 10 }, (_, ordinal) => oracle.frameAt(ordinal).pictures[0]?.sourceOrdinal),
		[10, 11, 12, 12, 14, 14, 13, 13, 11, 10],
	);
	assert.equal(Object.hasOwn(oracle, 'frames'), false);
	assert.strictEqual(oracle.frameAt(9), oracle.frameAt(9), 'only the last requested ordinal may be cached');
});

test('accepts authenticated timing for clips that contribute no serialized intersection row', () => {
	const curveTiming = bindCfrTiming('curve-source', 20, { num: 1, den: 1 });
	const unusedTiming = bindCfrTiming('zero-row-source', 4, { num: 1, den: 1 });
	const oracle = createVideoRetimeExactOrdinalOracle(createFiveModeIntent(), new Map([
		['curve-source', curveTiming],
		['zero-row-source', unusedTiming],
	]));
	assert.equal(oracle.frameAt(0).pictures[0]?.sourceId, 'curve-source');
});

test('resolves null-retime VFR wall-clock source time through exact boundary ownership', () => {
	const timing = bindVfrTiming('vfr-source', [0n, 1n, 3n, 6n], 4n, 1);
	const intent = createVideoRetimeExportIntentV6(baseInput({
		sampleDuration: 4,
		topology: topology(0, 4, 'vfr-clip'),
		canonicalClips: [videoClip('vfr-clip', 'vfr-source', null, {
			sequenceFrameCount: 4, sourceFrameCount: 4,
		})],
	}), new Map([['vfr-source', timing]]));
	const oracle = createVideoRetimeExactOrdinalOracle(intent, new Map([['vfr-source', timing]]));

	assert.deepEqual(
		Array.from({ length: 4 }, (_, ordinal) => oracle.frameAt(ordinal).pictures[0]?.sourceOrdinal),
		[0, 1, 2, 3],
	);
	assert.deepEqual(
		oracle.frameAt(1).pictures[0]?.sourceTime,
		{ numerator: 5n, denominator: 2n },
	);
	assert.deepEqual(oracle.frameAt(1).pictures[0], {
		intersectionIndex: 0,
		clipId: 'vfr-clip',
		sourceId: 'vfr-source',
		mapping: 'uniform-wall-clock',
		outerCell: 1,
		segmentIndex: 0,
		mode: 'constant-forward',
		sourceOrdinal: 1,
		sourcePosition: { numerator: 7n, denominator: 4n },
		sourceTime: { numerator: 5n, denominator: 2n },
		drawableSourceStartTime: { numerator: 1n, denominator: 1n },
		drawableSourceEndTime: { numerator: 3n, denominator: 1n },
	});
});

test('does not repair a rational that binary64 would round across an ordinal boundary', () => {
	const almostTen = { numerator: '90071992547409909', denominator: '9007199254740991' };
	const intent = {
		kind: 'video-retime-export-intent', version: 6,
		sampleStart: 0, sampleDuration: 1, sampleRate: 1,
		sequenceBinding: { id: 'sequence-1', rate: { num: 1, den: 1 } },
		outputRate: { num: 1, den: 1 }, outputFrameCount: 1,
		intersections: [{
			index: 0, topologyIntervalIndex: 0, layerIndex: 0, clipIndex: 0,
			clipId: 'clip', sourceId: 'source', sequenceStartFrame: 0, outerFrameCount: 1,
			sourceInFrame: 0, sourceOutFrame: 20, startSample: 0, endSample: 1,
			startOutputFrame: 0, endOutputFrame: 1, mapping: 'curve', segmentIndex: 0,
			mode: 'constant-forward', segmentStartOuterCell: 0, segmentEndOuterCell: 1,
			sourceStart: almostTen, sourceEnd: { numerator: '10', denominator: '1' },
			startOuterCell: 0, endOuterCell: 1, clippedSourceStart: almostTen,
			clippedSourceEnd: { numerator: '10', denominator: '1' },
			drawableStartTime: { numerator: '0', denominator: '1' },
			drawableEndTime: { numerator: '20', denominator: '1' },
		}],
		limits: {
			topologyRecordCount: 3, compiledSegmentCount: 1, geometricCandidateCount: 1,
			serializedIntersectionCount: 1, decimalByteCount: 0,
		},
	};
	const timing = bindCfrTiming('source', 20, { num: 1, den: 1 });
	const picture = createVideoRetimeExactOrdinalOracle(
		intent,
		new Map([['source', timing]]),
	).frameAt(0).pictures[0];
	assert.equal(picture?.sourceOrdinal, 9);
	assert.deepEqual(picture?.sourcePosition, {
		numerator: 90071992547409909n, denominator: 9007199254740991n,
	});
});

test('does not narrow two admitted 4,096-bit wire rationals at a working midpoint', () => {
	const denominatorA = (1n << 4_096n) - 1n;
	const denominatorB = denominatorA - 2n;
	const decimal = (denominator: bigint) => ({ numerator: '1', denominator: denominator.toString() });
	const intent = {
		kind: 'video-retime-export-intent', version: 6,
		sampleStart: 0, sampleDuration: 2, sampleRate: 1,
		sequenceBinding: { id: 'sequence-1', rate: { num: 1, den: 1 } },
		outputRate: { num: 1, den: 1 }, outputFrameCount: 2,
		intersections: [{
			index: 0, topologyIntervalIndex: 0, layerIndex: 0, clipIndex: 0,
			clipId: 'clip', sourceId: 'source', sequenceStartFrame: 0, outerFrameCount: 2,
			sourceInFrame: 0, sourceOutFrame: 1, startSample: 0, endSample: 2,
			startOutputFrame: 0, endOutputFrame: 2, mapping: 'uniform-wall-clock',
			clipStartSample: 0, clipEndSample: 2,
			sourceStartTime: decimal(denominatorA), sourceEndTime: decimal(denominatorB),
			clippedSourceStartTime: decimal(denominatorA),
			clippedSourceEndTime: decimal(denominatorB),
		}],
		limits: {
			topologyRecordCount: 3, compiledSegmentCount: 0, geometricCandidateCount: 1,
			serializedIntersectionCount: 1, decimalByteCount: 0,
		},
	};
	const timing = bindCfrTiming('source', 1, { num: 1, den: 1 });
	const picture = createVideoRetimeExactOrdinalOracle(
		intent,
		new Map([['source', timing]]),
	).frameAt(1).pictures[0];
	assert.equal(picture?.sourceOrdinal, 0);
	assert.ok((picture?.sourceTime.denominator.toString(2).length ?? 0) > 4_096);
});

test('preview and export consume one authenticated authority and a two-million-frame domain stays O(1)', async () => {
	const intent = createVideoRetimeExportIntentV6(baseInput({
		sampleDuration: 1,
		outputRate: { num: 2_000_000, den: 1 },
	}), new Map());
	const authority = createVideoRetimeExactOrdinalAuthority(intent, new Map());
	assert.doesNotThrow(() => assertVideoRetimeExactOrdinalAuthority(authority));
	assert.throws(
		() => assertVideoRetimeExactOrdinalAuthority(structuredClone(authority)),
		/authenticated.*authority/iu,
	);
	const source = createVideoRetimeExactExportFrameSource(authority);
	assert.doesNotThrow(() => assertVideoRetimeExactExportFrameSource(source));
	assert.equal(source.frameCount, 2_000_000);
	const last = source.frameAt(1_999_999);
	assert.doesNotThrow(() => assertVideoRetimeExactExportFrame(source, last));
	assert.throws(
		() => assertVideoRetimeExactExportFrame(source, structuredClone(last)),
		/authenticated|owned/iu,
	);
	assert.deepEqual(last.pictures, []);
	assert.deepEqual(Object.keys(authority), ['outputFrameCount']);

	const timing = bindCfrTiming('curve-source', 20, { num: 1, den: 1 });
	const pictureAuthority = createVideoRetimeExactOrdinalAuthority(
		createFiveModeIntent(),
		new Map([['curve-source', timing]]),
	);
	let presentedFrame = -1;
	let presentedSourceTime: unknown = null;
	const preview = createVideoRetimeExactPreviewConsumer(pictureAuthority, {
		pause() {},
		assertCurrent() {},
		present(request) {
			presentedFrame = request.drawableSourceFrame;
			return Promise.resolve({ mediaTime: request.targetSeconds });
		},
	}, {
		onPresented(descriptor) { presentedSourceTime = descriptor.sourceTime; },
	});
	assert.deepEqual(await preview.requestFrame({
		outputOrdinal: 3, clipId: 'curve-clip', sourceId: 'curve-source',
	}), { kind: 'presented' });
	const exportFrame = createVideoRetimeExactExportFrameSource(pictureAuthority).frameAt(3);
	assert.equal(presentedFrame, exportFrame.pictures[0]?.sourceOrdinal);
	assert.deepEqual(presentedSourceTime, exportFrame.pictures[0]?.sourceTime);
	preview.dispose();
});

test('rejects forged timing, mismatched sources, malformed intent and out-of-domain ordinals', () => {
	const intent = createFiveModeIntent();
	assert.throws(() => createVideoRetimeExactOrdinalOracle(intent, new Map()), /timing|source/iu);
	assert.throws(
		() => createVideoRetimeExactOrdinalOracle(intent, new Map([[
			'curve-source', { sourceId: 'curve-source', frameCount: 20, kind: 'cfr' },
		]])),
		/authenticated|bind|timing/iu,
	);
	assert.throws(
		() => createVideoRetimeExactOrdinalOracle(intent, new Map([
			['curve-source', bindCfrTiming('curve-source', 20, { num: 1, den: 1 })],
			['extra-key', bindCfrTiming('different-source', 1, { num: 1, den: 1 })],
		])),
		/source binding|inconsistent/iu,
	);
	assert.throws(
		() => createVideoRetimeExactOrdinalOracle({ ...intent, extension: true }, new Map()),
		/closed|shape|field/iu,
	);
	const oracle = createVideoRetimeExactOrdinalOracle(
		intent,
		new Map([['curve-source', bindCfrTiming('curve-source', 20, { num: 1, den: 1 })]]),
	);
	for (const ordinal of [-1, 10, 0.5, Number.NaN]) {
		assert.throws(() => oracle.frameAt(ordinal), /ordinal|range|integer/iu);
	}
});
