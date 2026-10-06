/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	resolveDesktopStoragePaths,
	type DesktopStoragePathOptions,
} from '../desktop/desktop-storage-paths.ts';

const homePath = resolve('test-storage-home');
const appDataPath = join(homePath, '.config');
const userDataPath = join(appDataPath, 'Soundscaper');
const defaults: DesktopStoragePathOptions = {
	platform: 'linux', environment: {}, homePath, appDataPath, userDataPath,
	appName: 'Soundscaper',
};

test('Linux desktop storage separates configuration, data, cache and state', () => {
	const dataBase = join(homePath, '.local', 'share');
	const dataRoot = join(dataBase, 'Soundscaper');
	const stateRoot = join(homePath, '.local', 'state', 'Soundscaper');
	assert.deepEqual(resolveDesktopStoragePaths(defaults), {
		configRoot: userDataPath,
		dataRoot,
		cacheRoot: join(homePath, '.cache', 'Soundscaper'),
		stateRoot,
		projectLibraryAppData: dataBase,
		sessionDataRoot: join(dataRoot, 'browser'),
		logsRoot: join(stateRoot, 'logs'),
		crashDumpsRoot: join(stateRoot, 'Crashpad'),
	});
});

test('Linux desktop storage honors each absolute XDG directory independently', () => {
	const dataBase = resolve('test-xdg-data');
	const cacheBase = resolve('test-xdg-cache');
	const stateBase = resolve('test-xdg-state');
	const result = resolveDesktopStoragePaths({
		...defaults,
		environment: {
			XDG_CONFIG_HOME: resolve('test-xdg-config'),
			XDG_DATA_HOME: dataBase,
			XDG_CACHE_HOME: cacheBase,
			XDG_STATE_HOME: stateBase,
		},
	});
	assert.equal(result.configRoot, userDataPath, 'Electron owns configuration path resolution');
	assert.equal(result.dataRoot, join(dataBase, 'Soundscaper'));
	assert.equal(result.cacheRoot, join(cacheBase, 'Soundscaper'));
	assert.equal(result.stateRoot, join(stateBase, 'Soundscaper'));
	assert.equal(result.projectLibraryAppData, dataBase);
	assert.equal(result.sessionDataRoot, join(dataBase, 'Soundscaper', 'browser'));
	assert.equal(result.logsRoot, join(stateBase, 'Soundscaper', 'logs'));
	assert.equal(result.crashDumpsRoot, join(stateBase, 'Soundscaper', 'Crashpad'));
});

test('Linux ignores unset, empty, relative and NUL-containing XDG values', () => {
	const expected = resolveDesktopStoragePaths(defaults);
	for (const value of [undefined, '', 'relative/storage', '~/storage', '/invalid\0storage']) {
		assert.deepEqual(resolveDesktopStoragePaths({
			...defaults,
			environment: { XDG_DATA_HOME: value, XDG_CACHE_HOME: value, XDG_STATE_HOME: value },
		}), expected);
	}
	const dataBase = resolve('test-xdg-only-data');
	const paths = resolveDesktopStoragePaths({
		...defaults, environment: { XDG_DATA_HOME: dataBase, XDG_CACHE_HOME: 'relative' },
	});
	assert.equal(paths.dataRoot, join(dataBase, 'Soundscaper'));
	assert.equal(paths.cacheRoot, expected.cacheRoot);
	assert.equal(paths.stateRoot, expected.stateRoot);
});

test('non-Linux desktop storage preserves existing Electron roots', () => {
	for (const platform of ['darwin', 'win32'] as const) {
		assert.deepEqual(resolveDesktopStoragePaths({
			...defaults, platform,
			environment: {
				XDG_DATA_HOME: resolve('ignored-data'),
				XDG_CACHE_HOME: resolve('ignored-cache'),
				XDG_STATE_HOME: resolve('ignored-state'),
			},
		}), {
			configRoot: userDataPath,
			dataRoot: userDataPath,
			cacheRoot: userDataPath,
			stateRoot: userDataPath,
			projectLibraryAppData: appDataPath,
			sessionDataRoot: userDataPath,
			logsRoot: join(userDataPath, 'logs'),
			crashDumpsRoot: join(userDataPath, 'Crashpad'),
		});
	}
});

test('Linux storage isolates application roots while sharing the library data base', () => {
	const soundscaper = resolveDesktopStoragePaths(defaults);
	const framescaper = resolveDesktopStoragePaths({
		...defaults, appName: 'Framescaper', userDataPath: join(appDataPath, 'Framescaper'),
	});
	assert.equal(framescaper.projectLibraryAppData, soundscaper.projectLibraryAppData);
	for (const field of ['configRoot', 'dataRoot', 'cacheRoot', 'stateRoot',
		'sessionDataRoot', 'logsRoot', 'crashDumpsRoot'] as const) {
		assert.notEqual(framescaper[field], soundscaper[field], field);
	}
	assert.ok(Object.isFrozen(soundscaper));
});

test('desktop storage rejects unsafe base paths and application names', () => {
	for (const field of ['homePath', 'appDataPath', 'userDataPath'] as const) {
		for (const value of ['', 'relative/path', '/invalid\0path']) {
			assert.throws(() => resolveDesktopStoragePaths({ ...defaults, [field]: value }),
				TypeError, `${field}: ${JSON.stringify(value)}`);
		}
	}
	for (const appName of ['', '.', '..', '/absolute', 'nested/name', 'nested\\name', 'invalid\0name']) {
		assert.throws(() => resolveDesktopStoragePaths({ ...defaults, appName }), TypeError,
			JSON.stringify(appName));
	}
});
