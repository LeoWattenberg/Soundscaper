/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_OWNED_AUDIO_CUT_TRANSFORM_IDS_V1,
	createAssistanceOwnedAudioCutTransformRegistryV1,
	reviewAssistanceOwnedAudioCutTransformResultV1,
} from '../src/common/editor/assistance/owned-audio-cut-transform-registry-v1.ts';
import { createAssistanceEmbeddingMatrixV1 } from
	'../src/common/editor/assistance/binary-formats-v1.ts';
import { createAssistanceTranscript } from '../src/common/editor/assistance/transcript.ts';
import type { AssistanceTokenizerV1 } from
	'../src/common/editor/assistance/transcript-indexing-v1.ts';

const tokenizer: AssistanceTokenizerV1 = Object.freeze({
	encode(value: string): readonly number[] {
		return value === '\n' ? [10] : value.trim().split(/\s+/u).filter(Boolean)
			.map((token) => [...token].reduce((sum, character) => sum + character.codePointAt(0)!, 1));
	},
});

const registry = createAssistanceOwnedAudioCutTransformRegistryV1({ tokenizer });

function settings(workflowId: string, fields: Readonly<Record<string, unknown>> = {}) {
	return Object.freeze({ settingsVersion: 1, workflowId, ...fields });
}

function transcript(segments: readonly Readonly<Record<string, unknown>>[] = [
	{
		startFrame: 0, endFrame: 48_000, text: 'um welcome', speaker: null,
		words: [
			{ text: 'um', startFrame: 0, endFrame: 8_000, confidence: 0.7 },
			{ text: 'welcome', startFrame: 9_000, endFrame: 30_000, confidence: 0.9 },
		],
	},
]) {
	return createAssistanceTranscript({
		sourceId: 'source-a', sampleRate: 48_000, language: 'en', modelId: 'whisper-large-v3-turbo',
		segments: segments as never,
	});
}

test('the registry exposes only the eight owned audio/cut transforms and exact request fields', () => {
	assert.deepEqual(ASSISTANCE_OWNED_AUDIO_CUT_TRANSFORM_IDS_V1, [
		'assemble-captions', 'propose-cleanup', 'attribute-speakers', 'merge-reaction-ranges',
		'chunk-transcript', 'publish-transcript-index', 'propose-tempo-map', 'normalize-cuts',
	]);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'execute-shell', settings: {}, inputs: {},
	}), /transform/iu);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'assemble-captions',
		settings: settings('transcribe-captions', {
			recognizer: 'whisper', language: 'en', englishWhisperAlignment: 'off',
		}),
		inputs: { transcript: transcript(), 'word-alignment': null }, invented: true,
	}), /field/iu);
});

test('caption assembly re-admits transcript and alignment semantics into bounded JSON cues', () => {
	const alignment = {
		schemaVersion: 1, sourceSampleRate: 48_000, sourceStartFrame: 0,
		alignment: {
			schemaVersion: 1, sampleRate: 16_000,
			words: [
				{ segmentIndex: 0, wordIndex: 0, text: 'um', startSample: 100,
					endSample: 2_000, confidence: 0.8 },
				{ segmentIndex: 0, wordIndex: 1, text: 'welcome', startSample: 3_000,
					endSample: 10_000, confidence: 0.95 },
			],
		},
	};
	const result = registry.run({
		schemaVersion: 1, transformId: 'assemble-captions',
		settings: settings('transcribe-captions', {
			recognizer: 'whisper', language: 'en', englishWhisperAlignment: 'when-installed',
		}),
		inputs: { transcript: transcript(), 'word-alignment': alignment },
	});
	assert.deepEqual(result.outputs.captions.cues, [{
		cueId: 'caption:0', startFrame: 0, endFrame: 48_000, text: 'um welcome',
		words: [
			{ text: 'um', startFrame: 300, endFrame: 6_000, confidence: 0.8 },
			{ text: 'welcome', startFrame: 9_000, endFrame: 30_000, confidence: 0.95 },
		],
	}]);
	assert.equal(result.outputs.captions.alignmentApplied, true);
	const automaticEnglish = registry.run({
		schemaVersion: 1, transformId: 'assemble-captions',
		settings: settings('transcribe-captions', {
			recognizer: 'whisper', language: 'auto', englishWhisperAlignment: 'when-installed',
		}),
		inputs: { transcript: transcript(), 'word-alignment': alignment },
	});
	assert.equal(automaticEnglish.outputs.captions.alignmentApplied, true);
	const automaticFrench = registry.run({
		schemaVersion: 1, transformId: 'assemble-captions',
		settings: settings('transcribe-captions', {
			recognizer: 'whisper', language: 'auto', englishWhisperAlignment: 'when-installed',
		}),
		inputs: { transcript: { ...transcript(), language: 'fr' }, 'word-alignment': {
			...alignment, alignment: { ...alignment.alignment, words: [] },
		} },
	});
	assert.equal(automaticFrench.outputs.captions.alignmentApplied, false);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'assemble-captions',
		settings: settings('transcribe-captions', {
			recognizer: 'whisper', language: 'auto', englishWhisperAlignment: 'when-installed',
		}),
		inputs: { transcript: { ...transcript(), language: 'fr' }, 'word-alignment': alignment },
	}), /English|non-English|empty/iu);
	assert.deepEqual(
		reviewAssistanceOwnedAudioCutTransformResultV1(JSON.parse(JSON.stringify(result))),
		result,
	);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'assemble-captions',
		settings: settings('transcribe-captions', {
			recognizer: 'parakeet', language: 'en', englishWhisperAlignment: 'off',
		}),
		inputs: { transcript: transcript(), 'word-alignment': {
			schemaVersion: 1, sourceSampleRate: 48_000, sourceStartFrame: 0,
			alignment: { schemaVersion: 1, sampleRate: 16_000, words: [] },
		} },
	}), /alignment|Whisper/iu);

	const empty = registry.run({
		schemaVersion: 1, transformId: 'assemble-captions',
		settings: settings('transcribe-captions', {
			recognizer: 'parakeet', language: 'auto', englishWhisperAlignment: 'off',
		}),
		inputs: { transcript: transcript([]), 'word-alignment': null },
	});
	assert.deepEqual(empty.outputs.captions.cues, []);
});

test('caption assembly admits the longest producer-valid diarized title', () => {
	const text = 't'.repeat(16_384);
	const speaker = 's'.repeat(160);
	const result = registry.run({
		schemaVersion: 1,
		transformId: 'assemble-captions',
		settings: settings('transcribe-captions', {
			recognizer: 'parakeet', language: 'auto', englishWhisperAlignment: 'off',
		}),
		inputs: {
			transcript: transcript([{
				startFrame: 0, endFrame: 48_000, text, speaker, words: [],
			}]),
			'word-alignment': null,
		},
	});

	assert.equal(result.outputs.captions.cues[0]?.text, `${speaker}: ${text}`);
	assert.equal(result.outputs.captions.cues[0]?.text.length, 16_546);
});

test('caption alignment keeps touching words disjoint after sample-rate rescaling', () => {
	const source = createAssistanceTranscript({
		sourceId: 'source-a', sampleRate: 11_025, language: 'en', modelId: 'whisper',
		segments: [{
			startFrame: 0, endFrame: 11_025, text: 'one two', speaker: null,
			words: [
				{ text: 'one', startFrame: 0, endFrame: 220, confidence: 0.9 },
				{ text: 'two', startFrame: 220, endFrame: 441, confidence: 0.8 },
			],
		}],
	});
	const result = registry.run({
		schemaVersion: 1,
		transformId: 'assemble-captions',
		settings: settings('transcribe-captions', {
			recognizer: 'whisper', language: 'en', englishWhisperAlignment: 'when-installed',
		}),
		inputs: {
			transcript: source,
			'word-alignment': {
				schemaVersion: 1, sourceSampleRate: 11_025, sourceStartFrame: 0,
				alignment: {
					schemaVersion: 1, sampleRate: 16_000,
					words: [
						{ segmentIndex: 0, wordIndex: 0, text: 'one', startSample: 0,
							endSample: 320, confidence: 0.9 },
						{ segmentIndex: 0, wordIndex: 1, text: 'two', startSample: 320,
							endSample: 640, confidence: 0.8 },
					],
				},
			},
		},
	});

	assert.deepEqual(result.outputs.captions.cues[0]?.words.map(
		({ startFrame, endFrame }) => [startFrame, endFrame],
	), [[0, 221], [221, 441]]);
});

test('cleanup uses the exact authenticated preset while keeping every proposal unselected', () => {
	const voiceActivity = {
		schemaVersion: 1, sourceSampleRate: 48_000, sourceStartFrame: 0, sourceEndFrame: 96_000,
		result: { kind: 'voice-activity', sampleRate: 16_000, segments: [
			{ startSample: 0, sampleCount: 8_000 },
			{ startSample: 24_000, sampleCount: 8_000 },
		] },
	};
	const aggressive = registry.run({
		schemaVersion: 1, transformId: 'propose-cleanup',
		settings: settings('clean-filler-silence', { preset: 'aggressive' }),
		inputs: { 'voice-activity': voiceActivity, transcript: transcript() },
	});
	assert.deepEqual(aggressive.outputs['cleanup-proposals'].proposals.map(({ kind }) => kind), [
		'filler', 'silence',
	]);
	assert.ok(aggressive.outputs['cleanup-proposals'].proposals.every(({ selected }) => !selected));

	const conservative = registry.run({
		schemaVersion: 1, transformId: 'propose-cleanup',
		settings: settings('clean-filler-silence', { preset: 'conservative' }),
		inputs: { 'voice-activity': voiceActivity, transcript: transcript() },
	});
	assert.deepEqual(conservative.outputs['cleanup-proposals'].proposals, [],
		'one-second silence and a 0.7-confidence filler do not meet Conservative settings');
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'propose-cleanup',
		settings: settings('clean-filler-silence', { preset: 'balanced', threshold: 0 }),
		inputs: { 'voice-activity': voiceActivity, transcript: transcript() },
	}), /field|settings/iu);
});

test('speaker attribution scales selected 16 kHz turns onto absolute transcript frames', () => {
	const source = transcript([
		{ startFrame: 48_000, endFrame: 72_000, text: 'one', words: [], speaker: null },
		{ startFrame: 72_000, endFrame: 96_000, text: 'two', words: [], speaker: null },
	]);
	const result = registry.run({
		schemaVersion: 1, transformId: 'attribute-speakers',
		settings: settings('identify-speakers', { speakerNames: 'anonymous' }),
		inputs: {
			transcript: source,
			'speaker-turns': {
				schemaVersion: 1, sourceSampleRate: 48_000, sourceStartFrame: 48_000,
				result: { kind: 'speaker-turns', sampleRate: 16_000, turns: [
					{ startSample: 0, sampleCount: 8_000, speakerId: 1 },
					{ startSample: 8_000, sampleCount: 8_000, speakerId: 0 },
				] },
			},
		},
	});
	assert.deepEqual(result.outputs['attributed-transcript'].segments.map(({ speaker }) => speaker), [
		'Speaker 2', 'Speaker 1',
	]);
});

test('reaction merging uses the explicit threshold and preserves authenticated empty results', () => {
	const base = {
		schemaVersion: 1 as const, transformId: 'merge-reaction-ranges' as const,
		settings: settings('mark-reactions', { threshold: 0.5 }),
	};
	const result = registry.run({ ...base, inputs: { 'audio-tags': {
		schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000, windows: [
			{ startSample: 0, scores: { laughter: 0.6, applause: 0, cheering: 0 } },
			{ startSample: 64_000, scores: { laughter: 0.7, applause: 0, cheering: 0 } },
		],
	} } });
	assert.deepEqual(result.outputs['reaction-ranges'].ranges.map(({ startSample, endSample }) =>
		[startSample, endSample]), [[0, 96_000]]);
	const empty = registry.run({ ...base, inputs: { 'audio-tags': {
		schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000, windows: [],
	} } });
	assert.deepEqual(empty.outputs['reaction-ranges'].ranges, []);
});

test('transcript chunking and publication bind exact timing rows to one reviewed matrix digest', () => {
	const source = transcript([
		{ startFrame: 100, endFrame: 200, text: 'one', words: [], speaker: null },
		{ startFrame: 250, endFrame: 400, text: 'two words', words: [], speaker: null },
	]);
	const indexSettings = settings('index-transcript', { chunkTokens: 256, overlapTokens: 32 });
	const chunked = registry.run({
		schemaVersion: 1, transformId: 'chunk-transcript', settings: indexSettings,
		inputs: { transcript: source },
	});
	assert.equal(chunked.outputs['text-chunks'].chunks.length, 1);
	assert.equal(chunked.outputs['text-chunks'].chunks[0]!.label, 'one two words');
	const matrix = createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [[1, 0]] });
	const published = registry.run({
		schemaVersion: 1, transformId: 'publish-transcript-index', settings: indexSettings,
		inputs: { 'text-chunks': chunked.outputs['text-chunks'], embeddings: matrix },
	});
	assert.deepEqual(published.outputs['transcript-index'].rows, [{
		resultId: 'transcript:0', timelineFrame: 100, sourceEndFrame: 400,
		segmentStartIndex: 0, segmentEndIndexExclusive: 2, label: 'one two words', embeddingRow: 0,
	}]);
	assert.equal(published.outputs['transcript-index'].embedding.rowCount, 1);
	assert.match(published.outputs['transcript-index'].embedding.sha256, /^[a-f\d]{64}$/u);
	assert.deepEqual(
		reviewAssistanceOwnedAudioCutTransformResultV1(JSON.parse(JSON.stringify(published))),
		published,
	);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'publish-transcript-index', settings: indexSettings,
		inputs: { 'text-chunks': chunked.outputs['text-chunks'],
			embeddings: createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [] }) },
	}), /row|chunk/iu);

	const emptyChunks = registry.run({
		schemaVersion: 1, transformId: 'chunk-transcript', settings: indexSettings,
		inputs: { transcript: transcript([]) },
	});
	const emptyIndex = registry.run({
		schemaVersion: 1, transformId: 'publish-transcript-index', settings: indexSettings,
		inputs: { 'text-chunks': emptyChunks.outputs['text-chunks'],
			embeddings: createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [] }) },
	});
	assert.deepEqual(emptyIndex.outputs['transcript-index'].rows, []);
});

test('transcript chunk labels stay within the validator UTF-16 unit ceiling', () => {
	const text = '🎧'.repeat(600);
	const indexSettings = settings('index-transcript', { chunkTokens: 256, overlapTokens: 32 });
	const chunked = registry.run({
		schemaVersion: 1, transformId: 'chunk-transcript', settings: indexSettings,
		inputs: { transcript: transcript([{
			startFrame: 0, endFrame: 48_000, text, words: [], speaker: null,
		}]) },
	});
	const label = chunked.outputs['text-chunks'].chunks[0]!.label;
	assert.equal(label, '🎧'.repeat(512));
	assert.equal(label.length, 1_024);
	assert.doesNotThrow(() => reviewAssistanceOwnedAudioCutTransformResultV1(chunked));
});

test('beat and cut transforms retain no-event results and reject substitution or malformed values', () => {
	const beats = registry.run({
		schemaVersion: 1, transformId: 'propose-tempo-map',
		settings: settings('detect-beats-tempo', { publishBeatLabels: false, applyTempoMap: true }),
		inputs: { 'beat-grid': { schemaVersion: 1, sampleRate: 22_050, points: [], tempoProposal: null } },
	});
	assert.deepEqual(beats.outputs['beat-labels'].points, []);
	assert.equal(beats.outputs['beat-labels'].publicationRequested, false);
	assert.equal(beats.outputs['tempo-map-diff'].applicationRequested, true);
	assert.equal(beats.outputs['tempo-map-diff'].proposal, null);

	const cuts = registry.run({
		schemaVersion: 1, transformId: 'normalize-cuts',
		settings: settings('mark-cuts', { mode: 'accurate' }),
		inputs: { 'shot-boundaries': {
			schemaVersion: 1, detector: 'transnetv2', timescale: 1_000, sourceFrameCount: 50,
			boundaries: [],
		} },
	});
	assert.deepEqual(cuts.outputs['cut-proposals'].proposals, []);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'normalize-cuts',
		settings: settings('mark-cuts', { mode: 'fast' }),
		inputs: { 'shot-boundaries': {
			schemaVersion: 1, detector: 'transnetv2', timescale: 1_000, sourceFrameCount: 50,
			boundaries: [],
		} },
	}), /mode|detector|substitut/iu);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'normalize-cuts',
		settings: settings('mark-cuts', { mode: 'accurate' }),
		inputs: { 'shot-boundaries': {
			schemaVersion: 1, detector: 'transnetv2', timescale: 1_000, sourceFrameCount: 50,
			boundaries: [{ sourceFrame: 1, presentationTick: '1', score: Number.NaN }],
		} },
	}), /score|finite/iu);
});

test('every semantic edge rejects wrong schemas, unstable order, and oversized inventories', () => {
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'assemble-captions',
		settings: settings('transcribe-captions', {
			recognizer: 'parakeet', language: 'auto', englishWhisperAlignment: 'off',
		}),
		inputs: { transcript: { ...transcript(), schemaVersion: 2 }, 'word-alignment': null },
	}), /schema/iu);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'propose-tempo-map',
		settings: settings('detect-beats-tempo', { publishBeatLabels: true, applyTempoMap: false }),
		inputs: { 'beat-grid': {
			schemaVersion: 1, sampleRate: 22_050, tempoProposal: null,
			points: [
				{ sample: 20, kind: 'beat', confidence: null },
				{ sample: 10, kind: 'beat', confidence: null },
			],
		} },
	}), /order/iu);
	assert.throws(() => registry.run({
		schemaVersion: 1, transformId: 'merge-reaction-ranges',
		settings: settings('mark-reactions', { threshold: 0.5 }),
		inputs: { 'audio-tags': {
			schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000,
			windows: new Array(100_001),
		} },
	}), /bound|inventory/iu);
});
