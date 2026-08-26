/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAssistanceEmbeddingMatrixV1 } from
	'../src/common/editor/assistance/binary-formats-v1.ts';
import {
	ASSISTANCE_OWNED_VIDEO_HIGHLIGHT_TRANSFORM_IDS_V1,
	createAssistanceOwnedVideoHighlightTransformRegistryV1,
	reviewAssistanceOwnedVideoHighlightTransformResultV1,
} from '../src/common/editor/assistance/owned-video-highlight-transform-registry-v1.ts';

const INDEX_SETTINGS = Object.freeze({
	settingsVersion: 1 as const,
	workflowId: 'index-video' as const,
	shotMode: 'accurate' as const,
	includeOcr: true,
});
const REFRAME_SETTINGS = Object.freeze({
	settingsVersion: 1 as const,
	workflowId: 'reframe' as const,
	targetAspectWidth: 9,
	targetAspectHeight: 16,
});
const HIGHLIGHT_SETTINGS = Object.freeze({
	settingsVersion: 1 as const,
	workflowId: 'make-highlights' as const,
	resultCount: 4,
	minimumDurationSeconds: 15 as const,
	maximumDurationSeconds: 60,
	targetAspectWidth: 9 as const,
	targetAspectHeight: 16 as const,
});

test('the owned video/highlight registry is closed and settings-bound', () => {
	const registry = createAssistanceOwnedVideoHighlightTransformRegistryV1();
	assert.deepEqual(registry.transformIds, [
		'sample-shot-frames', 'publish-video-index', 'track-subjects', 'plan-crops',
		'gather-signals', 'rank-highlights', 'assemble-highlights',
	]);
	assert.deepEqual(ASSISTANCE_OWNED_VIDEO_HIGHLIGHT_TRANSFORM_IDS_V1,
		registry.transformIds);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'sample-shot-frames', settings: REFRAME_SETTINGS,
		inputs: {},
	} as never), /another workflow|settings belong/u);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'not-a-transform', settings: INDEX_SETTINGS, inputs: {},
	} as never), /identity is unsupported/u);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'sample-shot-frames', settings: INDEX_SETTINGS,
		inputs: {}, surprise: true,
	} as never), /fields are invalid/u);
});

test('sample-shot-frames applies the exact elapsed-time rules over VFR authority', () => {
	const registry = createAssistanceOwnedVideoHighlightTransformRegistryV1();
	const result = registry.run({
		schemaVersion: 1,
		transformId: 'sample-shot-frames',
		settings: INDEX_SETTINGS,
		inputs: {
			video: videoAuthority(),
			'shot-boundaries': shotBoundaries(),
		},
	});
	assert.deepEqual(result.outputs['frame-pack'].frames.map((frame) => ({
		shotId: frame.shotId,
		anchor: frame.anchor,
		sourceFrame: frame.sourceFrame,
		presentationTick: frame.presentationTick,
		timelineFrame: frame.timelineFrame,
	})), [
		{ shotId: 'shot:000000', anchor: 'midpoint', sourceFrame: 15,
			presentationTick: '15', timelineFrame: 1_500 },
		{ shotId: 'shot:000001', anchor: 'first-third', sourceFrame: 53,
			presentationTick: '53', timelineFrame: 5_300 },
		{ shotId: 'shot:000001', anchor: 'second-third', sourceFrame: 76,
			presentationTick: '76', timelineFrame: 7_600 },
		{ shotId: 'shot:000002', anchor: 'first-quarter', sourceFrame: 135,
			presentationTick: '135', timelineFrame: 13_500 },
		{ shotId: 'shot:000002', anchor: 'midpoint', sourceFrame: 170,
			presentationTick: '170', timelineFrame: 17_000 },
		{ shotId: 'shot:000002', anchor: 'third-quarter', sourceFrame: 205,
			presentationTick: '205', timelineFrame: 20_500 },
	]);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'sample-shot-frames', settings: INDEX_SETTINGS,
		inputs: {
			video: videoAuthority(),
			'shot-boundaries': { ...shotBoundaries(), boundaries: [
				{ sourceFrame: 30, presentationTick: '31', score: 0.9 },
			] },
		},
	}), /source-time authority/u);
});

test('publish-video-index binds normalized embeddings, non-biometric tags, OCR, and jumps', () => {
	const registry = createAssistanceOwnedVideoHighlightTransformRegistryV1();
	const sampled = registry.run({
		schemaVersion: 1, transformId: 'sample-shot-frames', settings: INDEX_SETTINGS,
		inputs: { video: videoAuthority(), 'shot-boundaries': shotBoundaries() },
	}).outputs['frame-pack'];
	const matrix = createAssistanceEmbeddingMatrixV1({ dimensions: 2,
		vectors: sampled.frames.map((_, index) => index % 2 === 0 ? [1, 0] : [0, 1]) });
	const tags = sampled.frames.map(({ resultId }, index) => ({ resultId,
		tags: index === 0 ? [{ tag: 'person' as const, score: 0.9 }] : [] }));
	const ocr = {
		schemaVersion: 1, width: sampled.width, height: sampled.height,
		timescale: sampled.timescale,
		frames: sampled.frames.map((frame, index) => ({
			sourceFrame: frame.sourceFrame, presentationTick: frame.presentationTick,
			regions: index === 0 ? [{ text: 'Opening card', confidence: 0.95,
				box: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 } }] : [],
		})),
	};
	const result = registry.run({
		schemaVersion: 1, transformId: 'publish-video-index', settings: INDEX_SETTINGS,
		inputs: {
			'visual-embeddings': { schemaVersion: 1, kind: 'visual-embeddings',
				framePack: sampled, matrix, tags },
			'recognized-text': ocr,
		},
	});
	const index = result.outputs['video-index'];
	assert.equal(index.embedding.rowCount, sampled.frames.length);
	assert.match(index.embedding.sha256, /^[a-f\d]{64}$/u);
	assert.deepEqual(index.records.visual[0]?.tags, [{ tag: 'person', score: 0.9 }]);
	assert.equal(index.records.ocr[0]?.text, 'Opening card');
	assert.deepEqual(index.rows.ocr[0], {
		resultId: 'visual-sample:0', timelineFrame: 1_500, label: 'Opening card',
	});
	assert.deepEqual(reviewAssistanceOwnedVideoHighlightTransformResultV1(
		JSON.parse(JSON.stringify(result)) as unknown,
	), result);

	const noOcrSettings = { ...INDEX_SETTINGS, includeOcr: false } as const;
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'publish-video-index', settings: noOcrSettings,
		inputs: { 'visual-embeddings': { schemaVersion: 1, kind: 'visual-embeddings',
			framePack: sampled, matrix, tags }, 'recognized-text': ocr },
	}), /authenticated OCR choice/u);
});

test('track-subjects and plan-crops retain exact VFR ticks and the fallback chain', () => {
	const registry = createAssistanceOwnedVideoHighlightTransformRegistryV1();
	const authority = {
		width: 1_920, height: 1_080, timescale: 1_000,
		frames: [
			{ sourceFrame: 4, presentationTick: '125' },
			{ sourceFrame: 9, presentationTick: '710' },
		],
	};
	const subjectResult = {
		schemaVersion: 1, width: 1_920, height: 1_080, timescale: 1_000,
		frames: [
			{ ...authority.frames[0], subjects: [{ kind: 'face', classId: null, label: 'face',
				confidence: 0.95, box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 } }] },
			{ ...authority.frames[1], subjects: [] },
		],
	};
	const tracked = registry.run({
		schemaVersion: 1, transformId: 'track-subjects', settings: REFRAME_SETTINGS,
		inputs: { 'subject-tracks': { schemaVersion: 1, kind: 'subject-detections',
			authority, shotAnchorFrames: [4], result: subjectResult } },
	}).outputs['tracked-subjects'];
	assert.equal(tracked.frames[0]?.subjects[0]?.trackId, 'subject-000001');
	assert.equal(tracked.frames[1]?.presentationTick, '710');

	const saliency = {
		schemaVersion: 1, width: 1_920, height: 1_080, timescale: 1_000,
		frames: [
			{ ...authority.frames[0], saliency: null },
			{ ...authority.frames[1], saliency: { x: 0.8, y: 0.4, score: 0.8 } },
		],
	};
	const planned = registry.run({
		schemaVersion: 1, transformId: 'plan-crops', settings: REFRAME_SETTINGS,
		inputs: { 'tracked-subjects': tracked, 'saliency-map': saliency },
	}).outputs['reframe-path'];
	assert.deepEqual(planned.fallbackChain, ['subject', 'saliency', 'center']);
	assert.deepEqual(planned.path.targetAspect, { width: 9, height: 16 });
	assert.deepEqual(planned.path.keyframes.map(({ authority: value }) => value),
		['subject', 'saliency']);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'plan-crops', settings: REFRAME_SETTINGS,
		inputs: { 'tracked-subjects': tracked,
			'saliency-map': { ...saliency, frames: [saliency.frames[0],
				{ ...saliency.frames[1], presentationTick: '711' }] } },
	}), /exact authority/u);
});

test('highlight stages snap evidence, rank deterministically, and assemble safe unselected clips', () => {
	const registry = createAssistanceOwnedVideoHighlightTransformRegistryV1();
	const gathered = registry.run({
		schemaVersion: 1, transformId: 'gather-signals', settings: HIGHLIGHT_SETTINGS,
		inputs: highlightInputs(),
	}).outputs['highlight-signals'];
	assert.deepEqual(gathered.candidates.map(({ id, startFrame, endFrame, sourceStartFrame,
		sourceEndFrame, transcriptEvidence, duplication }) => ({ id, startFrame, endFrame,
		sourceStartFrame, sourceEndFrame, transcriptEvidence, duplication })), [
		{ id: 'a', startFrame: 15_000, endFrame: 60_000, sourceStartFrame: 15,
			sourceEndFrame: 60, transcriptEvidence: true, duplication: 1 },
		{ id: 'b', startFrame: 60_000, endFrame: 90_000, sourceStartFrame: 60,
			sourceEndFrame: 90, transcriptEvidence: true,
			duplication: Math.fround(Math.SQRT1_2) },
		{ id: 'c', startFrame: 90_000, endFrame: 120_000, sourceStartFrame: 90,
			sourceEndFrame: 120, transcriptEvidence: false,
			duplication: Math.fround(Math.SQRT1_2) },
		{ id: 'd', startFrame: 15_000, endFrame: 60_000, sourceStartFrame: 15,
			sourceEndFrame: 60, transcriptEvidence: true, duplication: 1 },
	]);

	const ranked = registry.run({
		schemaVersion: 1, transformId: 'rank-highlights', settings: HIGHLIGHT_SETTINGS,
		inputs: { 'highlight-signals': gathered },
	}).outputs['highlight-candidates'];
	assert.deepEqual(ranked.candidates.map(({ id, evidenceMode, selected }) =>
		({ id, evidenceMode, selected })), [
		{ id: 'a', evidenceMode: 'transcript', selected: false },
		{ id: 'c', evidenceMode: 'speechless', selected: false },
		{ id: 'b', evidenceMode: 'transcript', selected: false },
	]);
	const editorial = { schemaVersion: 1, candidates: [
		{ candidateId: 'c', title: 'Visual payoff', hook: null, chapters: [], explanation: null },
		{ candidateId: 'a', title: 'Opening insight', hook: null, chapters: [], explanation: null },
		{ candidateId: 'b', title: null, hook: null, chapters: [], explanation: null },
	] };
	const assembled = registry.run({
		schemaVersion: 1, transformId: 'assemble-highlights', settings: HIGHLIGHT_SETTINGS,
		inputs: { 'highlight-candidates': ranked, editorial },
	}).outputs['highlight-proposals'];
	assert.deepEqual(assembled.proposals.map(({ id, title, selected }) => ({ id, title, selected })), [
		{ id: 'c', title: 'Visual payoff', selected: false },
		{ id: 'a', title: 'Opening insight', selected: false },
		{ id: 'b', title: 'Highlight 3', selected: false },
	]);
	assert.deepEqual(assembled.proposals[0]?.cropKeyframes.map(({ authority, sourceFrame }) =>
		({ authority, sourceFrame })), [
		{ authority: 'center', sourceFrame: 90 },
		{ authority: 'center', sourceFrame: 119 },
	]);
	assert.equal(assembled.proposals[0]?.cropKeyframes[0]?.crop.left, 0.341796875);
	assert.deepEqual(reviewAssistanceOwnedVideoHighlightTransformResultV1(
		JSON.parse(JSON.stringify({ schemaVersion: 1, transformId: 'assemble-highlights',
			outputs: { 'highlight-proposals': assembled } })) as unknown,
	).outputs['highlight-proposals'], assembled);
});

test('highlight transforms reject malformed scores and preserve empty no-event results', () => {
	const registry = createAssistanceOwnedVideoHighlightTransformRegistryV1();
	const inputs = highlightInputs();
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'gather-signals', settings: HIGHLIGHT_SETTINGS,
		inputs: { ...inputs, audio: { ...inputs.audio,
			signals: [{ candidateId: 'a', energyDynamics: Number.NaN }] } },
	}), /unit interval/u);
	const emptyInputs = { ...inputs,
		video: { ...inputs.video, windows: [] }, audio: null, transcript: null,
		'reaction-ranges': null, embeddings: null };
	const gathered = registry.run({ schemaVersion: 1, transformId: 'gather-signals',
		settings: HIGHLIGHT_SETTINGS, inputs: emptyInputs }).outputs['highlight-signals'];
	assert.deepEqual(gathered.candidates, []);
	const ranked = registry.run({ schemaVersion: 1, transformId: 'rank-highlights',
		settings: HIGHLIGHT_SETTINGS, inputs: { 'highlight-signals': gathered } })
		.outputs['highlight-candidates'];
	assert.deepEqual(ranked.candidates, []);
	const assembled = registry.run({ schemaVersion: 1, transformId: 'assemble-highlights',
		settings: HIGHLIGHT_SETTINGS,
		inputs: { 'highlight-candidates': ranked, editorial: null } })
		.outputs['highlight-proposals'];
	assert.deepEqual(assembled.proposals, []);
});

function videoAuthority() {
	return {
		schemaVersion: 1 as const, kind: 'video-source-time-authority' as const,
		sourceId: 'video-source', width: 1_920, height: 1_080, timescale: 10,
		presentationEndTick: '241',
		frames: Array.from({ length: 241 }, (_, sourceFrame) => ({
			sourceFrame, presentationTick: String(sourceFrame), timelineFrame: sourceFrame * 100,
		})),
	};
}

function shotBoundaries() {
	return {
		schemaVersion: 1 as const, detector: 'transnetv2' as const, timescale: 10,
		sourceFrameCount: 241,
		boundaries: [
			{ sourceFrame: 30, presentationTick: '30', score: 0.9 },
			{ sourceFrame: 100, presentationTick: '100', score: 0.8 },
		],
	};
}

function highlightInputs() {
	const timing = [0, 15, 60, 90, 120, 180].map((sourceFrame) => ({
		sourceFrame, presentationTick: String(sourceFrame), timelineFrame: sourceFrame * 1_000,
	}));
	return {
		video: {
			schemaVersion: 1 as const, kind: 'highlight-video-signals' as const,
			sourceId: 'video-source', sampleRate: 1_000, timescale: 1,
			sourceSize: { width: 1_920, height: 1_080 },
			videoOccurrenceId: 'video-occurrence', audioOccurrenceId: 'audio-occurrence',
			selectionStartFrame: 0, selectionEndFrame: 180_000,
			sourceTimeAuthority: timing,
			windows: [
				{ id: 'a', startFrame: 14_000, endFrame: 61_000,
					shotStructure: 0.8, visualInterest: 0.8 },
				{ id: 'b', startFrame: 59_000, endFrame: 91_000,
					shotStructure: 0.5, visualInterest: 0.4 },
				{ id: 'c', startFrame: 89_000, endFrame: 121_000,
					shotStructure: 1, visualInterest: 1 },
				{ id: 'd', startFrame: 30_000, endFrame: 70_000,
					shotStructure: 0.1, visualInterest: 0.1 },
			],
		},
		audio: { schemaVersion: 1 as const, kind: 'highlight-audio-signals' as const,
			signals: [
				{ candidateId: 'a', energyDynamics: 1 },
				{ candidateId: 'b', energyDynamics: 0.4 },
				{ candidateId: 'c', energyDynamics: 0.5 },
				{ candidateId: 'd', energyDynamics: 0.1 },
			] },
		transcript: { schemaVersion: 1 as const, kind: 'highlight-transcript-signals' as const,
			sourceTimelineStartFrame: 0,
			transcript: { schemaVersion: 1 as const, sourceId: 'audio-source', sampleRate: 1_000,
				language: 'en', modelId: 'test-model', segments: [
					{ startFrame: 15_000, endFrame: 60_000, text: 'Opening idea', speaker: null,
						words: [{ text: 'Opening', startFrame: 15_000, endFrame: 16_000,
							confidence: 1 }] },
					{ startFrame: 60_000, endFrame: 90_000, text: 'Follow up', speaker: null,
						words: [{ text: 'Follow', startFrame: 60_000, endFrame: 61_000,
							confidence: 1 }] },
				] },
			signals: [
				{ candidateId: 'a', hook: 1, conversationalStructure: 1,
					semanticSelfContainedness: 1 },
				{ candidateId: 'b', hook: 0.4, conversationalStructure: 0.4,
					semanticSelfContainedness: 0.4 },
				{ candidateId: 'd', hook: 0.1, conversationalStructure: 0.1,
					semanticSelfContainedness: 0.1 },
			],
		},
		'shot-boundaries': {
			schemaVersion: 1 as const, detector: 'transnetv2' as const, timescale: 1,
			sourceFrameCount: 181,
			boundaries: [15, 60, 90, 120].map((sourceFrame) => ({ sourceFrame,
				presentationTick: String(sourceFrame), score: 1 })),
		},
		'reaction-ranges': { schemaVersion: 1 as const, kind: 'highlight-reaction-signals' as const,
			sourceTimelineStartFrame: 0,
			result: { schemaVersion: 1 as const, kind: 'reaction-ranges' as const,
				sampleRate: 32_000 as const, threshold: 0.5, ranges: [
					{ id: 'reaction:laughter:480000:1920000', kind: 'reaction' as const,
						label: 'Laughter' as const, startSample: 480_000, endSample: 1_920_000,
						score: 1, selected: false as const },
					{ id: 'reaction:cheering:2880000:3840000', kind: 'reaction' as const,
						label: 'Cheering' as const, startSample: 2_880_000, endSample: 3_840_000,
						score: 0.9, selected: false as const },
				] },
		},
		embeddings: createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [
			[1, 0], [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [1, 0],
		] }),
	};
}
