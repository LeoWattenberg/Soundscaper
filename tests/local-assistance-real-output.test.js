/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateModelOutput } from './electron/local-assistance-models/model-output-validation.js';
import { digest, encodeFloatWave, loadSpeechFixture, prepareModelInput } from './electron/local-assistance-models/model-inputs.js';
import { createAssistanceEmbeddingMatrixV1 } from '../src/common/editor/assistance/binary-formats-v1.ts';
import { ASSISTANCE_VISUAL_TAG_PROMPTS_V1 } from '../src/common/editor/assistance/visual-tag-classification-v1.ts';
import { reviewAssistanceVisualFramePackV2 } from '../src/common/editor/assistance/visual-frame-pack-v2.ts';

const json = (value) => Buffer.from(JSON.stringify(value));
const speech = { bytes: Buffer.from('input'), sampleRate: 16_000, frameCount: 160_000 };

test('real audio validation rejects silence, unchanged PCM, invalid numbers and lost frames', () => {
	const input = { bytes: encodeFloatWave(new Float32Array([0.2, -0.3, 0.5]), 48_000), sampleRate: 48_000, frameCount: 3 };
	for (const samples of [[0, 0, 0], [1e-12, -1e-12, 1e-12], [0.2, -0.3, 0.5], [NaN, 0.1, 0.2], [0.2, 0.3]]) {
		assert.throws(() => validateModelOutput('changed-audio', encodeFloatWave(new Float32Array(samples), 48_000), input));
	}
	const headerOnlyChange = Buffer.concat([input.bytes, Buffer.from('JUNK'), Buffer.alloc(4)]);
	headerOnlyChange.writeUInt32LE(headerOnlyChange.length - 8, 4);
	assert.throws(() => validateModelOutput('changed-audio', headerOnlyChange, input), /PCM samples identical/u);
	const result = validateModelOutput('changed-audio', encodeFloatWave(new Float32Array([0.1, -0.2, 0.3]), 48_000), input);
	assert.ok(result.rms > 0);
	assert.ok(result.changedSamples > 0);
});

test('real speech checks accept varying words but reject empty or out-of-range results', () => {
	assert.equal(validateModelOutput('transcript', json({ segments: [{ text: 'some real words', startSeconds: 1, endSeconds: 4 }] }), speech).segments, 1);
	assert.throws(() => validateModelOutput('transcript', json({ segments: [] }), speech));
	assert.throws(() => validateModelOutput('transcript', json({ segments: [{ text: ' ', startSeconds: 0, endSeconds: 1 }] }), speech));
	assert.throws(() => validateModelOutput('voice-activity', json({ sampleRate: 16_000, segments: [{ startSample: 159_000, sampleCount: 2_000 }] }), speech));
	assert.equal(validateModelOutput('speaker-turns', json({ sampleRate: 16_000, turns: [{ speakerId: 0, startSample: 0, sampleCount: 16_000 }] }), speech).turns, 1);
});

test('visual checks reject empty detections and stale frame authority', () => {
	const authority = { width: 512, height: 512, timescale: 30, frames: [{ sourceFrame: 0, presentationTick: '0' }] };
	const input = { ...speech, authority };
	const result = { schemaVersion: 1, ...authority, frames: [{ ...authority.frames[0], saliency: { x: 0.4, y: 0.6, score: 0.8 } }] };
	assert.equal(validateModelOutput('saliency', json(result), input).frames, 1);
	assert.throws(() => validateModelOutput('saliency', json({ ...result, frames: [{ ...result.frames[0], saliency: null }] }), input));
	assert.throws(() => validateModelOutput('saliency', json({ ...result, timescale: 60 }), input));
	assert.throws(() => validateModelOutput('ocr', json({ ...result, frames: [{ ...authority.frames[0], regions: [] }] }), input));
	const box = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
	const face = { kind: 'face', label: 'face', classId: null, confidence: 0.9, box };
	const person = { kind: 'person', label: 'person', classId: 0, confidence: 0.9, box };
	const subjects = (rows) => json({ ...result, frames: [{ ...authority.frames[0], subjects: rows }] });
	assert.throws(() => validateModelOutput('subject-detections', subjects([face]), input));
	assert.equal(validateModelOutput('subject-detections', subjects([face, person]), input).subjects, 2);
});

test('embedding checks require a complete nonconstant 768-dimensional vector', () => {
	const vector = new Float32Array(768);
	vector[0] = 1;
	assert.equal(validateModelOutput('embeddings', createAssistanceEmbeddingMatrixV1({ dimensions: 768, vectors: [vector] }), speech).rows, 1);
	assert.throws(() => validateModelOutput('embeddings', createAssistanceEmbeddingMatrixV1({ dimensions: 768, vectors: [] }), speech));
	assert.throws(() => validateModelOutput('embeddings', createAssistanceEmbeddingMatrixV1({ dimensions: 768, vectors: [new Float32Array(768).fill(1 / Math.sqrt(768))] }), speech));
	const frames = { ...speech, role: 'frame-pack', frameCount: 1 };
	assert.throws(() => validateModelOutput('embeddings', createAssistanceEmbeddingMatrixV1({ dimensions: 768, vectors: [vector] }), frames), /tag-prototype/u);
	const expectedRows = 1 + ASSISTANCE_VISUAL_TAG_PROMPTS_V1.length;
	assert.equal(validateModelOutput('embeddings', createAssistanceEmbeddingMatrixV1({ dimensions: 768,
		vectors: Array.from({ length: expectedRows }, () => vector) }), frames).rows, expectedRows);
});

test('licensed speech fixtures are authenticated, voiced and prepared at exact runtime rates', async () => {
	const speechInput = await loadSpeechFixture(false);
	const noisyInput = await loadSpeechFixture(true);
	assert.equal(speechInput.sampleRate, 16_000);
	assert.equal(noisyInput.sampleRate, 48_000);
	assert.equal(noisyInput.frameCount, speechInput.frameCount * 3);
	assert.ok(speechInput.frameCount > 160_000);
	assert.deepEqual((await loadSpeechFixture(true)).bytes, noisyInput.bytes);
});

test('subject fixtures retain two authenticated photographs and distinct frame timing', async () => {
	// Normal-suite check of fixture custody; actual image decoding and inference run in Electron.
	const rasters = [new Uint8Array(512 * 512 * 4).fill(64), new Uint8Array(512 * 512 * 4).fill(192)];
	const input = await prepareModelInput('visual-subject-frames', { async evaluate(_render, photos) {
		assert.deepEqual(photos.map((photo) => digest(Buffer.from(photo, 'base64'))), [
			'88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5',
			'596aa1e7cb875eb79f437e310381d26b338a81c2da23439704a73c4651e8c4bb',
		]);
		return rasters;
	} });
	const reviewed = reviewAssistanceVisualFramePackV2(input.bytes);
	assert.equal(input.frameCount, 2);
	assert.equal(reviewed.frameCount, 2);
	assert.deepEqual(input.authority.frames, [{ sourceFrame: 0, presentationTick: '0' }, { sourceFrame: 1, presentationTick: '1' }]);
	for (let ordinal = 0; ordinal < 2; ordinal += 1) {
		assert.deepEqual(reviewed.frameTiming(ordinal), input.authority.frames[ordinal]);
		assert.deepEqual(reviewed.frame(ordinal).rgba, rasters[ordinal]);
	}
});
