/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The retired-product tombstone service worker.
 *
 * Framescaper moves from `soundscaper.org/framescaper/` to the root of
 * `framescaper.org`. Visitors who already used the old path carry a registered
 * service worker at scope `/framescaper/` that answers navigations out of Cache
 * Storage without touching the network, so a redirect deployed on
 * soundscaper.org is invisible to exactly the people it is for: the document
 * path never reaches the origin. A 301 alone therefore cannot perform this
 * cutover.
 *
 * The tombstone is a replacement script served at the retired worker's own
 * script URL. Because it is the same registration, the browser fetches it on the
 * next navigation or update check, installs it, and it takes over. It then
 * claims its clients, deletes the caches the retired worker owned, sends the
 * pages it controls to the new origin with their locale intact, and unregisters
 * itself so every later visit reaches the network — where a 301 may or may not
 * yet exist. Nothing here depends on that 301 existing.
 *
 * Three invariants keep it safe to serve for a long retention window:
 *
 * - It never claims the origin root. `scope` is refused when it is `/`, so a
 *   tombstone can never displace or outrank the Soundscaper worker at `/`.
 * - It deletes only cache names that exactly match the retired product's own
 *   shell caches. The literal prefix below names caches that already exist in
 *   visitors' browsers; it is deliberately a frozen historical fact and must not
 *   follow later renames of the live shell's cache naming.
 * - Every redirect target is rebuilt against the configured origin and rejected
 *   unless the result still carries that origin, so no request path can steer a
 *   visitor somewhere else.
 *
 * A browser that never had the retired worker is unharmed: the script is inert
 * until it is registered, and once registered it removes itself.
 */

import { createHash } from 'node:crypto';

const CONFIGURATION_TOKEN = '__SOUNDSCAPER_RETIRED_SHELL_CONFIGURATION__';
const RETIRED_PRODUCT_IDS = Object.freeze(['framescaper', 'soundscaper']);
/** The cache-name prefix the deployed shell worker used; a historical fact, not a live constant. */
const SHELL_CACHE_PREFIX = 'soundscaper-application-shell-v2-';
const REDIRECT_STATUS = 302;

const TOMBSTONE_VARIABLE = 'FRAMESCAPER_TOMBSTONE';
const TARGET_SITE_VARIABLE = 'FRAMESCAPER_SITE';
const RETIRING_PRODUCT_ID = 'framescaper';
const DEFAULT_TARGET_ORIGIN = 'https://framescaper.org';

export { RETIRING_PRODUCT_ID, SHELL_CACHE_PREFIX, TARGET_SITE_VARIABLE, TOMBSTONE_VARIABLE };

/* ---------- build side ---------- */

/**
 * Resolves which of this build's workers are emitted as tombstones instead of
 * offline shells. Unset or empty retires nothing, so a build that says nothing
 * keeps emitting exactly what it emits today.
 */
export function retiredWebWorkers(routing, environment = process.env) {
	if (!admitTombstoneFlag(environment)) return Object.freeze([]);
	const worker = routing.workers.find(({ productId }) => productId === RETIRING_PRODUCT_ID);
	if (!worker) {
		throw new Error(`${TOMBSTONE_VARIABLE} is set but this build emits no ${RETIRING_PRODUCT_ID} service worker.`);
	}
	if (routing.productId === RETIRING_PRODUCT_ID || worker.scope === '/') {
		throw new Error(
			`${TOMBSTONE_VARIABLE} cannot retire the service worker a ${RETIRING_PRODUCT_ID} build serves at its own root.`,
		);
	}
	return Object.freeze([Object.freeze({
		productId: worker.productId,
		scriptUrl: worker.scriptUrl,
		scope: worker.scope,
		configuration: tombstoneConfiguration({
			productId: worker.productId,
			scope: worker.scope,
			targetOrigin: retiredProductTargetOrigin(environment),
		}),
	})]);
}

function admitTombstoneFlag(environment) {
	const value = environment[TOMBSTONE_VARIABLE];
	if (value === undefined || value === '') return false;
	if (value !== '1') {
		throw new Error(`${TOMBSTONE_VARIABLE} must be "1" or unset; received ${JSON.stringify(String(value))}.`);
	}
	return true;
}

/** The origin the retired product now serves from, admitted the way its canonical site is. */
export function retiredProductTargetOrigin(environment = process.env) {
	const configured = environment[TARGET_SITE_VARIABLE];
	const value = configured === undefined || configured === '' ? DEFAULT_TARGET_ORIGIN : String(configured);
	const origin = value.endsWith('/') ? value.slice(0, -1) : value;
	if (!validTargetOrigin(origin)) {
		throw new Error(`${TARGET_SITE_VARIABLE} must be an https origin with no path, query or fragment: ${value}`);
	}
	return origin;
}

export function tombstoneConfiguration({ productId, scope, targetOrigin }) {
	return validateTombstoneConfiguration(Object.freeze({
		schemaVersion: 1,
		productId,
		scope,
		targetOrigin,
	}));
}

export function tombstoneServiceWorkerTemplateSha256() {
	return createHash('sha256').update(tombstoneServiceWorkerTemplate()).digest('hex');
}

export function renderTombstoneServiceWorker(configuration) {
	validateTombstoneConfiguration(configuration);
	const template = tombstoneServiceWorkerTemplate();
	if (!template.includes(CONFIGURATION_TOKEN)) throw new Error('Retired service worker template token is missing.');
	const serialized = JSON.stringify(configuration);
	return template.replace(CONFIGURATION_TOKEN, () => serialized);
}

/* ---------- worker side ---------- */

function plainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected) {
	return Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function validRetiredPath(value) {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
		|| value.includes('\\') || value.includes('?') || value.includes('#')) return false;
	return value.split('/').every((segment) => segment !== '.' && segment !== '..');
}

/** A tombstone may only retire a strict sub-path: the origin root belongs to the surviving product. */
function validRetiredScope(value) {
	return validRetiredPath(value) && value.endsWith('/') && !value.includes('//') && value !== '/';
}

function validTargetOrigin(value) {
	if (typeof value !== 'string' || !value.startsWith('https://')) return false;
	let url;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	return url.origin === value && url.pathname === '/' && url.search === '' && url.hash === ''
		&& url.username === '' && url.password === '';
}

export function validateTombstoneConfiguration(value) {
	if (!plainObject(value)
		|| !exactKeys(value, ['productId', 'schemaVersion', 'scope', 'targetOrigin'])
		|| value.schemaVersion !== 1
		|| !RETIRED_PRODUCT_IDS.includes(value.productId)
		|| !validRetiredScope(value.scope)
		|| !validTargetOrigin(value.targetOrigin)) {
		throw new Error('Retired product service worker configuration is invalid.');
	}
	return value;
}

/** Exactly the caches the retired product's shell worker created; never another product's. */
function retiredShellCachePattern(productId) {
	return new RegExp(`^${SHELL_CACHE_PREFIX}${productId}-[a-f\\d]{64}$`, 'u');
}

/**
 * Maps one retired-path URL onto the new origin, preserving the locale and every
 * remaining segment. Returns null rather than guessing whenever the path is not
 * the retired product's, or the rebuilt URL would leave the configured origin.
 */
function tombstoneRedirectUrl(href, configuration) {
	let url;
	try {
		url = new URL(String(href));
	} catch {
		return null;
	}
	if (url.origin === configuration.targetOrigin) return null;
	const scope = configuration.scope;
	const remainder = url.pathname === scope.slice(0, -1)
		? ''
		: url.pathname.startsWith(scope) ? url.pathname.slice(scope.length) : null;
	if (remainder === null || remainder.startsWith('/') || remainder.includes('\\')) return null;
	let target;
	try {
		target = new URL(`/${remainder}${url.search}`, configuration.targetOrigin);
	} catch {
		return null;
	}
	return target.origin === configuration.targetOrigin ? target.href : null;
}

/**
 * Answers a controlled navigation with a temporary redirect to the new origin.
 * This is what reaches a visitor whose browser never asks the network for the
 * retired document, and it works whether or not a 301 has been deployed. The
 * redirect is temporary so no browser caches the mapping past the retention
 * window, and only same-origin GET navigations are answered at all.
 */
function tombstoneNavigationResponse(request, configuration, origin) {
	if (request.method !== 'GET' || request.mode !== 'navigate') return null;
	let url;
	try {
		url = new URL(request.url);
	} catch {
		return null;
	}
	if (url.origin !== origin) return null;
	const target = tombstoneRedirectUrl(request.url, configuration);
	return target === null ? null : Response.redirect(target, REDIRECT_STATUS);
}

export async function installTombstone({ configuration, skipWaiting }) {
	validateTombstoneConfiguration(configuration);
	await skipWaiting();
}

/**
 * Retires the worker in the only order that is safe.
 *
 * 1. Claim, so pages loaded under the previous worker are controlled by this one
 *    and can be both redirected and navigated.
 * 2. Delete the retired product's shell caches, so no stale document can be
 *    served again even if a later step fails.
 * 3. Start navigating the controlled windows while control is certain: a window
 *    client may only be navigated by the worker that controls it.
 * 4. Unregister, so every later visit to the retired path reaches the network.
 * 5. Await the navigations, which are individually allowed to fail — a window
 *    that refuses is still redirected by the fetch handler on its next
 *    navigation, because it stays controlled until it unloads.
 */
export async function activateTombstone({ configuration, cacheStorage, clients, registration, origin }) {
	validateTombstoneConfiguration(configuration);
	const failures = [];
	const pattern = retiredShellCachePattern(configuration.productId);
	try {
		await clients.claim();
	} catch (error) {
		failures.push(`claim its clients (${retiredFailureReason(error)})`);
	}
	try {
		for (const name of await cacheStorage.keys()) {
			if (pattern.test(name)) await cacheStorage.delete(name);
		}
		const remaining = (await cacheStorage.keys()).filter((name) => pattern.test(name));
		if (remaining.length > 0) failures.push(`retire the caches ${remaining.join(', ')}`);
	} catch (error) {
		failures.push(`retire its caches (${retiredFailureReason(error)})`);
	}
	let navigations = [];
	try {
		const windows = await clients.matchAll({ type: 'window' });
		navigations = windows.map((client) => navigateRetiredClient(client, configuration, origin));
	} catch (error) {
		failures.push(`enumerate its clients (${retiredFailureReason(error)})`);
	}
	try {
		await registration.unregister();
	} catch (error) {
		failures.push(`unregister itself (${retiredFailureReason(error)})`);
	}
	await Promise.all(navigations);
	if (failures.length > 0) {
		throw new Error(`Retired ${configuration.productId} service worker could not ${failures.join('; ')}.`);
	}
}

function retiredFailureReason(error) {
	return typeof error?.message === 'string' && error.message !== '' ? error.message : String(error);
}

async function navigateRetiredClient(client, configuration, origin) {
	let url;
	try {
		url = new URL(String(client.url));
	} catch {
		return;
	}
	if (url.origin !== origin) return;
	const target = tombstoneRedirectUrl(client.url, configuration);
	if (target === null) return;
	try {
		await client.navigate(target);
	} catch {
		// A window may refuse to be navigated; it stays controlled and the fetch handler redirects it instead.
	}
}

function attachRetiredServiceWorker(scope, configuration) {
	scope.addEventListener('install', (event) => {
		event.waitUntil(installTombstone({ configuration, skipWaiting: () => scope.skipWaiting() }));
	});
	scope.addEventListener('activate', (event) => {
		event.waitUntil(activateTombstone({
			configuration,
			cacheStorage: scope.caches,
			clients: scope.clients,
			registration: scope.registration,
			origin: scope.location.origin,
		}));
	});
	scope.addEventListener('fetch', (event) => {
		const response = tombstoneNavigationResponse(event.request, configuration, scope.location.origin);
		if (response) event.respondWith(response);
	});
}

export { attachRetiredServiceWorker, tombstoneNavigationResponse, tombstoneRedirectUrl };

function tombstoneServiceWorkerTemplate() {
	return `/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
const RETIRED_SHELL = ${CONFIGURATION_TOKEN};
const RETIRED_PRODUCT_IDS = ${JSON.stringify(RETIRED_PRODUCT_IDS)};
const SHELL_CACHE_PREFIX = ${JSON.stringify(SHELL_CACHE_PREFIX)};
const REDIRECT_STATUS = ${String(REDIRECT_STATUS)};
${[
	plainObject,
	exactKeys,
	validRetiredPath,
	validRetiredScope,
	validTargetOrigin,
	validateTombstoneConfiguration,
	retiredShellCachePattern,
	tombstoneRedirectUrl,
	tombstoneNavigationResponse,
	installTombstone,
	retiredFailureReason,
	navigateRetiredClient,
	activateTombstone,
	attachRetiredServiceWorker,
].map((value) => value.toString()).join('\n')}
attachRetiredServiceWorker(globalThis, RETIRED_SHELL);
`;
}
