/* SPDX-License-Identifier: AGPL-3.0-only */

// Publishing a staged translation release and rolling one back. Every object is
// written immutably before the pointer that names it moves, each published
// object is fetched back and checked against its digest and CORS headers first,
// and a rollback republishes an earlier release the same way rather than
// deleting anything. Split out of manage-audacity-translation-release.mjs; no
// behaviour changes here.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalJsonDocument as canonicalJson } from './canonical-json.mjs';
import { R2Client, strongEntityTag } from './r2-client.mjs';
import {
	MAX_MANIFEST_BYTES,
	MAX_POINTER_BYTES,
	PUBLIC_ROOT,
	ROOT_PREFIX,
	RELEASE_ID_PATTERN,
	TRANSLATION_ORIGIN,
	assert,
	fail,
	fetchLimited,
	normalizedPublicRoot,
	parseJson,
	publicObjectUrl,
	rejectUnknownOptions,
	requiredOption,
	sha256,
} from './audacity-translation-release-values.mjs';
import {
	validateAudacityLicense,
	validateLatest,
	validateManifestShape,
	validatePackShape,
	validateStage,
} from './audacity-translation-release-validation.mjs';


export function immutableContentType(path) {
	if (path.endsWith('.json')) return 'application/json; charset=utf-8';
	if (path.endsWith('.zip')) return 'application/zip';
	if (path.endsWith('.txt')) return 'text/plain; charset=utf-8';
	fail(`No content type registered for ${path}`);
}

export function pointerFromRelease(release) {
	const locales = {};
	for (const [locale, descriptor] of Object.entries(release.locales)) {
		locales[locale] = {
			name: descriptor.name,
			direction: descriptor.direction,
			eligible: descriptor.eligible,
			coverage: descriptor.coverage,
			mapped: descriptor.mapped,
			total: descriptor.total,
			path: descriptor.path,
			sha256: descriptor.sha256,
			byteLength: descriptor.byteLength,
		};
	}
	return {
		schemaVersion: 1,
		releaseId: release.releaseId,
		manifest: release.manifestDescriptor,
		mappingVersion: release.manifest.conversion.mappingVersion,
		mappingSha256: release.manifest.conversion.mappingSha256,
		normalizedContentSha256: release.manifest.normalizedContentSha256,
		pendingLocales: release.pendingLocales,
		locales,
		source: {
			repository: release.manifest.source.repository,
			workflowUrl: release.manifest.source.workflowUrl,
			runId: release.manifest.source.runId,
			headSha: release.manifest.source.headSha,
			artifactId: Number(release.releaseId),
			archive: release.archive,
		},
		publishedAt: new Date().toISOString(),
	};
}

export async function existingPointer(client) {
	const key = `${ROOT_PREFIX}/latest.json`;
	const result = await client.get(key, MAX_POINTER_BYTES, [200, 404]);
	if (result.response.status === 404) return { key, pointer: null, bytes: null, etag: null };
	const pointer = validateLatest(parseJson(result.bytes, 'stored latest.json'));
	const etag = strongEntityTag(result.response.headers.get('etag'), 'Stored latest.json');
	return { key, pointer, bytes: result.bytes, etag };
}

export async function putImmutable(client, key, bytes, contentType) {
	const response = await client.put(key, bytes, {
		contentType,
		cacheControl: 'public, max-age=31536000, immutable',
		ifNoneMatch: '*',
	});
	if (response.status === 412) {
		const existing = await client.get(key, bytes.byteLength);
		assert(existing.bytes.byteLength === bytes.byteLength && sha256(existing.bytes) === sha256(bytes),
			`Immutable R2 object already exists with different contents: ${key}`);
		return;
	}
	const stored = await client.get(key, bytes.byteLength);
	assert(stored.bytes.byteLength === bytes.byteLength && sha256(stored.bytes) === sha256(bytes),
		`R2 verification failed after writing ${key}`);
}

export function assertCors(response, label) {
	const allowedOrigin = response.headers.get('access-control-allow-origin');
	assert(allowedOrigin === TRANSLATION_ORIGIN || allowedOrigin === '*',
		`${label} does not allow ${TRANSLATION_ORIGIN} through CORS`);
}

export async function publicFetchVerified(baseUrl, descriptor, label, parse = false) {
	const smokeUrl = `${publicObjectUrl(baseUrl, descriptor.path)}?smoke=${Date.now()}-${encodeURIComponent(label)}`;
	const { response, bytes } = await fetchLimited(smokeUrl, {
		maximum: descriptor.byteLength,
		label,
		headers: { Origin: TRANSLATION_ORIGIN, 'Cache-Control': 'no-cache' },
	});
	assertCors(response, label);
	assert(bytes.byteLength === descriptor.byteLength && sha256(bytes) === descriptor.sha256,
		`${label} does not match its published descriptor`);
	return parse ? parseJson(bytes, label) : bytes;
}

export async function publicSmokeRelease(baseUrl, release, { canonicalCatalog = false } = {}) {
	await publicFetchVerified(baseUrl, release.manifestDescriptor, 'public release manifest', true);
	const seen = new Set();
	for (const [locale, descriptor] of Object.entries(release.locales)) {
		if (seen.has(descriptor.path)) continue;
		const pack = await publicFetchVerified(baseUrl, descriptor, `public ${locale} pack`, true);
		validatePackShape(pack, locale, `public ${locale} pack`, descriptor, { canonicalCatalog });
		seen.add(descriptor.path);
	}
}

export async function publicSmokePointer(baseUrl, expectedBytes) {
	const { response, bytes } = await fetchLimited(`${publicObjectUrl(baseUrl, 'latest.json')}?smoke=${Date.now()}`, {
		maximum: MAX_POINTER_BYTES,
		label: 'public latest.json',
		headers: { Origin: TRANSLATION_ORIGIN, 'Cache-Control': 'no-cache' },
	});
	assertCors(response, 'public latest.json');
	assert(sha256(bytes) === sha256(expectedBytes), 'Public latest.json does not match the promoted pointer');
	validateLatest(parseJson(bytes, 'public latest.json'));
}

export async function promotePointer(client, current, pointer, publicBaseUrl, smokePointer = publicSmokePointer) {
	const bytes = Buffer.from(canonicalJson(pointer));
	assert(bytes.byteLength <= MAX_POINTER_BYTES, `latest.json exceeds ${MAX_POINTER_BYTES} bytes`);
	if (current.etag) strongEntityTag(current.etag, 'Stored latest.json');
	const response = await client.put(current.key, bytes, {
		contentType: 'application/json; charset=utf-8',
		cacheControl: 'no-store',
		...(current.etag ? { ifMatch: current.etag } : { ifNoneMatch: '*' }),
	});
	assert(response.status === 200, 'latest.json changed concurrently; refusing to overwrite it');
	const promotedEtag = strongEntityTag(response.headers.get('etag'), 'Promoted latest.json');
	const stored = await client.get(current.key, bytes.byteLength);
	assert(sha256(stored.bytes) === sha256(bytes), 'Stored latest.json does not match the promoted pointer');
	try {
		await smokePointer(publicBaseUrl, bytes);
	} catch (error) {
		if (current.bytes) {
			const restored = await client.put(current.key, current.bytes, {
				contentType: 'application/json; charset=utf-8',
				cacheControl: 'no-store',
				ifMatch: promotedEtag,
			});
			assert(restored.status === 200, `Public smoke test failed and restoring latest.json also failed: ${error.message}`);
			const check = await client.get(current.key, current.bytes.byteLength);
			assert(sha256(check.bytes) === sha256(current.bytes), 'Restored latest.json failed verification');
			fail(`Public smoke test failed; restored release ${current.pointer.releaseId}: ${error.message}`);
		}
		// R2's S3 DeleteObject has no conditional header. The workflow is serialized,
		// so re-read and match both ETag and bytes immediately before removing the
		// first pointer, then prove the key is absent.
		const candidate = await client.get(current.key, bytes.byteLength, [200, 404]);
		assert(candidate.response.status === 200
			&& candidate.response.headers.get('etag') === promotedEtag
			&& sha256(candidate.bytes) === sha256(bytes),
			`First-release public smoke test failed and latest.json changed before cleanup: ${error.message}`);
		await client.delete(current.key);
		const missing = await client.get(current.key, MAX_POINTER_BYTES, [200, 404]);
		assert(missing.response.status === 404,
			`First-release public smoke test failed and latest.json cleanup could not be verified: ${error.message}`);
		fail(`First-release public smoke test failed; removed the guarded latest.json pointer: ${error.message}`);
	}
	return bytes;
}

export async function publish(options) {
	rejectUnknownOptions(options, ['root', 'public-base-url']);
	const root = requiredOption(options, 'root');
	const publicBaseUrl = normalizedPublicRoot(options['public-base-url']
		?? process.env.PUBLIC_TRANSLATIONS_BASE_URL ?? PUBLIC_ROOT);
	const release = await validateStage(root);
	const client = new R2Client();
	const current = await existingPointer(client);
	if (current.pointer?.normalizedContentSha256 === release.manifest.normalizedContentSha256) {
		console.log(`Translation content is unchanged from release ${current.pointer.releaseId}; nothing published`);
		return;
	}
	for (const path of release.files) {
		const bytes = await readFile(join(release.root, path));
		await putImmutable(client, `${ROOT_PREFIX}/${path}`, bytes, immutableContentType(path));
	}
	await publicSmokeRelease(publicBaseUrl, release);
	const pointer = pointerFromRelease(release);
	await promotePointer(client, current, pointer, publicBaseUrl);
	console.log(`Published Audacity translation release ${release.releaseId}`);
}

export async function fetchRemoteDescriptor(client, descriptor, label) {
	const result = await client.get(`${ROOT_PREFIX}/${descriptor.path}`, descriptor.byteLength);
	assert(result.bytes.byteLength === descriptor.byteLength && sha256(result.bytes) === descriptor.sha256,
		`${label} does not match its release manifest`);
	return result.bytes;
}

export async function loadRemoteRelease(client, releaseId) {
	assert(RELEASE_ID_PATTERN.test(releaseId), '--release-id must be a positive artifact ID');
	const manifestPath = `releases/${releaseId}/manifest.json`;
	const { bytes: manifestBytes } = await client.get(`${ROOT_PREFIX}/${manifestPath}`, MAX_MANIFEST_BYTES);
	const manifest = parseJson(manifestBytes, `release ${releaseId} manifest`);
	const shape = validateManifestShape(manifest, releaseId);
	await fetchRemoteDescriptor(client, shape.archive, 'rollback source archive');
	const licenseBytes = await fetchRemoteDescriptor(client, shape.license, 'rollback source license');
	validateAudacityLicense(licenseBytes, 'rollback source license');
	const audit = await fetchRemoteDescriptor(client, shape.audit, 'rollback audit');
	parseJson(audit, 'rollback audit');
	for (const [locale, descriptor] of Object.entries(shape.locales)) {
		const packBytes = await fetchRemoteDescriptor(client, descriptor, `rollback ${locale} pack`);
		const pack = parseJson(packBytes, `rollback ${locale} pack`);
		validatePackShape(pack, locale, `rollback ${locale} pack`, descriptor, { canonicalCatalog: true });
	}
	return {
		manifest,
		manifestBytes,
		manifestDescriptor: { path: manifestPath, sha256: sha256(manifestBytes), byteLength: manifestBytes.byteLength },
		...shape,
	};
}

export async function rollback(options) {
	rejectUnknownOptions(options, ['release-id', 'public-base-url']);
	const releaseId = requiredOption(options, 'release-id');
	const publicBaseUrl = normalizedPublicRoot(options['public-base-url']
		?? process.env.PUBLIC_TRANSLATIONS_BASE_URL ?? PUBLIC_ROOT);
	const client = new R2Client();
	const current = await existingPointer(client);
	assert(current.pointer, 'Cannot roll back before an initial translation release exists');
	if (String(current.pointer.releaseId) === releaseId) {
		console.log(`Release ${releaseId} is already active`);
		return;
	}
	const release = await loadRemoteRelease(client, releaseId);
	await publicSmokeRelease(publicBaseUrl, release, { canonicalCatalog: true });
	const pointer = pointerFromRelease(release);
	await promotePointer(client, current, pointer, publicBaseUrl);
	console.log(`Promoted Audacity translation release ${releaseId}`);
}
