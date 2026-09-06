/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

import {
	handleShareTargetSubmission,
	isShareTargetSubmission,
	sharedFilesBodyUrl,
	sharedFilesCacheName,
	sharedFilesLimits,
	sharedFilesManifestUrl,
	shareTargetPath,
} from '../scripts/lib/offline-share-target-worker.mjs';
import {
	attachOfflineServiceWorker,
	handleOfflineShellFetch,
	renderOfflineServiceWorker,
} from '../scripts/lib/offline-service-worker.mjs';
import { SHARE_TARGET_FILES_FIELD, SHARE_TARGET_PATH } from '../scripts/lib/product-web-manifest.mjs';
import { shellConfiguration, shellResponse } from './helpers/offline-shell-fixtures.js';

const ORIGIN = 'https://soundscaper.org';
const SHARE_URL = `${ORIGIN}/share-target`;

/** A cache storage that answers `keys()`, which the stash prune walks. */
class ShareCacheStorage {
	caches = new Map();

	async open(name) {
		let cache = this.caches.get(name);
		if (!cache) {
			cache = new ShareCache();
			this.caches.set(name, cache);
		}
		return cache;
	}

	async keys() {
		return [...this.caches.keys()];
	}

	async delete(name) {
		return this.caches.delete(name);
	}

	shareCache() {
		return this.caches.get(sharedFilesCacheName()) ?? new ShareCache();
	}
}

class ShareCache {
	entries = new Map();

	async match(url) {
		return this.entries.get(String(url))?.clone();
	}

	async put(url, response) {
		this.entries.set(String(url), response.clone());
	}

	async delete(url) {
		return this.entries.delete(String(url));
	}

	/** The real Cache answers absolute requests, so the fake does too. */
	async keys() {
		return [...this.entries.keys()].map((url) => new Request(`${ORIGIN}${url}`));
	}
}

/** A deterministic token source, one distinct token per share. */
function countingCrypto() {
	let counter = 0;
	return {
		getRandomValues(bytes) {
			counter += 1;
			bytes.fill(counter);
			return bytes;
		},
	};
}

function shareRequest(parts, options = {}) {
	const {
		contentType = 'multipart/form-data; boundary=--soundscaper',
		method = 'POST',
		url = SHARE_URL,
		formData = async () => ({ getAll: (field) => field === SHARE_TARGET_FILES_FIELD ? parts : [] }),
	} = options;
	return {
		method,
		url,
		headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null },
		formData,
	};
}

function mediaFile(name, contents, type = 'audio/wav') {
	return new File([new TextEncoder().encode(contents)], name, { type });
}

async function submit(parts, options = {}) {
	const cacheStorage = options.cacheStorage ?? new ShareCacheStorage();
	const response = await handleShareTargetSubmission({
		configuration: options.configuration ?? shellConfiguration('e'),
		cacheStorage,
		request: options.request ?? shareRequest(parts, options.requestOptions ?? {}),
		cryptoImpl: options.cryptoImpl ?? countingCrypto(),
		now: options.now ?? (() => 1_000),
	});
	return { cacheStorage, response, location: new URL(response.headers.get('location')) };
}

async function stashedTokens(cacheStorage) {
	const cache = cacheStorage.shareCache();
	return [...cache.entries.keys()]
		.map((url) => /\/\.soundscaper\/share\/([a-f\d]{32})\.json$/u.exec(url))
		.filter((match) => match !== null)
		.map((match) => match[1])
		.sort();
}

test('a shared batch is stashed under a one-time token and answered with a redirect', async () => {
	const { cacheStorage, response, location } = await submit([
		mediaFile('Interview.wav', 'first shared file'),
		mediaFile('Room tone.flac', 'second shared file', 'audio/flac'),
	]);

	assert.equal(response.status, 303);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.equal(location.origin, ORIGIN);
	assert.equal(location.pathname, '/en/');
	const token = location.searchParams.get('share');
	assert.match(token, /^[a-f\d]{32}$/u);
	const cache = cacheStorage.shareCache();
	const manifest = await (await cache.match(sharedFilesManifestUrl(token))).json();
	assert.deepEqual(manifest, {
		schemaVersion: 1,
		createdAt: 1_000,
		files: [
			{ name: 'Interview.wav', type: 'audio/wav', byteLength: 17 },
			{ name: 'Room tone.flac', type: 'audio/flac', byteLength: 18 },
		],
	});
	assert.equal(await (await cache.match(sharedFilesBodyUrl(token, 0))).text(), 'first shared file');
	assert.equal(await (await cache.match(sharedFilesBodyUrl(token, 1))).text(), 'second shared file');
});

test('the worker reads the field, and answers the path, that the manifest declares', async () => {
	assert.equal(shareTargetPath({ scope: '/' }), `/${SHARE_TARGET_PATH}`);
	assert.equal(shareTargetPath({ scope: '/framescaper/' }), `/framescaper/${SHARE_TARGET_PATH}`);

	const { location } = await submit([mediaFile('Take.wav', 'shared')], {
		requestOptions: {
			formData: async () => ({ getAll: (field) => field === 'files' ? [mediaFile('Take.wav', 'x')] : [] }),
		},
	});

	assert.equal(location.search, '', 'a field the manifest never declares carries no files');
});

test('a share carrying nothing this editor can hold still opens the editor', async () => {
	const { cacheStorage, location } = await submit(['https://example.invalid/a-link', { size: 4 }, null]);

	assert.equal(location.href, `${ORIGIN}/en/`);
	assert.deepEqual([...cacheStorage.caches.keys()], [], 'nothing is stored for a share with no files');
});

test('a submission that is not multipart form data is refused rather than read', async () => {
	const { cacheStorage, location } = await submit([mediaFile('Take.wav', 'shared')], {
		requestOptions: { contentType: 'application/x-www-form-urlencoded' },
	});

	assert.equal(location.href, `${ORIGIN}/en/?share-error=unreadable`);
	assert.deepEqual([...cacheStorage.caches.keys()], []);
});

test('a share whose form cannot be read is refused rather than half stored', async () => {
	const { cacheStorage, location } = await submit([], {
		requestOptions: { formData: () => Promise.reject(new TypeError('malformed multipart body')) },
	});

	assert.equal(location.href, `${ORIGIN}/en/?share-error=unreadable`);
	assert.deepEqual([...cacheStorage.caches.keys()], []);
});

test('a share larger than a stash may hold is refused whole rather than truncated', async () => {
	const oversize = {
		name: 'Feature.mp4',
		type: 'video/mp4',
		size: sharedFilesLimits().maximumBytes + 1,
		arrayBuffer: async () => new Uint8Array(4).buffer,
	};

	const { cacheStorage, location } = await submit([mediaFile('Take.wav', 'shared'), oversize]);

	assert.equal(location.href, `${ORIGIN}/en/?share-error=too-large`);
	assert.deepEqual(await stashedTokens(cacheStorage), []);
});

test('a share of more files than a stash may hold is refused whole', async () => {
	const files = Array.from(
		{ length: sharedFilesLimits().maximumFiles + 1 },
		(_value, index) => mediaFile(`Take ${String(index)}.wav`, 'shared'),
	);

	const { cacheStorage, location } = await submit(files);

	assert.equal(location.href, `${ORIGIN}/en/?share-error=too-large`);
	assert.deepEqual(await stashedTokens(cacheStorage), []);
});

test('a second share arriving before the first is collected keeps both', async () => {
	const cacheStorage = new ShareCacheStorage();
	const cryptoImpl = countingCrypto();

	const first = await submit([mediaFile('First.wav', 'one')], { cacheStorage, cryptoImpl, now: () => 1_000 });
	const second = await submit([mediaFile('Second.wav', 'two')], { cacheStorage, cryptoImpl, now: () => 2_000 });

	const tokens = [first.location.searchParams.get('share'), second.location.searchParams.get('share')];
	assert.notEqual(tokens[0], tokens[1], 'each share is collectable on its own token');
	assert.deepEqual(await stashedTokens(cacheStorage), [...tokens].sort());
});

test('pending shares beyond the limit drop the oldest rather than accumulating', async () => {
	const cacheStorage = new ShareCacheStorage();
	const cryptoImpl = countingCrypto();
	const limits = sharedFilesLimits();
	const tokens = [];
	for (let index = 0; index < limits.maximumPending + 2; index += 1) {
		const { location } = await submit([mediaFile(`Take ${String(index)}.wav`, 'shared')], {
			cacheStorage,
			cryptoImpl,
			now: () => 1_000 + index,
		});
		tokens.push(location.searchParams.get('share'));
	}

	assert.deepEqual(
		await stashedTokens(cacheStorage),
		[...tokens.slice(-limits.maximumPending)].sort(),
		'only the newest pending shares survive',
	);
	const cache = cacheStorage.shareCache();
	assert.equal(await cache.match(sharedFilesBodyUrl(tokens[0], 0)), undefined, 'a dropped share leaves no bytes');
});

test('a stash older than the share lifetime is swept by the next share', async () => {
	const cacheStorage = new ShareCacheStorage();
	const cryptoImpl = countingCrypto();
	const limits = sharedFilesLimits();

	const stale = await submit([mediaFile('Stale.wav', 'old')], { cacheStorage, cryptoImpl, now: () => 1_000 });
	const fresh = await submit([mediaFile('Fresh.wav', 'new')], {
		cacheStorage,
		cryptoImpl,
		now: () => 1_000 + limits.lifetimeMs + 1,
	});

	assert.deepEqual(await stashedTokens(cacheStorage), [fresh.location.searchParams.get('share')]);
	const cache = cacheStorage.shareCache();
	const staleToken = stale.location.searchParams.get('share');
	assert.equal(await cache.match(sharedFilesBodyUrl(staleToken, 0)), undefined);
});

test('bodies orphaned by a manifest that was never written are swept by the next share', async () => {
	const cacheStorage = new ShareCacheStorage();
	const orphan = 'a'.repeat(32);
	const cache = await cacheStorage.open(sharedFilesCacheName());
	await cache.put(sharedFilesBodyUrl(orphan, 0), new Response('orphaned bytes'));

	await submit([mediaFile('Take.wav', 'shared')], { cacheStorage });

	assert.equal(await cache.match(sharedFilesBodyUrl(orphan, 0)), undefined);
	assert.equal(await cache.match(sharedFilesManifestUrl(orphan)), undefined);
});

test('a share submission is recognized only as a POST to the declared path on this origin', () => {
	const configuration = shellConfiguration('e');
	const submission = (request) => isShareTargetSubmission(request, ORIGIN, configuration);

	assert.equal(submission({ method: 'POST', url: SHARE_URL }), true);
	assert.equal(submission({ method: 'GET', url: SHARE_URL }), false);
	assert.equal(submission({ method: 'POST', url: `${ORIGIN}/en/` }), false);
	assert.equal(submission({ method: 'POST', url: 'https://framescaper.org/share-target' }), false);
	assert.equal(submission({ method: 'POST', url: `${ORIGIN}/share-target/nested` }), false);
	assert.equal(submission({ method: 'POST', url: '/share-target' }), false);
	assert.equal(submission(null), false);
});

test('a GET of the share-target path is served as an ordinary request', async () => {
	const cacheStorage = new ShareCacheStorage();
	const requested = [];

	const response = await handleOfflineShellFetch({
		configuration: shellConfiguration('e'),
		cacheStorage,
		fetchImpl: async (request) => {
			requested.push(request.url);
			return new Response('network');
		},
		request: { method: 'GET', url: SHARE_URL },
		origin: ORIGIN,
	});

	assert.equal(await response.text(), 'network');
	assert.deepEqual(requested, [SHARE_URL]);
	assert.deepEqual(await stashedTokens(cacheStorage), []);
});

test('a POST that is not a share reaches the network untouched', async () => {
	const cacheStorage = new ShareCacheStorage();
	const requested = [];

	const response = await handleOfflineShellFetch({
		configuration: shellConfiguration('e'),
		cacheStorage,
		fetchImpl: async (request) => {
			requested.push(request.url);
			return new Response('network');
		},
		request: { method: 'POST', url: `${ORIGIN}/api/anything` },
		origin: ORIGIN,
	});

	assert.equal(await response.text(), 'network');
	assert.deepEqual(requested, [`${ORIGIN}/api/anything`]);
	assert.deepEqual([...cacheStorage.caches.keys()], []);
});

test('the fetch listener answers a share submission and still declines every other POST', async () => {
	const configuration = shellConfiguration('e');
	const listeners = new Map();
	const scope = {
		location: { origin: ORIGIN },
		caches: new ShareCacheStorage(),
		crypto: countingCrypto(),
		clients: { claim: async () => undefined },
		fetch: async (input) => typeof input === 'string' ? shellResponse(input) : new Response('network'),
		addEventListener: (type, handler) => { listeners.set(type, handler); },
	};
	attachOfflineServiceWorker(scope, configuration);
	const respond = (request) => {
		const answers = [];
		listeners.get('fetch')({ request, respondWith: (value) => { answers.push(value); } });
		return answers;
	};

	const declined = respond({ method: 'POST', url: `${ORIGIN}/api/anything` });
	const shared = respond(shareRequest([mediaFile('Take.wav', 'shared')]));
	const navigated = respond({ method: 'GET', url: `${ORIGIN}/en/`, mode: 'navigate' });

	assert.deepEqual(declined, [], 'a POST that is not a share is left to the network');
	assert.equal(shared.length, 1);
	assert.equal((await shared[0]).status, 303);
	assert.equal(navigated.length, 1, 'ordinary navigations are still served by the shell');
	assert.equal(await (await navigated[0]).text(), 'root shell');
});

test('the generated worker carries the share-target runtime', () => {
	const source = renderOfflineServiceWorker(shellConfiguration('0'));

	assert.match(source, /function handleShareTargetSubmission\(/u);
	assert.match(source, /function isShareTargetSubmission\(/u);
	assert.equal(source.includes(sharedFilesCacheName()), true);
	assert.match(source, /\$\{configuration\.scope\}share-target/u);
	assert.equal(SHARE_TARGET_PATH, 'share-target');
	assert.equal(source.includes(`getAll('${SHARE_TARGET_FILES_FIELD}')`), true);
});

/*
 * The share-target runtime reaches a browser only as text: every function is
 * serialised into the worker by `Function.prototype.toString`, which keeps the
 * source and drops the module scope around it. A reference this module resolves
 * by import or by a top-level constant therefore compiles here and fails only in
 * the deployed worker, so the generated script is run rather than read.
 */
test('the generated worker really answers a share once it is detached from this module', async () => {
	const cacheStorage = new ShareCacheStorage();
	const listeners = new Map();
	const scope = {
		Array, Blob, Date, Error, File, Headers, JSON, Map, Math, Number, Object, Promise,
		Request, Response, Set, String, TextEncoder, TypeError, URL, URLSearchParams, Uint8Array, console,
		caches: cacheStorage,
		clients: { claim: async () => undefined },
		crypto: globalThis.crypto,
		fetch: async () => new Response('network'),
		location: { origin: ORIGIN },
		addEventListener: (type, handler) => { listeners.set(type, handler); },
	};
	scope.globalThis = scope;
	runInContext(renderOfflineServiceWorker(shellConfiguration('4')), createContext(scope));
	const respond = (request) => {
		const answers = [];
		listeners.get('fetch')({ request, respondWith: (value) => { answers.push(value); } });
		return answers;
	};

	const shared = respond(shareRequest([mediaFile('Take.wav', 'shared bytes')]));
	const declined = respond({ method: 'POST', url: `${ORIGIN}/api/anything` });

	assert.deepEqual(declined, [], 'the deployed worker declines every other POST too');
	const response = await shared[0];
	assert.equal(response.status, 303);
	const token = new URL(response.headers.get('location')).searchParams.get('share');
	assert.match(token, /^[a-f\d]{32}$/u, 'the deployed worker mints a token from real Web Crypto');
	const cache = cacheStorage.shareCache();
	const manifest = await (await cache.match(sharedFilesManifestUrl(token))).json();
	assert.deepEqual(manifest.files, [{ name: 'Take.wav', type: 'audio/wav', byteLength: 12 }]);
	assert.equal(await (await cache.match(sharedFilesBodyUrl(token, 0))).text(), 'shared bytes');
});
