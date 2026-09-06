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
export const SHARED_FILES_LIMITS = Object.freeze({ maximumFiles: 32 });

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
		onError(new Error(sharedFilesRefusalMessage(refusal)));
		return collection('refused');
	}
	if (token === null || !/^[a-f\d]{32}$/u.test(token)) return collection('missing');
	const cacheStorage = options.caches ?? documentCacheStorage();
	if (!cacheStorage) return collection('unsupported');
	try {
		return await collectStashedFiles(cacheStorage, token, options, onError);
	} catch (error) {
		onError(error);
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
	const response = await cache.match(sharedFilesManifestUrl(token));
	if (!response) return collection('missing');
	const entries = sharedFilesManifest(await parsedJson(response));
	if (entries === null) {
		// A manifest that cannot be read still names a stash that must not be
		// left behind, so the whole index range is swept.
		await deleteSharedFileStash(cache, token, 0);
		return collection('unreadable');
	}
	const files = await readStashedFiles(cache, token, entries, onError);
	await deleteSharedFileStash(cache, token, entries.length);
	if (files.length === 0) return collection('missing');
	await deliverLaunchedFiles(files, options.deliver);
	return collection('collected', files);
}

async function readStashedFiles(
	cache: SharedFileStashCache,
	token: string,
	entries: readonly SharedFileEntry[],
	onError: (error: unknown) => void,
): Promise<File[]> {
	const files: File[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const response = await cache.match(sharedFilesBodyUrl(token, index));
		if (!response) {
			onError(new Error(`A shared file was missing from the handoff: ${entry.name}`));
			continue;
		}
		const body = await response.blob();
		if (body.size !== entry.byteLength) {
			onError(new Error(`A shared file was truncated in the handoff: ${entry.name}`));
			continue;
		}
		files.push(new File([body], entry.name, { type: entry.type }));
	}
	return files;
}

/**
 * One stash removed.
 *
 * The manifest goes first, so a second collection of the same token finds
 * nothing rather than a manifest whose bodies are already gone.
 */
async function deleteSharedFileStash(
	cache: SharedFileStashCache,
	token: string,
	count: number,
): Promise<void> {
	const total = Number.isSafeInteger(count) && count > 0
		? Math.min(count, SHARED_FILES_LIMITS.maximumFiles)
		: SHARED_FILES_LIMITS.maximumFiles;
	await cache.delete(sharedFilesManifestUrl(token));
	for (let index = 0; index < total; index += 1) await cache.delete(sharedFilesBodyUrl(token, index));
}

function sharedFilesManifest(value: unknown): readonly SharedFileEntry[] | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as { schemaVersion?: unknown; files?: unknown };
	if (record.schemaVersion !== 1 || !Array.isArray(record.files)) return null;
	if (record.files.length > SHARED_FILES_LIMITS.maximumFiles) return null;
	const entries: SharedFileEntry[] = [];
	for (const candidate of record.files as readonly unknown[]) {
		if (!candidate || typeof candidate !== 'object') return null;
		const entry = candidate as { name?: unknown; type?: unknown; byteLength?: unknown };
		if (typeof entry.name !== 'string' || entry.name === '' || typeof entry.type !== 'string'
			|| !Number.isSafeInteger(entry.byteLength) || (entry.byteLength as number) < 0) return null;
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
		: 'The files shared with the editor could not be read.';
}

function collection(
	status: SharedFilesCollectionStatus,
	files: readonly File[] = [],
): SharedFilesCollection {
	return Object.freeze({ status, files: Object.freeze(files) });
}

function defaultReport(error: unknown): void {
	console.error('Files shared with the editor could not be opened:', error);
}
