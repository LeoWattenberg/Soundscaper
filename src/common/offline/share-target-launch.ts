/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The files the operating system's share sheet sent this editor, collected.
 *
 * A `share_target` declaration is a POST, and these products are served from a
 * static host, so the service worker answers it: it takes the multipart body,
 * writes the files into a cache under a one-time token, and redirects the
 * browser onto the product's start URL with that token in the query.
 * `scripts/lib/offline-share-target-worker.mjs` is that half. This module is
 * the other one - the document arrives holding a token, and the files are
 * waiting behind it.
 *
 * The token is taken rather than read: it is stripped from the address before
 * anything is fetched, so a refresh cannot replay a share whose files have
 * already been collected and deleted, and the stash is deleted as it is
 * collected so nothing survives the navigation that consumed it.
 *
 * Delivery goes through `file-handler-launch.ts`'s buffer, which already holds
 * an operating-system launch until the editor can act on it. A share and a
 * double-clicked file are the same event by the time they are files, and the
 * workspace drains both from one subscription into one routed import. Anything
 * else would fork the routing.
 *
 * The constants below are copies of the worker's, which is a plain build script
 * this module cannot import; `tests/offline-share-target-launch.test.ts`
 * imports both and holds them to each other, so the two can only drift past a
 * failing test.
 */

import { deliverLaunchedFiles, type LaunchedFilesHandler } from './file-handler-launch.ts';

/** The cache the worker stashes a pending share in. */
export const SHARED_FILES_CACHE_NAME = 'soundscaper-shared-files-v1';

/** The query parameter a collectable share arrives under. */
export const SHARED_FILES_TOKEN_PARAMETER = 'share';

/** The query parameter a share the worker refused arrives under. */
export const SHARED_FILES_ERROR_PARAMETER = 'share-error';

/** What one stash may hold, mirroring what the worker will write. */
export const SHARED_FILES_LIMITS = Object.freeze({
	maximumFiles: 32,
	maximumBytes: 512 * 1024 * 1024,
});

/** Where one stash records the files it holds. */
export function sharedFilesManifestUrl(token: string): string {
	return `/.soundscaper/share/${token}.json`;
}

/** Where one stashed file's bytes live. */
export function sharedFilesBodyUrl(token: string, index: number): string {
	return `/.soundscaper/share/${token}/${String(index)}`;
}

/** Only what this module asks of `caches`, so a test may stand in for it. */
export interface SharedFileStashCache {
	match(url: string): Promise<Response | undefined>;
	delete(url: string): Promise<boolean>;
}

export interface SharedFileStashStorage {
	open(name: string): Promise<SharedFileStashCache>;
}

export type SharedFilesCollectionStatus =
	/** The address carries no share. */
	| 'none'
	/** Files were collected and delivered. */
	| 'collected'
	/** A token with nothing behind it: already collected, or swept. */
	| 'missing'
	/** The worker refused the share and said so in the address. */
	| 'refused'
	/** The stash existed and could not be read. */
	| 'unreadable'
	/** No cache storage to collect from, or a build that shares no files. */
	| 'unsupported';

export interface SharedFilesCollection {
	readonly status: SharedFilesCollectionStatus;
	readonly files: readonly File[];
}

export interface CollectSharedFilesOptions {
	/** The desktop build has its own file handling and no service worker. */
	readonly desktop?: boolean;
	/** Injectable for tests; the document's own address otherwise. */
	readonly href?: string | null;
	/** Injectable for tests; the document's cache storage otherwise. */
	readonly caches?: SharedFileStashStorage | null;
	/** Where collected files go. Defaults to the buffer `subscribeLaunchedFiles` drains. */
	readonly deliver?: LaunchedFilesHandler;
	/** Injectable for tests; `history.replaceState` otherwise. */
	readonly replaceAddress?: (address: string) => void;
	readonly onError?: (error: unknown) => void;
}

interface SharedFileEntry {
	readonly name: string;
	readonly type: string;
	readonly byteLength: number;
}

type SharedFileBodyMatch =
	| Readonly<{ response: Response | undefined }>
	| Readonly<{ error: unknown }>;

/**
 * Takes the share this document was opened by, if it was opened by one.
 *
 * Everything that can go wrong ends in a status rather than a rejection: the
 * caller is a startup path, and a share that cannot be collected must still
 * leave the editor open on an empty project rather than failing to mount.
 */
export async function collectSharedFiles(
	options: CollectSharedFilesOptions = {},
): Promise<SharedFilesCollection> {
	const onError = options.onError ?? defaultReport;
	if (options.desktop === true) return collection('unsupported');
	const address = sharedFilesAddress(options.href ?? globalThis.location?.href);
	const token = address?.searchParams.get(SHARED_FILES_TOKEN_PARAMETER) ?? null;
	const refusal = address?.searchParams.get(SHARED_FILES_ERROR_PARAMETER) ?? null;
	if (!address || (token === null && refusal === null)) return collection('none');
	// Taken before anything else can fail, so a reload of this address opens the
	// editor rather than asking for a share that has already been consumed.
	stripSharedFilesParameters(address, options.replaceAddress ?? replaceDocumentAddress);
	if (refusal !== null) {
		reportError(onError, Object.assign(new Error(sharedFilesRefusalMessage(refusal)),
			refusal === 'too-large' ? { code: 'SHARE_TARGET_TOO_LARGE' }
				: refusal === 'storage' ? { code: 'SHARE_TARGET_STORAGE_FAILED' } : {}));
		return collection('refused');
	}
	if (token === null || !/^[a-f\d]{32}$/u.test(token)) return collection('missing');
	const cacheStorage = options.caches ?? documentCacheStorage();
	if (!cacheStorage) return collection('unsupported');
	try {
		return await collectStashedFiles(cacheStorage, token, options, onError);
	} catch (error) {
		reportError(onError, error);
		return collection('unreadable');
	}
}

async function collectStashedFiles(
	cacheStorage: SharedFileStashStorage,
	token: string,
	options: CollectSharedFilesOptions,
	onError: (error: unknown) => void,
): Promise<SharedFilesCollection> {
	const cache = await cacheStorage.open(SHARED_FILES_CACHE_NAME);
	const manifestUrl = sharedFilesManifestUrl(token);
	const response = await cache.match(manifestUrl);
	if (!response) return collection('missing');
	const entries = sharedFilesManifest(await parsedJson(response));
	// Acquire body Responses while the manifest still identifies their cache
	// keys. A service-worker prune may run in another context as soon as the
	// manifest is claimed, but deleting cache entries cannot invalidate Responses
	// this document already holds.
	const bodyMatches = entries === null
		? []
		: await matchStashedFileBodies(cache, token, entries.length);
	// Cache deletion is the one atomic claim the Cache API gives us. Two tabs
	// may both acquire Responses, but only the one whose deletion succeeds may
	// read and deliver them.
	let claimed: boolean;
	try {
		claimed = await cache.delete(manifestUrl);
	} catch (error) {
		await cancelStashedFileBodies(bodyMatches, error);
		throw error;
	}
	if (!claimed) {
		await cancelStashedFileBodies(bodyMatches, new Error('Another document claimed the shared files.'));
		return collection('missing');
	}
	if (entries === null) {
		// A manifest that cannot be read still names a stash that must not be
		// left behind, so the whole index range is swept.
		await deleteSharedFileBodies(cache, token, 0);
		return collection('unreadable');
	}
	let files: File[];
	try {
		files = await readStashedFiles(bodyMatches, entries, onError);
	} finally {
		try {
			await deleteSharedFileBodies(cache, token, entries.length);
		} catch (error) {
			reportError(onError, error);
		}
	}
	if (files.length === 0) return collection('missing');
	await deliverLaunchedFiles(files, options.deliver);
	return collection('collected', files);
}

async function matchStashedFileBodies(
	cache: SharedFileStashCache,
	token: string,
	count: number,
): Promise<readonly SharedFileBodyMatch[]> {
	return Promise.all(Array.from({ length: count }, async (_unused, index): Promise<SharedFileBodyMatch> => {
		try {
			return { response: await cache.match(sharedFilesBodyUrl(token, index)) };
		} catch (error) {
			return { error };
		}
	}));
}

async function cancelStashedFileBodies(
	matches: readonly SharedFileBodyMatch[],
	reason: unknown,
): Promise<void> {
	await Promise.all(matches.map(async (match) => {
		if ('error' in match) return;
		await match.response?.body?.cancel(reason).catch(() => undefined);
	}));
}

async function readStashedFiles(
	matches: readonly SharedFileBodyMatch[],
	entries: readonly SharedFileEntry[],
	onError: (error: unknown) => void,
): Promise<File[]> {
	const files: File[] = [];
	const budget = { consumedBytes: 0 };
	let nextUnreadIndex = 0;
	try {
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const match = matches[index];
			nextUnreadIndex = index + 1;
			if ('error' in match) throw match.error;
			const response = match.response;
			if (!response) {
				reportError(onError, new Error(`A shared file was missing from the handoff: ${entry.name}`));
				continue;
			}
			const body = await readStashedFileBody(response, entry.byteLength, budget);
			if (body === null) {
				reportError(onError, new Error(`A shared file was truncated in the handoff: ${entry.name}`));
				continue;
			}
			files.push(new File([body], entry.name, { type: entry.type }));
		}
	} catch (error) {
		await cancelStashedFileBodies(matches.slice(nextUnreadIndex), error);
		throw error;
	}
	return files;
}

async function readStashedFileBody(
	response: Response,
	expectedBytes: number,
	budget: { consumedBytes: number },
): Promise<Blob | null> {
	if (!response.body) return expectedBytes === 0 ? new Blob() : null;
	const reader = response.body.getReader();
	const chunks: ArrayBuffer[] = [];
	let byteLength = 0;
	let cancelled = false;
	const cancel = async (reason: unknown): Promise<void> => {
		if (cancelled) return;
		cancelled = true;
		await reader.cancel(reason).catch(() => undefined);
	};
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array) || value.byteLength === 0) {
				throw new TypeError('A shared file returned an invalid body chunk.');
			}
			if (value.byteLength > SHARED_FILES_LIMITS.maximumBytes - budget.consumedBytes) {
				const error = new RangeError('Shared-file handoff bodies exceed their actual byte limit.');
				await cancel(error);
				throw error;
			}
			budget.consumedBytes += value.byteLength;
			if (value.byteLength > expectedBytes - byteLength) {
				await cancel('Shared-file body exceeded its declared byte length.');
				return null;
			}
			byteLength += value.byteLength;
			const owned = new Uint8Array(value.byteLength);
			owned.set(value);
			chunks.push(owned.buffer);
		}
	} catch (error) {
		await cancel(error);
		throw error;
	} finally {
		reader.releaseLock();
	}
	return byteLength === expectedBytes ? new Blob(chunks) : null;
}

/** Remove every body named by a claimed manifest, or sweep the full range when it was unreadable. */
async function deleteSharedFileBodies(
	cache: SharedFileStashCache,
	token: string,
	count: number,
): Promise<void> {
	const total = Number.isSafeInteger(count) && count > 0
		? Math.min(count, SHARED_FILES_LIMITS.maximumFiles)
		: SHARED_FILES_LIMITS.maximumFiles;
	let firstFailure: unknown;
	let failed = false;
	for (let index = 0; index < total; index += 1) {
		try {
			await cache.delete(sharedFilesBodyUrl(token, index));
		} catch (error) {
			if (!failed) firstFailure = error;
			failed = true;
		}
	}
	if (failed) throw firstFailure;
}

function sharedFilesManifest(value: unknown): readonly SharedFileEntry[] | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as { schemaVersion?: unknown; files?: unknown };
	if (record.schemaVersion !== 1 || !Array.isArray(record.files)) return null;
	if (record.files.length > SHARED_FILES_LIMITS.maximumFiles) return null;
	const entries: SharedFileEntry[] = [];
	let totalBytes = 0;
	for (const candidate of record.files as readonly unknown[]) {
		if (!candidate || typeof candidate !== 'object') return null;
		const entry = candidate as { name?: unknown; type?: unknown; byteLength?: unknown };
		if (typeof entry.name !== 'string' || entry.name === '' || typeof entry.type !== 'string'
			|| !Number.isSafeInteger(entry.byteLength) || (entry.byteLength as number) < 0) return null;
		totalBytes += entry.byteLength as number;
		if (!Number.isSafeInteger(totalBytes) || totalBytes > SHARED_FILES_LIMITS.maximumBytes) return null;
		entries.push({ name: entry.name, type: entry.type, byteLength: entry.byteLength as number });
	}
	return entries;
}

async function parsedJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

function sharedFilesAddress(href: string | null | undefined): URL | null {
	if (typeof href !== 'string' || href === '') return null;
	try {
		return new URL(href, 'http://localhost/');
	} catch {
		return null;
	}
}

function stripSharedFilesParameters(address: URL, replaceAddress: (value: string) => void): void {
	address.searchParams.delete(SHARED_FILES_TOKEN_PARAMETER);
	address.searchParams.delete(SHARED_FILES_ERROR_PARAMETER);
	try {
		replaceAddress(`${address.pathname}${address.search}${address.hash}`);
	} catch {
		// Tidying the address bar is a courtesy; a history this document may not
		// rewrite must not cost the person the files they shared with it.
	}
}

/** Rewrites the address of the open document without adding a history entry. */
function replaceDocumentAddress(address: string): void {
	const history = globalThis.history as History | undefined;
	history?.replaceState?.(history.state ?? null, '', address);
}

function documentCacheStorage(): SharedFileStashStorage | null {
	const storage = (globalThis as typeof globalThis & { caches?: CacheStorage }).caches;
	return storage && typeof storage.open === 'function' ? storage : null;
}

function sharedFilesRefusalMessage(reason: string): string {
	return reason === 'too-large'
		? 'The files shared with the editor were larger than a share may carry.'
		: reason === 'storage'
			? 'The files shared with the editor could not be stored in browser cache.'
		: 'The files shared with the editor could not be read.';
}

function collection(
	status: SharedFilesCollectionStatus,
	files: readonly File[] = [],
): SharedFilesCollection {
	return Object.freeze({ status, files: Object.freeze(files) });
}

function reportError(report: (error: unknown) => void, error: unknown): void {
	try {
		report(error);
	} catch {
		// Error reporting is best-effort and must not turn document startup into a rejection.
	}
}

function defaultReport(error: unknown): void {
	console.error('Files shared with the editor could not be opened:', error);
}
