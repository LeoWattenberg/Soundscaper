/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createVideoRetimeFrameDispatcher,
} from '../src/common/editor/video-retime-frame-dispatch.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../src/common/editor/video-source-timing-view.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';

const DISPATCH_SOURCE_URL = new URL('../src/common/editor/video-retime-frame-dispatch.ts', import.meta.url);
const TIMING_SOURCE_URL = new URL('../src/common/editor/video-source-timing-view.ts', import.meta.url);
const SOURCE_SHA256 = '9e'.repeat(32);
const RATE_24 = Object.freeze({ num: 24, den: 1 });

test('dispatches every retime mode from clip-relative cells with exact drawable intervals', () => {
	const timing = bindCfrTiming('video-source', 50, RATE_24);
	const dispatcher = createVideoRetimeFrameDispatcher(videoClip(fiveModeCurve()), timing);
	const expectedModes = [
		'constant-forward', 'constant-forward', 'ramp-forward', 'ramp-forward',
		'freeze', 'freeze', 'ramp-reverse', 'ramp-reverse',
		'constant-reverse', 'constant-reverse',
	];
	const expectedSource = [
		exact(10n), exact(11n), exact(12n), exact(25n, 2n), exact(14n),
		exact(14n), exact(14n), exact(27n, 2n), exact(12n), exact(11n),
	];
	const expectedDrawable = [10, 11, 12, 12, 14, 14, 13, 13, 11, 10];

	assert.equal(dispatcher.outerFrameCount, 10);
	for (let outerCell = 0; outerCell < dispatcher.outerFrameCount; outerCell += 1) {
		const descriptor = dispatcher.dispatchOuterCell(outerCell);
		assert.equal(descriptor.outerCell, outerCell);
		assert.equal(descriptor.mode, expectedModes[outerCell]);
		assert.deepEqual(descriptor.sourceFrame, expectedSource[outerCell]);
		assert.equal(descriptor.drawableSourceFrame, expectedDrawable[outerCell]);
		assertDeepFrozen(descriptor);
	}
	const rampInterior = dispatcher.dispatchOuterCell(3);
	assert.equal(rampInterior.segmentIndex, 1);
	assert.deepEqual(rampInterior.sourceTime, exact(25n, 48n));
	assert.deepEqual(rampInterior.drawableSourceStartTime, exact(1n, 2n));
	assert.deepEqual(rampInterior.drawableSourceEndTime, exact(13n, 24n));
	assert.deepEqual(dispatcher.terminal, {
		outerBoundary: 10,
		sourceFrame: exact(10n),
		sourceTime: exact(5n, 12n),
	});
	assertDeepFrozen(dispatcher);
	assert.strictEqual(dispatcher.dispatchOuterCell(3), rampInterior, 'the last cell descriptor must be cached');
});

test('gives breakpoints to the following segment and handles both direction changes exactly', () => {
	const timing = bindVfrTiming('vfr-source', [0n, 10n, 30n, 60n, 100n, 150n], 70n, 10);
	const freezeTurn = createVideoRetimeFrameDispatcher(videoClip({
		feature: 'video-retime',
		version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 1, den: 1 } },
			{ outerFrame: 1, sourceFrame: { num: 4, den: 1 } },
			{ outerFrame: 2, sourceFrame: { num: 4, den: 1 } },
			{ outerFrame: 4, sourceFrame: { num: 1, den: 1 } },
		],
		segments: [
			{ mode: 'constant-forward' },
			{ mode: 'freeze' },
			{ mode: 'constant-reverse' },
		],
	}, {
		sourceId: 'vfr-source', sequenceFrameCount: 4, sourceInFrame: 1, sourceFrameCount: 3,
	}), timing);

	const frozenAtOut = freezeTurn.dispatchOuterCell(1);
	assert.equal(frozenAtOut.segmentIndex, 1);
	assert.equal(frozenAtOut.mode, 'freeze');
	assert.deepEqual(frozenAtOut.sourceFrame, exact(4n));
	assert.deepEqual(frozenAtOut.sourceTime, exact(10n));
	assert.equal(frozenAtOut.drawableSourceFrame, 3, 'freeze clamps to the trimmed clip, not the source');
	assert.deepEqual(frozenAtOut.drawableSourceStartTime, exact(6n));
	assert.deepEqual(frozenAtOut.drawableSourceEndTime, exact(10n));
	const reverseAtOut = freezeTurn.dispatchOuterCell(2);
	assert.equal(reverseAtOut.mode, 'constant-reverse');
	assert.equal(reverseAtOut.drawableSourceFrame, 3, 'reverse owns the frame before an integer boundary');

	const forwardReverse = createVideoRetimeFrameDispatcher(videoClip(turnCurve('forward-reverse'), {
		sourceId: 'vfr-source', sequenceFrameCount: 4, sourceInFrame: 1, sourceFrameCount: 2,
	}), timing).dispatchOuterCell(2);
	assert.equal(forwardReverse.mode, 'ramp-reverse');
	assert.deepEqual(forwardReverse.sourceFrame, exact(3n));
	assert.equal(forwardReverse.drawableSourceFrame, 2);

	const reverseForward = createVideoRetimeFrameDispatcher(videoClip(turnCurve('reverse-forward'), {
		sourceId: 'vfr-source', sequenceFrameCount: 4, sourceInFrame: 1, sourceFrameCount: 2,
	}), timing).dispatchOuterCell(2);
	assert.equal(reverseForward.mode, 'ramp-forward');
	assert.deepEqual(reverseForward.sourceFrame, exact(1n));
	assert.equal(reverseForward.drawableSourceFrame, 1);
});

test('keeps the terminal non-drawable while a final VFR frame retains its unequal duration', () => {
	const timing = bindVfrTiming('full-vfr', [0n, 10n, 30n, 60n, 100n, 150n], 70n, 10);
	const dispatcher = createVideoRetimeFrameDispatcher(videoClip({
		feature: 'video-retime',
		version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 6, den: 1 } },
			{ outerFrame: 1, sourceFrame: { num: 6, den: 1 } },
		],
		segments: [{ mode: 'freeze' }],
	}, {
		sourceId: 'full-vfr', sequenceStartFrame: 9, sequenceFrameCount: 1,
		sourceInFrame: 0, sourceFrameCount: 6,
	}), timing);

	const frame = dispatcher.dispatchOuterCell(0);
	assert.deepEqual(frame.sourceTime, exact(22n));
	assert.equal(frame.drawableSourceFrame, 5);
	assert.deepEqual(frame.drawableSourceStartTime, exact(15n));
	assert.deepEqual(frame.drawableSourceEndTime, exact(22n));
	assert.deepEqual(dispatcher.terminal, {
		outerBoundary: 1, sourceFrame: exact(6n), sourceTime: exact(22n),
	});
	assert.equal(Object.hasOwn(dispatcher.terminal, 'drawableSourceFrame'), false);
	assert.throws(() => dispatcher.dispatchOuterCell(1), /cell|drawable|domain|range/iu);
});

test('snapshots each clip once, reuses one timing token, and retains only bounded state', () => {
	const source = cfrSource('shared-source', Number.MAX_SAFE_INTEGER, { num: 1, den: 1 });
	const timingViews = new CountingTimingMap([[
		'shared-source',
		Object.freeze({ kind: 'cfr', rate: Object.freeze({ num: 1, den: 1 }), frameCount: Number.MAX_SAFE_INTEGER }),
	]]);
	const timing = bindVideoSourceTimingView(timingViews, source);
	const points = trackedArray([
		{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } },
		{ outerFrame: Number.MAX_SAFE_INTEGER, sourceFrame: { num: Number.MAX_SAFE_INTEGER, den: 1 } },
	]);
	const segments = trackedArray([{ mode: 'constant-forward' }]);
	const rawMap: Record<string, unknown> = {
		feature: 'video-retime', version: 2, points: points.proxy, segments: segments.proxy,
	};
	const rawClip = videoClip(rawMap, {
		sourceId: 'shared-source', sequenceStartFrame: 0,
		sequenceFrameCount: Number.MAX_SAFE_INTEGER,
		sourceInFrame: 0, sourceFrameCount: Number.MAX_SAFE_INTEGER,
	});
	const first = createVideoRetimeFrameDispatcher(rawClip, timing);
	const second = createVideoRetimeFrameDispatcher(videoClip(uniformCurve(2), {
		sourceId: 'shared-source', sequenceStartFrame: 4, sequenceFrameCount: 2,
		sourceInFrame: 0, sourceFrameCount: 2,
	}), timing);

	assert.equal(timingViews.getCalls, 1);
	assert.equal(points.ownKeyReads(), 1);
	assert.equal(segments.ownKeyReads(), 1);
	const last = first.dispatchOuterCell(Number.MAX_SAFE_INTEGER - 1);
	assert.equal(last.drawableSourceFrame, Number.MAX_SAFE_INTEGER - 1);
	assert.deepEqual(first.terminal.sourceTime, exact(BigInt(Number.MAX_SAFE_INTEGER)));
	assert.equal(second.dispatchOuterCell(1).drawableSourceFrame, 1);

	points.target[1] = { outerFrame: Number.MAX_SAFE_INTEGER, sourceFrame: { num: 0, den: 1 } };
	segments.target[0] = { mode: 'freeze' };
	rawMap.feature = 'audio-warp';
	rawClip.sourceId = 'changed-source';
	const afterMutation = first.dispatchOuterCell(Number.MAX_SAFE_INTEGER - 2);
	assert.equal(afterMutation.mode, 'constant-forward');
	assert.equal(afterMutation.drawableSourceFrame, Number.MAX_SAFE_INTEGER - 2);
	assert.equal(points.ownKeyReads(), 1);
	assert.equal(segments.ownKeyReads(), 1);
	assert.equal(timingViews.getCalls, 1);
});

test('refuses forged timing, source mismatch, unsafe cells, and clip accessors without invoking them', () => {
	const timing = bindCfrTiming('secure-source', 8, RATE_24);
	assert.throws(
		() => createVideoRetimeFrameDispatcher(videoClip(uniformCurve(2), {
			sourceId: 'other-source', sequenceFrameCount: 2, sourceInFrame: 0, sourceFrameCount: 2,
		}), timing),
		/source|timing|match/iu,
	);
	assert.throws(
		() => createVideoRetimeFrameDispatcher(videoClip(rangeCurve(7, 9, 2), {
			sourceId: 'secure-source', sourceInFrame: 7, sourceFrameCount: 2,
		}), timing),
		/source|timing|frame|bound/iu,
	);
	assert.throws(
		() => createVideoRetimeFrameDispatcher(videoClip(uniformCurve(2), {
			sourceId: 'secure-source', sequenceFrameCount: 2, sourceInFrame: 0, sourceFrameCount: 2,
		}), Object.freeze({ ...timing })),
		/bound|timing|token|authentic/iu,
	);
	let timingReads = 0;
	const forgedTiming = Object.freeze(Object.defineProperties({}, {
		sourceId: { enumerable: true, get: () => { timingReads += 1; return 'secure-source'; } },
		frameCount: { enumerable: true, get: () => { timingReads += 1; return 8; } },
		kind: { enumerable: true, get: () => { timingReads += 1; return 'cfr'; } },
	}));
	assert.throws(
		() => createVideoRetimeFrameDispatcher(videoClip(uniformCurve(2), {
			sourceId: 'secure-source', sequenceFrameCount: 2, sourceInFrame: 0, sourceFrameCount: 2,
		}), forgedTiming as BoundVideoSourceTimingView),
		/bound|timing|token|authentic/iu,
	);
	assert.equal(timingReads, 0);
	let sourceIdReads = 0;
	const accessorClip = videoClip(uniformCurve(2), {
		sequenceFrameCount: 2, sourceInFrame: 0, sourceFrameCount: 2,
	});
	Object.defineProperty(accessorClip, 'sourceId', {
		enumerable: true,
		get() { sourceIdReads += 1; return 'secure-source'; },
	});
	assert.throws(
		() => createVideoRetimeFrameDispatcher(accessorClip, timing),
		/accessor|data property|enumerable|sourceId/iu,
	);
	assert.equal(sourceIdReads, 0);

	const dispatcher = createVideoRetimeFrameDispatcher(videoClip(uniformCurve(2), {
		sourceId: 'secure-source', sequenceFrameCount: 2, sourceInFrame: 0, sourceFrameCount: 2,
	}), timing);
	for (const outerCell of [-1, 2, 0.5, Number.NaN, { numerator: 0n, denominator: 1n }]) {
		assert.throws(
			() => dispatcher.dispatchOuterCell(outerCell as number),
			/cell|integer|drawable|domain|range/iu,
		);
	}
});

test('keeps timing traversal in the timing owner and compilation in the clip mapper', async () => {
	const [dispatchSource, timingSource] = await Promise.all([
		readFile(DISPATCH_SOURCE_URL, 'utf8'),
		readFile(TIMING_SOURCE_URL, 'utf8'),
	]);

	assert.equal(callCount(dispatchSource, 'createVideoRetimeRuntimeMapper'), 1);
	assert.equal(callCount(timingSource, 'videoSourceTimingView'), 2, 'definition plus one binding call');
	assert.equal(callCount(timingSource, 'validateVfrIndex'), 2, 'definition plus the existing binding validation');
	assert.doesNotMatch(dispatchSource, /\b(?:videoSourceTimingView|VideoTimingIndex|presentationTicks|finalFrameDurationTicks|endTicks)\b/u);
	assert.doesNotMatch(timingSource, /from ['"]\.\/video-retime-curve\.ts['"]/u);
	assert.doesNotMatch(exportedFunctionSource(timingSource, 'videoSourceFrameTime'), /\b(?:for|while)\b|\.(?:map|reduce|forEach)\s*\(/u);
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

function turnCurve(direction: 'forward-reverse' | 'reverse-forward') {
	const forwardFirst = direction === 'forward-reverse';
	return {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: forwardFirst ? 1 : 3, den: 1 } },
			{ outerFrame: 2, sourceFrame: { num: forwardFirst ? 3 : 1, den: 1 } },
			{ outerFrame: 4, sourceFrame: { num: forwardFirst ? 1 : 3, den: 1 } },
		],
		segments: forwardFirst ? [
			{ mode: 'ramp-forward', startVelocity: { num: 2, den: 1 }, endVelocity: { num: 0, den: 1 } },
			{ mode: 'ramp-reverse', startVelocity: { num: 0, den: 1 }, endVelocity: { num: 2, den: 1 } },
		] : [
			{ mode: 'ramp-reverse', startVelocity: { num: 2, den: 1 }, endVelocity: { num: 0, den: 1 } },
			{ mode: 'ramp-forward', startVelocity: { num: 0, den: 1 }, endVelocity: { num: 2, den: 1 } },
		],
	};
}

function uniformCurve(frameCount: number) {
	return {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } },
			{ outerFrame: frameCount, sourceFrame: { num: frameCount, den: 1 } },
		],
		segments: [{ mode: 'constant-forward' }],
	};
}

function rangeCurve(sourceStartFrame: number, sourceEndFrame: number, outerFrameCount: number) {
	return {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: sourceStartFrame, den: 1 } },
			{ outerFrame: outerFrameCount, sourceFrame: { num: sourceEndFrame, den: 1 } },
		],
		segments: [{ mode: 'constant-forward' }],
	};
}

function videoClip(retimeMap: unknown, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		id: 'video-clip', kind: 'video', sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame: 101, sequenceFrameCount: 10,
		sourceInFrame: 8, sourceFrameCount: 8, retimeMap,
		...overrides,
	};
}

function bindCfrTiming(
	sourceId: string,
	frameCount: number,
	rate: Readonly<{ num: number; den: number }>,
): BoundVideoSourceTimingView {
	return bindVideoSourceTimingView(new Map([[
		sourceId, Object.freeze({ kind: 'cfr', rate, frameCount }),
	]]), cfrSource(sourceId, frameCount, rate));
}

function cfrSource(
	id: string,
	sourceFrameCount: number,
	rate: Readonly<{ num: number; den: number }>,
): Record<string, unknown> {
	return {
		id, kind: 'video', contentSha256: SOURCE_SHA256, frameRate: rate, sourceFrameCount,
		timingAsset: null, timingDecision: { mode: 'conform-cfr-at-ingest', rate },
	};
}

function bindVfrTiming(
	sourceId: string,
	presentationTicks: readonly bigint[],
	finalFrameDurationTicks: bigint,
	timescale: number,
): BoundVideoSourceTimingView {
	const publication = createVideoTimingAssetPublication(SOURCE_SHA256, {
		timescale, presentationTicks, finalFrameDurationTicks,
	});
	const index = validateVideoTimingAssetBytes(publication.reference, publication.bytes);
	const rate = Object.freeze({ num: 24, den: 1 });
	const source = {
		id: sourceId, kind: 'video', contentSha256: SOURCE_SHA256,
		frameRate: rate, sourceFrameCount: presentationTicks.length,
		timingAsset: publication.reference,
		timingDecision: { mode: 'exact', rate, backend: 'demuxer' },
	};
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'vfr', reference: publication.reference, index,
	});
	return bindVideoSourceTimingView(new Map([[sourceId, view]]), source);
}

class CountingTimingMap extends Map<string, VideoSourceTimingView> {
	getCalls = 0;

	override get(key: string): VideoSourceTimingView | undefined {
		this.getCalls += 1;
		return super.get(key);
	}
}

function trackedArray<Value>(target: Value[]) {
	let ownKeyReads = 0;
	return {
		target,
		proxy: new Proxy(target, {
			ownKeys(value) { ownKeyReads += 1; return Reflect.ownKeys(value); },
		}),
		ownKeyReads: () => ownKeyReads,
	};
}

function exact(numerator: bigint, denominator = 1n) {
	return Object.freeze({ numerator, denominator });
}

function callCount(source: string, name: string): number {
	return [...source.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'gu'))].length;
}

function exportedFunctionSource(source: string, name: string): string {
	const start = source.indexOf(`export function ${name}`);
	if (start < 0) throw new Error(`Missing exported function ${name}.`);
	const bodyStart = source.indexOf('{', start);
	let depth = 0;
	for (let index = bodyStart; index < source.length; index += 1) {
		if (source[index] === '{') depth += 1;
		if (source[index] === '}') depth -= 1;
		if (depth === 0) return source.slice(start, index + 1);
	}
	throw new Error(`Unclosed exported function ${name}.`);
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
	if (value === null || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	assert.equal(Object.isFrozen(value), true);
	for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}
