/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('desktop file service forwards only the two preload audio codec calls', async () => {
	const calls = [];
	const request = Object.freeze({
		operation: 'audio-decode', format: 'flac', input: Uint8Array.of(1, 2, 3),
		sampleRate: 48_000, channelCount: 2, settings: Object.freeze({ sampleFormat: 'f32le' }),
		maximumOutputBytes: 64, requestId: 'desktop-audio-request-1',
	});
	const result = Object.freeze({ status: 'main-result' });
	const service = createAudioEditorFileService({
		bridge: {
			runDesktopAudioCodecOperation(value) { calls.push(['execute', value]); return Promise.resolve(result); },
			cancelDesktopAudioCodecOperation(requestId) { calls.push(['cancel', requestId]); return Promise.resolve(true); },
		},
	});
	assert.equal(await service.runDesktopAudioCodecOperation(request), result);
	assert.equal(await service.cancelDesktopAudioCodecOperation(request.requestId), true);
	assert.deepEqual(calls, [['execute', request], ['cancel', request.requestId]]);
});

test('file service does not invent a browser codec fallback when the preload calls are absent', () => {
	const service = createAudioEditorFileService({ bridge: null });
	assert.equal(service.runDesktopAudioCodecOperation({}), null);
	assert.equal(service.cancelDesktopAudioCodecOperation('desktop-audio-request-1'), null);
});
