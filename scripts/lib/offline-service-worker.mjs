/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

const CONFIGURATION_TOKEN = '__SOUNDSCAPER_OFFLINE_SHELL_CONFIGURATION__';
const RUNTIME_CACHE_PREFIX = 'soundscaper-ffmpeg-runtime-v1-';
const RUNTIME_STATE_CACHE_NAME = `${RUNTIME_CACHE_PREFIX}state`;
const RUNTIME_STATE_PATH = '/.soundscaper/offline/ffmpeg-runtime-state-v1.json';
const RUNTIME_ORIGIN = 'https://assets.soundscaper.org';
const RUNTIME_VERSION = '0.12.10';
const MAXIMUM_RUNTIME_STATE_BYTES = 64 * 1024;
const MAXIMUM_RUNTIME_FILE_BYTES = 64 * 1024 * 1024;
const MAXIMUM_RUNTIME_RELEASE_BYTES = 65 * 1024 * 1024;

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
				const fallbackPath = offlineNavigationFallbackPath(requestUrl.pathname, shellPaths);
				const fallback = await cache.match(fallbackPath, { ignoreSearch: true });
				if (fallback) return fallback;
				throw error;
			}
		}
	}
	if (requestUrl.origin === 'https://assets.soundscaper.org'
		&& /^\/runtime\/ffmpeg\/\d+\.\d+\.\d+\/releases\/[a-f\d]{64}\/ffmpeg-core\.(?:js|wasm)$/u.test(requestUrl.pathname)) {
		const cached = await matchCommittedRuntimeResponse({ cacheStorage, request, origin });
		if (cached) return cached;
	}
	return fetchImpl(request);
}

async function matchCommittedRuntimeResponse({ cacheStorage, request, origin }) {
	const state = await readCommittedRuntimeState(cacheStorage, origin);
	if (!state) return null;
	const releases = [state.active, state.previous].filter(Boolean);
	const release = releases.find(({ files }) => files.some(({ url }) => url === request.url));
	if (!release) return null;
	const file = release.files.find(({ url }) => url === request.url);
	if (!file) return null;
	const cache = await cacheStorage.open(`${RUNTIME_CACHE_PREFIX}${release.releaseId}`);
	const response = await cache.match(file.url);
	return verifiedRuntimeResponse(response, file);
}

async function readCommittedRuntimeState(cacheStorage, origin) {
	try {
		const cache = await cacheStorage.open(RUNTIME_STATE_CACHE_NAME);
		const response = await cache.match(new URL(RUNTIME_STATE_PATH, origin).href);
		if (!response?.ok || response.status !== 200 || response.headers.get('content-encoding') !== null
			|| response.headers.get('content-type')?.toLowerCase() !== 'application/json; charset=utf-8') return null;
		const declaredLength = response.headers.get('content-length');
		if (declaredLength === null || !/^[1-9]\d*$/u.test(declaredLength)
			|| Number(declaredLength) > MAXIMUM_RUNTIME_STATE_BYTES) return null;
		const bytes = await readBoundedRuntimeStateBody(response.body);
		if (bytes.byteLength !== Number(declaredLength)) return null;
		const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		return validateRuntimeState(value);
	} catch {
		return null;
	}
}

async function readBoundedRuntimeStateBody(body) {
	if (!body) throw new Error('Runtime state has no readable body.');
	const reader = body.getReader();
	const chunks = [];
	let byteLength = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array) || value.byteLength === 0
				|| byteLength + value.byteLength > MAXIMUM_RUNTIME_STATE_BYTES) {
				throw new Error('Runtime state body exceeds its byte limit.');
			}
			byteLength += value.byteLength;
			chunks.push(value.slice());
		}
	} catch (error) {
		await reader.cancel(error).catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
	if (byteLength === 0) throw new Error('Runtime state is empty.');
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function validateRuntimeState(value) {
	if (!runtimePlainObject(value) || !runtimeExactKeys(value, ['active', 'previous', 'schemaVersion'])
		|| value.schemaVersion !== 1) throw new Error('Runtime state is invalid.');
	const active = validateRuntimeRelease(value.active);
	const previous = value.previous === null ? null : validateRuntimeRelease(value.previous);
	if (previous?.releaseId === active.releaseId) throw new Error('Runtime state versions must be distinct.');
	return { schemaVersion: 1, active, previous };
}

function validateRuntimeRelease(value) {
	if (!runtimePlainObject(value)
		|| !runtimeExactKeys(value, ['baseUrl', 'files', 'manifestSha256', 'releaseId', 'schemaVersion'])
		|| value.schemaVersion !== 1 || typeof value.releaseId !== 'string'
		|| !/^[a-f\d]{64}$/u.test(value.releaseId) || value.manifestSha256 !== value.releaseId) {
		throw new Error('Runtime release is invalid.');
	}
	const baseUrl = `${RUNTIME_ORIGIN}/runtime/ffmpeg/${RUNTIME_VERSION}/releases/${value.releaseId}/`;
	if (value.baseUrl !== baseUrl || !Array.isArray(value.files) || value.files.length !== 2) {
		throw new Error('Runtime release inventory is invalid.');
	}
	const names = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];
	let totalBytes = 0;
	const files = names.map((name, index) => {
		const file = value.files[index];
		const contentType = name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8';
		if (!runtimePlainObject(file)
			|| !runtimeExactKeys(file, ['byteLength', 'contentType', 'name', 'sha256', 'url'])
			|| file.name !== name || file.url !== `${baseUrl}${name}` || file.contentType !== contentType
			|| !Number.isSafeInteger(file.byteLength) || file.byteLength < 1
			|| file.byteLength > MAXIMUM_RUNTIME_FILE_BYTES || typeof file.sha256 !== 'string'
			|| !/^[a-f\d]{64}$/u.test(file.sha256)) throw new Error('Runtime file descriptor is invalid.');
		totalBytes += file.byteLength;
		if (!Number.isSafeInteger(totalBytes) || totalBytes > MAXIMUM_RUNTIME_RELEASE_BYTES) {
			throw new Error('Runtime release exceeds its byte limit.');
		}
		return file;
	});
	return { ...value, files };
}

function runtimePlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype;
}

function runtimeExactKeys(value, expected) {
	return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function verifiedRuntimeResponse(response, file) {
	if (!response?.ok || response.status !== 200 || !response.body
		|| response.headers.get('content-length') !== String(file.byteLength)
		|| response.headers.get('content-type')?.toLowerCase() !== file.contentType.toLowerCase()
		|| response.headers.get('content-encoding') !== null
		|| response.headers.get('content-range') !== null
		|| response.headers.get('transfer-encoding') !== null) return null;
	const reader = response.body.getReader();
	const digest = createRuntimeSha256();
	let byteLength = 0;
	let released = false;
	const releaseReader = () => {
		if (released) return;
		released = true;
		reader.releaseLock();
	};
	const body = new ReadableStream({
		pull: async (controller) => {
			try {
				const { done, value } = await reader.read();
				if (done) {
					if (byteLength !== file.byteLength) {
						throw new Error(`Runtime cache byte length for ${file.name} is invalid.`);
					}
					if (digest.digestHex() !== file.sha256) {
						throw new Error(`Runtime cache SHA-256 for ${file.name} is invalid.`);
					}
					releaseReader();
					controller.close();
					return;
				}
				if (!(value instanceof Uint8Array) || value.byteLength === 0
					|| byteLength + value.byteLength > file.byteLength) {
					throw new Error(`Runtime cache byte length for ${file.name} is invalid.`);
				}
				byteLength += value.byteLength;
				digest.update(value);
				controller.enqueue(value);
			} catch (error) {
				await reader.cancel(error).catch(() => undefined);
				releaseReader();
				controller.error(error);
			}
		},
		cancel: async (reason) => {
			try {
				await reader.cancel(reason);
			} finally {
				releaseReader();
			}
		},
	});
	return new Response(body, {
		status: 200,
		statusText: response.statusText,
		headers: response.headers,
	});
}

function createRuntimeSha256() {
	const constants = new Uint32Array([
		0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
		0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
		0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
		0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
		0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
		0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
		0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
		0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
	]);
	const state = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
		0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	]);
	const block = new Uint8Array(64);
	const words = new Uint32Array(64);
	let blockLength = 0;
	let bytesHashed = 0;
	let finished = false;
	const rotateRight = (value, shift) => value >>> shift | value << (32 - shift);
	const processBlock = (bytes, offset) => {
		for (let index = 0; index < 16; index += 1) {
			const position = offset + index * 4;
			words[index] = (bytes[position] << 24 | bytes[position + 1] << 16
				| bytes[position + 2] << 8 | bytes[position + 3]) >>> 0;
		}
		for (let index = 16; index < 64; index += 1) {
			const left = words[index - 15];
			const right = words[index - 2];
			const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ left >>> 3;
			const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ right >>> 10;
			words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
		}
		let [a, b, c, d, e, f, g, h] = state;
		for (let index = 0; index < 64; index += 1) {
			const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
			const choice = e & f ^ ~e & g;
			const temporary1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
			const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
			const majority = a & b ^ a & c ^ b & c;
			const temporary2 = (sum0 + majority) >>> 0;
			h = g;
			g = f;
			f = e;
			e = (d + temporary1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (temporary1 + temporary2) >>> 0;
		}
		state[0] = (state[0] + a) >>> 0;
		state[1] = (state[1] + b) >>> 0;
		state[2] = (state[2] + c) >>> 0;
		state[3] = (state[3] + d) >>> 0;
		state[4] = (state[4] + e) >>> 0;
		state[5] = (state[5] + f) >>> 0;
		state[6] = (state[6] + g) >>> 0;
		state[7] = (state[7] + h) >>> 0;
	};
	const update = (bytes) => {
		if (finished || !(bytes instanceof Uint8Array)) throw new Error('Runtime SHA-256 input is invalid.');
		bytesHashed += bytes.byteLength;
		let offset = 0;
		while (offset < bytes.byteLength) {
			if (blockLength === 0 && bytes.byteLength - offset >= 64) {
				processBlock(bytes, offset);
				offset += 64;
				continue;
			}
			const copied = Math.min(64 - blockLength, bytes.byteLength - offset);
			block.set(bytes.subarray(offset, offset + copied), blockLength);
			blockLength += copied;
			offset += copied;
			if (blockLength === 64) {
				processBlock(block, 0);
				blockLength = 0;
			}
		}
	};
	const digestHex = () => {
		if (finished) throw new Error('Runtime SHA-256 is already finalized.');
		finished = true;
		block[blockLength] = 0x80;
		blockLength += 1;
		if (blockLength > 56) {
			block.fill(0, blockLength);
			processBlock(block, 0);
			blockLength = 0;
		}
		block.fill(0, blockLength, 56);
		const bitLength = bytesHashed * 8;
		const high = Math.floor(bitLength / 0x100000000);
		const low = bitLength >>> 0;
		for (let index = 0; index < 4; index += 1) {
			block[56 + index] = high >>> (3 - index) * 8 & 0xff;
			block[60 + index] = low >>> (3 - index) * 8 & 0xff;
		}
		processBlock(block, 0);
		return Array.from(state, (value) => value.toString(16).padStart(8, '0')).join('');
	};
	return { update, digestHex };
}

function offlineNavigationFallbackPath(pathname, shellPaths) {
	const segments = String(pathname).split('/').filter(Boolean);
	const framescaper = segments[0] === 'framescaper';
	if (framescaper) segments.shift();
	if (segments[0] === 'embed') segments.shift();
	const locale = /^[A-Za-z\d-]{1,64}$/u.test(segments[0] ?? '') ? segments[0] : 'en';
	const productDefault = framescaper ? '/framescaper/en/' : '/en/';
	const localized = framescaper ? `/framescaper/${locale}/` : `/${locale}/`;
	if (shellPaths.has(localized)) return localized;
	if (shellPaths.has(productDefault)) return productDefault;
	return '/';
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
const RUNTIME_CACHE_PREFIX = ${JSON.stringify(RUNTIME_CACHE_PREFIX)};
const RUNTIME_STATE_CACHE_NAME = ${JSON.stringify(RUNTIME_STATE_CACHE_NAME)};
const RUNTIME_STATE_PATH = ${JSON.stringify(RUNTIME_STATE_PATH)};
const RUNTIME_ORIGIN = ${JSON.stringify(RUNTIME_ORIGIN)};
const RUNTIME_VERSION = ${JSON.stringify(RUNTIME_VERSION)};
const MAXIMUM_RUNTIME_STATE_BYTES = ${String(MAXIMUM_RUNTIME_STATE_BYTES)};
const MAXIMUM_RUNTIME_FILE_BYTES = ${String(MAXIMUM_RUNTIME_FILE_BYTES)};
const MAXIMUM_RUNTIME_RELEASE_BYTES = ${String(MAXIMUM_RUNTIME_RELEASE_BYTES)};
${validateOfflineShellConfiguration.toString()}
${sha256Hex.toString()}
${shellCacheName.toString()}
${shellReadinessUrl.toString()}
${installOfflineShell.toString()}
${activateOfflineShell.toString()}
${offlineNavigationFallbackPath.toString()}
${runtimePlainObject.toString()}
${runtimeExactKeys.toString()}
${validateRuntimeRelease.toString()}
${validateRuntimeState.toString()}
${readBoundedRuntimeStateBody.toString()}
${readCommittedRuntimeState.toString()}
${createRuntimeSha256.toString()}
${verifiedRuntimeResponse.toString()}
${matchCommittedRuntimeResponse.toString()}
${handleOfflineShellFetch.toString()}
${attachOfflineServiceWorker.toString()}
attachOfflineServiceWorker(globalThis, OFFLINE_SHELL);
`;
}
