/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProtocolHandler } from '../desktop/protocol.js';

test('desktop audio.com API dispatch is Soundscaper-only and reaches its trusted main proxy', async () => {
	const received: string[] = [];
	const options = { rendererRoot: '/unused', runtimeRoot: '/unused', readCapabilities: {},
		audiocomProxy: async (request: Request): Promise<Response> => {
			received.push(request.url);
			return Response.json({ data: { connected: true } });
		},
	};
	const request = new Request('soundscaper-app://bundle/_desktop/audiocom/api/audiocom/oauth/session');
	const handler = createProtocolHandler({ ...options, productId: 'soundscaper' });
	assert.deepEqual(await (await handler(request)).json(), { data: { connected: true } });
	assert.deepEqual(received, [request.url]);
	const framescaper = createProtocolHandler({ ...options, productId: 'framescaper' });
	assert.equal((await framescaper(request)).status, 404);
	assert.equal(received.length, 1);
	const missingProxy = createProtocolHandler({ ...options, audiocomProxy: null });
	assert.equal((await missingProxy(request)).status, 404);
});
