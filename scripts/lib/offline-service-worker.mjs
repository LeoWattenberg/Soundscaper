/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

const CONFIGURATION_TOKEN = '__SOUNDSCAPER_OFFLINE_SHELL_CONFIGURATION__';

export function offlineServiceWorkerTemplateSha256() {
	return createHash('sha256').update(serviceWorkerTemplate()).digest('hex');
}

export function renderOfflineServiceWorker(configuration) {
	const template = serviceWorkerTemplate();
	if (!template.includes(CONFIGURATION_TOKEN)) throw new Error('Offline service worker template token is missing.');
	return template.replace(CONFIGURATION_TOKEN, JSON.stringify(configuration));
}

export async function installOfflineShell({
	configuration,
	cacheStorage,
	fetchImpl,
	cryptoImpl = globalThis.crypto,
}) {
	validateOfflineShellConfiguration(configuration);
	const identityBytes = new TextEncoder().encode(JSON.stringify({
		schemaVersion: 1,
		workerSha256: configuration.workerSha256,
		assets: configuration.assets,
	}));
	if (await sha256Hex(identityBytes, cryptoImpl) !== configuration.releaseId) {
		throw new Error('Offline shell release identity is invalid.');
	}
	const cacheName = shellCacheName(configuration.releaseId);
	await cacheStorage.delete(cacheName);
	const cache = await cacheStorage.open(cacheName);
	try {
		for (const asset of configuration.assets) {
			const response = await fetchImpl(asset.url, {
				cache: 'reload',
				credentials: 'same-origin',
				redirect: 'error',
			});
			if (!response?.ok || response.status !== 200) {
				throw new Error(`Offline shell request failed for ${asset.url} (${String(response?.status)}).`);
			}
			const declaredLength = response.headers.get('content-length');
			const contentEncoding = response.headers.get('content-encoding');
			if (declaredLength !== null && contentEncoding === null && (!/^\d+$/u.test(declaredLength)
				|| Number(declaredLength) !== asset.byteLength)) {
				throw new Error(`Offline shell Content-Length mismatch for ${asset.url}.`);
			}
			const bytes = await response.arrayBuffer();
			if (bytes.byteLength !== asset.byteLength) {
				throw new Error(`Offline shell byte-length mismatch for ${asset.url}.`);
			}
			if (await sha256Hex(bytes, cryptoImpl) !== asset.sha256) {
				throw new Error(`Offline shell SHA-256 mismatch for ${asset.url}.`);
			}
			const headers = new Headers(response.headers);
			headers.delete('content-encoding');
			headers.delete('transfer-encoding');
			headers.set('content-length', String(asset.byteLength));
			await cache.put(asset.url, new Response(bytes, {
				status: 200,
				statusText: response.statusText,
				headers,
			}));
		}
		const readiness = JSON.stringify({ schemaVersion: 1, releaseId: configuration.releaseId });
		await cache.put(shellReadinessUrl(configuration.releaseId), new Response(readiness, {
			status: 200,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		}));
	} catch (error) {
		await cacheStorage.delete(cacheName).catch(() => false);
		throw error;
	}
	return cacheName;
}

export async function activateOfflineShell({ configuration, cacheStorage, clients }) {
	validateOfflineShellConfiguration(configuration);
	const activeName = shellCacheName(configuration.releaseId);
	const active = await cacheStorage.open(activeName);
	const readiness = await active.match(shellReadinessUrl(configuration.releaseId));
	if (!readiness?.ok) throw new Error('Offline shell cache is not complete.');
	await clients.claim();
	for (const cacheName of await cacheStorage.keys()) {
		if (cacheName.startsWith('soundscaper-application-shell-v1-') && cacheName !== activeName) {
			await cacheStorage.delete(cacheName).catch(() => false);
		}
	}
}

export async function handleOfflineShellFetch({
	configuration,
	cacheStorage,
	fetchImpl,
	request,
	origin,
}) {
	if (request.method !== 'GET') return fetchImpl(request);
	const requestUrl = new URL(request.url);
	if (requestUrl.origin === origin) {
		const shellPaths = new Set(configuration.assets.map(({ url }) => url));
		if (shellPaths.has(requestUrl.pathname)) {
			const cache = await cacheStorage.open(shellCacheName(configuration.releaseId));
			return await cache.match(requestUrl.pathname, { ignoreSearch: true }) ?? fetchImpl(request);
		}
		if (request.mode === 'navigate') {
			try {
				return await fetchImpl(request);
			} catch (error) {
				const cache = await cacheStorage.open(shellCacheName(configuration.releaseId));
				const fallback = await cache.match('/', { ignoreSearch: true });
				if (fallback) return fallback;
				throw error;
			}
		}
	}
	if (requestUrl.origin === 'https://assets.soundscaper.org'
		&& /^\/runtime\/ffmpeg\/\d+\.\d+\.\d+\/releases\/[a-f\d]{64}\/ffmpeg-core\.(?:js|wasm)$/u.test(requestUrl.pathname)) {
		for (const cacheName of await cacheStorage.keys()) {
			if (!cacheName.startsWith('soundscaper-ffmpeg-runtime-v1-')
				|| cacheName.endsWith('state') || cacheName.includes('candidate-')) continue;
			const cached = await (await cacheStorage.open(cacheName)).match(request);
			if (cached) return cached;
		}
	}
	return fetchImpl(request);
}

export function validateOfflineShellConfiguration(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| value.schemaVersion !== 1 || !/^[a-f\d]{64}$/u.test(value.releaseId)
		|| !/^[a-f\d]{64}$/u.test(value.workerSha256) || !Array.isArray(value.assets)
		|| value.assets.length < 1 || value.assets.length > 4096) {
		throw new Error('Offline shell configuration is invalid.');
	}
	let totalBytes = 0;
	let previousUrl = '';
	for (const asset of value.assets) {
		if (!asset || typeof asset !== 'object' || Array.isArray(asset)
			|| Object.keys(asset).sort().join(',') !== 'byteLength,sha256,url'
			|| typeof asset.url !== 'string' || !asset.url.startsWith('/')
			|| asset.url.includes('\\') || asset.url.includes('?') || asset.url.includes('#')
			|| asset.url <= previousUrl || !Number.isSafeInteger(asset.byteLength)
			|| asset.byteLength < 1 || asset.byteLength > 25 * 1024 * 1024
			|| !/^[a-f\d]{64}$/u.test(asset.sha256)) {
			throw new Error('Offline shell asset descriptor is invalid.');
		}
		previousUrl = asset.url;
		totalBytes += asset.byteLength;
		if (!Number.isSafeInteger(totalBytes) || totalBytes > 256 * 1024 * 1024) {
			throw new Error('Offline shell aggregate byte limit is exceeded.');
		}
	}
	return value;
}

async function sha256Hex(bytes, cryptoImpl) {
	if (!cryptoImpl?.subtle) throw new Error('Web Crypto is unavailable for offline shell verification.');
	const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes));
	return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

function shellCacheName(releaseId) {
	return `soundscaper-application-shell-v1-${releaseId}`;
}

function shellReadinessUrl(releaseId) {
	return `/.soundscaper/offline/application-shell-${releaseId}.json`;
}

function attachOfflineServiceWorker(scope, configuration) {
	scope.addEventListener('install', (event) => {
		event.waitUntil(installOfflineShell({
			configuration,
			cacheStorage: scope.caches,
			fetchImpl: scope.fetch.bind(scope),
			cryptoImpl: scope.crypto,
		}));
	});
	scope.addEventListener('activate', (event) => {
		event.waitUntil(activateOfflineShell({
			configuration,
			cacheStorage: scope.caches,
			clients: scope.clients,
		}));
	});
	scope.addEventListener('fetch', (event) => {
		if (event.request.method !== 'GET') return;
		event.respondWith(handleOfflineShellFetch({
			configuration,
			cacheStorage: scope.caches,
			fetchImpl: scope.fetch.bind(scope),
			request: event.request,
			origin: scope.location.origin,
		}));
	});
}

function serviceWorkerTemplate() {
	return `/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
const OFFLINE_SHELL = ${CONFIGURATION_TOKEN};
${validateOfflineShellConfiguration.toString()}
${sha256Hex.toString()}
${shellCacheName.toString()}
${shellReadinessUrl.toString()}
${installOfflineShell.toString()}
${activateOfflineShell.toString()}
${handleOfflineShellFetch.toString()}
${attachOfflineServiceWorker.toString()}
attachOfflineServiceWorker(globalThis, OFFLINE_SHELL);
`;
}
