import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DesktopSettingsStore } from '../desktop/settings.js';
import { ReleaseChecker, compareVersions, selectUpdate } from '../desktop/update-check.js';

test('desktop settings choose an OS locale and persist atomically', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-settings-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const filePath = join(root, 'settings.json');
	const settings = new DesktopSettingsStore(filePath);
	assert.equal((await settings.load(['fr-CA'])).locale, 'fr');
	assert.equal(JSON.parse(await readFile(filePath, 'utf8')).locale, 'fr');
	assert.equal(await settings.setLocale('de'), 'de');
	const stored = JSON.parse(await readFile(filePath, 'utf8'));
	assert.equal(stored.schemaVersion, 1);
	assert.equal(stored.locale, 'de');
});

test('invalid settings fall back without trusting unknown locale values', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-settings-invalid-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const filePath = join(root, 'settings.json');
	await writeFile(filePath, '{ broken json');
	const settings = new DesktopSettingsStore(filePath);
	assert.equal((await settings.load(['ja-JP'])).locale, 'ja');
});

test('semantic release selection respects preview and stable channels', () => {
	assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.1'), 1);
	assert.equal(compareVersions('1.0.0', '1.0.0-beta.9'), 1);
	const releases = [
		{ tag_name: 'v2.0.0-beta.1', prerelease: true, draft: false },
		{ tag_name: 'v1.2.0', prerelease: false, draft: false },
		{ tag_name: 'framescaper-v1.4.0', prerelease: false, draft: false },
		{ tag_name: 'v9.0.0', prerelease: false, draft: true },
	];
	assert.equal(selectUpdate(releases, '1.0.0').tag_name, 'v1.2.0');
	assert.equal(selectUpdate(releases, '1.0.0-beta.1').tag_name, 'v2.0.0-beta.1');
	assert.equal(selectUpdate(releases, '1.0.0', 'framescaper-v').tag_name, 'framescaper-v1.4.0');
});

test('startup update checks are throttled for 24 hours even after an offline attempt', async () => {
	let now = Date.parse('2026-07-16T00:00:00Z');
	let requests = 0;
	const state = { updatesEnabled: true, lastUpdateCheck: null };
	const settings = {
		snapshot: () => ({ ...state }),
		recordUpdateCheck: async (timestamp) => { state.lastUpdateCheck = new Date(timestamp).toISOString(); },
	};
	const checker = new ReleaseChecker({
		currentVersion: '0.2.0-beta.1',
		settings,
		now: () => now,
		fetchImpl: async () => {
			requests += 1;
			throw new Error('offline');
		},
	});
	assert.equal((await checker.check()).status, 'offline');
	assert.equal((await checker.check()).status, 'throttled');
	assert.equal(requests, 1);
	now += 24 * 60 * 60 * 1000;
	assert.equal((await checker.check()).status, 'offline');
	assert.equal(requests, 2);
});
