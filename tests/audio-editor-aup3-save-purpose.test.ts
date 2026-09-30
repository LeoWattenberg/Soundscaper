/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSaveChoice } from '../desktop/validation.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('the AUP3 save purpose has a dedicated desktop extension and filter', () => {
	assert.deepEqual(validateSaveChoice({
		purpose: 'aup3',
		suggestedName: 'Session',
	}), {
		purpose: 'aup3',
		suggestedName: 'Session.aup3',
		filters: [{ name: 'Audacity 3 project', extensions: ['aup3'] }],
	});
});

test('the shared file service admits AUP3 save targets', async () => {
	const requests: unknown[] = [];
	const service = createAudioEditorFileService({
		bridge: {
			chooseSaveTarget: (request: unknown) => {
				requests.push(request);
				return null;
			},
		},
		scope: {},
	});

	assert.equal(await service.chooseSaveTarget({
		purpose: 'aup3',
		suggestedName: 'Session.aup3',
		mimeType: 'application/x-audacity-project',
	}), null);
	assert.deepEqual(requests, [{
		purpose: 'aup3',
		suggestedName: 'Session.aup3',
		mimeType: 'application/x-audacity-project',
	}]);
});
