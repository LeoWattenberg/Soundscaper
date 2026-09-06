/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The files the operating system's share sheet sends an installed editor.
 *
 * A `share_target` entry names a URL and a method, and the browser submits the
 * shared files to it as an ordinary multipart form POST. These products are
 * served from a static host, so there is nothing behind that URL to answer it:
 * the service worker is the whole server. It takes the body, puts the files
 * where the document can reach them, and answers with a redirect so the browser
 * lands on the editor rather than on a bare response.
 *
 * The handoff runs through the Cache API, which is the only store that survives
 * everything between the two halves of a share. Three alternatives were
 * weighed and rejected:
 *
 * - Worker memory. A service worker may be terminated the moment its response
 *   is delivered, and the navigation that response asks for is what wakes it
 *   again, so state held in a module variable is exactly the state most likely
 *   to be collected before it is read.
 * - `postMessage` to a client. At POST time there is no client to send to: the
 *   document that will collect the files is created by the redirect this
 *   handler has not returned yet. A buffer would still be needed, which is the
 *   problem rather than the solution.
 * - IndexedDB. It would work, but it is a second database with a version and an
 *   upgrade path standing next to the editor's own, for a payload whose entire
 *   life is one navigation.
 *
 * This is a module of its own rather than more of `offline-shell-worker.mjs`
 * because that file is the application shell: one cache, one release identity,
 * one verified asset inventory, and every function in it serves that. A share
 * has its own cache, its own lifetime and no digest to verify, and the shell
 * file is close enough to the maintainability ceiling that adding a second
 * subject to it would be the wrong answer twice over. `offline-service-worker.mjs`
 * stays what it already was: the assembly point that composes both runtimes into
 * one script and owns the single fetch listener that dispatches between them.
 *
 * The cache is keyed by a one-time random token that rides the redirect in the
 * query, and the document deletes the entries it collects.
 * `src/common/offline/share-target-launch.ts` is that document half, and it
 * mirrors the constants below; `tests/offline-share-target-launch.test.ts`
 * holds the two copies to each other.
 *
 * Every function here is serialised into the generated worker by
 * `shareTargetFunctionSources`, so this module carries no imports and no
 * top-level constants: a value a serialised function closes over does not
 * survive `Function.prototype.toString`. Constants are therefore functions, and
 * the two the manifest also states - `SHARE_TARGET_PATH` and
 * `SHARE_TARGET_FILES_FIELD` in `scripts/lib/product-web-manifest.mjs` - are
 * spelled out here and held to that module by
 * `tests/offline-share-target-worker.test.js`. A worker answering a path the
 * manifest never declared is dead code, and a field name only one half knows is
 * a share that arrives empty.
 */

/** The share-target runtime, in the order the generated worker declares it. */
export function shareTargetFunctionSources() {
	return [
		sharedFilesCacheName,
		sharedFilesLimits,
		sharedFilesTokenParameter,
		sharedFilesErrorParameter,
		sharedFilesManifestUrl,
		sharedFilesBodyUrl,
		sharedFilesStashToken,
		newSharedFilesToken,
		shareTargetPath,
		isShareTargetSubmission,
		readSharedSubmissionFiles,
		sharedFilesStashRecord,
		deleteSharedFileStash,
		pruneSharedFileStashes,
		stashSharedFiles,
		sharedFilesRedirect,
		handleShareTargetSubmission,
	].map((value) => value.toString()).join('\n');
}

/**
 * The one cache every pending share is held in.
 *
 * It carries no product identifier, unlike the application shell caches: cache
 * storage is per-origin and each product now owns the root of its own origin,
 * so there is no second product here to collide with. The shell names carry one
 * only because a retired deployment once served both products from a single
 * origin.
 */
export function sharedFilesCacheName() {
	return 'soundscaper-shared-files-v1';
}

/**
 * What one share may hold, and how much may be pending at once.
 *
 * The pending count and the lifetime are the bound on a share nobody collects:
 * a document that never opens, or a person who dismisses it, leaves a stash
 * behind, and without these the cache would grow for the life of the install.
 */
export function sharedFilesLimits() {
	return {
		maximumFiles: 32,
		maximumBytes: 512 * 1024 * 1024,
		maximumPending: 4,
		lifetimeMs: 10 * 60 * 1000,
	};
}

/** The query parameter the redirect carries a collectable token in. */
export function sharedFilesTokenParameter() {
	return 'share';
}

/** The query parameter that reports a share the worker could not accept. */
export function sharedFilesErrorParameter() {
	return 'share-error';
}

/** Where one stash records the files it holds. */
export function sharedFilesManifestUrl(token) {
	return `/.soundscaper/share/${token}.json`;
}

/** Where one stashed file's bytes live. */
export function sharedFilesBodyUrl(token, index) {
	return `/.soundscaper/share/${token}/${index}`;
}

/** The token a stash key belongs to, or null when the key is not one. */
function sharedFilesStashToken(url) {
	const match = /\/\.soundscaper\/share\/([a-f\d]{32})(?:\.json|\/\d{1,3})$/u.exec(String(url));
	return match === null ? null : match[1];
}

function newSharedFilesToken(cryptoImpl) {
	if (!cryptoImpl || typeof cryptoImpl.getRandomValues !== 'function') {
		throw new Error('Web Crypto is unavailable for a shared-file token.');
	}
	const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

/**
 * The path the manifest's `share_target` action addresses.
 *
 * It is derived from the worker's own scope rather than written out, because a
 * worker may only claim what its script URL bounds: a share posted outside the
 * scope would never reach this handler at all.
 */
export function shareTargetPath(configuration) {
	return `${configuration.scope}share-target`;
}

/**
 * Whether one request is a share submission.
 *
 * Deliberately narrow. The worker declines every other non-GET request without
 * reading it, and a handler that guessed would turn the editor into a general
 * POST interceptor for its own origin.
 */
export function isShareTargetSubmission(request, origin, configuration) {
	if (!request || request.method !== 'POST' || typeof request.url !== 'string') return false;
	let url;
	try {
		url = new URL(request.url);
	} catch {
		return false;
	}
	return url.origin === origin && url.pathname === shareTargetPath(configuration);
}

/**
 * The files one submission carries, refusing anything it cannot hold.
 *
 * A share sheet may send text and links as well as files, and those parts
 * arrive under the same form as strings: only parts that read as files are
 * taken. An over-sized share is refused whole rather than truncated, because a
 * batch silently missing half its files is worse than a batch that says so.
 */
async function readSharedSubmissionFiles(request) {
	const limits = sharedFilesLimits();
	const contentType = request.headers && typeof request.headers.get === 'function'
		? String(request.headers.get('content-type') ?? '')
		: '';
	if (!/^multipart\/form-data\b/iu.test(contentType.trim())) {
		return { files: [], overflow: false, refused: true };
	}
	const form = await request.formData();
	const parts = form && typeof form.getAll === 'function' ? form.getAll('media') : [];
	const files = [];
	let bytes = 0;
	for (const part of parts) {
		if (!part || typeof part !== 'object' || typeof part.name !== 'string' || part.name === ''
			|| typeof part.arrayBuffer !== 'function') continue;
		bytes += Number.isSafeInteger(part.size) && part.size > 0 ? part.size : 0;
		if (files.length >= limits.maximumFiles || bytes > limits.maximumBytes) {
			return { files: [], overflow: true, refused: false };
		}
		files.push(part);
	}
	return { files, overflow: false, refused: false };
}

/** One stash's manifest, or null when it is absent or unreadable. */
async function sharedFilesStashRecord(cache, token) {
	const response = await cache.match(sharedFilesManifestUrl(token));
	if (!response) return null;
	let record;
	try {
		record = await response.json();
	} catch {
		return null;
	}
	if (!record || typeof record !== 'object' || record.schemaVersion !== 1 || !Array.isArray(record.files)) {
		return null;
	}
	const createdAt = Number(record.createdAt);
	return { createdAt: Number.isFinite(createdAt) ? createdAt : 0, count: record.files.length };
}

/**
 * One stash removed.
 *
 * The manifest goes first, so a document collecting concurrently never reads a
 * manifest whose bodies are being deleted underneath it. A count of zero means
 * the manifest could not be read, and the whole index range is swept instead.
 */
async function deleteSharedFileStash(cache, token, count) {
	const limits = sharedFilesLimits();
	const total = Number.isSafeInteger(count) && count > 0
		? Math.min(count, limits.maximumFiles)
		: limits.maximumFiles;
	await cache.delete(sharedFilesManifestUrl(token));
	for (let index = 0; index < total; index += 1) await cache.delete(sharedFilesBodyUrl(token, index));
}

/**
 * Whatever earlier shares left behind, dropped before a new one is written.
 *
 * Three kinds of debris are swept: a stash whose bodies outlived a failed
 * manifest write, a stash older than the share lifetime, and the oldest stashes
 * once more are pending than the limit allows. What remains is bounded whether
 * or not any document ever collects.
 */
async function pruneSharedFileStashes(cache, now) {
	const limits = sharedFilesLimits();
	const records = new Map();
	for (const key of await cache.keys()) {
		const token = sharedFilesStashToken(key && typeof key === 'object' ? key.url : key);
		if (token === null || records.has(token)) continue;
		records.set(token, await sharedFilesStashRecord(cache, token));
	}
	const stashes = [];
	for (const [token, record] of records) {
		if (record === null) await deleteSharedFileStash(cache, token, 0);
		else stashes.push({ token, createdAt: record.createdAt, count: record.count });
	}
	stashes.sort((left, right) => left.createdAt - right.createdAt);
	const expiry = now() - limits.lifetimeMs;
	const surplus = stashes.length - (limits.maximumPending - 1);
	for (let index = 0; index < stashes.length; index += 1) {
		if (index < surplus || stashes[index].createdAt <= expiry) {
			await deleteSharedFileStash(cache, stashes[index].token, stashes[index].count);
		}
	}
}

/**
 * One share written to the cache, or null when its real bytes exceed the limit.
 *
 * Bodies are written before the manifest that indexes them, so a collector that
 * finds a manifest finds every file it names. A failure part way through takes
 * the partial stash with it rather than leaving bytes nothing will ever read.
 */
async function stashSharedFiles({ cacheStorage, files, cryptoImpl, now }) {
	const limits = sharedFilesLimits();
	const cache = await cacheStorage.open(sharedFilesCacheName());
	await pruneSharedFileStashes(cache, now);
	const token = newSharedFilesToken(cryptoImpl);
	const entries = [];
	let bytes = 0;
	try {
		for (const file of files) {
			const body = await file.arrayBuffer();
			bytes += body.byteLength;
			if (bytes > limits.maximumBytes) {
				await deleteSharedFileStash(cache, token, entries.length);
				return null;
			}
			await cache.put(sharedFilesBodyUrl(token, entries.length), new Response(body, {
				status: 200,
				headers: {
					'cache-control': 'no-store',
					'content-length': String(body.byteLength),
					'content-type': 'application/octet-stream',
				},
			}));
			entries.push({
				name: String(file.name),
				type: typeof file.type === 'string' ? file.type : '',
				byteLength: body.byteLength,
			});
		}
		const manifest = JSON.stringify({ schemaVersion: 1, createdAt: now(), files: entries });
		await cache.put(sharedFilesManifestUrl(token), new Response(manifest, {
			status: 200,
			headers: {
				'cache-control': 'no-store',
				'content-length': String(new TextEncoder().encode(manifest).byteLength),
				'content-type': 'application/json; charset=utf-8',
			},
		}));
	} catch (error) {
		await deleteSharedFileStash(cache, token, entries.length).catch(() => undefined);
		throw error;
	}
	return token;
}

/**
 * The answer to a share: a redirect onto the product's start URL.
 *
 * A share sheet expects the application to open, so even a share carrying
 * nothing this editor can hold lands the person in the editor - with a reason
 * in the query rather than a token, so the document can say what happened
 * instead of silently opening empty.
 */
function sharedFilesRedirect(request, configuration, token, reason) {
	const target = new URL(configuration.fallbacks.standard, request.url);
	if (token) target.searchParams.set(sharedFilesTokenParameter(), token);
	else if (reason) target.searchParams.set(sharedFilesErrorParameter(), reason);
	return new Response(null, {
		status: 303,
		headers: { 'cache-control': 'no-store', location: target.href },
	});
}

/** Takes one share submission and answers it. */
export async function handleShareTargetSubmission({
	configuration,
	cacheStorage,
	request,
	cryptoImpl = globalThis.crypto,
	now = Date.now,
}) {
	let token = '';
	let reason = '';
	try {
		const submission = await readSharedSubmissionFiles(request);
		if (submission.refused) reason = 'unreadable';
		else if (submission.overflow) reason = 'too-large';
		else if (submission.files.length > 0) {
			const stashed = await stashSharedFiles({ cacheStorage, files: submission.files, cryptoImpl, now });
			if (stashed === null) reason = 'too-large';
			else token = stashed;
		}
	} catch {
		reason = 'unreadable';
	}
	return sharedFilesRedirect(request, configuration, token, reason);
}
