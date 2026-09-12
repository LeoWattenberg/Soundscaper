/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareModelInput } from './electron/local-assistance-models/model-inputs.js';
import { reviewAssistanceFloat32MonoWaveV1 } from '../src/common/editor/assistance/float32-mono-wave-v1.ts';
import { reviewAssistanceEditorialGenerationPlanV1 } from '../src/common/editor/assistance/editorial-generation-v1.ts';

test('alignment fixture carries real speech and the exact accompanying English words', async () => {
	const input = await prepareModelInput('aligned-speech-16khz');
	assert.equal(input.sampleRate, 16_000);
	assert.equal(input.additionalInputs.length, 1);
	assert.equal(input.additionalInputs[0].role, 'transcript');
	const transcript = JSON.parse(input.additionalInputs[0].bytes.toString('utf8'));
	assert.equal(transcript.language, 'en');
	assert.deepEqual(transcript.segments.flatMap(({ text }) => text.split(' ')), input.expectedWords);
	assert.ok(input.expectedWords.length > 10);
	assert.ok(transcript.segments[0].endSeconds <= input.frameCount / input.sampleRate);
});

test('additional audio fixtures match the real adapters and contain finite audible samples', async () => {
	for (const [fixtureId, rate] of [['mixed-speech-44100hz', 44_100],
		['reverberant-speech-44100hz', 44_100], ['speech-tags-32khz', 32_000], ['rhythmic-music-22050hz', 22_050]]) {
		const input = await prepareModelInput(fixtureId);
		const wave = reviewAssistanceFloat32MonoWaveV1(input.bytes, rate);
		assert.equal(input.frameCount, wave.samples.length);
		assert.ok(wave.samples.length >= rate * 4);
		assert.ok(wave.samples.some((sample) => Math.abs(sample) > 0.01));
	}
});

test('editorial fixture binds generated text to known candidates without granting timing changes', async () => {
	const input = await prepareModelInput('editorial-candidates');
	assert.equal(input.role, 'editorial-context');
	const plan = reviewAssistanceEditorialGenerationPlanV1(JSON.parse(input.bytes.toString('utf8')));
	assert.deepEqual(plan.authorizedCandidateIds, input.candidateIds);
	assert.equal(plan.authorizedCandidateIds.length, 2);
	assert.ok(plan.evidence.every((entry) => entry.transcriptExcerpt || entry.visualSummary));
});
