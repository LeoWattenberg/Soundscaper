/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSaveChoice } from '../desktop/validation.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('the attribution CSV save purpose has a dedicated desktop filter', () => {
	assert.deepEqual(validateSaveChoice({
		purpose: 'attribution-csv',
		suggestedName: 'Field recording credits',
	}), {
		purpose: 'attribution-csv',
		suggestedName: 'Field recording credits.csv',
		filters: [{ name: 'Attribution list', extensions: ['csv'] }],
	});
});

test('the shared file service admits attribution CSV saves', async () => {
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
		purpose: 'attribution-csv',
		suggestedName: 'credits.csv',
		mimeType: 'text/csv;charset=utf-8',
	}), null);
	assert.deepEqual(requests, [{
		purpose: 'attribution-csv',
		suggestedName: 'credits.csv',
		mimeType: 'text/csv;charset=utf-8',
	}]);
});
