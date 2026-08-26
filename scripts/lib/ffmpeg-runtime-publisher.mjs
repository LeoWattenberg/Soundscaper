/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
	snapshotVerifiedFfmpegRuntime,
	verifyFfmpegRuntimeManifest,
} from './ffmpeg-runtime-manifest.mjs';
import { R2Client, strongEntityTag } from './r2-client.mjs';

const MAXIMUM_POINTER_BYTES = 64 * 1024;
const PUBLIC_SMOKE_ORIGIN = 'https://soundscaper.org';
const UNAVAILABLE_POINTER_BYTES = Buffer.from('{"schemaVersion":1,"status":"unavailable"}\n');

export async function publishFfmpegRuntime({
	repositoryRoot,
	loadRelease,
	client: providedClient,
	createClient = createRuntimeR2Client,
	applyCors = applyRuntimeCors,
	purgeUrls = purgeCloudflareUrls,
	publicFetch = fetch,
} = {}) {
	const release = await (loadRelease
		? loadRelease()
		: verifyFfmpegRuntimeManifest({ repositoryRoot, purpose: 'runtime-publication' }));
	const snapshot = snapshotVerifiedFfmpegRuntime(release);
	assert(release.manifest.authorizations.runtimePublication.status === 'approved',
		`runtime publication is blocked by ${release.manifest.authorizations.runtimePublication.blockedBy.join(', ')}`);
	const policy = snapshot.publicPolicy;
	const bucket = release.manifest.publication.bucket;
	const jurisdiction = release.manifest.publication.jurisdiction ?? null;
	const client = providedClient ?? createClient({ bucket, jurisdiction });
	validateRuntimeClient(client, { bucket, jurisdiction });

	await applyCors({
		bucket,
		jurisdiction,
		bytes: snapshot.corsBytes,
		repositoryRoot,
	});
	const releasePrefix = `${policy.publicPrefix}/${policy.releaseSegment}/${release.manifestSha256}`;
	const objects = publicationObjects(release, snapshot, releasePrefix, policy);
	for (const object of objects) await putImmutable(client, object);
	const releaseUrls = objects.map(({ key }) => publicObjectUrl(policy, key));
	await purgeUrls(releaseUrls);
	for (const object of objects) {
		await publicFetchVerified(publicFetch, publicObjectUrl(policy, object.key), object, policy);
	}

	const pointerKey = `${policy.publicPrefix}/${policy.pointer.name}`;
	const current = await existingPointer(client, pointerKey);
	const pointerBytes = runtimePointer(release, releasePrefix);
	await promotePointer({
		client,
		current,
		pointerBytes,
		pointerKey,
		pointerPolicy: policy.pointer,
		pointerUrl: publicObjectUrl(policy, pointerKey),
		publicFetch,
		purgeUrls,
	});
	return Object.freeze({ objectCount: objects.length + 1, manifestSha256: release.manifestSha256 });
}

function publicationObjects(release, snapshot, releasePrefix, policy) {
	const cacheControl = policy.immutableCacheControl;
	const runtimePolicy = new Map(policy.runtimeFiles.map((file) => [file.name, file]));
	return [
		...snapshot.runtimeFiles.map((file) => {
			const filePolicy = runtimePolicy.get(file.name);
			assert(filePolicy?.contentType === file.contentType,
				`Runtime publication MIME policy disagrees for ${file.name}`);
			return {
				key: `${releasePrefix}/${file.name}`,
				bytes: file.bytes,
				contentType: filePolicy.contentType,
				cacheControl,
			};
		}),
		{
			key: `${releasePrefix}/${release.manifest.publication.noticeName}`,
			bytes: snapshot.evidence.notices.bytes,
			contentType: policy.releaseMetadata.notice.contentType,
			cacheControl,
		},
		{
			key: `${releasePrefix}/${release.manifest.publication.correspondingSourceName}`,
			bytes: snapshot.evidence.correspondingSource.bytes,
			contentType: policy.releaseMetadata.correspondingSource.contentType,
			cacheControl,
		},
		{
			key: `${releasePrefix}/${release.manifest.publication.manifestName}`,
			bytes: snapshot.manifestBytes,
			contentType: policy.releaseMetadata.manifest.contentType,
			cacheControl,
		},
	].map((object) => Object.freeze({
		...object,
		byteLength: object.bytes.byteLength,
		sha256: sha256(object.bytes),
	}));
}

async function putImmutable(client, object) {
	const response = await client.put(object.key, object.bytes, {
		contentType: object.contentType,
		cacheControl: object.cacheControl,
		ifNoneMatch: '*',
	});
	assert(response.status === 200 || response.status === 412,
		`Immutable R2 write returned HTTP ${String(response.status)} for ${object.key}`);
	const stored = await client.get(object.key, object.byteLength);
	verifyStoredObject(stored, object, `Immutable R2 object ${object.key}`);
}

async function existingPointer(client, key) {
	const stored = await client.get(key, MAXIMUM_POINTER_BYTES, [200, 404]);
	if (stored.response.status === 404) return Object.freeze({ bytes: null, etag: null, key });
	return Object.freeze({
		bytes: stored.bytes,
		etag: strongEntityTag(stored.response.headers.get('etag'), 'Stored FFmpeg latest.json'),
		key,
	});
}

export async function promotePointer({
	client,
	current,
	pointerBytes,
	pointerKey,
	pointerPolicy,
	pointerUrl,
	publicFetch,
	purgeUrls,
}) {
	assert(pointerBytes.byteLength <= MAXIMUM_POINTER_BYTES, 'FFmpeg latest.json exceeds its byte limit');
	const response = await client.put(pointerKey, pointerBytes, {
		contentType: pointerPolicy.contentType,
		cacheControl: pointerPolicy.cacheControl,
		...(current.etag ? { ifMatch: current.etag } : { ifNoneMatch: '*' }),
	});
	assert(response.status === 200, 'FFmpeg latest.json changed concurrently; refusing to overwrite it');
	const promotedEtag = strongEntityTag(response.headers.get('etag'), 'Promoted FFmpeg latest.json');
	const descriptor = {
		key: pointerKey,
		bytes: pointerBytes,
		byteLength: pointerBytes.byteLength,
		sha256: sha256(pointerBytes),
		contentType: pointerPolicy.contentType,
		cacheControl: pointerPolicy.cacheControl,
	};
	verifyStoredObject(await client.get(pointerKey, pointerBytes.byteLength), descriptor, 'Stored FFmpeg latest.json');
	try {
		await purgeUrls([pointerUrl]);
		await publicFetchVerified(publicFetch, pointerUrl, descriptor, {
			immutableCacheControl: pointerPolicy.cacheControl,
		}, true);
	} catch (error) {
		await rollbackPointer({
			client, current, descriptor, error, pointerKey, pointerPolicy, pointerUrl, promotedEtag, purgeUrls,
		});
	}
	return pointerBytes;
}

async function rollbackPointer({
	client, current, descriptor, error, pointerKey, pointerPolicy, pointerUrl, promotedEtag, purgeUrls,
}) {
	if (current.bytes) {
		const restored = await client.put(pointerKey, current.bytes, {
			contentType: pointerPolicy.contentType,
			cacheControl: pointerPolicy.cacheControl,
			ifMatch: promotedEtag,
		});
		assert(restored.status === 200,
			`Public smoke failed and restoring FFmpeg latest.json also failed: ${error.message}`);
		const restoredDescriptor = {
			...descriptor,
			bytes: current.bytes,
			byteLength: current.bytes.byteLength,
			sha256: sha256(current.bytes),
		};
		verifyStoredObject(
			await client.get(pointerKey, current.bytes.byteLength), restoredDescriptor, 'Restored FFmpeg latest.json',
		);
		await purgeUrls([pointerUrl]);
		throw new Error(`Public FFmpeg pointer smoke failed; restored the prior release: ${error.message}`);
	}
	const unavailable = await client.put(pointerKey, UNAVAILABLE_POINTER_BYTES, {
		contentType: pointerPolicy.contentType,
		cacheControl: pointerPolicy.cacheControl,
		ifMatch: promotedEtag,
	});
	if (unavailable.status === 200) {
		const unavailableDescriptor = {
			...descriptor,
			bytes: UNAVAILABLE_POINTER_BYTES,
			byteLength: UNAVAILABLE_POINTER_BYTES.byteLength,
			sha256: sha256(UNAVAILABLE_POINTER_BYTES),
		};
		verifyStoredObject(
			await client.get(pointerKey, UNAVAILABLE_POINTER_BYTES.byteLength),
			unavailableDescriptor,
			'Unavailable FFmpeg latest.json',
		);
		await purgeUrls([pointerUrl]);
		throw new Error(
			`Public FFmpeg pointer smoke failed; replaced the first pointer with an unavailable marker: ${error.message}`,
		);
	}
	assert(unavailable.status === 412,
		`First FFmpeg pointer rollback returned HTTP ${String(unavailable.status)}: ${error.message}`);
	await purgeUrls([pointerUrl]);
	throw new Error(
		`Public FFmpeg pointer smoke failed; a concurrent pointer was left in place: ${error.message}`,
	);
}

function verifyStoredObject(stored, descriptor, label) {
	assert(stored.response.status === 200, `${label} readback returned HTTP ${String(stored.response.status)}`);
	assert(stored.response.headers.get('content-type')?.toLowerCase() === descriptor.contentType.toLowerCase(),
		`${label} content type is invalid`);
	assert(stored.response.headers.get('cache-control') === descriptor.cacheControl,
		`${label} Cache-Control is invalid`);
	assert(stored.bytes.byteLength === descriptor.byteLength && sha256(stored.bytes) === descriptor.sha256,
		`${label} readback does not match its verified bytes`);
}

async function publicFetchVerified(fetchImpl, url, descriptor, policy, pointer = false) {
	const response = await fetchImpl(url, {
		method: 'GET',
		cache: 'no-store',
		credentials: 'omit',
		redirect: 'error',
		headers: { Origin: PUBLIC_SMOKE_ORIGIN, 'Cache-Control': 'no-cache' },
	});
	assert(response instanceof Response && response.status === 200,
		`Public runtime smoke returned HTTP ${String(response?.status)} for ${url}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	assert(bytes.byteLength === descriptor.byteLength && sha256(bytes) === descriptor.sha256,
		`Public runtime smoke bytes are invalid for ${url}`);
	assert(response.headers.get('content-type')?.toLowerCase() === descriptor.contentType.toLowerCase(),
		`Public runtime smoke content type is invalid for ${url}`);
	const expectedCacheControl = pointer ? policy.immutableCacheControl : descriptor.cacheControl;
	assert(response.headers.get('cache-control') === expectedCacheControl,
		`Public runtime smoke Cache-Control is invalid for ${url}`);
	const allowedOrigin = response.headers.get('access-control-allow-origin');
	assert(allowedOrigin === PUBLIC_SMOKE_ORIGIN || allowedOrigin === '*',
		`Public runtime smoke CORS does not allow ${PUBLIC_SMOKE_ORIGIN} for ${url}`);
}

export function runtimePointer(release, releasePrefix) {
	return Buffer.from(`${JSON.stringify({
		schemaVersion: 1,
		releaseId: release.manifestSha256,
		manifest: {
			path: `${releasePrefix}/${release.manifest.publication.manifestName}`,
			byteLength: release.manifestBytes.byteLength,
			sha256: release.manifestSha256,
		},
		files: Object.fromEntries(release.runtimeFiles.map((file) => [file.name, {
			path: `${releasePrefix}/${file.name}`,
			byteLength: file.byteLength,
			sha256: file.sha256,
		}])),
	}, null, 2)}\n`);
}

function publicObjectUrl(policy, key) {
	assert(key.startsWith(`${policy.publicPrefix}/`), `Public runtime object leaves ${policy.publicPrefix}`);
	return `${policy.publicOrigin}/${key}`;
}

function createRuntimeR2Client({ bucket, jurisdiction }) {
	const client = new R2Client({
		environmentPrefix: 'R2_FFMPEG',
		defaultBucket: bucket,
		label: 'FFmpeg runtime',
	});
	validateRuntimeClient(client, { bucket, jurisdiction });
	return client;
}

function validateRuntimeClient(client, { bucket, jurisdiction }) {
	assert(client && typeof client.get === 'function' && typeof client.put === 'function',
		'FFmpeg runtime R2 client is invalid');
	if (client.bucket !== undefined) assert(client.bucket === bucket,
		`R2_FFMPEG_BUCKET is ${client.bucket}, but the runtime manifest publishes to ${bucket}`);
	if (jurisdiction && client.endpoint?.hostname) {
		assert(client.endpoint.hostname.includes(`.${jurisdiction}.r2.cloudflarestorage.com`),
			`R2_FFMPEG_ENDPOINT must use the ${jurisdiction} jurisdiction endpoint`);
	}
}

async function applyRuntimeCors({ bucket, jurisdiction, bytes, repositoryRoot }) {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-runtime-cors-'));
	try {
		const file = resolve(temporaryRoot, 'r2-cors.json');
		await mkdir(temporaryRoot, { recursive: true });
		await writeFile(file, bytes, { flag: 'wx' });
		const wrangler = resolve(repositoryRoot, 'node_modules/wrangler/bin/wrangler.js');
		const result = spawnSync(process.execPath, [
			wrangler, 'r2', 'bucket', 'cors', 'set', bucket,
			'--file', file,
			...(jurisdiction ? ['--jurisdiction', jurisdiction] : []),
		], { cwd: resolve(repositoryRoot), stdio: 'inherit' });
		if (result.error) throw result.error;
		assert(result.status === 0, `Applying runtime CORS failed with status ${String(result.status)}`);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

async function purgeCloudflareUrls(urls) {
	const zoneId = process.env.CLOUDFLARE_ZONE_ID;
	const token = process.env.CLOUDFLARE_API_TOKEN;
	assert(zoneId && /^[a-f\d]{32}$/u.test(zoneId), 'CLOUDFLARE_ZONE_ID is required for exact runtime cache purges');
	assert(token, 'CLOUDFLARE_API_TOKEN is required for exact runtime cache purges');
	for (let offset = 0; offset < urls.length; offset += 30) {
		const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ files: urls.slice(offset, offset + 30) }),
		});
		const result = await response.json().catch(() => null);
		assert(response.ok && result?.success === true,
			`Cloudflare runtime cache purge failed (${String(response.status)})`);
	}
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
