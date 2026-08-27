/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveLocalAssistanceGuidedReviewAuthority } from
	'../src/common/editor/controller/local-assistance-guided-review-authority.ts';
import { encodeWav } from '../src/common/editor/wav.js';

function speechWave(value: number): Blob {
	const bytes = encodeWav([Float32Array.of(value, 0, -value)], {
		sampleRate: 16_000, bitDepth: 32, float: true, dither: false,
	});
	return new Blob([bytes.slice().buffer], { type: 'audio/wav' });
}

test('cleanup review accepts byte-identical adapter inputs and binds the VAD claim', async () => {
	const first = speechWave(0.25);
	const second = speechWave(0.25);
	assert.notEqual(first, second);
	const authority = await deriveLocalAssistanceGuidedReviewAuthority('clean-filler-silence', [
		{ stageId: 'recognize-speech', slotId: 'audio', mediaType: 'audio/wav', bytes: first },
		{ stageId: 'detect-speech', slotId: 'audio', mediaType: 'audio/wav', bytes: second },
	]);
	assert.equal(authority.media.audio?.stageId, 'detect-speech');
	assert.equal(authority.media.audio?.slotId, 'audio');
	assert.equal(authority.media.audio?.byteLength, second.size);
	assert.match(authority.media.audio?.sha256 ?? '', /^[a-f\d]{64}$/u);
});

test('cleanup review refuses adapter inputs with ambiguous byte custody', async () => {
	await assert.rejects(deriveLocalAssistanceGuidedReviewAuthority('clean-filler-silence', [
		{ stageId: 'detect-speech', slotId: 'audio', mediaType: 'audio/wav', bytes: speechWave(0.25) },
		{ stageId: 'recognize-speech', slotId: 'audio', mediaType: 'audio/wav', bytes: speechWave(0.5) },
	]), /ambiguous/iu);
});
