/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { configureDesktopStorage } from '../desktop/desktop-storage-bootstrap.ts';

async function fixture(t: test.TestContext, platform: NodeJS.Platform = 'linux', isolated = false,
	seed?: (userData: string) => Promise<void>) {
	const home = await mkdtemp(join(tmpdir(), 'scape-xdg-bootstrap-'));
	t.after(() => rm(home, { recursive: true, force: true }));
	const appData = join(home, '.config');
	const userData = join(appData, 'Soundscaper');
	const paths = new Map<string, string>([['home', home], ['appData', appData], ['userData', userData]]);
	const switches = new Map<string, string>();
	await seed?.(userData);
	const storage = configureDesktopStorage({
		app: {
			getPath: (name) => { const path = paths.get(name); assert.ok(path); return path; },
			setPath: (name, path) => { paths.set(name, path); },
			setAppLogsPath: (path) => { paths.set('logs', path); },
			commandLine: {
				getSwitchValue: () => isolated ? userData : '',
				appendSwitch: (name, value) => { switches.set(name, value); },
			},
		},
		appName: 'Soundscaper', platform, environment: {}, argv: [],
	});
	return { home, appData, userData, paths, switches, storage };
}

test('resolving storage does not mutate files or Electron before the instance lock', async (t) => {
	const f = await fixture(t);
	assert.equal(f.paths.has('sessionData'), false);
	assert.equal(f.switches.size, 0);
	await assert.rejects(lstat(f.storage.dataRoot), { code: 'ENOENT' });
	await assert.rejects(f.storage.migrate(), /single-instance lock/u);
});

test('Linux configures Chromium and diagnostics paths synchronously before startup', async (t) => {
	const f = await fixture(t);
	f.storage.prepareBeforeReady();
	assert.equal(f.paths.get('userData'), f.userData);
	assert.equal(f.paths.get('sessionData'), join(f.home, '.local/share/Soundscaper/browser'));
	assert.equal(f.paths.get('logs'), join(f.home, '.local/state/Soundscaper/logs'));
	assert.equal(f.paths.get('crashDumps'), join(f.home, '.local/state/Soundscaper/Crashpad'));
	assert.equal(f.switches.get('disk-cache-dir'), join(f.home, '.cache/Soundscaper/chromium'));
	f.storage.prepareBeforeReady();
	await f.storage.migrate();
	assert.equal(await readlink(join(f.storage.sessionDataRoot, 'Partitions/soundscaper-production/GPUCache')),
		join(f.storage.cacheRoot, 'browser/Partitions/soundscaper-production/GPUCache'));
});

test('Electron profile identity and existing shader caches relocate before paths are activated', async (t) => {
	const f = await fixture(t, 'linux', false, async (userData) => {
		await mkdir(join(userData, 'Crashpad'), { recursive: true });
		await mkdir(join(userData, 'GPUCache'), { recursive: true });
		await writeFile(join(userData, 'Local State'), 'original browser identity');
		await writeFile(join(userData, 'Crashpad/client_id'), 'original crash identity');
		await writeFile(join(userData, 'GPUCache/shader'), 'original shader');
	});
	f.storage.prepareBeforeReady();
	assert.equal(await readFile(join(f.storage.sessionDataRoot, 'Local State'), 'utf8'), 'original browser identity');
	assert.equal(await readFile(join(f.storage.crashDumpsRoot, 'client_id'), 'utf8'), 'original crash identity');
	assert.equal(await readFile(join(f.storage.cacheRoot, 'browser/GPUCache/shader'), 'utf8'), 'original shader');
	await assert.rejects(lstat(join(f.userData, 'Local State')), { code: 'ENOENT' });
	await assert.rejects(lstat(join(f.userData, 'GPUCache')), { code: 'ENOENT' });
	f.storage.prepareBeforeReady();
	await f.storage.migrate();
});

test('Linux migrates existing projects, browser storage, models and state before services open', async (t) => {
	const f = await fixture(t);
	const legacy = [
		['desktop-settings.json', '{"modelsDirectory":null}'],
		['models/blobs/model', 'model bytes'],
		['runtime/assistance/engine', 'engine bytes'],
		['runtime/.archives/blobs/archive', 'archive bytes'],
		['Partitions/soundscaper-production/IndexedDB/project', 'browser project'],
		['Partitions/soundscaper-production/File System/original', 'original audio'],
		['freesound-session.json', 'session'],
		['soundscaper-delivery-services-v1.sqlite', 'queue'],
		['soundscaper-delivery-services-v1.sqlite-wal', 'pending queue'],
		['native-plugin-quarantine-v1.json', 'quarantine'],
		['desktop-audio-codecs/scratch', 'codec scratch'],
	] as const;
	for (const [path, bytes] of legacy) {
		const full = join(f.userData, path);
		await mkdir(join(full, '..'), { recursive: true });
		await writeFile(full, bytes);
	}
	const library = 'kw.media/soundscaper-project-library/v1/library.sqlite3';
	await mkdir(join(f.appData, library, '..'), { recursive: true });
	await writeFile(join(f.appData, library), 'project library');
	f.storage.prepareBeforeReady();
	await f.storage.migrate();
	assert.equal(await readFile(join(f.userData, 'desktop-settings.json'), 'utf8'), legacy[0][1]);
	for (const [path, bytes] of legacy.slice(1, 4)) {
		const target = path.includes('.archives')
			? join(f.storage.cacheRoot, path.replace('runtime/.archives', 'runtime-archives'))
			: join(f.storage.dataRoot, path);
		assert.equal(await readFile(target, 'utf8'), bytes);
	}
	for (const [path, bytes] of legacy.slice(4, 6)) {
		assert.equal(await readFile(join(f.storage.sessionDataRoot, path), 'utf8'), bytes);
	}
	for (const [path, bytes] of legacy.slice(6, 10)) {
		assert.equal(await readFile(join(f.storage.stateRoot, path), 'utf8'), bytes);
	}
	assert.equal(await readFile(join(f.storage.cacheRoot, 'desktop-audio-codecs/scratch'), 'utf8'), 'codec scratch');
	assert.equal(await readFile(join(f.storage.projectLibraryAppData, library), 'utf8'), 'project library');
	await assert.rejects(readFile(join(f.userData, 'models/blobs/model')), { code: 'ENOENT' });
	f.storage.prepareBeforeReady();
	await f.storage.migrate();
});

test('explicit desktop profiles and non-Linux platforms retain their storage layout', async (t) => {
	for (const [platform, isolated] of [['linux', true], ['darwin', false], ['win32', false]] as const) {
		const f = await fixture(t, platform, isolated);
		f.storage.prepareBeforeReady();
		assert.equal(f.storage.dataRoot, f.userData);
		assert.equal(f.storage.cacheRoot, f.userData);
		assert.equal(f.storage.stateRoot, f.userData);
		assert.equal(f.paths.has('sessionData'), false);
		assert.equal(f.switches.size, 0);
		f.storage.prepareBeforeReady();
	await f.storage.migrate();
	}
});

test('an explicitly chosen legacy models directory retains its path and bytes', async (t) => {
	const f = await fixture(t);
	const chosen = join(f.userData, 'models');
	await mkdir(chosen, { recursive: true });
	const settings = JSON.stringify({ schemaVersion: 1, modelsDirectory: chosen });
	await writeFile(join(f.userData, 'desktop-settings.json'), settings);
	await writeFile(join(chosen, 'model'), 'chosen model');
	f.storage.prepareBeforeReady();
	await f.storage.migrate();
	assert.equal(await readFile(join(chosen, 'model'), 'utf8'), 'chosen model');
	assert.equal(await readFile(join(f.userData, 'desktop-settings.json'), 'utf8'), settings);
});

test('pending native render inputs retain their filesystem identity until the queue drains', async (t) => {
	const f = await fixture(t, 'linux', false, async (userData) => {
		const directory = join(userData, 'framescaper-native-render-inputs');
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, 'carrier'), 'pinned carrier');
	});
	const carrier = join(f.userData, 'framescaper-native-render-inputs/carrier');
	const original = await lstat(carrier);
	f.storage.prepareBeforeReady();
	await f.storage.migrate();
	assert.equal(f.storage.renderInputRoot, join(f.userData, 'framescaper-native-render-inputs'));
	assert.equal((await lstat(carrier)).ino, original.ino);
	assert.equal((await lstat(carrier)).dev, original.dev);
	assert.equal(await readFile(carrier, 'utf8'), 'pinned carrier');
});
