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

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { R2Client } from './r2-client.mjs';

const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const MAX_ARTIFACT_BYTES = 8 * 1024 ** 3;

function assert(condition, message) {
	if (!condition) throw new Error(message);
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
}) {
	assertPinnedArtifact(artifact, modelId);
	const target = join(stagingRoot, modelId, artifact.fileName);
	await mkdir(dirname(target), { recursive: true });

	const existing = await readFile(target).catch(() => null);
	if (existing && existing.byteLength === artifact.byteLength
		&& createHash('sha256').update(existing).digest('hex') === artifact.sha256) {
		onProgress?.({ fileName: artifact.fileName, completedBytes: artifact.byteLength, reused: true });
		return Object.freeze({ path: target, reused: true });
	}

	const response = await fetchImpl(artifact.url, { redirect: 'follow' });
	assert(response.status === 200, `${modelId}: ${artifact.fileName} returned HTTP ${response.status}`);
	assert(response.body, `${modelId}: ${artifact.fileName} returned no body`);

	const hash = createHash('sha256');
	const chunks = [];
	let completedBytes = 0;
	for await (const chunk of response.body) {
		completedBytes += chunk.byteLength;
		assert(completedBytes <= artifact.byteLength,
			`${modelId}: ${artifact.fileName} exceeded its pinned byte length`);
		hash.update(chunk);
		chunks.push(Buffer.from(chunk));
		onProgress?.({ fileName: artifact.fileName, completedBytes, reused: false });
	}

	assert(completedBytes === artifact.byteLength,
		`${modelId}: ${artifact.fileName} ended at ${completedBytes} of ${artifact.byteLength} bytes`);
	const digest = hash.digest('hex');
	assert(digest === artifact.sha256,
		`${modelId}: ${artifact.fileName} hashed ${digest}, not the pinned ${artifact.sha256}`);

	const temporary = `${target}.part`;
	await writeFile(temporary, Buffer.concat(chunks), { mode: 0o600 });
	await rename(temporary, target);
	return Object.freeze({ path: target, reused: false });
}

/**
 * Uploads over the S3 API rather than through wrangler.
 *
 * `wrangler r2 object put` refuses anything over 300 MiB, and model weights
 * routinely exceed that — the Parakeet encoder alone is roughly 650 MB. A
 * signed single-part S3 PUT accepts up to 5 GiB, which covers every artifact
 * this catalog can hold, so publishing uses that path and needs an R2 API
 * token rather than a wrangler login.
 *
 * The jurisdiction is carried by the endpoint host for the S3 API, so it is
 * verified here rather than passed as a flag.
 */
function s3Uploader() {
	const client = new R2Client({
		environmentPrefix: 'R2_MODELS',
		defaultBucket: 'soundscaper-assets',
		label: 'model mirror',
	});
	return async ({ bucket, key, file, contentType, jurisdiction }) => {
		assert(client.bucket === bucket,
			`R2_MODELS_BUCKET is ${client.bucket}, but the catalog publishes to ${bucket}`);
		if (jurisdiction) {
			assert(client.endpoint.hostname.includes(`.${jurisdiction}.r2.cloudflarestorage.com`),
				`R2_MODELS_ENDPOINT must be the ${jurisdiction} jurisdiction endpoint for this bucket`);
		}
		const bytes = await readFile(file);
		await client.put(key, bytes, { contentType, cacheControl: 'public, max-age=31536000, immutable' });
		return { status: 0 };
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
	publish = false,
	execute,
	onProgress,
}) {
	const entry = findCatalogEntry(catalog, modelId);
	const staged = [];
	for (const artifact of entry.upstream.artifacts) {
		const result = await fetchPinnedArtifact({
			artifact, modelId, stagingRoot, fetchImpl, onProgress,
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
		const { key } = mirrorLocation(catalog, entry, artifact.fileName);
		const result = await run({
			bucket: catalog.publication.bucket,
			key,
			file: path,
			contentType: contentTypeFor(artifact.fileName),
			jurisdiction: catalog.publication.jurisdiction ?? null,
		});
		assert(result && result.status === 0,
			`${modelId}: publishing ${key} failed: ${result?.stderr ?? 'no result'}`);
	}
	return Object.freeze({ modelId, published: true, artifacts: Object.freeze(artifacts), staged });
}

/**
 * Streams a mirrored artifact back from the public URL and hashes it.
 *
 * A successful upload is not proof that the object serves correctly: the CDN
 * in front of it could transform, truncate, or serve a stale body. Reading the
 * bytes a user would actually receive is the only check that covers that, and
 * it streams rather than buffers so a multi-hundred-megabyte model does not
 * have to fit in memory to be verified.
 */
export async function verifyMirroredArtifact({ url, artifact, fetchImpl = fetch }) {
	const response = await fetchImpl(url, { redirect: 'follow' });
	assert(response.status === 200, `${url} returned HTTP ${response.status}`);
	assert(response.body, `${url} returned no body`);
	const hash = createHash('sha256');
	let bytes = 0;
	for await (const chunk of response.body) {
		bytes += chunk.byteLength;
		hash.update(chunk);
	}
	assert(bytes === artifact.byteLength,
		`${url} served ${bytes} bytes, not the recorded ${artifact.byteLength}`);
	const digest = hash.digest('hex');
	assert(digest === artifact.sha256, `${url} served ${digest}, not the recorded ${artifact.sha256}`);
	return Object.freeze({ url, byteLength: bytes, sha256: digest });
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
