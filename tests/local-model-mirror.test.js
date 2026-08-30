/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	assertPublishable,
	catalogWithMirroredArtifacts,
	fetchPinnedArtifact,
	findCatalogEntry,
	mirrorLocalModel,
	mirrorLocation,
	uploadImmutableR2File,
	verifyMirroredArtifact,
} from '../scripts/lib/local-model-mirror.mjs';

const EVIDENCE = Object.freeze([
	{ id: 'silero-vad-v6', blockedBy: ['versioned-download-notices-and-hashes'] },
	{ id: 'spleeter', blockedBy: ['versioned-download-notices-and-hashes', 'weights-and-code-license-review'] },
]);

const PAYLOAD = 'silero weights';
const DIGEST = createHash('sha256').update(PAYLOAD).digest('hex');

const CATALOG = Object.freeze({
	schemaVersion: 1,
	publication: {
		bucket: 'soundscaper-assets',
		prefix: 'models',
		publicBaseUrl: 'https://assets.soundscaper.org/models/',
		jurisdiction: 'eu',
	},
	entries: [
		{
			modelId: 'silero-vad-v6',
			version: '6.2.1',
			upstream: {
				source: 'https://github.com/snakers4/silero-vad',
				revision: 'abc123',
				artifacts: [{
					fileName: 'silero_vad.onnx',
					byteLength: Buffer.byteLength(PAYLOAD),
					sha256: DIGEST,
					url: 'https://raw.githubusercontent.invalid/silero_vad.onnx',
				}],
			},
			artifacts: null,
		},
		{ modelId: 'unpinned-model', version: '1.0.0', upstream: null, artifacts: null },
	],
});

function stubFetch(body, status = 200) {
	return async () => ({
		status,
		body: (async function* stream() {
			if (body !== null) yield new Uint8Array(Buffer.from(body));
		})(),
	});
}

function publicArtifactFetch(body = PAYLOAD, observe = () => undefined) {
	const bytes = Buffer.from(body);
	return async (url, init = {}) => {
		const requestHeaders = new Headers(init.headers);
		const method = init.method ?? 'GET';
		const range = requestHeaders.get('Range');
		observe({ url: String(url), method, range });
		const headers = {
			'Accept-Ranges': 'bytes',
			'Access-Control-Allow-Origin': requestHeaders.get('Origin') ?? '*',
			'Access-Control-Expose-Headers': 'Content-Length, Content-Range, ETag',
			'Content-Length': String(range ? 1 : bytes.byteLength),
		};
		if (method === 'HEAD') return new Response(null, { status: 200, headers });
		if (range === 'bytes=0-0') {
			return new Response(bytes.subarray(0, 1), {
				status: 206,
				headers: { ...headers, 'Content-Range': `bytes 0-0/${String(bytes.byteLength)}` },
			});
		}
		return new Response(bytes, { status: 200, headers });
	};
}

async function staging(t) {
	const root = await mkdtemp(join(tmpdir(), 'scape-model-mirror-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test('a mirrored artifact takes a versioned key under the publication prefix', () => {
	const entry = findCatalogEntry(CATALOG, 'silero-vad-v6');
	assert.deepEqual(mirrorLocation(CATALOG, entry, 'silero_vad.onnx'), {
		key: 'models/silero-vad-v6/6.2.1/silero_vad.onnx',
		url: 'https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/silero_vad.onnx',
	});
});

test('a model with no pinned upstream cannot be mirrored', () => {
	assert.throws(() => findCatalogEntry(CATALOG, 'unpinned-model'), /no pinned upstream/iu);
	assert.throws(() => findCatalogEntry(CATALOG, 'absent-model'), /not in the model catalog/iu);
});

test('a fetched artifact is verified against its pin', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const [artifact] = CATALOG.entries[0].upstream.artifacts;

	const result = await fetchPinnedArtifact({
		artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch(PAYLOAD),
	});

	assert.equal(result.reused, false);
	assert.equal(String(await readFile(result.path)), PAYLOAD);
});

test('a fetched artifact reaches its partial file as the response streams', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const [artifact] = CATALOG.entries[0].upstream.artifacts;
	const partial = join(stagingRoot, 'silero-vad-v6', `${artifact.fileName}.part`);
	let firstChunkBytes = null;
	const first = Buffer.from('silero ');
	const second = Buffer.from('weights');
	const fetchImpl = async () => ({
		status: 200,
		body: (async function* stream() {
			yield first;
			firstChunkBytes = (await stat(partial)).size;
			yield second;
		})(),
	});

	await fetchPinnedArtifact({ artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl });

	assert.equal(firstChunkBytes, first.byteLength,
		'the first chunk is persisted before the response produces the second');
	await assert.rejects(stat(partial), /ENOENT/u, 'the partial is renamed after verification');
});

test('bytes that disagree with the pin stop the run', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const [artifact] = CATALOG.entries[0].upstream.artifacts;
	const partial = join(stagingRoot, 'silero-vad-v6', `${artifact.fileName}.part`);

	// Same length as the pin, so this reaches the digest check rather than the
	// cheaper length check in front of it.
	assert.equal('silero weightz'.length, PAYLOAD.length);
	await assert.rejects(
		fetchPinnedArtifact({
			artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch('silero weightz'),
		}),
		/hashed .*, not the pinned/iu,
	);
	await assert.rejects(
		fetchPinnedArtifact({
			artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch('short'),
		}),
		/ended at 5 of 14 bytes/iu,
	);
	await assert.rejects(
		fetchPinnedArtifact({
			artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch('much longer than pinned'),
		}),
		/exceeded its pinned byte length/iu,
	);
	await writeFile(partial, 'stale bytes from an interrupted process');
	await assert.rejects(
		fetchPinnedArtifact({
			artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch(null, 404),
		}),
		/returned HTTP 404/iu,
	);
	await assert.rejects(
		stat(partial),
		/ENOENT/u,
		'a rejected stream leaves no unverified partial behind',
	);
});

test('an already-staged artifact is reused rather than refetched', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const [artifact] = CATALOG.entries[0].upstream.artifacts;

	await fetchPinnedArtifact({
		artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch(PAYLOAD),
	});
	const second = await fetchPinnedArtifact({
		artifact,
		modelId: 'silero-vad-v6',
		stagingRoot,
		fetchImpl: () => { throw new Error('must not refetch'); },
	});

	assert.equal(second.reused, true);
});

test('a staged file that no longer matches its pin is refetched', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const [artifact] = CATALOG.entries[0].upstream.artifacts;
	const first = await fetchPinnedArtifact({
		artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch(PAYLOAD),
	});
	await writeFile(first.path, 'corrupted....');

	const refetched = await fetchPinnedArtifact({
		artifact, modelId: 'silero-vad-v6', stagingRoot, fetchImpl: stubFetch(PAYLOAD),
	});
	assert.equal(refetched.reused, false);
	assert.equal(String(await readFile(refetched.path)), PAYLOAD);
});

test('verifying does not publish', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);

	const result = await mirrorLocalModel({
		catalog: CATALOG,
		evidence: EVIDENCE,
		modelId: 'silero-vad-v6',
		stagingRoot,
		fetchImpl: stubFetch(PAYLOAD),
		execute: () => { throw new Error('must not publish'); },
	});

	assert.equal(result.published, false);
	assert.deepEqual(result.artifacts, [{
		fileName: 'silero_vad.onnx',
		byteLength: Buffer.byteLength(PAYLOAD),
		sha256: DIGEST,
		url: 'https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/silero_vad.onnx',
	}]);
});

test('publishing uploads every verified artifact to its versioned key', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const uploads = [];

	const result = await mirrorLocalModel({
		catalog: CATALOG,
		evidence: EVIDENCE,
		modelId: 'silero-vad-v6',
		stagingRoot,
		fetchImpl: stubFetch(PAYLOAD),
		publicFetchImpl: publicArtifactFetch(),
		publish: true,
		execute: (command) => {
			uploads.push({
				bucket: command.bucket,
				key: command.key,
				contentType: command.contentType,
				jurisdiction: command.jurisdiction,
			});
			return { status: 0 };
		},
	});

	assert.equal(result.published, true);
	assert.deepEqual(uploads, [{
		bucket: 'soundscaper-assets',
		key: 'models/silero-vad-v6/6.2.1/silero_vad.onnx',
		contentType: 'application/octet-stream',
		jurisdiction: 'eu',
	}]);
});

test('publishing performs a full public digest readback before reporting success', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const events = [];
	const publicFetchImpl = publicArtifactFetch(PAYLOAD, ({ url, method, range }) => {
		events.push(`readback:${method}:${range ?? 'full'}:${url}`);
	});
	const result = await mirrorLocalModel({
		catalog: CATALOG,
		evidence: EVIDENCE,
		modelId: 'silero-vad-v6',
		stagingRoot,
		fetchImpl: stubFetch(PAYLOAD),
		publicFetchImpl,
		publish: true,
		execute: async ({ key }) => {
			events.push(`upload:${key}`);
			return { status: 0 };
		},
	});

	assert.equal(result.published, true);
	assert.deepEqual(events, [
		'upload:models/silero-vad-v6/6.2.1/silero_vad.onnx',
		'readback:HEAD:full:https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/silero_vad.onnx',
		'readback:GET:bytes=0-0:https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/silero_vad.onnx',
		'readback:GET:full:https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/silero_vad.onnx',
	]);

	await assert.rejects(
		mirrorLocalModel({
			catalog: CATALOG,
			evidence: EVIDENCE,
			modelId: 'silero-vad-v6',
			stagingRoot,
			fetchImpl: stubFetch(PAYLOAD),
			publicFetchImpl: publicArtifactFetch('silero weightz'),
			publish: true,
			execute: async () => ({ status: 0 }),
		}),
		/served .*, not the recorded/iu,
	);
});

test('public mirror verification proves HEAD, Range and browser CORS before success', async () => {
	const requests = [];
	const artifact = { byteLength: Buffer.byteLength(PAYLOAD), sha256: DIGEST };
	const url = 'https://assets.soundscaper.org/models/example/1.0.0/model.onnx';

	assert.deepEqual(await verifyMirroredArtifact({
		url,
		artifact,
		fetchImpl: publicArtifactFetch(PAYLOAD, (request) => requests.push(request)),
	}), { url, byteLength: artifact.byteLength, sha256: artifact.sha256 });
	assert.deepEqual(requests.map(({ method, range }) => [method, range]), [
		['HEAD', null],
		['GET', 'bytes=0-0'],
		['GET', null],
	]);

	await assert.rejects(
		verifyMirroredArtifact({
			url,
			artifact,
			fetchImpl: async (requestUrl, init) => {
				const response = await publicArtifactFetch()(requestUrl, init);
				response.headers.delete('Access-Control-Allow-Origin');
				return response;
			},
		}),
		/CORS.*does not allow/iu,
	);
});

test('small R2 uploads conditionally create their immutable key', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const file = join(stagingRoot, 'small.onnx');
	await writeFile(file, PAYLOAD);
	const puts = [];
	const client = {
		async head() {
			return new Response(null, { status: 404 });
		},
		async put(key, bytes, options) {
			puts.push({ key, bytes: String(bytes), options });
			return new Response(null, { status: 412 });
		},
	};

	const result = await uploadImmutableR2File({
		client,
		key: 'models/example/1.0.0/small.onnx',
		file,
		artifact: { byteLength: Buffer.byteLength(PAYLOAD), sha256: DIGEST },
		contentType: 'application/octet-stream',
	});

	assert.deepEqual(puts, [{
		key: 'models/example/1.0.0/small.onnx',
		bytes: PAYLOAD,
		options: {
			contentType: 'application/octet-stream',
			cacheControl: 'public, max-age=31536000, immutable',
			ifNoneMatch: '*',
		},
	}]);
	assert.deepEqual(result, { status: 0, multipart: false, reused: true });
});

test('large immutable uploads resume missing S3 parts and conditionally copy into place',
	{ timeout: 20_000 }, async (t) => {
		const stagingRoot = await staging(t);
		const partSize = 5 * 1024 ** 2;
		const bytes = Buffer.alloc(partSize + 19, 0x5a);
		const file = join(stagingRoot, 'large.onnx');
		await writeFile(file, bytes);
		const artifact = {
			byteLength: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		};
		const remoteParts = new Map();
		const uploads = [];
		const copies = [];
		let failSecondPart = true;
		let stagingKey = null;
		const client = {
			bucket: 'soundscaper-assets',
			async put() {
				throw new Error('large artifacts must not use PutObject');
			},
			async head(key) {
				return new Response(null, { status: key === stagingKey && copies.length > 0 ? 200 : 404 });
			},
			async createMultipartUpload(key) {
				stagingKey = key;
				return { uploadId: 'upload-1' };
			},
			async listParts() {
				return [...remoteParts.entries()].map(([partNumber, part]) => ({ partNumber, ...part }));
			},
			async uploadPart(_key, _uploadId, partNumber, part) {
				uploads.push(partNumber);
				if (partNumber === 2 && failSecondPart) {
					failSecondPart = false;
					throw new Error('temporary part failure');
				}
				const etag = `"part-${String(partNumber)}"`;
				remoteParts.set(partNumber, { etag, size: part.byteLength });
				return { etag };
			},
			async completeMultipartUpload(_key, _uploadId, parts) {
				assert.deepEqual(parts.map(({ partNumber }) => partNumber), [1, 2]);
				return new Response(null, { status: 200 });
			},
			async abortMultipartUpload() {
				return new Response(null, { status: 204 });
			},
			async copy(sourceKey, destinationKey, options) {
				copies.push({ sourceKey, destinationKey, options });
				return new Response(null, { status: 200 });
			},
			async delete() {
				return new Response(null, { status: 204 });
			},
		};
		const request = {
			client,
			key: 'models/example/1.0.0/large.onnx',
			file,
			artifact,
			contentType: 'application/octet-stream',
			multipartThreshold: 1,
			partSize,
		};

		await assert.rejects(uploadImmutableR2File(request), /temporary part failure/u);
		const result = await uploadImmutableR2File(request);

		assert.equal(result.status, 0);
		assert.equal(result.multipart, true);
		assert.deepEqual(uploads, [1, 2, 2], 'the completed first part is not uploaded again');
		assert.deepEqual(copies, [{
			sourceKey: stagingKey,
			destinationKey: request.key,
			options: { ifNoneMatch: '*' },
		}]);
		await assert.rejects(stat(`${file}.r2-upload.json`), /ENOENT/u,
			'the durable checkpoint is removed only after the conditional copy');
	});

test('a failed upload stops the run rather than reporting success', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);

	await assert.rejects(
		mirrorLocalModel({
			catalog: CATALOG,
			evidence: EVIDENCE,
			modelId: 'silero-vad-v6',
			stagingRoot,
			fetchImpl: stubFetch(PAYLOAD),
			publish: true,
			execute: () => ({ status: 1, stderr: 'no such bucket' }),
		}),
		/publishing models\/silero-vad-v6.*failed: no such bucket/isu,
	);
});

test('recorded artifacts replace only the mirrored entry', () => {
	const artifacts = [{
		fileName: 'silero_vad.onnx',
		byteLength: Buffer.byteLength(PAYLOAD),
		sha256: DIGEST,
		url: 'https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/silero_vad.onnx',
	}];

	const updated = catalogWithMirroredArtifacts(CATALOG, 'silero-vad-v6', artifacts);

	assert.deepEqual(updated.entries[0].artifacts, artifacts);
	assert.equal(updated.entries[1].artifacts, null, 'other entries are untouched');
	assert.equal(CATALOG.entries[0].artifacts, null, 'the input catalog is not mutated');
	assert.throws(() => catalogWithMirroredArtifacts(CATALOG, 'silero-vad-v6', []), /nothing to record/iu);
});

test('a model whose licence review is unresolved cannot be published', { timeout: 20_000 }, async (t) => {
	const stagingRoot = await staging(t);
	const catalog = {
		...CATALOG,
		entries: [{ ...CATALOG.entries[0], modelId: 'spleeter' }, ...CATALOG.entries.slice(1)],
	};

	await assert.rejects(
		mirrorLocalModel({
			catalog,
			evidence: EVIDENCE,
			modelId: 'spleeter',
			stagingRoot,
			fetchImpl: stubFetch(PAYLOAD),
			publish: true,
			execute: () => { throw new Error('must not upload'); },
		}),
		/blocked by weights-and-code-license-review/iu,
	);

	const verified = await mirrorLocalModel({
		catalog, evidence: EVIDENCE, modelId: 'spleeter', stagingRoot, fetchImpl: stubFetch(PAYLOAD),
	});
	assert.equal(verified.published, false, 'verifying locally stays allowed');
});

test('publishing needs a licensing evidence record at all', () => {
	assert.throws(() => assertPublishable(EVIDENCE, 'absent-model'), /no licensing evidence record/iu);
	assert.throws(() => assertPublishable(null, 'silero-vad-v6'), /needs the licensing evidence register/iu);
	assert.deepEqual(assertPublishable(EVIDENCE, 'silero-vad-v6').id, 'silero-vad-v6');
});

test('the mirror CLI cannot record catalog URLs before public publication and readback', () => {
	const result = spawnSync(process.execPath, [
		'scripts/mirror-local-models.mjs',
		'--model', 'silero-vad-v6',
		'--write-catalog',
	], {
		cwd: new URL('..', import.meta.url),
		encoding: 'utf8',
	});

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /--write-catalog.*--publish|public.*readback/iu);
	assert.doesNotMatch(result.stdout, /Staging in|verified only|Recorded mirrored artifacts/iu,
		'the command must fail before fetching, staging, or recording any artifact');
});

test('the mirror CLI cannot report a successful verification for an unknown model', () => {
	const result = spawnSync(process.execPath, [
		'scripts/mirror-local-models.mjs',
		'--verify',
		'--model', 'misspelled-model',
	], {
		cwd: new URL('..', import.meta.url),
		encoding: 'utf8',
	});

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /misspelled-model.*not in the model catalog/iu);
	assert.doesNotMatch(result.stdout, /Verified 0 mirrored artifacts/iu);
});
