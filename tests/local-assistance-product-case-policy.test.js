/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import manifest from '../config/local-model-real-test-cases.json' with { type: 'json' };
import {
	localAssistanceCaseRunsInProduct,
} from './electron/local-assistance-models/product-case-policy.js';

const SOUNDSCAPER_CASES = Object.freeze([
	'beat-this-final-beats',
	'beat-this-small-beats',
	'deepfilter-enhancement',
	'dereverb-room-speech',
	'nomic-text-embedding',
	'panns-audio-tags',
	'parakeet-v2-transcript',
	'parakeet-v3-transcript',
	'silero-voice-activity',
	'speaker-diarization',
	'tiger-dialogue-music-effects',
	'wav2vec2-word-alignment',
	'whisper-turbo-transcript',
]);

test('real-model product policy keeps Framescaper complete and Soundscaper audio/text-only', () => {
	const cases = manifest.cases ?? manifest;
	assert.deepEqual(cases.filter((modelCase) => localAssistanceCaseRunsInProduct(
		'framescaper', modelCase.operation,
	)).map(({ id }) => id).sort(), cases.map(({ id }) => id).sort());
	assert.deepEqual(cases.filter((modelCase) => localAssistanceCaseRunsInProduct(
		'soundscaper', modelCase.operation,
	)).map(({ id }) => id).sort(), SOUNDSCAPER_CASES);
	assert.throws(() => localAssistanceCaseRunsInProduct('launcher', 'speech-recognition'), /product/iu);
	assert.equal(localAssistanceCaseRunsInProduct('soundscaper', 'optical-character-recognition'), false);
});
