/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('desktop file service exposes only the bounded external FFmpeg preference actions', async () => {
	const calls = [];
	const statuses = ['status', 'choose', 'clear', 'rescan', 'install'].map((action) => ({ action }));
	const bridge = Object.fromEntries([
		['getExternalFfmpegStatus', 'status'],
		['chooseExternalFfmpeg', 'choose'],
		['clearExternalFfmpeg', 'clear'],
		['rescanExternalFfmpeg', 'rescan'],
		['installExternalFfmpeg', 'install'],
	].map(([method], index) => [method, async (...args) => {
		calls.push([method, args]);
		return statuses[index];
	}]));
	const service = createAudioEditorFileService({ bridge });

	assert.deepEqual(await service.getExternalFfmpegStatus(), statuses[0]);
	assert.deepEqual(await service.chooseExternalFfmpeg(), statuses[1]);
	assert.deepEqual(await service.clearExternalFfmpeg(), statuses[2]);
	assert.deepEqual(await service.rescanExternalFfmpeg(), statuses[3]);
	assert.deepEqual(await service.installExternalFfmpeg(), statuses[4]);
	assert.deepEqual(calls, [
		['getExternalFfmpegStatus', []], ['chooseExternalFfmpeg', []],
		['clearExternalFfmpeg', []], ['rescanExternalFfmpeg', []],
		['installExternalFfmpeg', []],
	]);

	const browser = createAudioEditorFileService({ bridge: null, document: null });
	assert.equal(browser.getExternalFfmpegStatus(), null);
	assert.equal(browser.installExternalFfmpeg(), null);
});
