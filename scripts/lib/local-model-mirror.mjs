/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Mirrors pinned upstream model artifacts to the product's own object store.
 *
 * The mirror never decides what is correct: every artifact is verified against
 * the digest and byte length already checked into the catalog, and anything
 * that disagrees stops the run before a single object is uploaded. That keeps
 * the reviewed pin the authority and the network merely a delivery mechanism.
 *
 * Fetching and publishing are separate steps on purpose. Fetching is local and
 * repeatable; publishing writes to a bucket the product serves to users, so it
 * happens only when the caller asks for it explicitly.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { verifyMirroredArtifact } from './local-model-mirror-publication.mjs';
import { R2Client } from './r2-client.mjs';

export { verifyMirroredArtifact } from './local-model-mirror-publication.mjs';

const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const MAX_ARTIFACT_BYTES = 8 * 1024 ** 3;
const FILE_DIGEST_CHUNK_BYTES = 4 * 1024 ** 2;
const MINIMUM_MULTIPART_PART_BYTES = 5 * 1024 ** 2;
const DEFAULT_MULTIPART_PART_BYTES = 64 * 1024 ** 2;
const DEFAULT_MULTIPART_THRESHOLD_BYTES = 100 * 1024 ** 2;
const MAXIMUM_MULTIPART_PART_BYTES = 512 * 1024 ** 2;
const MAXIMUM_MULTIPART_PARTS = 10_000;
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function throwIfAborted(signal) {
	if (signal?.aborted) throw signal.reason ?? new Error('Model mirror operation aborted');
}

async function readExact(handle, offset, length, signal) {
	const bytes = Buffer.allocUnsafe(length);
	let completed = 0;
	while (completed < length) {
		throwIfAborted(signal);
		const result = await handle.read(bytes, completed, length - completed, offset + completed);
		assert(result.bytesRead > 0, `Staged model file ended at ${String(offset + completed)} bytes`);
		completed += result.bytesRead;
	}
	return bytes;
}

async function hashFileHandle(handle, byteLength, signal) {
	const hash = createHash('sha256');
	for (let offset = 0; offset < byteLength;) {
		const length = Math.min(FILE_DIGEST_CHUNK_BYTES, byteLength - offset);
		const bytes = await readExact(handle, offset, length, signal);
		hash.update(bytes);
		offset += length;
	}
	return hash.digest('hex');
}

async function verifiedExistingFile(path, artifact, signal) {
	let handle;
	try {
		handle = await open(path, 'r');
		const metadata = await handle.stat();
		if (!metadata.isFile() || metadata.size !== artifact.byteLength) return false;
		return await hashFileHandle(handle, artifact.byteLength, signal) === artifact.sha256;
	} catch (error) {
		if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
		throw error;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

async function writeAll(handle, chunk) {
	let offset = 0;
	while (offset < chunk.byteLength) {
		const result = await handle.write(chunk, offset, chunk.byteLength - offset);
		assert(result.bytesWritten > 0, 'Writing the staged model artifact made no progress');
		offset += result.bytesWritten;
	}
}

/** The object key and public URL an artifact takes once mirrored. */
export function mirrorLocation(catalog, entry, fileName) {
	const { prefix, publicBaseUrl } = catalog.publication;
	const relative = `${entry.modelId}/${entry.version}/${fileName}`;
	return Object.freeze({ key: `${prefix}/${relative}`, url: `${publicBaseUrl}${relative}` });
}

function assertPinnedArtifact(artifact, modelId) {
	assert(typeof artifact?.fileName === 'string' && artifact.fileName !== '',
		`${modelId}: an upstream artifact needs a file name`);
	assert(SHA256_PATTERN.test(artifact.sha256 ?? ''),
		`${modelId}: ${artifact.fileName} needs a pinned lowercase SHA-256`);
	assert(Number.isSafeInteger(artifact.byteLength) && artifact.byteLength > 0
		&& artifact.byteLength <= MAX_ARTIFACT_BYTES,
		`${modelId}: ${artifact.fileName} byte length is out of range`);
	assert(typeof artifact.url === 'string' && artifact.url.startsWith('https://'),
		`${modelId}: ${artifact.fileName} must be fetched over https`);
}

/**
 * The one requirement mirroring itself resolves. Every other unmet requirement
 * is a question about whether these weights may be distributed at all, and
 * uploading them to a public host is exactly the act it gates.
 */
const MIRRORABLE_BLOCKER = 'versioned-download-notices-and-hashes';

/**
 * Refuses to publish a model whose licensing evidence is unresolved. Fetching
 * and verifying locally stays allowed: that is how the digests needed to
 * finish a review are obtained in the first place.
 */
export function assertPublishable(evidence, modelId) {
	assert(Array.isArray(evidence), `${modelId}: publishing needs the licensing evidence register`);
	const record = evidence.find((candidate) => candidate.id === modelId);
	assert(record, `${modelId} has no licensing evidence record and cannot be published`);
	const blockers = (record.blockedBy ?? []).filter((id) => id !== MIRRORABLE_BLOCKER);
	assert(blockers.length === 0,
		`${modelId} cannot be published while its licensing evidence is blocked by ${blockers.join(', ')}`);
	return record;
}

export function findCatalogEntry(catalog, modelId) {
	const entry = (catalog?.entries ?? []).find((candidate) => candidate.modelId === modelId);
	assert(entry, `${modelId} is not in the model catalog`);
	assert(entry.upstream, `${modelId} has no pinned upstream to mirror`);
	for (const artifact of entry.upstream.artifacts) assertPinnedArtifact(artifact, modelId);
	return entry;
}

/**
 * Fetches one artifact into the staging directory and verifies it against its
 * pin. A mismatch removes the partial file and throws; nothing downstream ever
 * sees unverified bytes.
 */
export async function fetchPinnedArtifact({
	artifact,
	modelId,
	stagingRoot,
	fetchImpl = fetch,
	onProgress,
	signal,
}) {
	assertPinnedArtifact(artifact, modelId);
	const target = join(stagingRoot, modelId, artifact.fileName);
	await mkdir(dirname(target), { recursive: true });

	if (await verifiedExistingFile(target, artifact, signal)) {
		onProgress?.({ fileName: artifact.fileName, completedBytes: artifact.byteLength, reused: true });
		return Object.freeze({ path: target, reused: true });
	}

	const temporary = `${target}.part`;
	await rm(temporary, { force: true });
	throwIfAborted(signal);
	const response = await fetchImpl(artifact.url, { redirect: 'follow', signal });
	assert(response.status === 200, `${modelId}: ${artifact.fileName} returned HTTP ${response.status}`);
	assert(response.body, `${modelId}: ${artifact.fileName} returned no body`);

	const hash = createHash('sha256');
	let completedBytes = 0;
	const handle = await open(temporary, 'w', 0o600);
	let closed = false;
	try {
		for await (const chunk of response.body) {
			throwIfAborted(signal);
			completedBytes += chunk.byteLength;
			assert(completedBytes <= artifact.byteLength,
				`${modelId}: ${artifact.fileName} exceeded its pinned byte length`);
			await writeAll(handle, chunk);
			hash.update(chunk);
			onProgress?.({ fileName: artifact.fileName, completedBytes, reused: false });
		}
		assert(completedBytes === artifact.byteLength,
			`${modelId}: ${artifact.fileName} ended at ${completedBytes} of ${artifact.byteLength} bytes`);
		const digest = hash.digest('hex');
		assert(digest === artifact.sha256,
			`${modelId}: ${artifact.fileName} hashed ${digest}, not the pinned ${artifact.sha256}`);
		await handle.sync();
		await handle.close();
		closed = true;
		await rename(temporary, target);
	} catch (error) {
		if (!closed) await handle.close().catch(() => undefined);
		await rm(temporary, { force: true });
		throw error;
	}
	return Object.freeze({ path: target, reused: false });
}

function checkpointIdentity(client, key, artifact, partSize) {
	return Object.freeze({
		schemaVersion: 1,
		bucket: client.bucket ?? null,
		key,
		byteLength: artifact.byteLength,
		sha256: artifact.sha256,
		partSize,
	});
}

async function loadUploadCheckpoint(path, identity) {
	let text;
	try {
		text = await readFile(path, 'utf8');
	} catch (error) {
		if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
		throw error;
	}
	let checkpoint;
	try {
		checkpoint = JSON.parse(text);
	} catch (error) {
		throw new Error(`Model mirror upload checkpoint is invalid: ${error.message}`, { cause: error });
	}
	assert(checkpoint && typeof checkpoint === 'object' && !Array.isArray(checkpoint),
		'Model mirror upload checkpoint is invalid');
	assert(Object.keys(checkpoint).sort().join(',')
		=== 'bucket,byteLength,key,partSize,schemaVersion,sha256,stagingKey,uploadId',
		'Model mirror upload checkpoint has unknown fields');
	for (const [name, expected] of Object.entries(identity)) {
		assert(checkpoint[name] === expected, `Model mirror upload checkpoint ${name} does not match`);
	}
	assert(typeof checkpoint.stagingKey === 'string'
		&& checkpoint.stagingKey.startsWith(`${identity.key}.upload-`)
		&& /^[a-f\d]{32}$/u.test(checkpoint.stagingKey.slice(`${identity.key}.upload-`.length)),
		'Model mirror upload checkpoint staging key is invalid');
	assert(typeof checkpoint.uploadId === 'string' && checkpoint.uploadId.length > 0
		&& checkpoint.uploadId.length <= 2_048, 'Model mirror upload checkpoint ID is invalid');
	return Object.freeze(checkpoint);
}

async function saveUploadCheckpoint(path, checkpoint) {
	const temporary = `${path}.part`;
	await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, { mode: 0o600 });
	await rename(temporary, path);
}

function expectedPartBytes(artifactBytes, partSize, partNumber) {
	const offset = (partNumber - 1) * partSize;
	return Math.min(partSize, artifactBytes - offset);
}

function validateRemoteParts(parts, artifact, partSize, partCount) {
	const indexed = new Map();
	for (const part of parts) {
		assert(Number.isSafeInteger(part.partNumber) && part.partNumber >= 1 && part.partNumber <= partCount,
			'Model mirror multipart upload returned an out-of-range part');
		assert(!indexed.has(part.partNumber), 'Model mirror multipart upload returned a duplicate part');
		assert(part.size === expectedPartBytes(artifact.byteLength, partSize, part.partNumber),
			`Model mirror multipart part ${String(part.partNumber)} has the wrong size`);
		assert(typeof part.etag === 'string' && part.etag.length > 0,
			`Model mirror multipart part ${String(part.partNumber)} has no ETag`);
		indexed.set(part.partNumber, part);
	}
	return indexed;
}

async function beginOrResumeMultipart(client, key, file, artifact, contentType, partSize, signal) {
	const path = `${file}.r2-upload.json`;
	const identity = checkpointIdentity(client, key, artifact, partSize);
	let checkpoint = await loadUploadCheckpoint(path, identity);
	if (!checkpoint) {
		const stagingKey = `${key}.upload-${randomUUID().replaceAll('-', '')}`;
		const created = await client.createMultipartUpload(stagingKey, {
			contentType,
			cacheControl: IMMUTABLE_CACHE_CONTROL,
			...(signal ? { signal } : {}),
		});
		checkpoint = Object.freeze({ ...identity, stagingKey, uploadId: created.uploadId });
		await saveUploadCheckpoint(path, checkpoint);
	}
	return Object.freeze({ checkpoint, path });
}

async function removeUploadCheckpoint(client, checkpoint, path, signal) {
	await client.abortMultipartUpload(
		checkpoint.stagingKey, checkpoint.uploadId, signal ? { signal } : {},
	);
	await client.delete(checkpoint.stagingKey, {
		acceptedStatuses: [204, 404], ...(signal ? { signal } : {}),
	});
	await rm(path, { force: true });
}

async function removeCompletedCheckpoint(client, key, file, artifact, partSize, signal) {
	const path = `${file}.r2-upload.json`;
	const checkpoint = await loadUploadCheckpoint(path, checkpointIdentity(client, key, artifact, partSize));
	if (checkpoint) await removeUploadCheckpoint(client, checkpoint, path, signal);
}

async function multipartUpload({ client, key, file, handle, artifact, contentType, partSize, signal }) {
	let upload = await beginOrResumeMultipart(
		client, key, file, artifact, contentType, partSize, signal,
	);
	let { checkpoint } = upload;
	let checkpointPath = upload.path;
	const stagingStatus = await client.head(checkpoint.stagingKey, {
		acceptedStatuses: [200, 404], ...(signal ? { signal } : {}),
	});
	if (stagingStatus.status === 404) {
		const partCount = Math.ceil(artifact.byteLength / partSize);
		assert(partCount >= 1 && partCount <= MAXIMUM_MULTIPART_PARTS,
			'Model mirror artifact needs too many multipart parts');
		let remoteParts = await client.listParts(
			checkpoint.stagingKey,
			checkpoint.uploadId,
			{ allowMissing: true, ...(signal ? { signal } : {}) },
		);
		if (remoteParts === null) {
			// R2 aborts incomplete multipart uploads after its configured
			// lifecycle (seven days by default). A local checkpoint can outlive
			// that remote state, so replace it instead of failing every retry.
			await rm(checkpointPath, { force: true });
			upload = await beginOrResumeMultipart(
				client, key, file, artifact, contentType, partSize, signal,
			);
			checkpoint = upload.checkpoint;
			checkpointPath = upload.path;
			remoteParts = await client.listParts(
				checkpoint.stagingKey,
				checkpoint.uploadId,
				{ allowMissing: true, ...(signal ? { signal } : {}) },
			);
			assert(remoteParts !== null, 'New model mirror multipart upload is unavailable');
		}
		let existing;
		try {
			existing = validateRemoteParts(remoteParts, artifact, partSize, partCount);
		} catch (error) {
			await client.abortMultipartUpload(
				checkpoint.stagingKey, checkpoint.uploadId, signal ? { signal } : {},
			).catch(() => undefined);
			await rm(checkpointPath, { force: true });
			throw error;
		}
		for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
			if (existing.has(partNumber)) continue;
			const length = expectedPartBytes(artifact.byteLength, partSize, partNumber);
			const bytes = await readExact(handle, (partNumber - 1) * partSize, length, signal);
			const uploaded = await client.uploadPart(
				checkpoint.stagingKey, checkpoint.uploadId, partNumber, bytes, signal ? { signal } : {},
			);
			existing.set(partNumber, Object.freeze({ partNumber, etag: uploaded.etag, size: length }));
		}
		const completed = [...existing.values()].sort((left, right) => left.partNumber - right.partNumber);
		await client.completeMultipartUpload(
			checkpoint.stagingKey, checkpoint.uploadId, completed, signal ? { signal } : {},
		);
	}
	const copied = await client.copy(checkpoint.stagingKey, key, {
		ifNoneMatch: '*', ...(signal ? { signal } : {}),
	});
	assert(copied.status === 200 || copied.status === 412,
		`Immutable model copy returned HTTP ${String(copied.status)} for ${key}`);
	await client.delete(checkpoint.stagingKey, {
		acceptedStatuses: [204, 404], ...(signal ? { signal } : {}),
	});
	await rm(checkpointPath, { force: true });
	return Object.freeze({ status: 0, multipart: true, reused: copied.status === 412 });
}

/**
 * Uploads one verified staged file without ever replacing its public key.
 * Small objects use conditional PutObject. Large objects resume through an S3
 * multipart checkpoint, then R2 atomically copies the private staging object
 * into its final key only if that key is absent.
 */
export async function uploadImmutableR2File({
	client,
	key,
	file,
	artifact,
	contentType,
	multipartThreshold = DEFAULT_MULTIPART_THRESHOLD_BYTES,
	partSize = DEFAULT_MULTIPART_PART_BYTES,
	signal,
}) {
	assert(client && typeof client.head === 'function' && typeof client.put === 'function',
		'Model mirror R2 client is invalid');
	assert(typeof file === 'string' && file.length > 0, 'Model mirror staged file is invalid');
	assert(Number.isSafeInteger(artifact?.byteLength) && artifact.byteLength > 0
		&& artifact.byteLength <= MAX_ARTIFACT_BYTES, 'Model mirror artifact byte length is invalid');
	assert(SHA256_PATTERN.test(artifact?.sha256 ?? ''), 'Model mirror artifact SHA-256 is invalid');
	assert(Number.isSafeInteger(multipartThreshold) && multipartThreshold >= 1,
		'Model mirror multipart threshold is invalid');
	assert(Number.isSafeInteger(partSize) && partSize >= MINIMUM_MULTIPART_PART_BYTES
		&& partSize <= MAXIMUM_MULTIPART_PART_BYTES, 'Model mirror multipart part size is invalid');
	const multipart = artifact.byteLength >= multipartThreshold;
	if (multipart) {
		for (const method of [
			'abortMultipartUpload',
			'completeMultipartUpload',
			'copy',
			'createMultipartUpload',
			'delete',
			'listParts',
			'uploadPart',
		]) {
			assert(typeof client[method] === 'function', `Model mirror R2 client has no ${method}`);
		}
	}
	throwIfAborted(signal);
	const existing = await client.head(key, {
		acceptedStatuses: [200, 404], ...(signal ? { signal } : {}),
	});
	assert(existing.status === 200 || existing.status === 404,
		`Immutable model lookup returned HTTP ${String(existing.status)} for ${key}`);
	if (existing.status === 200) {
		if (multipart) await removeCompletedCheckpoint(client, key, file, artifact, partSize, signal);
		return Object.freeze({ status: 0, multipart, reused: true });
	}

	const handle = await open(file, 'r');
	try {
		const metadata = await handle.stat();
		assert(metadata.isFile() && metadata.size === artifact.byteLength,
			`Staged model file is not the recorded ${String(artifact.byteLength)} bytes`);
		const digest = await hashFileHandle(handle, artifact.byteLength, signal);
		assert(digest === artifact.sha256,
			`Staged model file hashed ${digest}, not the pinned ${artifact.sha256}`);
		if (multipart) {
			return await multipartUpload({ client, key, file, handle, artifact, contentType, partSize, signal });
		}
		const bytes = await readExact(handle, 0, artifact.byteLength, signal);
		const response = await client.put(key, bytes, {
			contentType,
			cacheControl: IMMUTABLE_CACHE_CONTROL,
			ifNoneMatch: '*',
			...(signal ? { signal } : {}),
		});
		assert(response.status === 200 || response.status === 412,
			`Immutable model write returned HTTP ${String(response.status)} for ${key}`);
		return Object.freeze({ status: 0, multipart: false, reused: response.status === 412 });
	} finally {
		await handle.close().catch(() => undefined);
	}
}

/** The jurisdiction is encoded in the R2 S3 endpoint host. */
function s3Uploader() {
	const client = new R2Client({
		environmentPrefix: 'R2_MODELS',
		defaultBucket: 'soundscaper-assets',
		label: 'model mirror',
	});
	return async ({ bucket, key, file, artifact, contentType, jurisdiction, signal }) => {
		assert(client.bucket === bucket,
			`R2_MODELS_BUCKET is ${client.bucket}, but the catalog publishes to ${bucket}`);
		if (jurisdiction) {
			assert(client.endpoint.hostname.includes(`.${jurisdiction}.r2.cloudflarestorage.com`),
				`R2_MODELS_ENDPOINT must be the ${jurisdiction} jurisdiction endpoint for this bucket`);
		}
		return uploadImmutableR2File({ client, key, file, artifact, contentType, signal });
	};
}

const CONTENT_TYPES = Object.freeze({
	'.json': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.onnx': 'application/octet-stream',
	'.bin': 'application/octet-stream',
});

function contentTypeFor(fileName) {
	const extension = fileName.slice(fileName.lastIndexOf('.'));
	return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * Fetches, verifies and optionally publishes one model. Returns the catalog
 * artifacts the run proved, so the caller writes pins it observed rather than
 * pins it assumed.
 */
export async function mirrorLocalModel({
	catalog,
	evidence,
	modelId,
	stagingRoot,
	fetchImpl = fetch,
	publicFetchImpl = fetch,
	publish = false,
	execute,
	onProgress,
	signal,
}) {
	const entry = findCatalogEntry(catalog, modelId);
	const staged = [];
	for (const artifact of entry.upstream.artifacts) {
		const result = await fetchPinnedArtifact({
			artifact, modelId, stagingRoot, fetchImpl, onProgress, signal,
		});
		staged.push({ artifact, path: result.path, reused: result.reused });
	}

	const artifacts = staged.map(({ artifact }) => Object.freeze({
		fileName: artifact.fileName,
		byteLength: artifact.byteLength,
		sha256: artifact.sha256,
		url: mirrorLocation(catalog, entry, artifact.fileName).url,
	}));

	if (!publish) {
		return Object.freeze({ modelId, published: false, artifacts: Object.freeze(artifacts), staged });
	}

	assertPublishable(evidence, modelId);
	const run = execute ?? s3Uploader();
	for (const { artifact, path } of staged) {
		const { key, url } = mirrorLocation(catalog, entry, artifact.fileName);
		const result = await run({
			bucket: catalog.publication.bucket,
			key,
			file: path,
			artifact,
			contentType: contentTypeFor(artifact.fileName),
			jurisdiction: catalog.publication.jurisdiction ?? null,
			signal,
		});
		assert(result && result.status === 0,
			`${modelId}: publishing ${key} failed: ${result?.stderr ?? 'no result'}`);
		await verifyMirroredArtifact({
			url,
			artifact,
			fetchImpl: publicFetchImpl,
			signal,
		});
	}
	return Object.freeze({ modelId, published: true, artifacts: Object.freeze(artifacts), staged });
}

/** Writes proved artifacts back into the catalog without touching anything else. */
export function catalogWithMirroredArtifacts(catalog, modelId, artifacts) {
	assert(Array.isArray(artifacts) && artifacts.length > 0, `${modelId}: nothing to record`);
	return {
		...catalog,
		entries: catalog.entries.map((entry) => (entry.modelId === modelId
			? { ...entry, artifacts }
			: entry)),
	};
}

export async function removeStagedModel(stagingRoot, modelId) {
	await rm(join(stagingRoot, modelId), { recursive: true, force: true });
}
