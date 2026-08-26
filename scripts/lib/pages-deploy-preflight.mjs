/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import { snapshotVerifiedFfmpegRuntime } from './ffmpeg-runtime-manifest.mjs';
import { runtimePointer } from './ffmpeg-runtime-publisher.mjs';

const PUBLIC_SMOKE_ORIGIN = 'https://soundscaper.org';
const MAXIMUM_OBJECT_BYTES = 64 * 1024 * 1024;

export async function preflightPagesDeployment({ release, fetchImpl = fetch }) {
	const snapshot = snapshotVerifiedFfmpegRuntime(release);
	assert(release.manifest.authorizations.runtimePublication.status === 'approved',
		`Pages deployment is blocked by ${release.manifest.authorizations.runtimePublication.blockedBy.join(', ')}`);
	const policy = snapshot.publicPolicy;
	const releasePrefix = `${policy.publicPrefix}/${policy.releaseSegment}/${release.manifestSha256}`;
	const pointer = Object.freeze({
		url: `${policy.publicOrigin}/${policy.publicPrefix}/${policy.pointer.name}`,
		bytes: runtimePointer(release, releasePrefix),
		contentType: policy.pointer.contentType,
		cacheControl: policy.pointer.cacheControl,
		mutable: true,
	});
	await fetchExact(fetchImpl, pointer);
	const objects = [
		...snapshot.runtimeFiles.map((file) => ({
			url: `${policy.publicOrigin}/${releasePrefix}/${file.name}`,
			bytes: file.bytes,
			contentType: file.contentType,
		})),
		{
			url: `${policy.publicOrigin}/${releasePrefix}/${release.manifest.publication.noticeName}`,
			bytes: snapshot.evidence.notices.bytes,
			contentType: 'text/markdown; charset=utf-8',
		},
		{
			url: `${policy.publicOrigin}/${releasePrefix}/${release.manifest.publication.correspondingSourceName}`,
			bytes: snapshot.evidence.correspondingSource.bytes,
			contentType: 'application/json; charset=utf-8',
		},
		{
			url: `${policy.publicOrigin}/${releasePrefix}/${release.manifest.publication.manifestName}`,
			bytes: snapshot.manifestBytes,
			contentType: 'application/json; charset=utf-8',
		},
	].map((object) => ({
		...object,
		cacheControl: policy.immutableCacheControl,
		mutable: false,
	}));
	for (const object of objects) await fetchExact(fetchImpl, object);
	return Object.freeze({ manifestSha256: release.manifestSha256, verifiedObjectCount: objects.length + 1 });
}

async function fetchExact(fetchImpl, descriptor) {
	const response = await fetchImpl(descriptor.url, {
		method: 'GET',
		cache: 'no-store',
		credentials: 'omit',
		redirect: 'error',
		headers: { Origin: PUBLIC_SMOKE_ORIGIN, 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' },
	});
	assert(response instanceof Response && response.status === 200,
		`Pages deploy preflight received HTTP ${String(response?.status)} for ${descriptor.url}`);
	assert(response.headers.get('content-encoding') === null,
		`Pages deploy preflight received encoded bytes for ${descriptor.url}`);
	assert(response.headers.get('content-length') === String(descriptor.bytes.byteLength),
		`Pages deploy preflight Content-Length is invalid for ${descriptor.url}`);
	assert(response.headers.get('content-type')?.toLowerCase() === descriptor.contentType.toLowerCase(),
		`Pages deploy preflight Content-Type is invalid for ${descriptor.url}`);
	assert(response.headers.get('cache-control') === descriptor.cacheControl,
		`Pages deploy preflight Cache-Control is invalid for ${descriptor.url}`);
	const allowedOrigin = response.headers.get('access-control-allow-origin');
	assert(allowedOrigin === PUBLIC_SMOKE_ORIGIN || allowedOrigin === '*',
		`Pages deploy preflight CORS does not allow ${PUBLIC_SMOKE_ORIGIN} for ${descriptor.url}`);
	const cacheStatus = response.headers.get('cf-cache-status')?.toUpperCase() ?? '';
	if (!descriptor.mutable) {
		assert(['HIT', 'MISS', 'EXPIRED', 'REVALIDATED', 'UPDATING'].includes(cacheStatus),
			`Pages deploy preflight requires an eligible Cloudflare cache status for ${descriptor.url}; received ${cacheStatus || '<missing>'}`);
	}
	assert(descriptor.bytes.byteLength <= MAXIMUM_OBJECT_BYTES,
		`Pages deploy preflight descriptor exceeds its byte limit for ${descriptor.url}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	assert(bytes.byteLength === descriptor.bytes.byteLength && sha256(bytes) === sha256(descriptor.bytes),
		`Pages deploy preflight bytes are invalid for ${descriptor.url}`);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
