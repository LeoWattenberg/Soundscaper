/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('file service forwards SESX session operations through the desktop bridge', async () => {
	const calls = [];
	const service = createAudioEditorFileService({ bridge: {
		resolveSesxMedia: async (request) => { calls.push(['resolve', request]); return { status: 'missing' }; },
		chooseSesxMediaFolder: async (request) => { calls.push(['choose', request]); return { status: 'cancelled' }; },
		releaseSesxSession: async (id) => { calls.push(['release', id]); return true; },
	} });
	const request = { sessionReadId: 'session', relativePath: 'Audio/take.wav' };
	assert.deepEqual(await service.resolveSesxMedia(request), { status: 'missing' });
	assert.deepEqual(await service.chooseSesxMediaFolder({ sessionReadId: 'session' }), { status: 'cancelled' });
	assert.equal(await service.releaseSesxSession('session'), true);
	assert.deepEqual(calls, [
		['resolve', request], ['choose', { sessionReadId: 'session' }], ['release', 'session'],
	]);
});

test('browser file service leaves SESX media lookup unavailable', async () => {
	const service = createAudioEditorFileService({ bridge: null });
	assert.deepEqual(await service.resolveSesxMedia({ sessionReadId: 'session', relativePath: 'take.wav' }), { status: 'missing' });
	assert.deepEqual(await service.chooseSesxMediaFolder({ sessionReadId: 'session' }), { status: 'cancelled' });
	assert.equal(await service.releaseSesxSession('session'), false);
});
