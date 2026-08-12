/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

import {
	createVideoRetimeExportIntentV6,
	type DecimalExactRationalV6,
	type VideoRetimeExportIntentInputV6,
	type VideoRetimeExportIntentV6,
	type VideoRetimeExportIntersectionBaseV6,
	type VideoRetimeExportIntersectionV6,
} from '../../src/common/editor/video-retime-export-plan.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../../src/common/editor/video-source-timing-view.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../../src/common/editor/video-timing-asset.ts';

export const SOURCE_SHA256 = 'a7'.repeat(32);
export const RATE_1 = Object.freeze({ num: 1, den: 1 });
export const RATE_24 = Object.freeze({ num: 24, den: 1 });
export const NTSC = Object.freeze({ num: 30_000, den: 1_001 });

export function baseInput(
	overrides: Partial<VideoRetimeExportIntentInputV6> = {},
): VideoRetimeExportIntentInputV6 {
	return {
		sampleStart: 0,
		sampleDuration: 1,
		sampleRate: 1,
		sequenceBinding: { id: 'sequence-1', rate: RATE_1 },
		topology: [{ startSample: 0, endSample: 1, layers: [] }],
		canonicalClips: [],
		...overrides,
	};
}

export function topology(startSample: number, endSample: number, clipId: string) {
	return [{ startSample, endSample, layers: [{ clips: [{ clipId }] }] }];
}

export function blackTopology(count: number) {
	return Array.from({ length: count }, (_, startSample) => ({
		startSample,
		endSample: startSample + 1,
		layers: [],
	}));
}

export function videoClip(
	id: string,
	sourceId: string,
	retimeMap: unknown,
	overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		kind: 'video', id, sourceId, sequenceId: 'sequence-1',
		sequenceStartFrame: 0, sequenceFrameCount: 1,
		sourceInFrame: 0, sourceFrameCount: 1, retimeMap,
		...overrides,
	};
}

export function fiveModeCurve() {
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

export function linearCurve(segmentCount: number) {
	return {
		feature: 'video-retime',
		version: 2,
		points: Array.from({ length: segmentCount + 1 }, (_, outerFrame) => ({
			outerFrame,
			sourceFrame: { num: outerFrame, den: 1 },
		})),
		segments: Array.from({ length: segmentCount }, () => ({ mode: 'constant-forward' as const })),
	};
}

type CurveMode = 'constant-forward' | 'ramp-forward' | 'freeze' | 'ramp-reverse' | 'constant-reverse';

export function curveRow(
	index: number,
	mode: CurveMode,
	sourceStart: number,
	sourceEnd: number,
	drawableStart: number,
	drawableEnd: number,
	velocities?: readonly [number, number],
): VideoRetimeExportIntersectionV6 {
	const start = index * 2;
	const end = start + 2;
	const base: VideoRetimeExportIntersectionBaseV6 = {
		index,
		topologyIntervalIndex: 0,
		layerIndex: 0,
		clipIndex: 0,
		clipId: 'curve-clip',
		sourceId: 'curve-source',
		sequenceStartFrame: 0,
		outerFrameCount: 10,
		sourceInFrame: 10,
		sourceOutFrame: 15,
		startSample: start,
		endSample: end,
		startOutputFrame: start,
		endOutputFrame: end,
	};
	return {
		...base,
		mapping: 'curve',
		segmentIndex: index,
		mode,
		segmentStartOuterCell: start,
		segmentEndOuterCell: end,
		sourceStart: decimal(sourceStart),
		sourceEnd: decimal(sourceEnd),
		...(velocities === undefined ? {} : {
			startVelocity: decimal(velocities[0]),
			endVelocity: decimal(velocities[1]),
		}),
		startOuterCell: start,
		endOuterCell: end,
		clippedSourceStart: decimal(sourceStart),
		clippedSourceEnd: decimal(sourceEnd),
		drawableStartTime: decimal(drawableStart),
		drawableEndTime: decimal(drawableEnd),
	} as VideoRetimeExportIntersectionV6;
}

export function createFiveModeIntent(): VideoRetimeExportIntentV6 {
	return createVideoRetimeExportIntentV6(baseInput({
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
	}), new Map([['curve-source', bindCfrTiming('curve-source', 20, RATE_1)]]));
}

export function bindCfrTiming(
	sourceId: string,
	frameCount: number,
	rate: Readonly<{ num: number; den: number }>,
): BoundVideoSourceTimingView {
	return bindVideoSourceTimingView(new Map<string, VideoSourceTimingView>([[
		sourceId,
		Object.freeze({ kind: 'cfr', rate, frameCount }),
	]]), {
		id: sourceId,
		kind: 'video',
		contentSha256: SOURCE_SHA256,
		frameRate: rate,
		sourceFrameCount: frameCount,
		timingAsset: null,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate },
	});
}

export function bindVfrTiming(
	sourceId: string,
	presentationTicks: readonly bigint[],
	finalFrameDurationTicks: bigint,
	timescale: number,
): BoundVideoSourceTimingView {
	const publication = createVideoTimingAssetPublication(SOURCE_SHA256, {
		timescale,
		presentationTicks,
		finalFrameDurationTicks,
	});
	const index = validateVideoTimingAssetBytes(publication.reference, publication.bytes);
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'vfr', reference: publication.reference, index,
	});
	return bindVideoSourceTimingView(new Map([[sourceId, view]]), {
		id: sourceId,
		kind: 'video',
		contentSha256: SOURCE_SHA256,
		frameRate: NTSC,
		sourceFrameCount: presentationTicks.length,
		timingAsset: publication.reference,
		timingDecision: { mode: 'exact', rate: NTSC, backend: 'demuxer' },
	});
}

export function decimal(numerator: number, denominator = 1): DecimalExactRationalV6 {
	return { numerator: String(numerator), denominator: String(denominator) };
}

export function decimalByteCount(value: unknown): number {
	if (value === null || typeof value !== 'object') return 0;
	const record = value as Record<string, unknown>;
	if (typeof record.numerator === 'string' && typeof record.denominator === 'string') {
		return Buffer.byteLength(JSON.stringify(record.numerator), 'utf8')
			+ Buffer.byteLength(JSON.stringify(record.denominator), 'utf8');
	}
	let total = 0;
	for (const nested of Object.values(record)) total += decimalByteCount(nested);
	return total;
}

export function rejectGet<Value extends object>(target: Value, tracker: { gets: number }): Value {
	return new Proxy(target, {
		get() {
			tracker.gets += 1;
			throw new Error('A descriptor snapshot must not invoke Proxy get.');
		},
	});
}

export function required<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new RangeError('Expected a value.');
	return value;
}

export function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
	if (value === null || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	assert.equal(Object.isFrozen(value), true);
	for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}
