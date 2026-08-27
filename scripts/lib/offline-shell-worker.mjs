/* SPDX-License-Identifier: AGPL-3.0-only */

export function offlineShellFunctionSources() {
	return [
		plainObject,
		exactKeys,
		validShellPath,
		validShellScope,
		validateOfflineShellConfiguration,
		sha256Hex,
		shellCacheName,
		shellReadinessUrl,
		legacyShellReadinessUrl,
		readinessRecord,
		cacheHasReadinessMarker,
		cacheIsComplete,
		completeReuseCacheNames,
		verifiedShellResponse,
		installVerifiedAsset,
		installAssetBatches,
		installOfflineShell,
		activateOfflineShell,
		pathWithinShellScope,
		pathIsProjectTransferDocument,
		offlineNavigationFallbackPaths,
		matchOfflineNavigationFallback,
		cacheVerifiedAssetOnUse,
		handleApplicationShellFetch,
	].map((value) => value.toString()).join('\n');
}

function plainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected) {
	return Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function validShellPath(value) {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
		|| value.includes('\\') || value.includes('?') || value.includes('#')) return false;
	return value.split('/').every((segment) => segment !== '.' && segment !== '..');
}

/** A worker may only claim a slash-terminated prefix; its script URL bounds it at deploy time. */
function validShellScope(value) {
	return validShellPath(value) && value.endsWith('/') && !value.includes('//');
}

export function validateOfflineShellConfiguration(value) {
	if (!plainObject(value)
		|| !exactKeys(value, [
			'assets', 'fallbacks', 'foreignScopes', 'installUrls', 'productId', 'releaseId', 'schemaVersion',
			'scope', 'workerSha256',
		])
		|| value.schemaVersion !== 2
		|| !['framescaper', 'soundscaper'].includes(value.productId)
		|| !validShellScope(value.scope)
		|| !Array.isArray(value.foreignScopes) || value.foreignScopes.length > 8
		|| value.foreignScopes.some((scope, index) => !validShellScope(scope) || !scope.startsWith(value.scope)
			|| scope === value.scope || (index > 0 && scope <= value.foreignScopes[index - 1]))
		|| !/^[a-f\d]{64}$/u.test(value.releaseId)
		|| !/^[a-f\d]{64}$/u.test(value.workerSha256)
		|| !plainObject(value.fallbacks)
		|| !exactKeys(value.fallbacks, ['embedded', 'standard'])
		|| !Array.isArray(value.assets) || value.assets.length < 1 || value.assets.length > 4_096
		|| !Array.isArray(value.installUrls) || value.installUrls.length < 1 || value.installUrls.length > 128) {
		throw new Error('Offline shell configuration is invalid.');
	}
	let totalBytes = 0;
	let previousUrl = '';
	const descriptors = new Map();
	for (const asset of value.assets) {
		if (!plainObject(asset) || !exactKeys(asset, ['byteLength', 'sha256', 'url'])
			|| !validShellPath(asset.url) || asset.url <= previousUrl
			|| !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1
			|| asset.byteLength > 25 * 1024 * 1024 || !/^[a-f\d]{64}$/u.test(asset.sha256)) {
			throw new Error('Offline shell asset descriptor is invalid.');
		}
		previousUrl = asset.url;
		totalBytes += asset.byteLength;
		if (!Number.isSafeInteger(totalBytes) || totalBytes > 256 * 1024 * 1024) {
			throw new Error('Offline shell aggregate byte limit is exceeded.');
		}
		descriptors.set(asset.url, asset);
	}
	let installBytes = 0;
	previousUrl = '';
	for (const url of value.installUrls) {
		const descriptor = descriptors.get(url);
		if (!validShellPath(url) || url <= previousUrl || !descriptor) {
			throw new Error('Offline shell install inventory is invalid.');
		}
		previousUrl = url;
		if (descriptor.byteLength > 4 * 1024 * 1024) {
			throw new Error('Offline shell install descriptor exceeds its in-flight byte limit.');
		}
		installBytes += descriptor.byteLength;
		if (!Number.isSafeInteger(installBytes) || installBytes > 8 * 1024 * 1024) {
			throw new Error('Offline shell install byte limit is exceeded.');
		}
	}
	const expectedFallbacks = { standard: `${value.scope}en/`, embedded: `${value.scope}embed/en/` };
	if (value.fallbacks.standard !== expectedFallbacks.standard
		|| value.fallbacks.embedded !== expectedFallbacks.embedded
		|| !value.installUrls.includes(value.fallbacks.standard)
		|| !value.installUrls.includes(value.fallbacks.embedded)
		|| value.foreignScopes.some((scope) => value.fallbacks.standard.startsWith(scope)
			|| value.fallbacks.embedded.startsWith(scope))) {
		throw new Error('Offline shell fallback inventory is invalid.');
	}
	return value;
}

async function sha256Hex(bytes, cryptoImpl) {
	if (!cryptoImpl?.subtle) throw new Error('Web Crypto is unavailable for offline shell verification.');
	const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes));
	return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

function shellCacheName(productId, releaseId) {
	return `soundscaper-application-shell-v2-${productId}-${releaseId}`;
}

function shellReadinessUrl(productId, releaseId) {
	return `/.soundscaper/offline/application-shell-v2-${productId}-${releaseId}.json`;
}

function legacyShellReadinessUrl(releaseId) {
	return `/.soundscaper/offline/application-shell-${releaseId}.json`;
}

async function readinessRecord(cache, cacheName, productId) {
	let match = cacheName.match(/^soundscaper-application-shell-v2-(framescaper|soundscaper)-([a-f\d]{64})$/u);
	let marker;
	let expected;
	if (match) {
		if (match[1] !== productId) return null;
		marker = shellReadinessUrl(match[1], match[2]);
		expected = { schemaVersion: 2, productId: match[1], releaseId: match[2] };
	} else {
		match = cacheName.match(/^soundscaper-application-shell-v1-([a-f\d]{64})$/u);
		if (!match) return null;
		marker = legacyShellReadinessUrl(match[1]);
		expected = { schemaVersion: 1, releaseId: match[1] };
	}
	try {
		const response = await cache.match(marker);
		if (!response?.ok || response.status !== 200) return null;
		const record = await response.json();
		return plainObject(record) && exactKeys(record, Object.keys(expected))
			&& Object.keys(expected).every((key) => record[key] === expected[key]) ? record : null;
	} catch {
		return null;
	}
}

async function cacheHasReadinessMarker(cacheStorage, cacheName, productId) {
	const cache = await cacheStorage.open(cacheName);
	return await readinessRecord(cache, cacheName, productId) !== null;
}

async function cacheIsComplete(cacheStorage, cacheName, configuration, cryptoImpl) {
	const cache = await cacheStorage.open(cacheName);
	if (await readinessRecord(cache, cacheName, configuration.productId) === null) return false;
	const descriptors = new Map(configuration.assets.map((asset) => [asset.url, asset]));
	for (const url of configuration.installUrls) {
		const response = await cache.match(url);
		if (!response) return false;
		try {
			await verifiedShellResponse(response, descriptors.get(url), cryptoImpl);
		} catch {
			return false;
		}
	}
	return true;
}

async function completeReuseCacheNames(cacheStorage, productId, candidateName) {
	const reusable = [];
	for (const cacheName of await cacheStorage.keys()) {
		if (cacheName === candidateName) continue;
		if (!cacheName.startsWith(`soundscaper-application-shell-v2-${productId}-`)
			&& !cacheName.startsWith('soundscaper-application-shell-v1-')) continue;
		if (await cacheHasReadinessMarker(cacheStorage, cacheName, productId)) reusable.push(cacheName);
	}
	return reusable;
}

async function verifiedShellResponse(response, descriptor, cryptoImpl) {
	if (!response?.ok || response.status !== 200) {
		throw new Error(`Offline shell request failed for ${descriptor.url} (${String(response?.status)}).`);
	}
	const declaredLength = response.headers.get('content-length');
	const contentEncoding = response.headers.get('content-encoding');
	if (declaredLength !== null && contentEncoding === null
		&& (!/^\d+$/u.test(declaredLength) || Number(declaredLength) !== descriptor.byteLength)) {
		throw new Error(`Offline shell Content-Length mismatch for ${descriptor.url}.`);
	}
	const bytes = await response.arrayBuffer();
	if (bytes.byteLength !== descriptor.byteLength) {
		throw new Error(`Offline shell byte-length mismatch for ${descriptor.url}.`);
	}
	if (await sha256Hex(bytes, cryptoImpl) !== descriptor.sha256) {
		throw new Error(`Offline shell SHA-256 mismatch for ${descriptor.url}.`);
	}
	const headers = new Headers(response.headers);
	headers.delete('content-encoding');
	headers.delete('transfer-encoding');
	headers.set('content-length', String(descriptor.byteLength));
	return new Response(bytes, { status: 200, statusText: response.statusText, headers });
}

async function installVerifiedAsset({ cacheStorage, candidate, descriptor, fetchImpl, cryptoImpl, reuseNames }) {
	for (const cacheName of reuseNames) {
		const response = await (await cacheStorage.open(cacheName)).match(descriptor.url);
		if (!response) continue;
		try {
			await candidate.put(descriptor.url, await verifiedShellResponse(response, descriptor, cryptoImpl));
			return;
		} catch {
			// A corrupt reusable entry is ignored; the immutable network response is still verified below.
		}
	}
	const response = await fetchImpl(descriptor.url, {
		cache: 'default',
		credentials: 'same-origin',
		redirect: 'error',
	});
	await candidate.put(descriptor.url, await verifiedShellResponse(response, descriptor, cryptoImpl));
}

async function installAssetBatches(options, descriptors) {
	let offset = 0;
	while (offset < descriptors.length) {
		const batch = [];
		let bytes = 0;
		while (offset < descriptors.length && batch.length < 4) {
			const descriptor = descriptors[offset];
			if (batch.length > 0 && bytes + descriptor.byteLength > 4 * 1024 * 1024) break;
			batch.push(descriptor);
			bytes += descriptor.byteLength;
			offset += 1;
		}
		await Promise.all(batch.map((descriptor) => installVerifiedAsset({ ...options, descriptor })));
	}
}

export async function installOfflineShell({
	configuration,
	cacheStorage,
	fetchImpl,
	cryptoImpl = globalThis.crypto,
}) {
	validateOfflineShellConfiguration(configuration);
	const identityBytes = new TextEncoder().encode(JSON.stringify({
		schemaVersion: 2,
		productId: configuration.productId,
		scope: configuration.scope,
		foreignScopes: configuration.foreignScopes,
		workerSha256: configuration.workerSha256,
		fallbacks: configuration.fallbacks,
		assets: configuration.assets,
		installUrls: configuration.installUrls,
	}));
	if (await sha256Hex(identityBytes, cryptoImpl) !== configuration.releaseId) {
		throw new Error('Offline shell release identity is invalid.');
	}
	const cacheName = shellCacheName(configuration.productId, configuration.releaseId);
	if (await cacheIsComplete(cacheStorage, cacheName, configuration, cryptoImpl)) return cacheName;
	const reuseNames = await completeReuseCacheNames(cacheStorage, configuration.productId, cacheName);
	await cacheStorage.delete(cacheName);
	const candidate = await cacheStorage.open(cacheName);
	const byUrl = new Map(configuration.assets.map((asset) => [asset.url, asset]));
	try {
		await installAssetBatches({
			cacheStorage,
			candidate,
			fetchImpl,
			cryptoImpl,
			reuseNames,
		}, configuration.installUrls.map((url) => byUrl.get(url)));
		const readiness = JSON.stringify({
			schemaVersion: 2,
			productId: configuration.productId,
			releaseId: configuration.releaseId,
		});
		await candidate.put(
			shellReadinessUrl(configuration.productId, configuration.releaseId),
			new Response(readiness, {
				status: 200,
				headers: {
					'content-length': String(new TextEncoder().encode(readiness).byteLength),
					'content-type': 'application/json; charset=utf-8',
				},
			}),
		);
	} catch (error) {
		await cacheStorage.delete(cacheName).catch(() => false);
		throw error;
	}
	return cacheName;
}

export async function activateOfflineShell({ configuration, cacheStorage, clients, cryptoImpl = globalThis.crypto }) {
	validateOfflineShellConfiguration(configuration);
	const activeName = shellCacheName(configuration.productId, configuration.releaseId);
	if (!await cacheIsComplete(cacheStorage, activeName, configuration, cryptoImpl)) {
		throw new Error('Offline shell cache is not complete.');
	}
	await clients.claim();
	for (const cacheName of await cacheStorage.keys()) {
		const sameProduct = cacheName.startsWith(`soundscaper-application-shell-v2-${configuration.productId}-`);
		const legacy = configuration.productId === 'soundscaper'
			&& cacheName.startsWith('soundscaper-application-shell-v1-');
		if ((sameProduct || legacy) && cacheName !== activeName) {
			await cacheStorage.delete(cacheName).catch(() => false);
		}
	}
}

function pathWithinShellScope(pathname, configuration) {
	const within = (path, scope) => path === scope.slice(0, -1) || path.startsWith(scope);
	if (!within(pathname, configuration.scope)) return false;
	return !configuration.foreignScopes.some((scope) => within(pathname, scope));
}

/**
 * The two cross-origin project transfer documents, and every path reserved
 * under their prefix.
 *
 * `TRANSFER_ROUTE_PREFIX` in `src/common/transfer/transfer-routes.js` is the
 * authority for that prefix; it is repeated as a literal here because this
 * function is serialised into the generated worker and can carry no imports.
 *
 * The worker declines these outright - it neither caches them nor answers them
 * from its cache - and two independent reasons point the same way. They are the
 * only documents `public/_headers` gives a per-document opener policy
 * (`same-origin-allow-popups` for the sender, `unsafe-none` for the receiver)
 * and marks `Cache-Control: no-cache`, because the popup handshake exists only
 * for as long as the opener relationship does; the origin's own response is the
 * only thing that carries that policy faithfully. And no product installs these
 * documents, so the offline navigation fallback has nothing to offer a
 * `/transfer/` path but an editor shell: it reads `transfer` as a locale
 * segment, finds no shell entry for it and lands on the cached `/en/` document,
 * whose `Cross-Origin-Opener-Policy: same-origin` severs `window.opener` -
 * turning a routing miss into what looks like a broken handshake protocol.
 *
 * A transfer navigation that cannot reach the network therefore fails as a
 * plain network error, which is honest, rather than quietly mounting the editor
 * with the opener already cut.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
function pathIsProjectTransferDocument(pathname) {
	// Never answered from the shell cache: an editor shell's same-origin COOP
	// severs the popup opener the project transfer handshake runs over.
	return pathname === '/transfer' || pathname.startsWith('/transfer/');
}

function offlineNavigationFallbackPaths(pathname, configuration, shellPaths) {
	const scope = configuration.scope;
	const path = String(pathname);
	let segments = (path.startsWith(scope) ? path.slice(scope.length) : '').split('/').filter(Boolean);
	const embedded = segments[0] === 'embed';
	if (embedded) segments = segments.slice(1);
	const locale = /^[A-Za-z\d-]{1,64}$/u.test(segments[0] ?? '') ? segments[0] : 'en';
	const localized = `${scope}${embedded ? 'embed/' : ''}${locale}/`;
	const defaultPath = embedded ? configuration.fallbacks.embedded : configuration.fallbacks.standard;
	return shellPaths.has(localized) && localized !== defaultPath ? [localized, defaultPath] : [defaultPath];
}

async function matchOfflineNavigationFallback(cache, pathname, configuration, descriptors, cryptoImpl) {
	if (pathIsProjectTransferDocument(pathname)) return null;
	for (const path of offlineNavigationFallbackPaths(pathname, configuration, descriptors)) {
		const descriptor = descriptors.get(path);
		if (!descriptor) continue;
		const response = await cache.match(path, { ignoreSearch: true });
		if (!response) continue;
		try {
			return await verifiedShellResponse(response, descriptor, cryptoImpl);
		} catch {
			await cache.delete(path, { ignoreSearch: true }).catch(() => false);
		}
	}
	return null;
}

async function cacheVerifiedAssetOnUse({ cache, descriptor, fetchImpl, cryptoImpl }) {
	const cached = await cache.match(descriptor.url, { ignoreSearch: true });
	if (cached) {
		try {
			return await verifiedShellResponse(cached, descriptor, cryptoImpl);
		} catch {
			await cache.delete(descriptor.url, { ignoreSearch: true }).catch(() => false);
		}
	}
	const response = await fetchImpl(descriptor.url, {
		cache: 'default',
		credentials: 'same-origin',
		redirect: 'error',
	});
	const verified = await verifiedShellResponse(response, descriptor, cryptoImpl);
	try {
		await cache.put(descriptor.url, verified.clone());
	} catch {
		// Cache-on-use is opportunistic; verified bytes can still satisfy this request.
	}
	return verified;
}

export async function handleApplicationShellFetch({
	configuration,
	cacheStorage,
	fetchImpl,
	request,
	origin,
	cryptoImpl = globalThis.crypto,
}) {
	if (request.method !== 'GET') return null;
	const requestUrl = new URL(request.url);
	if (requestUrl.origin !== origin) return null;
	if (pathIsProjectTransferDocument(requestUrl.pathname)) return null;
	if (request.mode === 'navigate' && !pathWithinShellScope(requestUrl.pathname, configuration)) return null;
	const descriptors = new Map(configuration.assets.map((asset) => [asset.url, asset]));
	const descriptor = descriptors.get(requestUrl.pathname);
	const cache = await cacheStorage.open(shellCacheName(configuration.productId, configuration.releaseId));
	if (descriptor) {
		try {
			return await cacheVerifiedAssetOnUse({ cache, descriptor, fetchImpl, cryptoImpl });
		} catch (error) {
			if (request.mode === 'navigate') {
				const fallback = await matchOfflineNavigationFallback(
					cache, requestUrl.pathname, configuration, descriptors, cryptoImpl,
				);
				if (fallback) return fallback;
			}
			throw error;
		}
	}
	if (request.mode !== 'navigate') return null;
	try {
		return await fetchImpl(request);
	} catch (error) {
		const fallback = await matchOfflineNavigationFallback(
			cache, requestUrl.pathname, configuration, descriptors, cryptoImpl,
		);
		if (fallback) return fallback;
		throw error;
	}
}
