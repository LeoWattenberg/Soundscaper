/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { handleFreesoundPreviewRequest } from '../functions/api/freesound/_shared/handlers.ts';
import { handleFreesoundOriginalRequest } from '../functions/api/freesound/_shared/protected-handlers.ts';

test('public and authenticated Freesound HEAD failures return no response body', async () => {
	const publicRequest = new Request('https://soundscaper.org/api/freesound/sounds/invalid/preview', {
		method: 'HEAD',
	});
	const publicResponse = await handleFreesoundPreviewRequest({
		request: publicRequest,
		env: { FREESOUND_API_KEY: 'server-secret-api-key' },
		params: { id: 'invalid' },
	});
	assert.equal(publicResponse.status, 400);
	assert.equal(publicResponse.body, null);

	const protectedRequest = new Request('https://soundscaper.org/api/freesound/sounds/invalid/original', {
		method: 'HEAD',
	});
	const protectedResponse = await handleFreesoundOriginalRequest({
		request: protectedRequest,
		env: {},
		params: { id: 'invalid' },
	});
	assert.equal(protectedResponse.status, 400);
	assert.equal(protectedResponse.body, null);
});
