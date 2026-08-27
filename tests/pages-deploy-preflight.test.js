/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { verifyFfmpegRuntimeManifest } from '../scripts/lib/ffmpeg-runtime-manifest.mjs';
import {
	pagesCachePolicyDescriptors,
	preflightPagesDeployment,
	verifyLivePagesCachePolicy,
} from '../scripts/lib/pages-deploy-preflight.mjs';
import { webBuildRouting } from '../scripts/lib/product-web-routing.mjs';
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
	objects.get(`${policy.publicOrigin}/${prefix}/ffmpeg-core.wasm`).cacheStatus = 'HIT';
	objects.get(`${policy.publicOrigin}/${policy.publicPrefix}/${policy.pointer.name}`).cacheStatus = 'HIT';
	await assert.rejects(
		() => preflightPagesDeployment({ release, fetchImpl }),
		/requires pointer cache bypass.*HIT/iu,
	);
	const pointer = objects.get(`${policy.publicOrigin}/${policy.publicPrefix}/${policy.pointer.name}`);
	pointer.cacheStatus = 'DYNAMIC';
	pointer.age = '4';
	await assert.rejects(
		() => preflightPagesDeployment({ release, fetchImpl }),
		/requires pointer cache bypass without Age.*DYNAMIC/iu,
	);
});

test('Pages CLI authenticates policy before any live runtime request', async () => {
	const [source, packageMetadata, documentation] = await Promise.all([
		readFile('scripts/preflight-pages-deploy.mjs', 'utf8'),
		readFile('package.json', 'utf8').then(JSON.parse),
		readFile('Technical_README.md', 'utf8'),
	]);
	assert.ok(
		source.indexOf("purpose: 'runtime-publication'") < source.indexOf('const result = await preflightPagesDeployment'),
		'checked-in publication authorization must precede live preflight requests',
	);
	assert.ok(
		source.indexOf('const result = await preflightPagesDeployment')
			< source.indexOf('const pages = await verifyLivePagesCachePolicy'),
		'the exact runtime must be live before the Pages hostname cache policy is accepted',
	);
	assert.match(packageMetadata.scripts['build:pages'], /npm run build.*preflight-pages-deploy\.mjs/u);
	assert.match(packageMetadata.scripts.deploy, /^npm run build:pages && wrangler pages deploy/u);
	assert.match(documentation, /gated build command\s+`npm run build:pages`/u);
	assert.match(documentation, /do not replace it with the ungated `npm run build`/u);
});

test('live Pages policy preserves checked-in browser TTLs for stable routes and immutable assets', async () => {
	const origin = 'https://soundscaper.org';
	const assetPath = '/assets/site-entry-AbCd1234.js';
	const policies = new Map([
		...['/', '/en/', '/embed/en/', '/framescaper/en/', '/framescaper/embed/en/']
			.map((path) => [path, { cacheControl: 'no-cache' }]),
		...[
			'/logo/logo-klein-schwarz.svg',
			'/logo/logo-klein-weiß.svg',
			'/logo/framescaper-icon.svg',
			'/offline-icons/soundscaper-180.png',
			'/offline-icons/framescaper-180.png',
			'/manifest-soundscaper.webmanifest',
			'/manifest-framescaper.webmanifest',
		].map((path) => [path, { cacheControl: 'no-cache' }]),
		['/offline-shell.json', { cacheControl: 'no-store' }],
		['/service-worker.js', { cacheControl: 'no-store', serviceWorkerAllowed: '/' }],
		['/framescaper/service-worker.js', {
			cacheControl: 'no-store', serviceWorkerAllowed: '/framescaper/',
		}],
		[assetPath, { cacheControl: 'public, max-age=31536000, immutable' }],
	]);
	const requests = [];
	const fetchImpl = async (url) => {
		const parsed = new URL(url);
		const pathname = decodeURIComponent(parsed.pathname);
		requests.push(pathname);
		const policy = policies.get(pathname);
		if (!policy) return new Response(null, { status: 404 });
		return new Response('ok', {
			status: 200,
			headers: {
				'cache-control': policy.cacheControl,
				...(policy.serviceWorkerAllowed
					? { 'service-worker-allowed': policy.serviceWorkerAllowed }
					: {}),
			},
		});
	};

	assert.deepEqual(await verifyLivePagesCachePolicy({ origin, assetPath, fetchImpl }), {
		verifiedRouteCount: policies.size,
	});
	assert.deepEqual(requests.sort(), [...policies.keys()].sort());

	policies.get('/en/').cacheControl = 'public, max-age=14400';
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ origin, assetPath, fetchImpl }),
		/Cache-Control is invalid.*\/en\//u,
	);
});

test('a Framescaper deployment audits its own origin and its own root routes', async () => {
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'framescaper' });
	const assetPath = '/assets/site-entry-AbCd1234.js';
	const descriptors = pagesCachePolicyDescriptors({ routing, assetPath });
	assert.deepEqual(descriptors.map(({ path }) => path).sort(), [
		'/',
		'/assets/site-entry-AbCd1234.js',
		'/embed/en/',
		'/en/',
		'/logo/framescaper-icon.svg',
		'/manifest-framescaper.webmanifest',
		'/offline-icons/framescaper-180.png',
		'/offline-shell.json',
		'/service-worker.js',
	]);
	assert.equal(descriptors.every(({ expectation }) => expectation === 'served'), true);
	assert.deepEqual(
		descriptors.find(({ path }) => path === '/service-worker.js'),
		{ path: '/service-worker.js', expectation: 'served', cacheControl: 'no-store', serviceWorkerAllowed: '/' },
	);

	const requests = [];
	const fetchImpl = async (url) => {
		const parsed = new URL(url);
		requests.push(parsed.href);
		const descriptor = descriptors.find(({ path }) => path === decodeURIComponent(parsed.pathname));
		if (!descriptor) return new Response(null, { status: 404 });
		return new Response('ok', {
			status: 200,
			headers: {
				'cache-control': descriptor.cacheControl,
				...(descriptor.serviceWorkerAllowed ? { 'service-worker-allowed': descriptor.serviceWorkerAllowed } : {}),
			},
		});
	};
	assert.deepEqual(await verifyLivePagesCachePolicy({ routing, assetPath, fetchImpl }), {
		verifiedRouteCount: descriptors.length,
	});
	assert.equal(requests.every((href) => href.startsWith('https://framescaper.org/')), true, requests.join(' '));
});

test('a retired product path is audited as a permanent redirect rather than as a served document', async () => {
	const full = webBuildRouting({ SCAPE_PRODUCT: 'soundscaper' });
	const routing = Object.freeze({
		...full,
		plans: full.plans.filter(({ root }) => root),
		workers: full.workers.filter(({ root }) => root),
	});
	const assetPath = '/assets/site-entry-AbCd1234.js';
	const descriptors = pagesCachePolicyDescriptors({ routing, assetPath });
	assert.deepEqual(descriptors.filter(({ expectation }) => expectation === 'redirected'), [
		{ path: '/framescaper/en/', expectation: 'redirected', location: 'https://framescaper.org/en/' },
		{ path: '/framescaper/embed/en/', expectation: 'redirected', location: 'https://framescaper.org/embed/en/' },
		{
			path: '/framescaper/service-worker.js',
			expectation: 'redirected',
			location: 'https://framescaper.org/service-worker.js',
		},
	]);

	const redirects = new Map(descriptors
		.filter(({ expectation }) => expectation === 'redirected')
		.map(({ path, location }) => [path, location]));
	const served = new Map(descriptors
		.filter(({ expectation }) => expectation === 'served')
		.map((descriptor) => [descriptor.path, descriptor]));
	const expectations = new Map(descriptors.map(({ path, expectation }) => [path, expectation]));
	const fetchImpl = async (url, init) => {
		const pathname = decodeURIComponent(new URL(url).pathname);
		assert.equal(init.redirect, expectations.get(pathname) === 'redirected' ? 'manual' : 'error', pathname);
		if (redirects.has(pathname)) return Response.redirect(redirects.get(pathname), 301);
		const descriptor = served.get(pathname);
		if (!descriptor) return new Response(null, { status: 404 });
		return new Response('ok', {
			status: 200,
			headers: {
				'cache-control': descriptor.cacheControl,
				...(descriptor.serviceWorkerAllowed ? { 'service-worker-allowed': descriptor.serviceWorkerAllowed } : {}),
			},
		});
	};
	assert.deepEqual(await verifyLivePagesCachePolicy({ routing, assetPath, fetchImpl }), {
		verifiedRouteCount: descriptors.length,
	});

	redirects.set('/framescaper/en/', 'https://soundscaper.org/en/');
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing, assetPath, fetchImpl }),
		/redirect target is invalid for \/framescaper\/en\//u,
	);
	redirects.delete('/framescaper/en/');
	served.set('/framescaper/en/', { path: '/framescaper/en/', cacheControl: 'no-cache' });
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing, assetPath, fetchImpl }),
		/requires a permanent redirect for \/framescaper\/en\/.*200/u,
	);
});

test('the deploy preflight presents the deploying origin to the runtime bucket CORS policy', async (context) => {
	const fixture = await createFixture(context);
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot: fixture.root,
		purpose: 'runtime-publication',
	});
	const origins = [];
	const fetchImpl = async (url, init) => {
		origins.push(init.headers.Origin);
		return new Response(new Uint8Array(0), { status: 404 });
	};
	await assert.rejects(
		() => preflightPagesDeployment({ release, fetchImpl, origin: 'https://framescaper.org' }),
		/received HTTP 404/u,
	);
	assert.deepEqual([...new Set(origins)], ['https://framescaper.org']);
});

function objectResponse(object) {
	if (!object) return new Response(null, { status: 404 });
	const headers = {
		'content-length': String(object.bytes.byteLength),
		'content-type': object.contentType,
		'cache-control': object.cacheControl,
		'access-control-allow-origin': 'https://soundscaper.org',
		'cf-cache-status': object.cacheStatus,
	};
	if (object.age !== undefined) headers.age = object.age;
	return new Response(object.bytes, {
		status: 200,
		headers,
	});
}
