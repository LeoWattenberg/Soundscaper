/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeFloatWave } from './electron/local-assistance-models/model-inputs.js';
import { validateModelOutput, validateModelOutputs } from './electron/local-assistance-models/model-output-validation.js';

const bytes = (value) => Buffer.from(JSON.stringify(value));
const input = { bytes: Buffer.from('source'), frameCount: 64_000, sampleRate: 32_000 };

test('alignment smoke check requires every original word with bounded timing', () => {
	const source = { ...input, sampleRate: 16_000, expectedWords: ['Hello', 'world'] };
	const result = { schemaVersion: 1, sampleRate: 16_000, words: source.expectedWords.map((text, wordIndex) =>
		({ segmentIndex: 0, wordIndex, text, startSample: wordIndex * 8_000, endSample: (wordIndex + 1) * 8_000, confidence: 0.8 })) };
	assert.equal(validateModelOutput('word-alignment', bytes(result), source).words, 2);
	assert.throws(() => validateModelOutput('word-alignment', bytes({ ...result, words: [] }), source));
	assert.throws(() => validateModelOutput('word-alignment', bytes(result), { ...source, frameCount: 100 }));
	assert.throws(() => validateModelOutput('word-alignment', bytes(result), { ...source, expectedWords: ['Different', 'words'] }));
});

test('audio tag smoke check rejects missing windows and collapsed probabilities', () => {
	const result = { schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000,
		windows: [0, 32_000].map((startSample) => ({ startSample, scores: { laughter: 0.1, applause: 0.2, cheering: 0.3 } })) };
	assert.equal(validateModelOutput('audio-tags', bytes(result), input).windows, 2);
	assert.throws(() => validateModelOutput('audio-tags', bytes({ ...result, windows: result.windows.slice(0, 1) }), input));
	assert.throws(() => validateModelOutput('audio-tags', bytes({ ...result, windows: result.windows.map((row) =>
		({ ...row, scores: { laughter: 0, applause: 0, cheering: 0 } })) }), input));
});

test('beat and shot smoke checks require predictions inside the input authority', () => {
	const beat = { schemaVersion: 1, sampleRate: 22_050, points: [{ sample: 100, kind: 'beat', confidence: 0.8 }], tempoProposal: null };
	assert.equal(validateModelOutput('beat-grid', bytes(beat), { ...input, sampleRate: 22_050 }).points, 1);
	assert.throws(() => validateModelOutput('beat-grid', bytes({ ...beat, points: [] }), input));
	assert.throws(() => validateModelOutput('beat-grid', bytes(beat), { ...input, frameCount: 99 }));
	const source = { ...input, frameCount: 2, authority: { timescale: 30,
		frames: [{ sourceFrame: 0, presentationTick: '0' }, { sourceFrame: 1, presentationTick: '1' }] } };
	const shots = { schemaVersion: 1, detector: 'transnetv2', timescale: 30, sourceFrameCount: 2,
		boundaries: [{ sourceFrame: 1, presentationTick: '1', score: 0.8 }] };
	assert.equal(validateModelOutput('shot-boundaries', bytes(shots), source).boundaries, 1);
	assert.throws(() => validateModelOutput('shot-boundaries', bytes({ ...shots, boundaries: [] }), source));
	assert.throws(() => validateModelOutput('shot-boundaries', bytes({ ...shots,
		boundaries: [{ ...shots.boundaries[0], presentationTick: '7' }] }), source));
});

test('editorial smoke check rejects empty text and unauthorized candidate identities', () => {
	const source = { ...input, candidateIds: ['restoration'] };
	const result = { schemaVersion: 1, candidates: [{ candidateId: 'restoration', title: 'Restoring the recording',
		hook: 'Hear the speech clearly', chapters: ['The original recording'], explanation: 'The speaker describes the restoration.' }] };
	assert.equal(validateModelOutput('editorial-proposal', bytes(result), source).candidates, 1);
	assert.throws(() => validateModelOutput('editorial-proposal', bytes({ ...result,
		candidates: [{ ...result.candidates[0], title: null, hook: null, explanation: null, chapters: [] }] }), source));
	assert.throws(() => validateModelOutput('editorial-proposal', bytes(result), { ...source, candidateIds: ['unknown'] }));
});

test('source separation checks all three stems and rejects duplicated or silent PCM', () => {
	const source = { bytes: encodeFloatWave(Float32Array.of(0.1, 0.2, 0.3), 44_100), sampleRate: 44_100, frameCount: 3 };
	const stems = [0.2, 0.3, 0.4].map((gain) => encodeFloatWave(Float32Array.of(gain, 0.1, -gain), 44_100));
	assert.equal(validateModelOutputs('separated-audio', stems, source).stems.length, 3);
	assert.throws(() => validateModelOutputs('separated-audio', stems.slice(0, 2), source));
	assert.throws(() => validateModelOutputs('separated-audio', [stems[0], stems[0], stems[2]], source));
	assert.throws(() => validateModelOutputs('separated-audio', [stems[0], stems[1], encodeFloatWave(new Float32Array(3), 44_100)], source));
});
