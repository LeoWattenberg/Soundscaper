/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pure deterministic transforms for video sampling, indexing, tracking, and crop planning. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { reviewAssistanceEmbeddingMatrixV1 } from './binary-formats-v1.ts';
import {
	ownedArray,
	ownedExactRecord,
	ownedText,
} from './owned-transform-validation-v1.ts';
import type {
	AssistanceOwnedFramePackPlanV1,
	AssistanceOwnedReframePathV1,
	AssistanceOwnedVideoIndexV1,
} from './owned-video-highlight-transform-types-v1.ts';
import {
	reviewOwnedFramePackPlanV1,
	reviewOwnedTrackedSubjectsV1,
	reviewOwnedVideoSourceTimeAuthorityV1,
} from './owned-video-highlight-validation-v1.ts';
import { planAssistanceReframePathV1 } from './reframe-planner-v1.ts';
import { reviewAssistanceShotBoundariesV1 } from './shot-boundaries-v1.ts';
import { trackAssistanceSubjectsV1 } from './subject-tracker-v1.ts';
import {
	reviewAssistanceOcrResultV1,
	reviewAssistanceReframePathResultV1,
	reviewAssistanceSaliencyResultV1,
	reviewAssistanceSubjectResultV1,
	type AssistanceVisualFrameAuthorityV1,
} from './visual-semantic-results-v1.ts';
import { sampleAssistanceShotsV1 } from './visual-indexing-v1.ts';
import {
	createAssistanceVisualSearchRowsV1,
	reviewAssistanceVisualSearchRecordsV1,
	type AssistanceNonBiometricVisualTagV1,
	type AssistanceVisualSearchSampleAuthorityV1,
} from './visual-search-records-v1.ts';
import type { AssistanceWorkflowSettingsV1 } from './workflow-settings-v1.ts';

type Settings<Id extends AssistanceWorkflowSettingsV1['workflowId']> =
	Extract<AssistanceWorkflowSettingsV1, { readonly workflowId: Id }>;

const SAMPLE_INPUT_FIELDS = Object.freeze(['video', 'shot-boundaries'] as const);
const PUBLISH_INPUT_FIELDS = Object.freeze(['visual-embeddings', 'recognized-text'] as const);
const EMBEDDING_SOURCE_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'framePack', 'matrix', 'tags',
] as const);
const TAG_SOURCE_FIELDS = Object.freeze(['resultId', 'tags'] as const);
const TRACK_INPUT_FIELDS = Object.freeze(['subject-tracks'] as const);
const SUBJECT_SOURCE_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'authority', 'shotAnchorFrames', 'result',
] as const);
const PLAN_INPUT_FIELDS = Object.freeze(['tracked-subjects', 'saliency-map'] as const);

export function sampleOwnedShotFramesV1(
	inputsValue: unknown,
	settings: Settings<'index-video'>,
): AssistanceOwnedFramePackPlanV1 {
	const inputs = ownedExactRecord(inputsValue, SAMPLE_INPUT_FIELDS, 'sample-shot-frames inputs');
	const video = reviewOwnedVideoSourceTimeAuthorityV1(inputs.video);
	const shots = reviewAssistanceShotBoundariesV1(inputs['shot-boundaries']);
	const expectedDetector = settings.shotMode === 'fast' ? 'ffmpeg-scdet' : 'transnetv2';
	if (shots.detector !== expectedDetector) {
		throw new TypeError('Shot sampling refuses substitution for the authenticated detector mode.');
	}
	if (shots.timescale !== video.timescale || shots.sourceFrameCount < video.sourceEndFrame) {
		throw new RangeError('Shot sampling disagrees with its exact video source-time authority.');
	}
	const boundaries = shots.boundaries.filter(({ sourceFrame }) => (
		sourceFrame > video.sourceStartFrame && sourceFrame < video.sourceEndFrame
	));
	for (const boundary of boundaries) {
		const exact = frameBySource(video.frames, boundary.sourceFrame);
		if (exact?.presentationTick !== boundary.presentationTick) {
			throw new RangeError('A shot boundary disagrees with its exact video source-time authority.');
		}
	}
	const starts = [Object.freeze({ sourceFrame: video.sourceStartFrame,
		presentationTick: video.frames.first.presentationTick }), ...boundaries];
	const result: AssistanceOwnedFramePackPlanV1['frames'][number][] = [];
	for (const [shotIndex, start] of starts.entries()) {
		const end = starts[shotIndex + 1];
		const startTick = BigInt(start.presentationTick);
		const endTick = shotIndex + 1 < starts.length
			? BigInt(end!.presentationTick)
			: BigInt(video.presentationEndTick);
		const duration = endTick - startTick;
		if (duration < 1n || duration > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new RangeError('A shot duration exceeds deterministic sampling geometry.');
		}
		const shotId = `shot:${String(shotIndex).padStart(6, '0')}`;
		const anchors = sampleAssistanceShotsV1([
			{ shotId, startFrame: 0, endFrame: Number(duration) },
		], video.timescale);
		for (const anchor of anchors) {
			const targetTick = startTick + BigInt(anchor.sourceFrame);
			const source = firstFrameAtOrAfter(video.frames,
				firstFrameIndexAtOrAfter(video.frames, start.sourceFrame),
				end ? firstFrameIndexAtOrAfter(video.frames, end.sourceFrame) : video.frames.rowCount,
				targetTick);
			if (result.at(-1)?.sourceFrame === source.sourceFrame) continue;
			result.push(Object.freeze({ resultId: `visual-sample:${String(result.length)}`,
				shotId, anchor: anchor.anchor, sourceFrame: source.sourceFrame,
				presentationTick: source.presentationTick, timelineFrame: source.timelineFrame }));
		}
	}
	return reviewOwnedFramePackPlanV1({ schemaVersion: 1, kind: 'frame-pack-plan',
		sourceId: video.sourceId, width: video.width, height: video.height,
		timescale: video.timescale, frames: result });
}

function frameBySource(
	frames: ReturnType<typeof reviewOwnedVideoSourceTimeAuthorityV1>['frames'],
	sourceFrame: number,
) {
	const index = firstFrameIndexAtOrAfter(frames, sourceFrame);
	return index < frames.rowCount && frames.row(index).sourceFrame === sourceFrame
		? frames.row(index) : null;
}

function firstFrameIndexAtOrAfter(
	frames: ReturnType<typeof reviewOwnedVideoSourceTimeAuthorityV1>['frames'],
	sourceFrame: number,
): number {
	return frames.firstAtOrAfterSource(sourceFrame);
}

export function publishOwnedVideoIndexV1(
	inputsValue: unknown,
	settings: Settings<'index-video'>,
): AssistanceOwnedVideoIndexV1 {
	const inputs = ownedExactRecord(inputsValue, PUBLISH_INPUT_FIELDS, 'publish-video-index inputs');
	const source = ownedExactRecord(inputs['visual-embeddings'], EMBEDDING_SOURCE_FIELDS,
		'visual embedding source');
	if (source.schemaVersion !== 1 || source.kind !== 'visual-embeddings') {
		throw new TypeError('The visual embedding source identity is unsupported.');
	}
	const framePack = reviewOwnedFramePackPlanV1(source.framePack);
	if (!(source.matrix instanceof ArrayBuffer) && !ArrayBuffer.isView(source.matrix)) {
		throw new TypeError('The visual embedding source requires a strict binary matrix body.');
	}
	const matrixValue = source.matrix as ArrayBuffer | ArrayBufferView;
	const matrix = reviewAssistanceEmbeddingMatrixV1(matrixValue);
	if (matrix.rowCount !== framePack.frames.length) {
		throw new RangeError('Visual embedding rows disagree with the exact sampled-frame inventory.');
	}
	const authority = sampleAuthority(framePack);
	const tags = ownedArray(source.tags, framePack.frames.length, 'visual embedding tags',
		framePack.frames.length).map((candidate, index) => {
		const row = ownedExactRecord(candidate, TAG_SOURCE_FIELDS, `visual tag row ${String(index)}`);
		if (row.resultId !== authority[index]!.resultId) {
			throw new RangeError('Visual tag rows disagree with sampled-frame authority.');
		}
		return row.tags as readonly Readonly<{ tag: AssistanceNonBiometricVisualTagV1; score: number }>[];
	});
	if (settings.includeOcr !== (inputs['recognized-text'] !== null)) {
		throw new TypeError('Video-index OCR input disagrees with the authenticated OCR choice.');
	}
	const visual = authority.map((sample, embeddingRow) => ({
		recordVersion: 1 as const, ...sample, embeddingRow, tags: tags[embeddingRow],
	}));
	const ocr = inputs['recognized-text'] === null ? [] : ocrRecords(
		inputs['recognized-text'], framePack, authority,
	);
	const records = reviewAssistanceVisualSearchRecordsV1({
		schemaVersion: 1, tagTaxonomyVersion: 1, visual, ocr,
	}, authority);
	const bytes = binaryBytes(matrixValue);
	const result = Object.freeze({
		schemaVersion: 1 as const,
		kind: 'video-index' as const,
		sourceId: framePack.sourceId,
		timescale: framePack.timescale,
		sampleAuthority: authority,
		embedding: Object.freeze({ schemaVersion: 1 as const, byteLength: bytes.byteLength,
			sha256: bytesToHex(sha256(bytes)), rowCount: matrix.rowCount,
			dimensions: matrix.dimensions }),
		records,
		rows: createAssistanceVisualSearchRowsV1(records, authority),
	});
	return result;
}

export function trackOwnedSubjectsV1(
	inputsValue: unknown,
	_settings: Settings<'reframe'>,
) {
	const inputs = ownedExactRecord(inputsValue, TRACK_INPUT_FIELDS, 'track-subjects inputs');
	const source = ownedExactRecord(inputs['subject-tracks'], SUBJECT_SOURCE_FIELDS,
		'subject-detection source');
	if (source.schemaVersion !== 1 || source.kind !== 'subject-detections') {
		throw new TypeError('The subject-detection source identity is unsupported.');
	}
	const result = reviewAssistanceSubjectResultV1(source.result, source.authority);
	return reviewOwnedTrackedSubjectsV1(trackAssistanceSubjectsV1({ schemaVersion: 1,
		width: result.width, height: result.height, timescale: result.timescale,
		shotAnchorFrames: source.shotAnchorFrames, frames: result.frames }));
}

export function planOwnedCropsV1(
	inputsValue: unknown,
	settings: Settings<'reframe'>,
): AssistanceOwnedReframePathV1 {
	const inputs = ownedExactRecord(inputsValue, PLAN_INPUT_FIELDS, 'plan-crops inputs');
	const tracked = reviewOwnedTrackedSubjectsV1(inputs['tracked-subjects']);
	const authority: AssistanceVisualFrameAuthorityV1 = Object.freeze({
		width: tracked.width, height: tracked.height, timescale: tracked.timescale,
		frames: Object.freeze(tracked.frames.map(({ sourceFrame, presentationTick }) =>
			Object.freeze({ sourceFrame, presentationTick }))),
	});
	const saliency = reviewAssistanceSaliencyResultV1(inputs['saliency-map'], authority);
	const targetAspect = Object.freeze({ width: settings.targetAspectWidth,
		height: settings.targetAspectHeight });
	const planned = planAssistanceReframePathV1({
		sourceSize: { width: tracked.width, height: tracked.height }, targetAspect,
		samples: tracked.frames.map((frame, index) => ({ sourceFrame: frame.sourceFrame,
			subjects: frame.subjects, saliency: saliency.frames[index]!.saliency })),
	});
	const path = reviewAssistanceReframePathResultV1({ schemaVersion: 1, targetAspect,
		keyframes: planned.map(({ sourceFrame, authority: cropAuthority, trackIds, crop }) => ({
			sourceFrame, authority: cropAuthority, trackIds, crop,
		})) }, authority);
	return Object.freeze({ schemaVersion: 1, kind: 'reframe-path', authority,
		fallbackChain: Object.freeze(['subject', 'saliency', 'center'] as const), path });
}

function firstFrameAtOrAfter(
	frames: ReturnType<typeof reviewOwnedVideoSourceTimeAuthorityV1>['frames'],
	start: number,
	end: number,
	target: bigint,
) {
	const found = frames.firstAtOrAfterPresentationTick(target.toString());
	return frames.row(Math.max(start, Math.min(end - 1, found)));
}

function sampleAuthority(framePack: AssistanceOwnedFramePackPlanV1):
	readonly AssistanceVisualSearchSampleAuthorityV1[] {
	return Object.freeze(framePack.frames.map(({ resultId, shotId, anchor, sourceFrame,
		timelineFrame }) => Object.freeze({ resultId, shotId, anchor, sourceFrame, timelineFrame })));
}

function ocrRecords(
	value: unknown,
	framePack: AssistanceOwnedFramePackPlanV1,
	authority: readonly AssistanceVisualSearchSampleAuthorityV1[],
) {
	const visualAuthority = { width: framePack.width, height: framePack.height,
		timescale: framePack.timescale, frames: framePack.frames.map(({ sourceFrame,
			presentationTick }) => ({ sourceFrame, presentationTick })) };
	const result = reviewAssistanceOcrResultV1(value, visualAuthority);
	return result.frames.flatMap((frame, index) => {
		if (frame.regions.length === 0) return [];
		const text = ownedText(frame.regions.map((region) => region.text).join(' '), 4_096,
			`OCR search row ${String(index)} text`);
		return [{ recordVersion: 1 as const, ...authority[index]!, text,
			confidence: Math.max(...frame.regions.map(({ confidence }) => confidence)) }];
	});
}

function binaryBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
