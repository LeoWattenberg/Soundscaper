/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { handleFreesoundSearchRequest } from '../functions/api/freesound/_shared/handlers.ts';

test('commercial use search includes CC0 and attribution but excludes noncommercial', async () => {
	let upstreamFilter = '';
	const response = await handleFreesoundSearchRequest({
		request: new Request('https://soundscaper.org/api/freesound/search?q=rain&license=commercial'),
		env: { FREESOUND_API_KEY: 'test-key' },
		params: {},
	}, { fetchImpl: async (input) => {
		upstreamFilter = new URL(String(input)).searchParams.get('filter') ?? '';
		return Response.json({ count: 0, results: [] });
	} });
	assert.equal(response.status, 200);
	assert.equal(upstreamFilter, 'license:("Creative Commons 0" OR Attribution)');
});
