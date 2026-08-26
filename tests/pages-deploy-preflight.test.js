/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { verifyFfmpegRuntimeManifest } from '../scripts/lib/ffmpeg-runtime-manifest.mjs';
import { preflightPagesDeployment } from '../scripts/lib/pages-deploy-preflight.mjs';
import { runtimePointer } from '../scripts/lib/ffmpeg-runtime-publisher.mjs';
import { createFixture } from './helpers/ffmpeg-runtime-fixture.mjs';

test('Pages preflight accepts only the exact live content-addressed release and cache metadata', async (context) => {
	const fixture = await createFixture(context);
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot: fixture.root,
		purpose: 'runtime-publication',
	});
	const policy = release.publicPolicy;
	const prefix = `${policy.publicPrefix}/${policy.releaseSegment}/${release.manifestSha256}`;
	const objects = new Map([
		[`${policy.publicOrigin}/${policy.publicPrefix}/${policy.pointer.name}`, {
			bytes: runtimePointer(release, prefix),
			contentType: policy.pointer.contentType,
			cacheControl: policy.pointer.cacheControl,
			cacheStatus: 'DYNAMIC',
		}],
		...release.runtimeFiles.map((file) => [`${policy.publicOrigin}/${prefix}/${file.name}`, {
			bytes: file.bytes, contentType: file.contentType,
			cacheControl: policy.immutableCacheControl, cacheStatus: 'HIT',
		}]),
		[`${policy.publicOrigin}/${prefix}/${release.manifest.publication.noticeName}`, {
			bytes: release.evidence.notices.bytes, contentType: 'text/markdown; charset=utf-8',
			cacheControl: policy.immutableCacheControl, cacheStatus: 'MISS',
		}],
		[`${policy.publicOrigin}/${prefix}/${release.manifest.publication.correspondingSourceName}`, {
			bytes: release.evidence.correspondingSource.bytes, contentType: 'application/json; charset=utf-8',
			cacheControl: policy.immutableCacheControl, cacheStatus: 'REVALIDATED',
		}],
		[`${policy.publicOrigin}/${prefix}/${release.manifest.publication.manifestName}`, {
			bytes: release.manifestBytes, contentType: 'application/json; charset=utf-8',
			cacheControl: policy.immutableCacheControl, cacheStatus: 'HIT',
		}],
	]);
	const fetchImpl = async (url) => objectResponse(objects.get(String(url)));
	assert.deepEqual(await preflightPagesDeployment({ release, fetchImpl }), {
		manifestSha256: release.manifestSha256,
		verifiedObjectCount: 6,
	});

	objects.get(`${policy.publicOrigin}/${prefix}/ffmpeg-core.wasm`).cacheStatus = 'DYNAMIC';
	await assert.rejects(
		() => preflightPagesDeployment({ release, fetchImpl }),
		/requires an eligible Cloudflare cache status.*DYNAMIC/iu,
	);
});

test('Pages CLI authenticates policy before any live runtime request', async () => {
	const source = await readFile('scripts/preflight-pages-deploy.mjs', 'utf8');
	assert.ok(
		source.indexOf("purpose: 'runtime-publication'") < source.indexOf('const result = await preflightPagesDeployment'),
		'checked-in publication authorization must precede live preflight requests',
	);
});

function objectResponse(object) {
	if (!object) return new Response(null, { status: 404 });
	return new Response(object.bytes, {
		status: 200,
		headers: {
			'content-length': String(object.bytes.byteLength),
			'content-type': object.contentType,
			'cache-control': object.cacheControl,
			'access-control-allow-origin': 'https://soundscaper.org',
			'cf-cache-status': object.cacheStatus,
		},
	});
}
