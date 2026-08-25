/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('desktop file service forwards only the three preload audio codec calls', async () => {
	const calls = [];
	const request = Object.freeze({
		operation: 'audio-decode', format: 'flac', input: Uint8Array.of(1, 2, 3),
		sampleRate: null, channelCount: null, settings: Object.freeze({ sampleFormat: 'f32le' }),
		maximumOutputBytes: 64, requestId: 'desktop-audio-request-1',
	});
	const result = Object.freeze({ status: 'main-result' });
	const query = Object.freeze({ schemaVersion: 2, operations: Object.freeze([]) });
	const capabilities = Object.freeze({ schemaVersion: 2, capabilities: Object.freeze([]) });
	const service = createAudioEditorFileService({
		bridge: {
			getDesktopAudioCodecCapabilities(value) { calls.push(['capabilities', value]); return Promise.resolve(capabilities); },
			runDesktopAudioCodecOperation(value) { calls.push(['execute', value]); return Promise.resolve(result); },
			cancelDesktopAudioCodecOperation(requestId) { calls.push(['cancel', requestId]); return Promise.resolve(true); },
		},
	});
	assert.equal(await service.getDesktopAudioCodecCapabilities(query), capabilities);
	assert.equal(await service.runDesktopAudioCodecOperation(request), result);
	assert.equal(await service.cancelDesktopAudioCodecOperation(request.requestId), true);
	assert.deepEqual(calls, [['capabilities', query], ['execute', request], ['cancel', request.requestId]]);
});

test('file service does not invent a browser codec fallback when the preload calls are absent', () => {
	const service = createAudioEditorFileService({ bridge: null });
	assert.equal(service.getDesktopAudioCodecCapabilities({}), null);
	assert.equal(service.runDesktopAudioCodecOperation({}), null);
	assert.equal(service.cancelDesktopAudioCodecOperation('desktop-audio-request-1'), null);
});
