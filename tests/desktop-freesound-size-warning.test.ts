/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopFreesoundProxy } from '../desktop/freesound-integration.js';

test('desktop original downloads forward only the exact client size-warning query', async () => {
	const urls: unknown[] = [];
	const proxy = createDesktopFreesoundProxy({
		appOrigin: 'soundscaper-app://bundle', apiOrigin: 'https://soundscaper.org',
		sessionStore: { get: () => 'a'.repeat(43), clear: async () => undefined },
		fetchImpl: async (url: unknown) => { urls.push(url); return new Response(null, { status: 204 }); },
	});
	for (const [path, status] of [
		['sounds/42/original?sizeWarning=client', 204],
		['sounds/42/original?sizeWarning=client&sizeWarning=client', 400],
		['sounds/42/original?sizeWarning=client&url=https://evil.example', 400],
		['sounds/42/original?sizeWarning=other', 400],
		['oauth/session?sizeWarning=client', 400],
	] as const) {
		const response = await proxy(new Request(`soundscaper-app://bundle/_desktop/freesound/api/freesound/${path}`));
		assert.equal(response.status, status);
	}
	assert.deepEqual(urls, ['https://soundscaper.org/api/freesound/sounds/42/original?sizeWarning=client']);
});
