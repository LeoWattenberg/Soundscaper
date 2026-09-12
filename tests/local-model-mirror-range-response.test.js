/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyMirroredArtifact } from '../scripts/lib/local-model-mirror-publication.mjs';

const bytes = Buffer.from('model bytes');
const artifact = { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const url = 'https://assets.soundscaper.org/models/test/1/model.onnx';

function delivery({ rangeStatus = 206, contentRange = `bytes 0-0/${bytes.length}`, rangeBody = bytes.subarray(0, 1), body = bytes } = {}) {
	return async (_url, init) => {
		const ranged = init.headers.Range === 'bytes=0-0';
		const headers = { 'Access-Control-Allow-Origin': 'https://soundscaper.org',
			'Access-Control-Expose-Headers': 'Content-Length,Content-Range,ETag',
			'Content-Length': String(ranged ? rangeBody.length : bytes.length) };
		if (ranged) headers['Content-Range'] = contentRange;
		return new Response(init.method === 'HEAD' ? null : ranged ? rangeBody : body,
			{ status: ranged ? rangeStatus : 200, headers });
	};
}

test('a real partial response proves range support without an optional Accept-Ranges advertisement', async () => {
	assert.deepEqual(await verifyMirroredArtifact({ url, artifact, fetchImpl: delivery() }), { url, ...artifact });
});

test('a cold CDN full response is cancelled and retried once before requiring a valid partial response', async () => {
	let ranges = 0;
	let cancelled = false;
	const normal = delivery();
	const fetchImpl = (address, init) => {
		if (init.headers.Range && ranges++ === 0) return new Response(new ReadableStream({
			cancel() { cancelled = true; },
		}), { status: 200 });
		return normal(address, init);
	};
	assert.deepEqual(await verifyMirroredArtifact({ url, artifact, fetchImpl }), { url, ...artifact });
	assert.equal(ranges, 2);
	assert.equal(cancelled, true, 'The ignored range must not download a multi-gigabyte body.');
});

test('missing advertisements do not excuse incorrect range replies or changed complete bytes', async () => {
	for (const [options, error] of [
		[{ rangeStatus: 200 }, /not 206/u],
		[{ contentRange: `bytes 1-1/${bytes.length}` }, /Content-Range/u],
		[{ rangeBody: bytes.subarray(0, 2) }, /Content-Length/u],
		[{ body: Buffer.from('model bytez') }, /served.*not the recorded/u],
	]) await assert.rejects(verifyMirroredArtifact({ url, artifact, fetchImpl: delivery(options) }), error);
});
