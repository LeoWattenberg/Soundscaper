/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { verifyFfmpegRuntimeManifest } from '../scripts/lib/ffmpeg-runtime-manifest.mjs';
import {
	COLD_START_VARIABLE,
	admitPagesColdStart,
	preflightPagesDeployment,
	verifyLivePagesCachePolicy,
} from '../scripts/lib/pages-deploy-preflight.mjs';
import { webBuildRouting } from '../scripts/lib/product-web-routing.mjs';
import { runtimePointer } from '../scripts/lib/ffmpeg-runtime-publisher.mjs';
import { createFixture } from './helpers/ffmpeg-runtime-fixture.mjs';
import { livePagesDeployment as liveDeployment } from './helpers/pages-live-deployment-fixture.mjs';
import { ZONE_BROWSER_TTL } from './helpers/pages-cache-policy-values.mjs';

test('legacy runtime publication preflight accepts only exact content-addressed objects', async (context) => {
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

test('Pages CLI separates predecessor preflight from intended post-deploy verification', async () => {
	const [source, verifier, packageMetadata, documentation] = await Promise.all([
		readFile('scripts/preflight-pages-deploy.mjs', 'utf8'),
		readFile('scripts/verify-pages-deploy.mjs', 'utf8'),
		readFile('package.json', 'utf8').then(JSON.parse),
		readFile('Technical_README.md', 'utf8'),
	]);
	assert.doesNotMatch(source, /ffmpeg|preflightPagesDeployment|runtime-publication/iu);
	assert.match(source, /verifyLivePagesCachePolicy/u);
	assert.match(source, /webBuildRouting/u, 'the audit uses the selected product routing');
	// The gate must never take its audit sample from the build it is gating: the
	// live origin is the previous deployment and has none of the new hashes.
	assert.doesNotMatch(source, /dist\/offline-shell\.json/u, 'the audit sample comes from the live origin');
	assert.match(source, /admitPagesColdStart\(process\.env\)/u, 'a cold start is declared, never inferred');
	assert.match(source, /SCAPE_DEPLOY_AUDIT_ORIGIN/u, 'the project hostname may be named explicitly');
	assert.match(source, /coldStart/u);
	assert.match(source, /includeRetired: false/u);
	assert.match(verifier, /includeRetired: true/u);
	assert.match(
		verifier,
		/verifyPublishedPagesCachePolicy/u,
		'the post-deploy gate tolerates propagation; the preflight does not',
	);
	assert.match(packageMetadata.scripts['build:pages'], /npm run build.*preflight-pages-deploy\.mjs/u);
	assert.match(packageMetadata.scripts['verify:pages'], /verify-pages-deploy\.mjs/u);
	assert.match(packageMetadata.scripts.deploy, /^npm run build:pages && wrangler pages deploy/u);
	assert.match(documentation, /gated build command\s+`npm run build:pages`/u);
	assert.match(documentation, /do not\s+replace it with the ungated `npm run build`/u);
	const workflow = await readFile('.github/workflows/quality.yml', 'utf8');
	const orderedSteps = [
		'Build Framescaper',
		'Deploy Framescaper',
		'Verify Framescaper deployment',
		'Build Soundscaper',
		'Deploy Soundscaper',
		'Verify Soundscaper deployment',
	];
	let preceding = -1;
	for (const step of orderedSteps) {
		const position = workflow.indexOf(`- name: ${step}`);
		assert.ok(position > preceding, `${step} must follow the prior Pages cutover step`);
		preceding = position;
	}
});

test('live Pages policy preserves checked-in browser TTLs for stable routes and immutable assets', async () => {
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'soundscaper' });
	const assetPath = '/assets/site-entry-AbCd1234.js';
	const live = liveDeployment({ routing, assetPath, zoneBrowserTtl: ZONE_BROWSER_TTL, includeRetired: false });

	assert.deepEqual(await verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl, includeRetired: false }), {
		verifiedRouteCount: live.descriptors.length,
		assetPath,
		coldStart: false,
	});
	assert.deepEqual([...new Set(live.paths())].sort(), [
		'/',
		'/assets/site-entry-AbCd1234.js',
		'/embed/en/',
		'/en/',
		'/logo/logo-klein-schwarz.svg',
		'/logo/logo-klein-weiß.svg',
		'/manifest-soundscaper.webmanifest',
		'/offline-icons/soundscaper-180.png',
		'/offline-shell.json',
		'/service-worker.js',
	]);

	live.served.get('/en/').cacheControl = 'public, max-age=14400';
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl, includeRetired: false }),
		/Cache-Control is invalid.*\/en\//u,
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

test('a cold start is admitted only as a declaration, never inferred', () => {
	assert.equal(COLD_START_VARIABLE, 'SCAPE_PAGES_COLD_START');
	assert.equal(admitPagesColdStart({}), false);
	assert.equal(admitPagesColdStart({ SCAPE_PAGES_COLD_START: '' }), false);
	assert.equal(admitPagesColdStart({ SCAPE_PAGES_COLD_START: '1' }), true);
	assert.throws(
		() => admitPagesColdStart({ SCAPE_PAGES_COLD_START: 'true' }),
		/SCAPE_PAGES_COLD_START must be "1" or unset; received "true"\./u,
	);
});

test('an origin that has never been deployed passes only when the build declared it', async () => {
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'framescaper' });
	const requests = [];
	// A hostname with no deployment answers nothing at all: `fetch` rejects with
	// a TypeError because the name does not resolve. That is the one state a
	// deployment cannot produce, and it is the only evidence of a cold start.
	const silent = async (url) => {
		requests.push(String(url));
		throw new TypeError('fetch failed');
	};

	assert.deepEqual(await verifyLivePagesCachePolicy({ routing, fetchImpl: silent, coldStart: true }), {
		verifiedRouteCount: 0,
		assetPath: null,
		coldStart: true,
	});
	assert.equal(requests.length, 1, 'a cold start probes the origin once and stops');
	assert.match(requests[0], /^https:\/\/framescaper\.org\/\?pages-deploy-audit=[a-z0-9]+$/u);

	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing, fetchImpl: silent }),
		/found no deployment answering https:\/\/framescaper\.org.*SCAPE_PAGES_COLD_START=1.*it is down/su,
	);
});

test('a deployed origin is never mistaken for one that was never deployed', async () => {
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'framescaper' });
	// A broken deployment still answers — 404, 500, a Cloudflare error page. The
	// declaration must not launder any of them into "not deployed yet".
	for (const status of [404, 500, 522]) {
		const fetchImpl = async () => new Response(null, { status });
		await assert.rejects(
			() => verifyLivePagesCachePolicy({ routing, fetchImpl, coldStart: true }),
			/SCAPE_PAGES_COLD_START is set but https:\/\/framescaper\.org is already answering/u,
			`HTTP ${String(status)} is a deployment`,
		);
		await assert.rejects(
			() => verifyLivePagesCachePolicy({ routing, fetchImpl }),
			/received HTTP/u,
			`HTTP ${String(status)} is audited`,
		);
	}
	const redirecting = async () => Response.redirect('https://elsewhere.test/', 302);
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing, fetchImpl: redirecting, coldStart: true }),
		/is already answering/u,
		'a redirect is an answer',
	);
});

test('each deploy audits the hostname people actually load', async () => {
	// framescaper.org is attached to the framescaper Pages project and already
	// carries a deployment, so nothing may stand between the gate and it.
	// Naming the project's *.pages.dev hostname would leave the custom domain —
	// the one with the zone settings and the one visitors reach — unaudited,
	// and a cold-start declaration on a live origin would let an outage of the
	// deployment being replaced pass as "never deployed", which is exactly the
	// failure that declaration exists to make impossible.
	const workflow = await readFile('.github/workflows/quality.yml', 'utf8');
	const section = (name, next) => workflow.slice(workflow.indexOf(`- name: Build ${name}`), workflow.indexOf(`- name: Deploy ${next}`));
	for (const product of ['Soundscaper', 'Framescaper']) {
		assert.doesNotMatch(section(product, product), /SCAPE_PAGES_COLD_START/u);
		assert.doesNotMatch(section(product, product), /SCAPE_DEPLOY_AUDIT_ORIGIN/u);
	}
});

test('the zone browser cache TTL excuses no-cache on either product origin, and nothing else', async () => {
	// Both product zones set a four-hour Browser Cache TTL, which Cloudflare
	// applies to whatever it caches that names no lifetime of its own. Which
	// routes that covers is the zone's decision: soundscaper.org caches its
	// documents and rewrites all of them, framescaper.org caches only the
	// artwork and still serves its documents `no-cache`. Both are legitimate on
	// those origins, so both are admitted for a `no-cache` route — and nothing
	// else is.
	const soundscaper = webBuildRouting({ SCAPE_PRODUCT: 'soundscaper' });
	const framescaper = webBuildRouting({ SCAPE_PRODUCT: 'framescaper' });
	const assetPath = '/assets/site-entry-AbCd1234.js';

	const rewritten = liveDeployment({ routing: soundscaper, assetPath, zoneBrowserTtl: ZONE_BROWSER_TTL });
	assert.deepEqual(
		[...rewritten.served].filter(([, { cacheControl }]) => cacheControl === ZONE_BROWSER_TTL).map(([path]) => path).sort(),
		[
			'/',
			'/embed/en/',
			'/en/',
			'/logo/logo-klein-schwarz.svg',
			'/logo/logo-klein-weiß.svg',
			'/manifest-soundscaper.webmanifest',
			'/offline-icons/soundscaper-180.png',
		],
		'the documents and the installed artwork are the routes that name no lifetime of their own',
	);
	assert.deepEqual(await verifyLivePagesCachePolicy({ routing: soundscaper, fetchImpl: rewritten.fetchImpl }), {
		verifiedRouteCount: rewritten.descriptors.length,
		assetPath,
		coldStart: false,
	});

	// framescaper.org caches the artwork and not the documents, so one live
	// deployment carries both values at once and still has to pass.
	const mixed = liveDeployment({ routing: framescaper, assetPath });
	for (const path of ['/logo/framescaper-icon.svg', '/offline-icons/framescaper-180.png']) {
		mixed.served.get(path).cacheControl = ZONE_BROWSER_TTL;
	}
	assert.deepEqual(await verifyLivePagesCachePolicy({ routing: framescaper, fetchImpl: mixed.fetchImpl }), {
		verifiedRouteCount: mixed.descriptors.length,
		assetPath,
		coldStart: false,
	});

	// Admitting the rewrite is not the same as admitting any lifetime.
	mixed.served.get('/en/').cacheControl = 'max-age=60';
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing: framescaper, fetchImpl: mixed.fetchImpl }),
		/Cache-Control is invalid for \/en\/: expected no-cache or max-age=14400, received max-age=60/u,
	);
	mixed.served.get('/en/').cacheControl = 'no-cache';

	// A `no-store` response is never cacheable, so the zone never touches it: a
	// service worker handed a browser TTL is a real fault, not the rewrite.
	mixed.served.get('/service-worker.js').cacheControl = ZONE_BROWSER_TTL;
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing: framescaper, fetchImpl: mixed.fetchImpl }),
		/Cache-Control is invalid for \/service-worker\.js: expected no-store, received max-age=14400/u,
	);

	// The setting belongs to the two product zones. framescaper.pages.dev is on
	// neither, so the same rewrite there is a change and has to fail.
	const origin = 'https://framescaper.pages.dev';
	const preview = liveDeployment({ routing: framescaper, assetPath, zoneBrowserTtl: ZONE_BROWSER_TTL });
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing: framescaper, origin, fetchImpl: preview.fetchImpl }),
		/Cache-Control is invalid for \/: expected no-cache, received max-age=14400/u,
	);
	assert.deepEqual(
		await verifyLivePagesCachePolicy({
			routing: framescaper,
			origin,
			fetchImpl: liveDeployment({ routing: framescaper, assetPath }).fetchImpl,
		}),
		{ verifiedRouteCount: preview.descriptors.length, assetPath, coldStart: false },
	);
});

test('an audit reads the deployment, not the CDN entry the previous one left behind', async () => {
	// Cloudflare fronts a Pages origin with its own cache and does not honour a
	// client's Cache-Control: no-cache, so a path the previous deployment served
	// keeps answering from that entry for as long as its s-maxage — four hours for
	// a document and a week for an immutable asset. Retired paths are exactly the
	// ones a cutover deploy stops serving, so the audit read the answer the
	// previous deployment had left and called a correct deploy broken. Waiting
	// cannot reach past that TTL; only a cache key no earlier deployment used can.
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'soundscaper' });
	const assetPath = '/assets/site-entry-AbCd1234.js';
	const live = liveDeployment({ routing, assetPath });
	const seen = [];
	// The stand-in CDN: any URL whose key an earlier deployment already populated
	// is answered from that deployment, which served every retired path.
	const fetchImpl = async (url, init) => {
		seen.push(String(url));
		if (!new URL(url).searchParams.has('pages-deploy-audit')) {
			return new Response('previous deployment', {
				status: 200,
				headers: { 'cache-control': 'public, max-age=14400, s-maxage=604800' },
			});
		}
		return live.fetchImpl(url, init);
	};

	assert.deepEqual(await verifyLivePagesCachePolicy({ routing, fetchImpl }), {
		verifiedRouteCount: live.descriptors.length,
		assetPath,
		coldStart: false,
	});
	assert.ok(seen.length > 0);
	for (const url of seen) {
		assert.match(url, /[?&]pages-deploy-audit=[a-z0-9]+/u, `${url} was addressed without a fresh cache key`);
	}
	const first = new URL(seen[0]).searchParams.get('pages-deploy-audit');
	assert.ok(seen.every((url) => new URL(url).searchParams.get('pages-deploy-audit') === first),
		'one pass uses one token, so a run reads one deployment');

	// A retry must not be answered by whatever its own earlier attempt cached.
	seen.length = 0;
	await verifyLivePagesCachePolicy({ routing, fetchImpl });
	assert.notEqual(new URL(seen[0]).searchParams.get('pages-deploy-audit'), first);
});
