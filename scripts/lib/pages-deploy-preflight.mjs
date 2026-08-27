/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import { productWebOrigin } from '../../src/common/product-web-links.js';
import { snapshotVerifiedFfmpegRuntime } from './ffmpeg-runtime-manifest.mjs';
import { runtimePointer } from './ffmpeg-runtime-publisher.mjs';
import { webBuildRouting } from './product-web-routing.mjs';

const MAXIMUM_OBJECT_BYTES = 64 * 1024 * 1024;

/**
 * The artwork, icon and manifest each product installs, by product.
 *
 * Only the products this build serves emit these, so the audit list follows the
 * build's routing rather than naming both products unconditionally.
 */
const PRODUCT_INSTALL_ARTWORK = Object.freeze({
	soundscaper: Object.freeze([
		'/logo/logo-klein-schwarz.svg',
		'/logo/logo-klein-weiß.svg',
		'/offline-icons/soundscaper-180.png',
		'/manifest-soundscaper.webmanifest',
	]),
	framescaper: Object.freeze([
		'/logo/framescaper-icon.svg',
		'/offline-icons/framescaper-180.png',
		'/manifest-framescaper.webmanifest',
	]),
});

/**
 * Base paths a deployment served for a product before that product moved to an
 * origin of its own, keyed by the product the deployment belongs to.
 *
 * These paths are audited only while the deployment no longer serves that
 * product: a Cloudflare deployment cannot both emit a document and redirect its
 * path, so the build that drops `/framescaper/` from its routing is the same
 * build that must start redirecting it. Auditing them as *redirects* — never as
 * documents — is what stops the cutover deploy from being blocked by its own
 * change, and stops the old URLs from being silently abandoned instead.
 */
const RETIRED_PRODUCT_BASE_PATHS = Object.freeze({
	soundscaper: Object.freeze({ framescaper: '/framescaper' }),
	framescaper: Object.freeze({}),
});

/** The routes a retired base path kept, relative to that base path. */
const RETIRED_ROUTE_SUFFIXES = Object.freeze(['/en/', '/embed/en/', '/service-worker.js']);

export async function preflightPagesDeployment({
	release,
	fetchImpl = fetch,
	origin = webBuildRouting().site.origin,
}) {
	const deployOrigin = normalizedOrigin(origin, 'Pages deploy preflight origin').origin;
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
	await fetchExact(fetchImpl, pointer, deployOrigin);
	const objects = [
		...snapshot.runtimeFiles.map((file) => ({
			url: `${policy.publicOrigin}/${releasePrefix}/${file.name}`,
			bytes: file.bytes,
			contentType: file.contentType,
		})),
		{
			url: `${policy.publicOrigin}/${releasePrefix}/${release.manifest.publication.noticeName}`,
			bytes: snapshot.evidence.notices.bytes,
			contentType: policy.releaseMetadata.notice.contentType,
		},
		{
			url: `${policy.publicOrigin}/${releasePrefix}/${release.manifest.publication.correspondingSourceName}`,
			bytes: snapshot.evidence.correspondingSource.bytes,
			contentType: policy.releaseMetadata.correspondingSource.contentType,
		},
		{
			url: `${policy.publicOrigin}/${releasePrefix}/${release.manifest.publication.manifestName}`,
			bytes: snapshot.manifestBytes,
			contentType: policy.releaseMetadata.manifest.contentType,
		},
	].map((object) => ({
		...object,
		cacheControl: policy.immutableCacheControl,
		mutable: false,
	}));
	for (const object of objects) await fetchExact(fetchImpl, object, deployOrigin);
	return Object.freeze({ manifestSha256: release.manifestSha256, verifiedObjectCount: objects.length + 1 });
}

/**
 * Every route one product's deployment is accountable for, and what it owes.
 *
 * A `served` descriptor must answer 200 with the checked-in cache metadata and
 * must not redirect; a `redirected` descriptor must answer a permanent redirect
 * to the named absolute URL and must not serve a document.
 */
export function pagesCachePolicyDescriptors({ routing = webBuildRouting(), assetPath }) {
	assert(typeof assetPath === 'string' && /^\/assets\/[\w.-]+$/u.test(assetPath),
		'Pages cache-policy asset path must name one emitted asset.');
	const noCache = [];
	for (const plan of routing.plans) {
		if (plan.root) noCache.push('/');
		noCache.push(`${plan.basePath}/en/`, `${plan.basePath}/embed/en/`);
	}
	for (const plan of routing.plans) noCache.push(...PRODUCT_INSTALL_ARTWORK[plan.productId]);
	const descriptors = [
		...noCache.map((path) => served(path, 'no-cache')),
		served('/offline-shell.json', 'no-store'),
		...routing.workers.map(({ scriptUrl, scope }) => served(scriptUrl, 'no-store', scope)),
		served(assetPath, 'public, max-age=31536000, immutable'),
		...retiredRedirects(routing),
	];
	const paths = new Set(descriptors.map(({ path }) => path));
	assert(paths.size === descriptors.length, 'Pages cache-policy audit lists a route twice.');
	return Object.freeze(descriptors);
}

export async function verifyLivePagesCachePolicy({
	routing = webBuildRouting(),
	origin = routing.site.origin,
	assetPath,
	fetchImpl = fetch,
}) {
	const auditOrigin = normalizedOrigin(origin, 'Pages cache-policy origin');
	const descriptors = pagesCachePolicyDescriptors({ routing, assetPath });
	for (const descriptor of descriptors) {
		const url = new URL(descriptor.path, auditOrigin);
		if (descriptor.expectation === 'redirected') {
			await verifyRetiredRedirect(fetchImpl, url, descriptor);
			continue;
		}
		const response = await fetchImpl(url.href, {
			method: 'GET',
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
			headers: { 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' },
		});
		assert(response instanceof Response && response.status === 200,
			`Pages cache-policy audit received HTTP ${String(response?.status)} for ${descriptor.path}`);
		assert(response.headers.get('cache-control') === descriptor.cacheControl,
			`Pages cache-policy Cache-Control is invalid for ${descriptor.path}`);
		if (descriptor.serviceWorkerAllowed) {
			assert(response.headers.get('service-worker-allowed') === descriptor.serviceWorkerAllowed,
				`Pages cache-policy Service-Worker-Allowed is invalid for ${descriptor.path}`);
		}
		await response.arrayBuffer();
	}
	return Object.freeze({ verifiedRouteCount: descriptors.length });
}

async function verifyRetiredRedirect(fetchImpl, url, descriptor) {
	const response = await fetchImpl(url.href, {
		method: 'GET',
		cache: 'no-store',
		credentials: 'omit',
		redirect: 'manual',
		headers: { 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' },
	});
	assert(response instanceof Response && response.status === 301,
		`Pages cache-policy audit requires a permanent redirect for ${descriptor.path}; received HTTP ${String(response?.status)}`);
	assert(response.headers.get('location') === descriptor.location,
		`Pages cache-policy redirect target is invalid for ${descriptor.path}; expected ${descriptor.location}`);
	await response.arrayBuffer();
}

function served(path, cacheControl, serviceWorkerAllowed) {
	return Object.freeze(serviceWorkerAllowed
		? { path, expectation: 'served', cacheControl, serviceWorkerAllowed }
		: { path, expectation: 'served', cacheControl });
}

function retiredRedirects(routing) {
	const hosted = new Set(routing.plans.map(({ productId }) => productId));
	const retired = RETIRED_PRODUCT_BASE_PATHS[routing.productId];
	assert(retired !== undefined, `Pages cache-policy audit has no retired-route table for ${routing.productId}.`);
	return Object.entries(retired)
		.filter(([productId]) => !hosted.has(productId))
		.flatMap(([productId, basePath]) => RETIRED_ROUTE_SUFFIXES.map((suffix) => Object.freeze({
			path: `${basePath}${suffix}`,
			expectation: 'redirected',
			location: `${productWebOrigin(productId)}${suffix}`,
		})));
}

function normalizedOrigin(origin, label) {
	const parsed = new URL(origin);
	assert(parsed.protocol === 'https:' && parsed.pathname === '/'
		&& parsed.search === '' && parsed.hash === ''
		&& parsed.username === '' && parsed.password === '',
	`${label} must be an HTTPS origin.`);
	return parsed;
}

async function fetchExact(fetchImpl, descriptor, deployOrigin) {
	const response = await fetchImpl(descriptor.url, {
		method: 'GET',
		cache: 'no-store',
		credentials: 'omit',
		redirect: 'error',
		headers: { Origin: deployOrigin, 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' },
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
	assert(allowedOrigin === deployOrigin || allowedOrigin === '*',
		`Pages deploy preflight CORS does not allow ${deployOrigin} for ${descriptor.url}`);
	const cacheStatus = response.headers.get('cf-cache-status')?.toUpperCase() ?? '';
	if (descriptor.mutable) {
		assert(['DYNAMIC', 'BYPASS'].includes(cacheStatus) && response.headers.get('age') === null,
			`Pages deploy preflight requires pointer cache bypass without Age for ${descriptor.url}; received ${cacheStatus || '<missing>'}`);
	} else {
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
