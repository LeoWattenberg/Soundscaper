/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assistanceOperationConsentOptions } from '../desktop/assistance-operation-consent.ts';

test('source-free speech requests produce a native consent prompt without a timeline selection', () => {
	const options = assistanceOperationConsentOptions({
		operation: 'text-to-speech', selectionFence: null,
		models: [{ modelId: 'kokoro-82m-v1.0', version: '1.0.0' }],
	});
	assert.equal(options.message, 'Generate speech from this text locally?');
	assert.equal(options.detail, 'Operation: text-to-speech\nInput: typed text\nModel: kokoro-82m-v1.0 1.0.0');
	assert.deepEqual(options.buttons, ['Run locally', 'Cancel']);
});

test('media operations retain their exact selection in the native consent prompt', () => {
	const options = assistanceOperationConsentOptions({
		operation: 'speech-recognition',
		selectionFence: { sourceStartFrame: 10, sourceEndFrame: 20,
			occurrenceIds: ['clip-1', 'clip-2'] },
		models: [{ modelId: 'whisper-large-v3-turbo-ggml', version: '1.0.0' }],
	});
	assert.equal(options.message, 'Process this exact media selection locally?');
	assert.match(options.detail, /Selected range: 10–20 frames\nTimeline items: 2/u);
});
