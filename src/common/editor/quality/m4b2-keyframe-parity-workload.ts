/* SPDX-License-Identifier: AGPL-3.0-only */

import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../video-clip-composition.ts';

export const M4B2_KEYFRAME_PARITY_WORKLOAD_ID = 'm4b2-keyframe-render-parity';
export const M4B2_KEYFRAME_PARITY_FIXTURE_ID = 'm4b2-keyframe-parity-rgba-v1';
export const M4B2_KEYFRAME_PARITY_PROFILE = 'deterministic-keyframe-parity-v1';
export const M4B2_KEYFRAME_PARITY_OBSERVATION_CLASS =
	'complete-keyed-rgba-consumer-ledger-v1';

/** Local admission thresholds only; they are not accepted reference qualification. */
export const M4B2_KEYFRAME_PARITY_LOCAL_ADMISSION_MINIMUM_SSIM = 0.98;
export const M4B2_KEYFRAME_PARITY_LOCAL_ADMISSION_MAXIMUM_CHANNEL_MAE = 6 / 255;

const WIDTH = 128;
const HEIGHT = 72;
const SAMPLE_RATE = 48_000;
const FRAME_RATE = Object.freeze({ num: 12, den: 1 });
const FRAME_COUNT = 12;
const SOURCE_SEED = 1_801_382_864;
const SOURCE_SHA256 = 'db9fa74f23eb1b5f9565cd10f10794a975492b629731534b56d0af3072b3ad8a';

export type M4B2KeyframeParityCurveKind = 'hold' | 'linear' | 'eased' | 'bezier';
export type M4B2KeyframeParityQueryId = 'start' | 'interior' | 'end';

export interface M4B2KeyframeParityQuery {
	readonly id: M4B2KeyframeParityQueryId;
	readonly frameIndex: number;
	readonly position: Readonly<{ readonly num: number; readonly den: number }>;
	readonly expectedValue: number;
	readonly expectedPresentation: Readonly<{
		readonly drawableSourceFrame: number;
		readonly sourceFrame: string;
		readonly sourceTime: string;
	}>;
}

export interface M4B2KeyframeParityCase {
	readonly id: string;
	readonly curveKind: M4B2KeyframeParityCurveKind;
	readonly targetId: 'composition.opacity';
	readonly evidenceClipId: string;
	readonly presentationClass:
		| 'authenticated-cfr-occurrence'
		| 'authenticated-vfr-materialized-occurrence';
	readonly curve: Readonly<Record<string, unknown>>;
	readonly queries: readonly M4B2KeyframeParityQuery[];
}

const QUERY_POSITIONS = Object.freeze([
	Object.freeze({ id: 'start' as const, frameIndex: 2, position: Object.freeze({ num: 2, den: 1 }) }),
	Object.freeze({ id: 'interior' as const, frameIndex: 6, position: Object.freeze({ num: 6, den: 1 }) }),
	Object.freeze({ id: 'end' as const, frameIndex: 10, position: Object.freeze({ num: 10, den: 1 }) }),
]);
const CFR_PRESENTATIONS = Object.freeze([
	Object.freeze({ drawableSourceFrame: 2, sourceFrame: '2/1', sourceTime: '1/6' }),
	Object.freeze({ drawableSourceFrame: 6, sourceFrame: '6/1', sourceTime: '1/2' }),
	Object.freeze({ drawableSourceFrame: 10, sourceFrame: '10/1', sourceTime: '5/6' }),
]);
const VFR_PRESENTATIONS = Object.freeze([
	Object.freeze({ drawableSourceFrame: 3, sourceFrame: '3/1', sourceTime: '1/6' }),
	Object.freeze({ drawableSourceFrame: 6, sourceFrame: '47/7', sourceTime: '1/2' }),
	Object.freeze({ drawableSourceFrame: 9, sourceFrame: '29/3', sourceTime: '5/6' }),
]);

const CASES: readonly M4B2KeyframeParityCase[] = Object.freeze([
	parityCase('opacity-hold', 'hold', 0.2, 0.8, [0.2, 0.2, 0.8]),
	parityCase('opacity-linear', 'linear', 0.1, 0.9, [0.1, 0.5, 0.9]),
	parityCase('opacity-eased', 'eased', 0.15, 0.85, [0.15, 0.5, 0.85]),
	parityCase(
		'opacity-bezier', 'bezier', 0.1, 0.95, [0.1, 0.50625, 0.95],
		'framescaper-flat-clip-4f2ad5b3a72f098f3878c158c7025f70',
	),
]);

export const M4B2_KEYFRAME_PARITY_SPECIFICATION = Object.freeze({
	generatorRevision: 3 as const,
	seed: SOURCE_SEED,
	width: WIDTH,
	height: HEIGHT,
	sampleRate: SAMPLE_RATE,
	frameRate: FRAME_RATE,
	frameCount: FRAME_COUNT,
	sourceByteLength: WIDTH * HEIGHT * 4 * FRAME_COUNT,
	sourceSha256: SOURCE_SHA256,
	caseIds: Object.freeze(CASES.map(({ id }) => id)),
	queryIds: Object.freeze(QUERY_POSITIONS.map(({ id }) => id)),
	evidenceClipIds: Object.freeze(CASES.map(({ evidenceClipId }) => evidenceClipId)),
	presentationClasses: Object.freeze(CASES.map(({ presentationClass }) => presentationClass)),
});

/** Return the frozen curve/query inventory used by both browser consumers and the collector. */
export function m4b2KeyframeParityCases(): readonly M4B2KeyframeParityCase[] {
	return CASES;
}

/** Generate 12 asymmetric, opaque, frame-distinct RGBA source frames without browser APIs. */
export function createM4B2KeyframeParitySourceRgba(): Uint8Array {
	const frameByteLength = WIDTH * HEIGHT * 4;
	const bytes = new Uint8Array(frameByteLength * FRAME_COUNT);
	let state = SOURCE_SEED >>> 0;
	for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
		for (let y = 0; y < HEIGHT; y += 1) {
			for (let x = 0; x < WIDTH; x += 1) {
				state ^= state << 13;
				state ^= state >>> 17;
				state ^= state << 5;
				const offset = frame * frameByteLength + (y * WIDTH + x) * 4;
				bytes[offset] = ((state >>> 24) + x * 3 + y * 5 + frame * 17) & 0xff;
				bytes[offset + 1] = ((state >>> 16) + x * 7 + y * 2 + frame * 29) & 0xff;
				bytes[offset + 2] = ((state >>> 8) + x + y * 11 + frame * 43) & 0xff;
				bytes[offset + 3] = 255;
			}
		}
	}
	return bytes;
}

/** Build a bounded raw project consumed by the real preview and export projections. */
export function createM4B2KeyframeParityProject(caseId: string): Record<string, unknown> {
	const definition = parityDefinition(caseId);
	const sourceId = `m4b2-${definition.id}-source`;
	const clipId = `m4b2-${definition.id}-clip`;
	const trackId = `m4b2-${definition.id}-track`;
	return {
		schemaVersion: 9,
		sampleRate: SAMPLE_RATE,
		primarySequenceId: 'm4b2-sequence',
		sequences: [{
			id: 'm4b2-sequence', type: 'video', rate: { ...FRAME_RATE }, trackIds: [trackId],
		}],
		sources: [{
			id: sourceId, kind: 'video', sampleRate: SAMPLE_RATE,
			frameRate: { ...FRAME_RATE }, sourceFrameCount: FRAME_COUNT,
			width: WIDTH, height: HEIGHT, contentSha256: SOURCE_SHA256,
			timingAsset: null,
			timingDecision: { mode: 'conform-cfr-at-ingest', rate: { ...FRAME_RATE } },
		}],
		clips: [{
			id: clipId, kind: 'video', sourceId, sequenceId: 'm4b2-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: FRAME_COUNT,
			sourceInFrame: 0, sourceFrameCount: FRAME_COUNT, retimeMap: null,
			videoComposition: structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
			videoEffects: [],
			videoKeyframes: {
				schemaVersion: 1,
				timeDomain: {
					authoredDuration: { num: FRAME_COUNT, den: 1 },
					viewStart: { num: 0, den: 1 },
					viewDuration: { num: FRAME_COUNT, den: 1 },
				},
				curves: [{
					target: { kind: 'composition', parameterId: 'opacity' },
					curve: structuredClone(definition.curve),
				}],
			},
		}],
		tracks: [{ id: trackId, type: 'video', clipIds: [clipId] }],
		projectBin: { clips: [] },
	};
}

export function m4b2KeyframeParityOperationId(
	caseId: string,
	queryId: string,
): string {
	const definition = parityDefinition(caseId);
	if (!definition.queries.some(({ id }) => id === queryId)) {
		throw new RangeError(`Unknown M4B2 keyframe parity query ${queryId}.`);
	}
	return `${definition.id}/${queryId}/${definition.targetId}`;
}

export function m4b2KeyframeParityOperationIds(): readonly string[] {
	return Object.freeze(CASES.flatMap(({ id, queries }) => (
		queries.map(({ id: queryId }) => m4b2KeyframeParityOperationId(id, queryId))
	)));
}

function parityCase(
	id: string,
	kind: M4B2KeyframeParityCurveKind,
	startValue: number,
	endValue: number,
	expectedValues: readonly [number, number, number],
	evidenceClipId = `m4b2-${id}-clip`,
	presentationClass: M4B2KeyframeParityCase['presentationClass'] =
		'authenticated-cfr-occurrence',
): M4B2KeyframeParityCase {
	const anchors = Object.freeze([
		Object.freeze({ position: Object.freeze({ num: 2, den: 1 }), value: startValue }),
		Object.freeze({ position: Object.freeze({ num: 10, den: 1 }), value: endValue }),
	]);
	const segment = kind === 'bezier'
		? Object.freeze({
			kind,
			control1: Object.freeze({ position: Object.freeze({ num: 4, den: 1 }), value: 0.8 }),
			control2: Object.freeze({ position: Object.freeze({ num: 8, den: 1 }), value: 0.2 }),
		})
		: Object.freeze({ kind });
	const presentations = kind === 'bezier' ? VFR_PRESENTATIONS : CFR_PRESENTATIONS;
	return Object.freeze({
		id,
		curveKind: kind,
		targetId: 'composition.opacity' as const,
		evidenceClipId,
		presentationClass: kind === 'bezier'
			? 'authenticated-vfr-materialized-occurrence'
			: presentationClass,
		curve: Object.freeze({ anchors, segments: Object.freeze([segment]) }),
		queries: Object.freeze(QUERY_POSITIONS.map((query, index) => Object.freeze({
			...query,
			expectedValue: expectedValues[index]!,
			expectedPresentation: presentations[index]!,
		}))),
	});
}

function parityDefinition(caseId: string): M4B2KeyframeParityCase {
	const definition = CASES.find(({ id }) => id === caseId);
	if (!definition) throw new RangeError(`Unknown M4B2 keyframe parity case ${caseId}.`);
	return definition;
}
