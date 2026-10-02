/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { handleFreesoundPreviewRequest } from '../functions/api/freesound/_shared/handlers.ts';

const PREVIEW_BYTES = 256 * 1024 * 1024;
const SOUND = {
	id: 123, name: 'rain.ogg', tags: [], description: '', category: null, subcategory: null,
	created: '2026-04-16T20:07:11.145', license: 'http://creativecommons.org/publicdomain/zero/1.0/',
	gen_ai_preference: null, type: 'ogg', channels: 2, filesize: 4096, duration: 1, samplerate: 48000,
	username: 'recordist', md5: '0123456789abcdef0123456789abcdef', is_explicit: false,
	previews: { 'preview-hq-ogg': 'https://cdn.freesound.org/previews/1/123_4-hq.ogg' },
	num_downloads: 1, avg_rating: 4, num_ratings: 1,
};

test('preview proxy permits a client warning opt-in and keeps integer, typing, and default byte bounds', async () => {
	for (const [query, byteLength, type, status] of [
		['sizeWarning=client', PREVIEW_BYTES + 1, 'audio/ogg', 200],
		['', PREVIEW_BYTES + 1, 'audio/ogg', 502],
		['sizeWarning=client&sizeWarning=client', 2, 'audio/ogg', 400],
		['sizeWarning=other', 2, 'audio/ogg', 400],
		['sizeWarning=client&url=https://evil.example', 2, 'audio/ogg', 400],
		['unknown=1', 2, 'audio/ogg', 400],
		['sizeWarning=client', Number.MAX_SAFE_INTEGER + 1, 'audio/ogg', 502],
		['sizeWarning=client', PREVIEW_BYTES + 1, 'text/html', 502],
	] as const) {
		let calls = 0;
		const response = await handleFreesoundPreviewRequest({
			request: new Request(`https://soundscaper.org/api/freesound/sounds/123/preview?${query}`),
			params: { id: '123' }, env: { FREESOUND_API_KEY: 'server-secret-api-key' },
		}, { fetchImpl: async (input) => {
			calls++;
			assert.equal(new URL(String(input)).searchParams.has('sizeWarning'), false);
			return calls === 1 ? Response.json(SOUND) : new Response(Uint8Array.of(1, 2), {
				headers: { 'Content-Type': type, 'Content-Length': String(byteLength) },
			});
		} });
		assert.equal(response.status, status);
		if (status === 400) assert.equal(calls, 0);
		if (status === 200) assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.of(1, 2));
	}
});
