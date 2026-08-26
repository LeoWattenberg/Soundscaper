/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { uploadImmutableR2File } from '../scripts/lib/local-model-mirror.mjs';

test('an expired multipart checkpoint is replaced and uploaded from the verified file',
	{ timeout: 20_000 }, async (t) => {
		const stagingRoot = await mkdtemp(join(tmpdir(), 'scape-model-mirror-expiry-'));
		t.after(() => rm(stagingRoot, { recursive: true, force: true }));
		const partSize = 5 * 1024 ** 2;
		const bytes = Buffer.alloc(partSize + 23, 0x43);
		const file = join(stagingRoot, 'expired.onnx');
		await writeFile(file, bytes);
		const artifact = {
			byteLength: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		};
		const started = [];
		const uploaded = [];
		let expired = false;
		const client = {
			bucket: 'soundscaper-assets',
			async put() {
				throw new Error('large artifacts must not use PutObject');
			},
			async head() {
				return new Response(null, { status: 404 });
			},
			async createMultipartUpload() {
				const uploadId = started.length === 0 ? 'expired-upload' : 'fresh-upload';
				started.push(uploadId);
				return { uploadId };
			},
			async listParts(_key, uploadId) {
				return uploadId === 'expired-upload' && expired ? null : [];
			},
			async uploadPart(_key, uploadId, partNumber) {
				uploaded.push([uploadId, partNumber]);
				if (uploadId === 'expired-upload' && partNumber === 2) {
					expired = true;
					throw new Error('upload expired before the final part');
				}
				return { etag: `"${uploadId}-${String(partNumber)}"` };
			},
			async completeMultipartUpload(_key, uploadId, parts) {
				assert.equal(uploadId, 'fresh-upload');
				assert.deepEqual(parts.map(({ partNumber }) => partNumber), [1, 2]);
				return new Response(null, { status: 200 });
			},
			async abortMultipartUpload() {
				return new Response(null, { status: 404 });
			},
			async copy() {
				return new Response(null, { status: 200 });
			},
			async delete() {
				return new Response(null, { status: 204 });
			},
		};
		const request = {
			client,
			key: 'models/example/1.0.0/expired.onnx',
			file,
			artifact,
			contentType: 'application/octet-stream',
			multipartThreshold: 1,
			partSize,
		};

		await assert.rejects(uploadImmutableR2File(request), /upload expired before the final part/u);
		const result = await uploadImmutableR2File(request);

		assert.deepEqual(started, ['expired-upload', 'fresh-upload']);
		assert.deepEqual(uploaded, [
			['expired-upload', 1],
			['expired-upload', 2],
			['fresh-upload', 1],
			['fresh-upload', 2],
		]);
		assert.deepEqual(result, { status: 0, multipart: true, reused: false });
		await assert.rejects(stat(`${file}.r2-upload.json`), /ENOENT/u);
	});
