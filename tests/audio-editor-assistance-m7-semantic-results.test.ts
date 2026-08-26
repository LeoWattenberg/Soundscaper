/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAXIMUM_ASSISTANCE_ALIGNMENT_WORDS,
	MAXIMUM_ASSISTANCE_AUDIO_TAG_WINDOWS,
	MAXIMUM_ASSISTANCE_BEAT_POINTS,
	MAXIMUM_ASSISTANCE_EDITORIAL_CANDIDATES,
	reviewAssistanceAudioTagsV1,
	reviewAssistanceBeatGridV1,
	reviewAssistanceEditorialProposalV1,
	reviewAssistanceWordAlignmentV1,
} from '../src/common/editor/assistance/m7-semantic-results.ts';

test('word-alignment v1 admits exact ordered 16 kHz word geometry', () => {
	const reviewed = reviewAssistanceWordAlignmentV1({
		schemaVersion: 1,
		sampleRate: 16_000,
		words: [
			{ segmentIndex: 0, wordIndex: 0, text: 'Hello', startSample: 80,
				endSample: 2_400, confidence: 0.98 },
			{ segmentIndex: 0, wordIndex: 1, text: 'world', startSample: 2_400,
				endSample: 4_800, confidence: null },
		],
	});
	assert.deepEqual(reviewed, {
		schemaVersion: 1,
		sampleRate: 16_000,
		words: [
			{ segmentIndex: 0, wordIndex: 0, text: 'Hello', startSample: 80,
				endSample: 2_400, confidence: 0.98 },
			{ segmentIndex: 0, wordIndex: 1, text: 'world', startSample: 2_400,
				endSample: 4_800, confidence: null },
		],
	});
	assert.ok(Object.isFrozen(reviewed));
	assert.ok(Object.isFrozen(reviewed.words));
});

test('word-alignment v1 refuses unknown fields, NaN, overlap, and unstable transcript order', () => {
	const base = {
		schemaVersion: 1,
		sampleRate: 16_000,
		words: [{ segmentIndex: 0, wordIndex: 0, text: 'Hello', startSample: 0,
			endSample: 100, confidence: 0.9 }],
	};
	assert.throws(() => reviewAssistanceWordAlignmentV1({ ...base, model: 'wav2vec2' }),
		/fields|schema/iu);
	assert.throws(() => reviewAssistanceWordAlignmentV1({ ...base, words: [{
		...base.words[0], confidence: Number.NaN,
	}] }), /confidence/iu);
	assert.throws(() => reviewAssistanceWordAlignmentV1({ ...base, words: [
		base.words[0],
		{ ...base.words[0], wordIndex: 1, startSample: 99, endSample: 200 },
	] }), /ordered|overlap|timing/iu);
	assert.throws(() => reviewAssistanceWordAlignmentV1({ ...base, words: [
		{ ...base.words[0], segmentIndex: 1 },
		{ ...base.words[0], segmentIndex: 0, wordIndex: 1, startSample: 100, endSample: 200 },
	] }), /transcript order/iu);
});

test('audio-tags v1 admits only one-second PANNs windows and three bounded scores', () => {
	const reviewed = reviewAssistanceAudioTagsV1({
		schemaVersion: 1,
		sampleRate: 32_000,
		windowSamples: 32_000,
		windows: [
			{ startSample: 0, scores: { laughter: 0.75, applause: 0.1, cheering: 0 } },
			{ startSample: 64_000, scores: { laughter: 0.25, applause: 0.6, cheering: 1 } },
		],
	});
	assert.deepEqual(reviewed.windows[1], {
		startSample: 64_000,
		scores: { laughter: 0.25, applause: 0.6, cheering: 1 },
	});
	for (const value of [
		{ ...reviewed, sampleRate: 16_000 },
		{ ...reviewed, windowSamples: 16_000 },
		{ ...reviewed, windows: [{ startSample: 1,
			scores: { laughter: 0, applause: 0, cheering: 0 } }] },
		{ ...reviewed, windows: [{ startSample: 0,
			scores: { laughter: Number.POSITIVE_INFINITY, applause: 0, cheering: 0 } }] },
		{ ...reviewed, windows: [{ startSample: 0,
			scores: { laughter: 0, applause: 0, cheering: 0, speech: 1 } }] },
	] as const) assert.throws(() => reviewAssistanceAudioTagsV1(value));
});

test('beat-grid v1 admits ordered beat/downbeat points and bounded tempo proposals', () => {
	assert.deepEqual(reviewAssistanceBeatGridV1({
		schemaVersion: 1,
		sampleRate: 22_050,
		points: [
			{ sample: 0, kind: 'downbeat', confidence: 0.9 },
			{ sample: 11_025, kind: 'beat', confidence: null },
		],
		tempoProposal: {
			kind: 'piecewise-held',
			changes: [{ startSample: 0, bpm: 120 }, { startSample: 88_200, bpm: 90 }],
		},
	}), {
		schemaVersion: 1,
		sampleRate: 22_050,
		points: [
			{ sample: 0, kind: 'downbeat', confidence: 0.9 },
			{ sample: 11_025, kind: 'beat', confidence: null },
		],
		tempoProposal: {
			kind: 'piecewise-held',
			changes: [{ startSample: 0, bpm: 120 }, { startSample: 88_200, bpm: 90 }],
		},
	});
	assert.deepEqual(reviewAssistanceBeatGridV1({
		schemaVersion: 1, sampleRate: 22_050, points: [], tempoProposal: null,
	}).points, []);
	assert.throws(() => reviewAssistanceBeatGridV1({
		schemaVersion: 1, sampleRate: 22_050,
		points: [
			{ sample: 100, kind: 'beat', confidence: 1 },
			{ sample: 100, kind: 'downbeat', confidence: 1 },
		],
		tempoProposal: null,
	}), /strictly ordered/iu);
	assert.throws(() => reviewAssistanceBeatGridV1({
		schemaVersion: 1, sampleRate: 22_050, points: [],
		tempoProposal: { kind: 'constant', bpm: Number.NaN },
	}), /tempo|bpm/iu);
	assert.throws(() => reviewAssistanceBeatGridV1({
		schemaVersion: 1, sampleRate: 22_050, points: [],
		tempoProposal: { kind: 'piecewise-held', changes: [{ startSample: 1, bpm: 120 }] },
	}), /sample zero/iu);
});

test('editorial proposal v1 can only rerank known candidates and return inert bounded text', () => {
	const reviewed = reviewAssistanceEditorialProposalV1({
		schemaVersion: 1,
		candidates: [{
			candidateId: 'candidate-2',
			title: 'The surprising turn',
			hook: 'A concise opening question',
			chapters: ['Setup', 'Resolution'],
			explanation: 'The opening is self-contained and energetic.',
		}, {
			candidateId: 'candidate-1', title: null, hook: null, chapters: [], explanation: null,
		}],
	}, ['candidate-1', 'candidate-2']);
	assert.deepEqual(reviewed.candidates.map(({ candidateId }) => candidateId), [
		'candidate-2', 'candidate-1',
	]);
	assert.ok(Object.isFrozen(reviewed.candidates[0].chapters));

	for (const value of [
		{ schemaVersion: 1, candidates: [] },
		{ schemaVersion: 1, candidates: [{ ...reviewed.candidates[0], candidateId: 'invented' },
			reviewed.candidates[1]] },
		{ schemaVersion: 1, candidates: [{ ...reviewed.candidates[0], title: '<b>Run this</b>' },
			reviewed.candidates[1]] },
		{ schemaVersion: 1, candidates: [{ ...reviewed.candidates[0], hook: 'file:///private/input' },
			reviewed.candidates[1]] },
		{ schemaVersion: 1, candidates: [{ ...reviewed.candidates[0], chapters: ['[Open](javascript:alert)'] },
			reviewed.candidates[1]] },
		{ schemaVersion: 1, candidates: [{ ...reviewed.candidates[0], command: 'cut' },
			reviewed.candidates[1]] },
	] as const) assert.throws(
		() => reviewAssistanceEditorialProposalV1(value, ['candidate-1', 'candidate-2']),
		/candidate|plain text|fields/iu,
	);
});

test('all semantic result inventories refuse oversized claims before visiting entries', () => {
	assert.throws(() => reviewAssistanceWordAlignmentV1({
		schemaVersion: 1, sampleRate: 16_000,
		words: new Array(MAXIMUM_ASSISTANCE_ALIGNMENT_WORDS + 1),
	}), /bound/iu);
	assert.throws(() => reviewAssistanceAudioTagsV1({
		schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000,
		windows: new Array(MAXIMUM_ASSISTANCE_AUDIO_TAG_WINDOWS + 1),
	}), /bound/iu);
	assert.throws(() => reviewAssistanceBeatGridV1({
		schemaVersion: 1, sampleRate: 22_050,
		points: new Array(MAXIMUM_ASSISTANCE_BEAT_POINTS + 1), tempoProposal: null,
	}), /bound/iu);
	assert.throws(() => reviewAssistanceEditorialProposalV1({
		schemaVersion: 1,
		candidates: new Array(MAXIMUM_ASSISTANCE_EDITORIAL_CANDIDATES + 1),
	}, []), /bound/iu);
});
