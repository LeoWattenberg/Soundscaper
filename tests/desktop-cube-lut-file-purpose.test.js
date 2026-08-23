/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { acceptsFile, validateFileChoice } from '../desktop/validation.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('desktop exposes one cube-only LUT file-open purpose', () => {
	assert.equal(acceptsFile('lut', '/tmp/managed-look.CUBE'), true);
	assert.equal(acceptsFile('lut', '/tmp/managed-look.txt'), false);
	assert.deepEqual(validateFileChoice({ purpose: 'lut', multiple: false }), {
		purpose: 'lut',
		multiple: false,
		filters: [{ name: 'Cube LUT', extensions: ['cube'] }],
		extensions: ['cube'],
	});
});

test('renderer file service forwards the cube-only purpose to its desktop bridge', async () => {
	const requests = [];
	const service = createAudioEditorFileService({ bridge: {
		chooseFiles: async (request) => { requests.push(request); return []; },
	} });
	assert.deepEqual(await service.chooseFiles({ purpose: 'lut', multiple: false }), []);
	assert.deepEqual(requests, [{ purpose: 'lut' }]);
});
