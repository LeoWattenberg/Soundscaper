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
/** The documents a retired base path kept, relative to that base path. */
const RETIRED_DOCUMENT_SUFFIXES = Object.freeze(['/en/', '/embed/en/']);

/** A retired worker path must disappear instead of redirecting as JavaScript. */
const RETIRED_WORKER_SUFFIX = '/service-worker.js';

/** The `Cache-Control` a route carries when the origin wants a browser to revalidate before reuse. */
const REVALIDATE_CACHE_CONTROL = 'no-cache';

/**
 * Zones that rewrite `no-cache` on the way out, and what a browser gets instead.
 *
 * Both product zones set a four-hour Browser Cache TTL, and Cloudflare applies
 * it to any response it caches whose own headers name no freshness lifetime.
 * `no-store` is never cacheable and `public, max-age=31536000, immutable` names
 * a lifetime of its own, so the workers, `/offline-shell.json` and the
 * content-hashed bundles always reach a browser exactly as `_headers` wrote
 * them. Only the `no-cache` routes — the documents and the installed artwork —
 * can come back rewritten.
 *
 * Which of them actually do is the zone's decision, not the deployment's, and
 * the two zones already differ: soundscaper.org caches its documents and hands
 * a browser `max-age=14400` for every one of them, while framescaper.org caches
 * only the artwork and still serves its documents `no-cache`. That split
 * follows Cloudflare's cache rules and its default eligibility by file
 * extension, both of which live outside this repository and can change without
 * a deploy. So on these origins the audit admits either value for a `no-cache`
 * route and nothing else — an unexpected lifetime is still a failure, and a
 * rewritten `no-store` route still is too.
 *
 * The rewrite is deliberate where it lands. The editor shell is large, and a
 * returning visitor opening a possibly-stale copy at once beats one blocked on
 * a revalidation. `_headers` keeps saying `no-cache` because that is what holds
 * the edge to revalidating against the origin.
 *
 * Origins are listed one at a time because the setting belongs to a zone and
 * not to a build: framescaper.pages.dev is not on one of these zones and is
 * held to `_headers` exactly.
 */
const ZONE_BROWSER_CACHE_CONTROL = Object.freeze({
	'https://soundscaper.org': 'max-age=14400',
	'https://framescaper.org': 'max-age=14400',
});

/** A content-hashed bundle, which is the only kind of object the immutable rule covers. */
const IMMUTABLE_ASSET_PATTERN = /^\/assets\/[\w.-]+\.(?:css|js)$/u;

/** Names the build's declaration that this origin has never had a deployment. */
/** How long a just-published deployment may take to reach its custom domain. */
export const PAGES_PROPAGATION_TIMEOUT_MS = 180_000;
const PAGES_PROPAGATION_INTERVAL_MS = 5_000;

export const COLD_START_VARIABLE = 'SCAPE_PAGES_COLD_START';

/**
 * Admits the cold-start declaration a deploy job may carry.
 *
 * Unset or empty means the origin is expected to be live, which is the only
 * state a settled product is ever in. The declaration is never inferred from a
 * failure: see `originAnswers` for why that distinction is the whole point.
 */
export function admitPagesColdStart(environment = process.env) {
	const value = environment[COLD_START_VARIABLE];
	if (value === undefined || value === '') return false;
	if (value !== '1') {
		throw new Error(`${COLD_START_VARIABLE} must be "1" or unset; received ${JSON.stringify(String(value))}.`);
	}
	return true;
}

export async function preflightPagesDeployment({
	release,
	fetchImpl = fetch,
	origin = webBuildRouting().site.origin,
}) {
	const deployOrigin = normalizedOrigin(origin, 'Pages deploy preflight origin').origin;
	const snapshot = snapshotVerifiedFfmpegRuntime(release);
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
export function pagesCachePolicyDescriptors({ routing = webBuildRouting(), assetPath, includeRetired = true }) {
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
		...includeRetired ? retiredRoutes(routing) : [],
	];
	const paths = new Set(descriptors.map(({ path }) => path));
	assert(paths.size === descriptors.length, 'Pages cache-policy audit lists a route twice.');
	return Object.freeze(descriptors);
}

export async function verifyLivePagesCachePolicy({
	routing = webBuildRouting(),
	origin = routing.site.origin,
	coldStart = false,
	fetchImpl = fetch,
	includeRetired = true,
}) {
	const auditOrigin = normalizedOrigin(origin, 'Pages cache-policy origin');
	if (!await originAnswers(fetchImpl, auditOrigin)) {
		assert(coldStart,
			`Pages cache-policy audit found no deployment answering ${auditOrigin.origin}. `
			+ `If that origin has genuinely never been deployed, set ${COLD_START_VARIABLE}=1 on this build; `
			+ 'if it has been deployed, then it is down and this deploy must not proceed.');
		return Object.freeze({ verifiedRouteCount: 0, assetPath: null, coldStart: true });
	}
	assert(!coldStart,
		`${COLD_START_VARIABLE} is set but ${auditOrigin.origin} is already answering. `
		+ 'Remove it from the deploy job: it exists only for the first deployment an origin ever receives, '
		+ 'and while it is set an origin that vanished would be mistaken for one that was never deployed.');
	const assetPath = await liveImmutableAssetPath(fetchImpl, auditOrigin);
	const descriptors = pagesCachePolicyDescriptors({ routing, assetPath, includeRetired });
	for (const descriptor of descriptors) {
		const url = new URL(descriptor.path, auditOrigin);
		if (descriptor.expectation === 'redirected') {
			await verifyRetiredRedirect(fetchImpl, url, descriptor);
			continue;
		}
		if (descriptor.expectation === 'missing') {
			await verifyRetiredMissing(fetchImpl, url, descriptor);
			continue;
		}
		const response = await fetchImpl(url.href, auditRequest());
		assert(response instanceof Response && response.status === 200,
			`Pages cache-policy audit received HTTP ${String(response?.status)} for ${descriptor.path}`);
		const accepted = acceptableCacheControl(descriptor, auditOrigin.origin);
		assert(accepted.includes(response.headers.get('cache-control')),
			`Pages cache-policy Cache-Control is invalid for ${descriptor.path}: expected ${accepted.join(' or ')}, `
			+ `received ${response.headers.get('cache-control') ?? '<missing>'}`);
		if (descriptor.serviceWorkerAllowed) {
			assert(response.headers.get('service-worker-allowed') === descriptor.serviceWorkerAllowed,
				`Pages cache-policy Service-Worker-Allowed is invalid for ${descriptor.path}`);
		}
		await response.arrayBuffer();
	}
	return Object.freeze({ verifiedRouteCount: descriptors.length, assetPath, coldStart: false });
}

/**
 * Audit a deployment that was just published, allowing for propagation.
 *
 * A Pages upload completes seconds before the custom domain serves it, and
 * until it does the origin still answers with the previous deployment. That is
 * invisible for a build that only changed asset hashes and fatal for one that
 * changed routing: the retired document routes this audit checks are exactly
 * the ones the previous deployment still serves as documents, so a single
 * immediate read fails every deploy that moves them.
 *
 * The preflight keeps its one strict pass — it audits the deployment that is
 * already live, where there is nothing to wait for. Only the post-deploy gate
 * polls, and only until its deadline: a misconfiguration still fails, with the
 * last observation as its reason.
 */
export async function verifyPublishedPagesCachePolicy(options, schedule = {}) {
	const timeoutMs = schedule.timeoutMs ?? PAGES_PROPAGATION_TIMEOUT_MS;
	const intervalMs = schedule.intervalMs ?? PAGES_PROPAGATION_INTERVAL_MS;
	const now = schedule.now ?? (() => Date.now());
	const sleep = schedule.sleep ?? ((delayMs) => new Promise((resolve) => { setTimeout(resolve, delayMs); }));
	const deadline = now() + timeoutMs;
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await verifyLivePagesCachePolicy(options);
		} catch (error) {
			if (now() >= deadline) throw error;
			schedule.onRetry?.({ attempt, error, intervalMs });
			await sleep(intervalMs);
		}
	}
}

/**
 * Whether anything at all is serving this origin.
 *
 * "Not deployed yet" and "deployed and broken" must never collapse into one
 * another: waving the second through is how a real outage ships. The only
 * evidence this audit accepts for "no deployment" is that the origin answers
 * *nothing* — the HTTP request never completes at all, because the hostname does
 * not resolve, the connection is refused, or there is no TLS peer. `fetch`
 * reports exactly that class of failure as a `TypeError`, and it is the one
 * state a live deployment cannot produce.
 *
 * Everything that completes is a server on that hostname and is audited in
 * full: 200, 404, 500 and a Cloudflare error page are all deployments, and a
 * deployment with a broken root is precisely what this gate exists to catch. A
 * redirect counts as an answer too, which is why the probe never follows one.
 */
async function originAnswers(fetchImpl, origin) {
	let response;
	try {
		response = await fetchImpl(new URL('/', origin).href, auditRequest());
	} catch (error) {
		if (error instanceof TypeError) return false;
		throw error;
	}
	assert(response instanceof Response,
		`Pages cache-policy audit received no response probing ${origin.origin}`);
	await response.arrayBuffer();
	return true;
}

/**
 * Names one content-hashed asset the LIVE deployment serves.
 *
 * The immutable `/assets/*` rule is what this part of the audit is for, and a
 * response header can only be observed on an object that exists. The bundle
 * that was just built cannot be that object: its filename carries the hash of
 * the build being deployed, and the live origin is by construction the previous
 * deployment, so it answers 404 for every one of them. Asserting the new hash is
 * already live fails the gate exactly when the build changed something, which is
 * nearly every push, and proves nothing when it passes. The live deployment
 * publishes its own asset inventory at `/offline-shell.json`, so the rule is
 * audited against an asset that deployment actually has.
 */
async function liveImmutableAssetPath(fetchImpl, origin) {
	const url = new URL('/offline-shell.json', origin);
	const response = await fetchImpl(url.href, auditRequest());
	assert(response instanceof Response && response.status === 200,
		`Pages cache-policy audit received HTTP ${String(response?.status)} for /offline-shell.json`);
	const text = await response.text();
	let audit;
	try {
		audit = JSON.parse(text);
	} catch (error) {
		throw new Error(`Live /offline-shell.json on ${origin.origin} is not JSON: ${error.message}`, { cause: error });
	}
	const assetPath = (Array.isArray(audit?.assets) ? audit.assets : [])
		.map((asset) => asset?.url)
		.find((candidate) => typeof candidate === 'string' && IMMUTABLE_ASSET_PATTERN.test(candidate));
	assert(assetPath !== undefined,
		`Live /offline-shell.json on ${origin.origin} names no content-hashed /assets/ bundle to audit.`);
	return assetPath;
}

/**
 * One audit request.
 *
 * Redirects are never followed and never turned into a transport error: an
 * unexpected redirect must reach the assertions as an HTTP status, so the audit
 * can name it, and so `originAnswers` can count it as an answer.
 */
function auditRequest() {
	return {
		method: 'GET',
		cache: 'no-store',
		credentials: 'omit',
		redirect: 'manual',
		headers: { 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' },
	};
}

async function verifyRetiredRedirect(fetchImpl, url, descriptor) {
	const response = await fetchImpl(url.href, auditRequest());
	assert(response instanceof Response && response.status === 301,
		`Pages cache-policy audit requires a permanent redirect for ${descriptor.path}; received HTTP ${String(response?.status)}`);
	assert(response.headers.get('location') === descriptor.location,
		`Pages cache-policy redirect target is invalid for ${descriptor.path}; expected ${descriptor.location}`);
	await response.arrayBuffer();
}

async function verifyRetiredMissing(fetchImpl, url, descriptor) {
	const response = await fetchImpl(url.href, auditRequest());
	assert(response instanceof Response && response.status === 404,
		`Pages cache-policy audit requires HTTP 404 for ${descriptor.path}; received HTTP ${String(response?.status)}`);
	assert(response.headers.get('location') === null,
		`Pages cache-policy audit forbids redirecting retired path ${descriptor.path}`);
	await response.arrayBuffer();
}

/** Every `Cache-Control` a browser may be handed for one descriptor on one audited origin. */
function acceptableCacheControl(descriptor, origin) {
	const rewritten = ZONE_BROWSER_CACHE_CONTROL[origin];
	return rewritten !== undefined && descriptor.cacheControl === REVALIDATE_CACHE_CONTROL
		? [descriptor.cacheControl, rewritten]
		: [descriptor.cacheControl];
}

function served(path, cacheControl, serviceWorkerAllowed) {
	return Object.freeze(serviceWorkerAllowed
		? { path, expectation: 'served', cacheControl, serviceWorkerAllowed }
		: { path, expectation: 'served', cacheControl });
}

function retiredRoutes(routing) {
	const hosted = new Set(routing.plans.map(({ productId }) => productId));
	const retired = routing.productId === 'soundscaper'
		? Object.freeze({ framescaper: '/framescaper' })
		: Object.freeze({});
	assert(retired !== undefined, `Pages cache-policy audit has no retired-route table for ${routing.productId}.`);
	return Object.entries(retired)
		.filter(([productId]) => !hosted.has(productId))
		.flatMap(([productId, basePath]) => [
			...RETIRED_DOCUMENT_SUFFIXES.map((suffix) => Object.freeze({
				path: `${basePath}${suffix}`,
				expectation: 'redirected',
				location: `${productWebOrigin(productId)}${suffix}`,
			})),
			Object.freeze({
				path: `${basePath}${RETIRED_WORKER_SUFFIX}`,
				expectation: 'missing',
			}),
		]);
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
