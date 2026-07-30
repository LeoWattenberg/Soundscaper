import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSaveChoice } from '../desktop/validation.js';

test('native PCM mix save selection is a dedicated WAV-only purpose', () => {
	assert.deepEqual(validateSaveChoice({
		purpose: 'audio-pcm-mix',
		suggestedName: 'final-mix',
	}), {
		purpose: 'audio-pcm-mix',
		suggestedName: 'final-mix.wav',
		filters: [{ name: 'WAV audio mix', extensions: ['wav'] }],
	});
	assert.equal(
		validateSaveChoice({ purpose: 'audio-pcm-mix', suggestedName: '' }).suggestedName,
		'untitled.wav',
	);
	assert.throws(
		() => validateSaveChoice({ purpose: 'audio-pcm', suggestedName: 'final-mix' }),
		/unsupported save purpose/iu,
	);
});
