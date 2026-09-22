/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { verifyMirroredArtifact } from '../scripts/lib/local-model-mirror-publication.mjs';

const PAYLOAD = Buffer.from('verified model bytes');
const URL = 'https://assets.soundscaper.org/models/example/1.0.0/model.onnx';
const ARTIFACT = Object.freeze({
	byteLength: PAYLOAD.length,
	sha256: createHash('sha256').update(PAYLOAD).digest('hex'),
});
const CORS = { 'Access-Control-Allow-Origin': 'https://soundscaper.org' };

function publicResponse(options) {
	if (options.method === 'HEAD') return new Response(null, {
		status: 200,
		headers: { ...CORS, 'Content-Length': String(PAYLOAD.length) },
	});
	if (options.headers.Range === 'bytes=0-0') return new Response(PAYLOAD.subarray(0, 1), {
		status: 206,
		headers: {
			...CORS,
			'Content-Length': '1',
			'Content-Range': `bytes 0-0/${PAYLOAD.length}`,
			'Access-Control-Expose-Headers': 'Content-Range',
		},
	});
	return new Response(PAYLOAD, { status: 200, headers: CORS });
}

test('public mirror verification retries a transient connection timeout', async () => {
	const requests = [];
	let attempts = 0;
	const result = await verifyMirroredArtifact({
		url: URL,
		artifact: ARTIFACT,
		fetchImpl: async (_url, options) => {
			attempts += 1;
			if (attempts === 1) {
				throw new TypeError('fetch failed', {
					cause: Object.assign(new Error('Connect Timeout Error'), {
						code: 'UND_ERR_CONNECT_TIMEOUT',
					}),
				});
			}
			requests.push(options.method);
			return publicResponse(options);
		},
	});
	assert.deepEqual(result, { url: URL, byteLength: ARTIFACT.byteLength, sha256: ARTIFACT.sha256 });
	assert.equal(attempts, 4);
	assert.deepEqual(requests, ['HEAD', 'GET', 'GET']);
});
