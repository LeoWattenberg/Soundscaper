/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { R2Client } from '../scripts/lib/r2-client.mjs';

function testClient(fetchImpl, options = {}) {
	const names = [
		'R2_TEST_ACCESS_KEY_ID',
		'R2_TEST_SECRET_ACCESS_KEY',
		'R2_TEST_ENDPOINT',
		'R2_TEST_BUCKET',
	];
	const previous = new Map(names.map((name) => [name, process.env[name]]));
	process.env.R2_TEST_ACCESS_KEY_ID = 'test-access-key';
	process.env.R2_TEST_SECRET_ACCESS_KEY = 'test-secret-key';
	process.env.R2_TEST_ENDPOINT = 'https://0123456789abcdef.eu.r2.cloudflarestorage.com';
	process.env.R2_TEST_BUCKET = 'soundscaper-assets';
	try {
		return new R2Client({
			environmentPrefix: 'R2_TEST',
			label: 'test',
			fetchImpl,
			requestTimeoutMs: 1_000,
			retryBaseDelayMs: 0,
			...options,
		});
	} finally {
		for (const [name, value] of previous) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

test('R2 multipart operations sign EU endpoint queries with the auto region', async () => {
	const requests = [];
	const replies = [
		new Response('<InitiateMultipartUploadResult><UploadId>upload-123</UploadId></InitiateMultipartUploadResult>', {
			status: 200,
		}),
		new Response([
			'<ListPartsResult>',
			'<Part><PartNumber>1</PartNumber><ETag>&quot;etag-1&quot;</ETag><Size>5242880</Size></Part>',
			'<IsTruncated>false</IsTruncated>',
			'</ListPartsResult>',
		].join(''), { status: 200 }),
		new Response(null, { status: 200, headers: { ETag: '"etag-2"' } }),
		new Response('<CompleteMultipartUploadResult/>', { status: 200 }),
		new Response('<CopyObjectResult/>', { status: 200 }),
	];
	const client = testClient(async (url, init) => {
		requests.push({
			url: String(url),
			method: init.method,
			headers: new Headers(init.headers),
			body: init.body ? String(init.body) : null,
		});
		return replies.shift();
	});
	const key = 'models/example/1.0.0/model.onnx.upload-test';
	const { uploadId } = await client.createMultipartUpload(key, {
		contentType: 'application/octet-stream',
		cacheControl: 'public, max-age=31536000, immutable',
	});
	const listed = await client.listParts(key, uploadId);
	const uploaded = await client.uploadPart(key, uploadId, 2, Buffer.from('tail'));
	await client.completeMultipartUpload(key, uploadId, [...listed, { partNumber: 2, etag: uploaded.etag }]);
	await client.copy(key, 'models/example/1.0.0/model.onnx', { ifNoneMatch: '*' });

	assert.equal(uploadId, 'upload-123');
	assert.deepEqual(listed, [{ partNumber: 1, etag: '"etag-1"', size: 5 * 1024 ** 2 }]);
	assert.equal(uploaded.etag, '"etag-2"');
	assert.equal(requests.length, 5);
	assert.match(requests[0].url, /\.eu\.r2\.cloudflarestorage\.com\/soundscaper-assets\/.*\?uploads=$/u);
	assert.match(requests[1].url, /\?max-parts=1000&uploadId=upload-123$/u);
	assert.match(requests[2].url, /\?partNumber=2&uploadId=upload-123$/u);
	for (const request of requests) {
		assert.match(request.headers.get('authorization') ?? '',
			/Credential=test-access-key\/\d{8}\/auto\/s3\/aws4_request/iu);
	}
	assert.match(requests[3].body ?? '',
		/<Part><ETag>&quot;etag-1&quot;<\/ETag><PartNumber>1<\/PartNumber><\/Part>/u);
	assert.equal(requests[4].headers.get('cf-copy-destination-if-none-match'), '*');
	assert.equal(requests[4].headers.get('x-amz-copy-source'),
		'/soundscaper-assets/models/example/1.0.0/model.onnx.upload-test');
});

test('R2 requests retry only a bounded number of transient responses', async () => {
	let calls = 0;
	const client = testClient(async () => {
		calls += 1;
		return calls < 3
			? new Response('temporarily unavailable', { status: 503 })
			: new Response(null, { status: 404 });
	}, { maximumAttempts: 3 });

	const response = await client.head('models/example/1.0.0/model.onnx');

	assert.equal(response.status, 404);
	assert.equal(calls, 3);

	let rejectedCalls = 0;
	const rejected = testClient(async () => {
		rejectedCalls += 1;
		return new Response('still unavailable', { status: 503 });
	}, { maximumAttempts: 3 });
	await assert.rejects(
		rejected.head('models/example/1.0.0/model.onnx'),
		/returned HTTP 503/iu,
	);
	assert.equal(rejectedCalls, 3, 'a persistent transient response cannot create an unbounded loop');
});

test('R2 multipart listing can report an expired upload without hiding other errors', async () => {
	const expired = testClient(async () => new Response('<Error><Code>NoSuchUpload</Code></Error>', {
		status: 404,
	}));
	assert.equal(await expired.listParts(
		'models/example/1.0.0/model.onnx.upload-expired',
		'expired-upload',
		{ allowMissing: true },
	), null);

	const strict = testClient(async () => new Response('<Error><Code>NoSuchUpload</Code></Error>', {
		status: 404,
	}));
	await assert.rejects(
		strict.listParts('models/example/1.0.0/model.onnx.upload-expired', 'expired-upload'),
		/returned HTTP 404.*NoSuchUpload/isu,
	);
});

test('an already-aborted R2 request performs no network attempt', async () => {
	let calls = 0;
	const controller = new AbortController();
	controller.abort(new Error('publisher cancelled'));
	const client = testClient(async () => {
		calls += 1;
		return new Response(null, { status: 200 });
	});

	await assert.rejects(
		client.head('models/example/1.0.0/model.onnx', { signal: controller.signal }),
		/publisher cancelled|aborted/iu,
	);
	assert.equal(calls, 0);
});

test('aborting an active R2 request prevents every retry', async () => {
	let calls = 0;
	const controller = new AbortController();
	const client = testClient(async (_url, init) => {
		calls += 1;
		return new Promise((_resolve, reject) => {
			init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
		});
	});
	const pending = client.head('models/example/1.0.0/model.onnx', { signal: controller.signal });
	controller.abort(new Error('active publisher cancelled'));

	await assert.rejects(pending, /active publisher cancelled/iu);
	assert.equal(calls, 1);
});
