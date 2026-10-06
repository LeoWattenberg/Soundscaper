/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstatSync, mkdirSync, readlinkSync, symlinkSync, type Stats } from 'node:fs';
import { lstat, mkdir, readdir, readlink, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { migrateDesktopStorageEntries } from './desktop-storage-migration.ts';

const CACHE_NAMES = Object.freeze([
	'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
]);

interface CachePair {
	readonly source: string;
	readonly destination: string;
}

/** Bind newly created Chromium caches before the browser opens its profile. */
export function configureDesktopBrowserCachesSync(sessionDataRoot: string, cacheRoot: string): void {
	const pairs = cachePairs(sessionDataRoot, cacheRoot);
	ensureDirectorySync(sessionDataRoot);
	ensureDirectorySync(join(cacheRoot, 'browser'));
	const sources = pairs.map((pair) => {
		const metadata = optionalStatSync(pair.source);
		assertCacheSource(pair, metadata, metadata?.isSymbolicLink() ? readlinkSync(pair.source) : undefined);
		const target = optionalStatSync(pair.destination);
		if (target !== null) assertDirectory(pair.destination, target);
		return metadata;
	});
	for (const [index, pair] of pairs.entries()) {
		ensureDirectorySync(pair.destination);
		if (sources[index] === null && pair.source !== pair.destination) {
			symlinkSync(pair.destination, pair.source, 'dir');
		}
	}
}

/** Relocate old cache directories while retaining IndexedDB and OPFS in the data profile. */
export async function migrateDesktopBrowserCaches(sessionDataRoot: string, cacheRoot: string): Promise<void> {
	const pairs = cachePairs(sessionDataRoot, cacheRoot);
	await ensureDirectory(sessionDataRoot);
	await ensureDirectory(join(cacheRoot, 'browser'));
	const partitionsRoot = join(sessionDataRoot, 'Partitions');
	const partitions = await optionalStat(partitionsRoot);
	if (partitions !== null) {
		assertDirectory(partitionsRoot, partitions);
		for (const partition of await readdir(partitionsRoot, { withFileTypes: true })) {
			if (partition.isSymbolicLink()) {
				throw new TypeError(`Browser cache partition cannot be a symbolic link: "${partition.name}".`);
			}
			if (!partition.isDirectory()) continue;
			pairs.push(...scopePairs(join(partitionsRoot, partition.name),
				join(cacheRoot, 'browser', 'Partitions', partition.name)));
		}
	}
	const entries: CachePair[] = [];
	for (const pair of pairs) {
		const metadata = await optionalStat(pair.source);
		assertCacheSource(pair, metadata, metadata?.isSymbolicLink() ? await readlink(pair.source) : undefined);
		const target = await optionalStat(pair.destination);
		if (target !== null) assertDirectory(pair.destination, target);
		if (metadata?.isDirectory() && pair.source !== pair.destination) entries.push(pair);
	}
	await migrateDesktopStorageEntries(entries);
	for (const pair of pairs) {
		await ensureDirectory(pair.destination);
		if (await optionalStat(pair.source) === null && pair.source !== pair.destination) {
			await symlink(pair.destination, pair.source, 'dir');
		}
	}
}

function cachePairs(sessionDataRoot: string, cacheRoot: string): CachePair[] {
	for (const root of [sessionDataRoot, cacheRoot]) {
		if (typeof root !== 'string' || root.includes('\0') || !isAbsolute(root)) {
			throw new TypeError('Browser cache roots must be absolute paths without NUL bytes.');
		}
	}
	return scopePairs(resolve(sessionDataRoot), resolve(cacheRoot, 'browser'));
}

function scopePairs(sourceRoot: string, destinationRoot: string): CachePair[] {
	return CACHE_NAMES.map((name) => ({ source: join(sourceRoot, name), destination: join(destinationRoot, name) }));
}

function assertCacheSource(pair: CachePair, metadata: Stats | null, linkTarget?: string): void {
	if (metadata === null) return;
	if (metadata.isSymbolicLink()) {
		if (linkTarget === undefined || resolve(dirname(pair.source), linkTarget) !== resolve(pair.destination)) {
			throw new TypeError(`Browser cache symbolic link has an incorrect target: "${pair.source}".`);
		}
		return;
	}
	assertDirectory(pair.source, metadata);
}

function assertDirectory(path: string, metadata: Stats): void {
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new TypeError(`Browser cache path must be a directory without symbolic links: "${path}".`);
	}
}

function missing(error: unknown): boolean {
	return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

function optionalStatSync(path: string): Stats | null {
	try { return lstatSync(path); }
	catch (error) { if (missing(error)) return null; throw error; }
}

async function optionalStat(path: string): Promise<Stats | null> {
	try { return await lstat(path); }
	catch (error) { if (missing(error)) return null; throw error; }
}

function ensureDirectorySync(path: string): void {
	const metadata = optionalStatSync(path);
	if (metadata !== null) { assertDirectory(path, metadata); return; }
	const parent = dirname(path);
	if (parent !== path) ensureDirectorySync(parent);
	mkdirSync(path, { mode: 0o700 });
}

async function ensureDirectory(path: string): Promise<void> {
	const metadata = await optionalStat(path);
	if (metadata !== null) { assertDirectory(path, metadata); return; }
	const parent = dirname(path);
	if (parent !== path) await ensureDirectory(parent);
	await mkdir(path, { mode: 0o700 });
}
