/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	configureDesktopBrowserCachesSync,
	migrateDesktopBrowserCaches,
} from '../desktop/desktop-browser-cache.ts';

const CACHE_NAMES = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache'];

async function fixture(context: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'scape-browser-cache-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return { root, sessionDataRoot: join(root, 'data', 'browser'), cacheRoot: join(root, 'cache') };
}

test('initial browser cache configuration creates private targets and links before Chromium starts', async (context) => {
	const { sessionDataRoot, cacheRoot } = await fixture(context);
	configureDesktopBrowserCachesSync(sessionDataRoot, cacheRoot);
	for (const name of CACHE_NAMES) {
		const source = join(sessionDataRoot, name);
		const destination = join(cacheRoot, 'browser', name);
		assert.equal((await lstat(source)).isSymbolicLink(), true);
		assert.equal(await readlink(source), destination);
		assert.equal((await lstat(destination)).mode & 0o777, 0o700);
	}
	assert.equal((await lstat(sessionDataRoot)).mode & 0o777, 0o700);
	assert.equal((await lstat(join(cacheRoot, 'browser'))).mode & 0o777, 0o700);
	await assert.rejects(lstat(join(sessionDataRoot, 'Partitions')), { code: 'ENOENT' });
	await writeFile(join(sessionDataRoot, 'Cache', 'entry'), 'cached');
	assert.equal(await readFile(join(cacheRoot, 'browser', 'Cache', 'entry'), 'utf8'), 'cached');
});

test('browser cache migration moves disposable entries and preserves IndexedDB and OPFS', async (context) => {
	const { sessionDataRoot, cacheRoot } = await fixture(context);
	for (const name of [...CACHE_NAMES, 'IndexedDB', 'File System']) {
		await mkdir(join(sessionDataRoot, name), { recursive: true });
		await writeFile(join(sessionDataRoot, name, 'entry'), name);
	}
	configureDesktopBrowserCachesSync(sessionDataRoot, cacheRoot);
	assert.equal((await lstat(join(sessionDataRoot, 'Cache'))).isDirectory(), true,
		'the synchronous setup leaves legacy directories for migration');
	await migrateDesktopBrowserCaches(sessionDataRoot, cacheRoot);
	for (const name of CACHE_NAMES) {
		assert.equal((await lstat(join(sessionDataRoot, name))).isSymbolicLink(), true);
		assert.equal(await readFile(join(cacheRoot, 'browser', name, 'entry'), 'utf8'), name);
	}
	for (const name of ['IndexedDB', 'File System']) {
		assert.equal((await lstat(join(sessionDataRoot, name))).isSymbolicLink(), false);
		assert.equal(await readFile(join(sessionDataRoot, name, 'entry'), 'utf8'), name);
		await assert.rejects(lstat(join(cacheRoot, 'browser', name)), { code: 'ENOENT' });
	}
	configureDesktopBrowserCachesSync(sessionDataRoot, cacheRoot);
	await migrateDesktopBrowserCaches(sessionDataRoot, cacheRoot);
	assert.equal(await readFile(join(sessionDataRoot, 'Cache', 'entry'), 'utf8'), 'Cache');
});

test('browser cache migration configures partition caches while leaving partition storage in data', async (context) => {
	const { sessionDataRoot, cacheRoot } = await fixture(context);
	for (const partition of ['audio-editor', 'second-profile']) {
		const partitionRoot = join(sessionDataRoot, 'Partitions', partition);
		await mkdir(join(partitionRoot, 'Cache'), { recursive: true });
		await writeFile(join(partitionRoot, 'Cache', 'entry'), partition);
		await mkdir(join(partitionRoot, 'IndexedDB'));
		await writeFile(join(partitionRoot, 'IndexedDB', 'project'), `${partition} project`);
	}
	await writeFile(join(sessionDataRoot, 'Partitions', 'metadata'), 'partition registry');
	await migrateDesktopBrowserCaches(sessionDataRoot, cacheRoot);
	for (const partition of ['audio-editor', 'second-profile']) {
		const partitionRoot = join(sessionDataRoot, 'Partitions', partition);
		for (const name of CACHE_NAMES) {
			assert.equal(await readlink(join(partitionRoot, name)),
				join(cacheRoot, 'browser', 'Partitions', partition, name));
		}
		assert.equal(await readFile(join(partitionRoot, 'Cache', 'entry'), 'utf8'), partition);
		assert.equal(await readFile(join(partitionRoot, 'IndexedDB', 'project'), 'utf8'), `${partition} project`);
	}
	assert.equal(await readFile(join(sessionDataRoot, 'Partitions', 'metadata'), 'utf8'), 'partition registry');
	await migrateDesktopBrowserCaches(sessionDataRoot, cacheRoot);
});

test('browser cache setup accepts existing links only when their resolved target is exact', async (context) => {
	const { sessionDataRoot, cacheRoot } = await fixture(context);
	await mkdir(sessionDataRoot, { recursive: true });
	const expected = join(cacheRoot, 'browser', 'Cache');
	await symlink(relative(sessionDataRoot, expected), join(sessionDataRoot, 'Cache'), 'dir');
	configureDesktopBrowserCachesSync(sessionDataRoot, cacheRoot);
	await migrateDesktopBrowserCaches(sessionDataRoot, cacheRoot);
	assert.equal(await readlink(join(sessionDataRoot, 'Cache')), relative(sessionDataRoot, expected));
});

test('browser cache setup refuses incorrect source links and regular files', async (context) => {
	const { root, sessionDataRoot, cacheRoot } = await fixture(context);
	await mkdir(sessionDataRoot, { recursive: true });
	const source = join(sessionDataRoot, 'Cache');
	const outside = join(root, 'outside');
	await mkdir(outside);
	await writeFile(join(outside, 'project'), 'preserved');
	await symlink(outside, source, 'dir');
	assert.throws(() => configureDesktopBrowserCachesSync(sessionDataRoot, cacheRoot), /link|target/iu);
	await assert.rejects(migrateDesktopBrowserCaches(sessionDataRoot, cacheRoot), /link|target/iu);
	assert.equal(await readFile(join(outside, 'project'), 'utf8'), 'preserved');
	await rm(source);
	await writeFile(source, 'plain file');
	assert.throws(() => configureDesktopBrowserCachesSync(sessionDataRoot, cacheRoot), /directory|file/iu);
	await assert.rejects(migrateDesktopBrowserCaches(sessionDataRoot, cacheRoot), /directory|file/iu);
	assert.equal(await readFile(source, 'utf8'), 'plain file');
});

test('browser cache migration rejects symbolic partition directories without traversing them', async (context) => {
	const { root, sessionDataRoot, cacheRoot } = await fixture(context);
	const partitions = join(sessionDataRoot, 'Partitions');
	const outside = join(root, 'outside');
	await mkdir(join(outside, 'Cache'), { recursive: true });
	await writeFile(join(outside, 'Cache', 'entry'), 'outside');
	await mkdir(sessionDataRoot, { recursive: true });
	await symlink(outside, partitions, 'dir');
	await assert.rejects(migrateDesktopBrowserCaches(sessionDataRoot, cacheRoot), /symbolic|link/iu);
	await rm(partitions);
	await mkdir(partitions);
	await symlink(outside, join(partitions, 'unsafe'), 'dir');
	await assert.rejects(migrateDesktopBrowserCaches(sessionDataRoot, cacheRoot), /symbolic|link/iu);
	assert.equal(await readFile(join(outside, 'Cache', 'entry'), 'utf8'), 'outside');
	assert.equal((await lstat(join(outside, 'Cache'))).isSymbolicLink(), false);
});

test('browser cache setup rejects invalid roots and cache target files', async (context) => {
	const { sessionDataRoot, cacheRoot } = await fixture(context);
	for (const invalid of ['', 'relative/path', '/invalid\0path']) {
		assert.throws(() => configureDesktopBrowserCachesSync(invalid, cacheRoot), /absolute/iu);
		assert.throws(() => configureDesktopBrowserCachesSync(sessionDataRoot, invalid), /absolute/iu);
		await assert.rejects(migrateDesktopBrowserCaches(invalid, cacheRoot), /absolute/iu);
		await assert.rejects(migrateDesktopBrowserCaches(sessionDataRoot, invalid), /absolute/iu);
	}
	await mkdir(join(cacheRoot, 'browser'), { recursive: true });
	await writeFile(join(cacheRoot, 'browser', 'Cache'), 'target file');
	assert.throws(() => configureDesktopBrowserCachesSync(sessionDataRoot, cacheRoot), /directory|file/iu);
	await assert.rejects(migrateDesktopBrowserCaches(sessionDataRoot, cacheRoot), /directory|file/iu);
	assert.equal(await readFile(join(cacheRoot, 'browser', 'Cache'), 'utf8'), 'target file');
});
