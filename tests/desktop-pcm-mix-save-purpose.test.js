import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSaveChoice } from '../desktop/validation.js';

test('native PCM mix save selection is a dedicated WAV and AIFF purpose', () => {
	assert.deepEqual(validateSaveChoice({
		purpose: 'audio-pcm-mix',
		suggestedName: 'final-mix',
	}), {
		purpose: 'audio-pcm-mix',
		suggestedName: 'final-mix.wav',
		filters: [{ name: 'WAV and AIFF audio mix', extensions: ['wav', 'aif', 'aiff'] }],
	});
	assert.equal(
		validateSaveChoice({ purpose: 'audio-pcm-mix', suggestedName: 'final-mix.aiff' }).suggestedName,
		'final-mix.aiff',
	);
	assert.equal(
		validateSaveChoice({ purpose: 'audio-pcm-mix', suggestedName: '' }).suggestedName,
		'untitled.wav',
	);
	assert.throws(
		() => validateSaveChoice({ purpose: 'audio-pcm', suggestedName: 'final-mix' }),
		/unsupported save purpose/iu,
	);
});
