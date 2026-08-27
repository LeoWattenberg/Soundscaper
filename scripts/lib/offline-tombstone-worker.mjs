/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The retired-product tombstone service worker.
 *
 * Framescaper moves from `soundscaper.org/framescaper/` to the root of
 * `framescaper.org`. Visitors who already used the old path carry a registered
 * service worker at scope `/framescaper/` that answers navigations out of Cache
 * Storage without touching the network, so a redirect deployed on
 * soundscaper.org is invisible to exactly the people it is for: the document
 * path never reaches the origin. That stale worker, not the redirect, is the
 * obstacle, and it is the only thing this file removes.
 *
 * The tombstone is a replacement script served at the retired worker's own
 * script URL. Because it is the same registration, the browser fetches it on the
 * next navigation or update check, installs it, and it takes over. It then
 * claims its clients, deletes the caches the retired worker owned, and
 * unregisters itself. It registers no fetch handler at all, so from that moment
 * every request on the retired path reaches the network — and therefore reaches
 * whatever the origin has deployed there, whether that is still the old document
 * or the permanent redirect that eventually replaces it.
 *
 * It deliberately does not navigate the windows it controls.
 *
 * Browser storage is partitioned per origin, so a project an open window is
 * editing cannot be read from the new origin — that partitioning is the entire
 * reason the cross-origin project transfer exists. Sending a window to the new
 * origin therefore takes the user away from their own work and lands them
 * somewhere that cannot see it. A stale worker is an inconvenience; losing sight
 * of an open project is not. The window is left running, its storage intact, and
 * the next navigation is the user's own — by which time the worker is gone and
 * the network answers.
 *
 * Three invariants keep it safe to serve for a long retention window:
 *
 * - It never claims the origin root. `scope` is refused when it is `/`, so a
 *   tombstone can never displace or outrank the Soundscaper worker at `/`.
 * - It deletes only cache names that exactly match the retired product's own
 *   shell caches. The literal prefix below names caches that already exist in
 *   visitors' browsers; it is deliberately a frozen historical fact and must not
 *   follow later renames of the live shell's cache naming.
 * - It answers no request and moves no window, so there is no path by which it
 *   can send a visitor anywhere at all.
 *
 * `targetOrigin` is recorded rather than acted on: it is what the deployment
 * audit publishes as the place the retired product went.
 *
 * A browser that never had the retired worker is unharmed: the script is inert
 * until it is registered, and once registered it removes itself.
 */

import { createHash } from 'node:crypto';

const CONFIGURATION_TOKEN = '__SOUNDSCAPER_RETIRED_SHELL_CONFIGURATION__';
const RETIRED_PRODUCT_IDS = Object.freeze(['framescaper', 'soundscaper']);
/** The cache-name prefix the deployed shell worker used; a historical fact, not a live constant. */
const SHELL_CACHE_PREFIX = 'soundscaper-application-shell-v2-';

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

export async function installTombstone({ configuration, skipWaiting }) {
	validateTombstoneConfiguration(configuration);
	await skipWaiting();
}

/**
 * Retires the worker in the only order that is safe.
 *
 * 1. Claim, so this worker — and not the one it replaced — is what the already
 *    open pages are controlled by.
 * 2. Delete the retired product's shell caches, so no stale document can be
 *    served again even if a later step fails.
 * 3. Unregister, so every later visit to the retired path reaches the network.
 *
 * There is no fourth step. The windows this worker controls are left alone: it
 * has no fetch handler, so their next navigation goes to the network by itself,
 * and moving them would strand them on an origin that cannot read their storage.
 */
export async function activateTombstone({ configuration, cacheStorage, clients, registration }) {
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
	try {
		await registration.unregister();
	} catch (error) {
		failures.push(`unregister itself (${retiredFailureReason(error)})`);
	}
	if (failures.length > 0) {
		throw new Error(`Retired ${configuration.productId} service worker could not ${failures.join('; ')}.`);
	}
}

function retiredFailureReason(error) {
	return typeof error?.message === 'string' && error.message !== '' ? error.message : String(error);
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
		}));
	});
	// No fetch listener, deliberately. A service worker that registers none is
	// bypassed for navigations entirely, which is exactly what retiring the path
	// means: the origin answers again.
}

export { attachRetiredServiceWorker };

function tombstoneServiceWorkerTemplate() {
	return `/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
const RETIRED_SHELL = ${CONFIGURATION_TOKEN};
const RETIRED_PRODUCT_IDS = ${JSON.stringify(RETIRED_PRODUCT_IDS)};
const SHELL_CACHE_PREFIX = ${JSON.stringify(SHELL_CACHE_PREFIX)};
${[
	plainObject,
	exactKeys,
	validRetiredPath,
	validRetiredScope,
	validTargetOrigin,
	validateTombstoneConfiguration,
	retiredShellCachePattern,
	installTombstone,
	retiredFailureReason,
	activateTombstone,
	attachRetiredServiceWorker,
].map((value) => value.toString()).join('\n')}
attachRetiredServiceWorker(globalThis, RETIRED_SHELL);
`;
}
