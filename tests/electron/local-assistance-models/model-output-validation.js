/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { reviewAssistanceEmbeddingMatrixV1 } from '../../../src/common/editor/assistance/binary-formats-v1.ts';
import { reviewAssistanceFloat32MonoWaveV1 } from '../../../src/common/editor/assistance/float32-mono-wave-v1.ts';
import { ASSISTANCE_VISUAL_TAG_PROMPTS_V1 } from '../../../src/common/editor/assistance/visual-tag-classification-v1.ts';
import { reviewAssistanceOcrResultV1, reviewAssistanceSaliencyResultV1, reviewAssistanceSubjectResultV1 } from '../../../src/common/editor/assistance/visual-semantic-results-v1.ts';
import { reviewAssistanceWordAlignmentV1, reviewAssistanceAudioTagsV1, reviewAssistanceBeatGridV1,
	reviewAssistanceEditorialProposalV1 } from '../../../src/common/editor/assistance/m7-semantic-results.ts';
import { reviewAssistanceShotBoundariesV1 } from '../../../src/common/editor/assistance/shot-boundaries-v1.ts';

export function validateModelOutputs(validation, outputs, input) {
	if (validation !== 'separated-audio') {
		assert.equal(outputs.length, 1, 'Expected one model output.');
		return validateModelOutput(validation, outputs[0], input);
	}
	assert.equal(outputs.length, 3, 'Expected dialogue, music, and effects stems.');
	const stems = outputs.map((output) => validateModelOutput('changed-audio', output, input));
	const samples = outputs.map((output) => reviewAssistanceFloat32MonoWaveV1(output, input.sampleRate).samples);
	for (let index = 0; index < samples.length; index += 1) {
		for (let other = 0; other < index; other += 1) {
			assert.notDeepEqual(samples[index], samples[other], 'Separation returned duplicated stems.');
		}
	}
	return { stems };
}

/** Smoke checks for real inference, deliberately independent of exact model predictions. */
export function validateModelOutput(validation, bytes, input) {
	assert.ok(bytes.byteLength > 0, 'Inference returned empty output.');
	assert.notDeepEqual(Buffer.from(bytes), Buffer.from(input.bytes), 'Inference copied the input bytes.');
	if (validation === 'changed-audio') return changedAudio(bytes, input);
	if (validation === 'embeddings') {
		const matrix = reviewAssistanceEmbeddingMatrixV1(bytes);
		const expectedRows = input.role === 'frame-pack' ? input.frameCount + ASSISTANCE_VISUAL_TAG_PROMPTS_V1.length : 1;
		assert.equal(matrix.rowCount, expectedRows, 'Missing image, text, or tag-prototype embedding rows.');
		assert.equal(matrix.dimensions, 768);
		for (let index = 0; index < matrix.rowCount; index += 1) {
			const row = matrix.vector(index);
			assert.ok(row.some((value) => value !== row[0]), 'Constant embedding vector.');
		}
		return { rows: matrix.rowCount, dimensions: matrix.dimensions };
	}
	const value = JSON.parse(Buffer.from(bytes).toString('utf8'));
	if (validation === 'word-alignment') {
		const result = reviewAssistanceWordAlignmentV1(value);
		assert.deepEqual(result.words.map(({ text }) => text), input.expectedWords, 'Alignment changed or omitted transcript words.');
		assert.ok(result.words.length > 0);
		assert.equal(result.sampleRate, input.sampleRate);
		assert.ok(result.words.every(({ endSample }) => endSample <= input.frameCount), 'Alignment exceeds the source.');
		return { words: result.words.length };
	}
	if (validation === 'audio-tags') {
		const result = reviewAssistanceAudioTagsV1(value);
		assert.equal(result.sampleRate, input.sampleRate);
		assert.equal(result.windows.length, Math.ceil(input.frameCount / result.windowSamples), 'Missing audio-tag windows.');
		for (const [index, window] of result.windows.entries()) assert.equal(window.startSample, index * result.windowSamples);
		const scores = result.windows.flatMap(({ scores }) => Object.values(scores));
		assert.ok(scores.some((score) => score > 0), 'Audio tagging returned only zero probabilities.');
		assert.ok(scores.some((score) => score !== scores[0]), 'Audio tagging returned constant probabilities.');
		return { windows: result.windows.length };
	}
	if (validation === 'beat-grid') {
		const result = reviewAssistanceBeatGridV1(value);
		assert.equal(result.sampleRate, input.sampleRate);
		assert.ok(result.points.length > 0, 'No beats detected in the rhythmic fixture.');
		assert.ok(result.points.every(({ sample }) => sample < input.frameCount), 'Beat lies outside the source.');
		return { points: result.points.length, tempoProposal: result.tempoProposal };
	}
	if (validation === 'shot-boundaries') {
		const result = reviewAssistanceShotBoundariesV1(value);
		assert.equal(result.detector, 'transnetv2');
		assert.equal(result.timescale, input.authority.timescale);
		assert.equal(result.sourceFrameCount, input.frameCount);
		assert.ok(result.boundaries.length > 0, 'No boundary detected in the shot-change fixture.');
		for (const boundary of result.boundaries) {
			assert.equal(boundary.presentationTick, input.authority.frames.find(({ sourceFrame }) =>
				sourceFrame === boundary.sourceFrame)?.presentationTick, 'Shot lost its source-frame timing.');
		}
		return { boundaries: result.boundaries.length };
	}
	if (validation === 'editorial-proposal') {
		const result = reviewAssistanceEditorialProposalV1(value, input.candidateIds);
		for (const candidate of result.candidates) {
			for (const field of ['title', 'hook', 'explanation']) {
				assert.ok(typeof candidate[field] === 'string' && /[\p{L}\p{N}]/u.test(candidate[field]), `No readable editorial ${field}.`);
			}
		}
		return { candidates: result.candidates.length };
	}
	if (validation === 'transcript') {
		assert.ok(value.segments?.length > 0, 'No speech recognized.');
		for (const segment of value.segments) {
			assert.ok(typeof segment.text === 'string' && /[\p{L}\p{N}]/u.test(segment.text), 'No readable transcript text.');
			assert.ok(Number.isFinite(segment.startSeconds) && Number.isFinite(segment.endSeconds));
			assert.ok(segment.startSeconds >= 0 && segment.endSeconds > segment.startSeconds);
			assert.ok(segment.endSeconds <= input.frameCount / input.sampleRate + 0.1, 'Transcript exceeds the source duration.');
		}
		return { segments: value.segments.length, characters: value.segments.reduce((sum, row) => sum + row.text.length, 0) };
	}
	if (validation === 'voice-activity' || validation === 'speaker-turns') {
		assert.equal(value.sampleRate, input.sampleRate);
		const rows = validation === 'voice-activity' ? value.segments : value.turns;
		assert.ok(rows?.length > 0, 'No speech regions returned.');
		let previousStart = -1;
		for (const row of rows) {
			assert.ok(Number.isSafeInteger(row.startSample) && row.startSample >= 0);
			assert.ok(row.startSample >= previousStart, 'Speech regions are out of order.');
			previousStart = row.startSample;
			assert.ok(Number.isSafeInteger(row.sampleCount) && row.sampleCount > 0);
			assert.ok(row.startSample + row.sampleCount <= input.frameCount, 'Speech region exceeds the source.');
			if (validation === 'speaker-turns') assert.ok((typeof row.speakerId === 'string' && row.speakerId.length > 0)
				|| (Number.isSafeInteger(row.speakerId) && row.speakerId >= 0), 'Missing speaker assignment.');
		}
		return { [validation === 'voice-activity' ? 'regions' : 'turns']: rows.length };
	}
	if (validation === 'subject-detections') {
		const result = reviewAssistanceSubjectResultV1(value, input.authority);
		const subjects = result.frames.flatMap((frame) => frame.subjects);
		assert.ok(subjects.some((subject) => subject.kind === 'face'), 'YuNet did not find a face.');
		assert.ok(subjects.some((subject) => subject.kind !== 'face'), 'D-FINE did not find an object.');
		return { frames: result.frames.length, subjects: subjects.length };
	}
	if (validation === 'saliency') {
		const result = reviewAssistanceSaliencyResultV1(value, input.authority);
		assert.ok(result.frames.some((frame) => frame.saliency && frame.saliency.score > 0), 'No salient region.');
		return { frames: result.frames.length };
	}
	if (validation === 'ocr') {
		const result = reviewAssistanceOcrResultV1(value, input.authority);
		const regions = result.frames.flatMap((frame) => frame.regions);
		assert.ok(regions.some((region) => /[\p{L}\p{N}]/u.test(region.text)), 'No readable text detected.');
		return { frames: result.frames.length, regions: regions.length };
	}
	throw new Error(`Unknown real-model validation: ${validation}`);
}

function changedAudio(bytes, input) {
	const original = reviewAssistanceFloat32MonoWaveV1(input.bytes, input.sampleRate);
	const output = reviewAssistanceFloat32MonoWaveV1(bytes, input.sampleRate);
	assert.equal(output.samples.length, original.samples.length, 'Processing lost audio frames.');
	let energy = 0;
	let changedSamples = 0;
	for (const [index, sample] of output.samples.entries()) {
		energy += sample * sample;
		if (sample !== original.samples[index]) changedSamples += 1;
	}
	const rms = Math.sqrt(energy / output.samples.length);
	assert.ok(rms > 1e-6, 'Processed audio is silent (RMS below -120 dBFS).');
	assert.ok(changedSamples > 0, 'Processing left the PCM samples identical.');
	return { frames: output.samples.length, sampleRate: output.sampleRate, rms, changedSamples };
}
