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

test('failed native-audio persistence rolls in-memory authority back', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-settings-rollback-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const filePath = join(root, 'state', 'settings.json');
	const settings = new DesktopSettingsStore(filePath);
	await settings.load(['en-US']);
	assert.equal(settings.snapshot().nativeAudioHelperEnabled, false);

	await rm(join(root, 'state'), { recursive: true });
	await writeFile(join(root, 'state'), 'blocks the settings directory');
	await assert.rejects(() => settings.setNativeAudioHelperEnabled(true));
	assert.equal(settings.snapshot().nativeAudioHelperEnabled, false,
		'a failed atomic write must not leave helper authority enabled only in memory');
});

test('failed native probe and effect-discovery persistence leave in-memory authority unchanged', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-settings-controls-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const filePath = join(root, 'state', 'settings.json');
	const settings = new DesktopSettingsStore(filePath);
	await settings.load(['en-US']);

	await rm(join(root, 'state'), { recursive: true });
	await writeFile(join(root, 'state'), 'blocks the settings directory');
	await assert.rejects(() => settings.setNativeProbeHelperEnabled(true));
	await assert.rejects(() => settings.setNativePluginDiscoveryEnabled(true));
	assert.equal(settings.snapshot().nativeProbeHelperEnabled, false);
	assert.equal(settings.snapshot().nativePluginDiscoveryEnabled, false);
});

test('Framescaper native media, hardware, and OFX authorities default off and persist independently', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-native-settings-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const filePath = join(root, 'settings.json');
	const settings = new DesktopSettingsStore(filePath);
	const initial = await settings.load(['en-US']);
	assert.equal(initial.nativeMediaEnabled, false);
	assert.equal(initial.nativeHardwareDecodeEnabled, false);
	assert.equal(initial.nativeHardwareEncodeEnabled, false);
	assert.equal(initial.ofxConsentEnabled, false);

	await Promise.all([
		settings.setNativeMediaEnabled(true),
		settings.setNativeHardwareDecodeEnabled(true),
		settings.setNativeHardwareEncodeEnabled(true),
		settings.setOfxConsentEnabled(true),
	]);
	const durable = JSON.parse(await readFile(filePath, 'utf8'));
	assert.equal(durable.nativeMediaEnabled, true);
	assert.equal(durable.nativeHardwareDecodeEnabled, true);
	assert.equal(durable.nativeHardwareEncodeEnabled, true);
	assert.equal(durable.ofxConsentEnabled, true);
});

test('concurrent whole-record setting changes serialize without losing durable fields', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-settings-concurrent-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const filePath = join(root, 'settings.json');
	const settings = new DesktopSettingsStore(filePath);
	await settings.load(['en-US']);

	await Promise.all([
		settings.setNativeProbeHelperEnabled(true),
		settings.setNativeAudioHelperEnabled(true),
		settings.setNativePluginDiscoveryEnabled(true),
	]);

	const memory = settings.snapshot();
	const durable = JSON.parse(await readFile(filePath, 'utf8'));
	assert.equal(memory.nativeProbeHelperEnabled, true);
	assert.equal(memory.nativeAudioHelperEnabled, true);
	assert.equal(memory.nativePluginDiscoveryEnabled, true);
	assert.equal(durable.nativeProbeHelperEnabled, memory.nativeProbeHelperEnabled);
	assert.equal(durable.nativeAudioHelperEnabled, memory.nativeAudioHelperEnabled);
	assert.equal(durable.nativePluginDiscoveryEnabled, memory.nativePluginDiscoveryEnabled);
});

test('the settings mutation queue remains live after a rolled-back write', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-settings-liveness-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const directory = join(root, 'state');
	const filePath = join(directory, 'settings.json');
	const settings = new DesktopSettingsStore(filePath);
	await settings.load(['en-US']);

	await rm(directory, { recursive: true });
	await writeFile(directory, 'blocks the settings directory');
	await assert.rejects(() => settings.setLocale('de'));
	assert.equal(settings.snapshot().locale, 'en');

	await rm(directory);
	await settings.setModelsDirectory(join(root, 'models'));
	const memory = settings.snapshot();
	const durable = JSON.parse(await readFile(filePath, 'utf8'));
	assert.equal(memory.locale, 'en');
	assert.equal(memory.modelsDirectory, join(root, 'models'));
	assert.equal(durable.locale, memory.locale);
	assert.equal(durable.modelsDirectory, memory.modelsDirectory);
});

test('native audio calibration and route preferences persist only for their exact opaque tuple', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-native-audio-settings-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const filePath = join(root, 'settings.json');
	const settings = new DesktopSettingsStore(filePath);
	await settings.load(['en']);
	const identity = {
		inputDeviceId: 'native:wasapi:in:device-1',
		outputDeviceId: 'native:wasapi:out:device-1',
		backend: 'wasapi', mode: 'exclusive', sampleRate: 48_000, bufferFrames: 256,
	};
	await settings.persistNativeAudioCalibration({ identity, offsetFrames: 384 });
	await settings.setNativeAudioRoutePreference({
		candidates: [
			{ backend: 'wasapi', deviceHandle: 'device-1' },
			{ backend: 'asio', deviceHandle: 'device-2' },
		],
		direction: 'duplex', mode: 'exclusive', sampleRate: 48_000,
		periodFrames: 256, channelCount: 2,
	});
	assert.equal(settings.resolveNativeAudioCalibration(identity), 384);
	for (const changed of [
		{ ...identity, outputDeviceId: 'native:wasapi:out:device-2' },
		{ ...identity, mode: 'shared' },
		{ ...identity, sampleRate: 44_100 },
		{ ...identity, bufferFrames: 512 },
	]) assert.equal(settings.resolveNativeAudioCalibration(changed), null);

	const reloaded = new DesktopSettingsStore(filePath);
	await reloaded.load(['en']);
	assert.equal(reloaded.resolveNativeAudioCalibration(identity), 384,
		'frames are restored through the explicitly persisted millisecond value');
	assert.deepEqual(reloaded.snapshot().nativeAudioRoutePreference.candidates, [
		{ backend: 'wasapi', deviceHandle: 'device-1' },
		{ backend: 'asio', deviceHandle: 'device-2' },
	]);
	await assert.rejects(() => reloaded.setNativeAudioRoutePreference({
		candidates: [{ backend: 'asio', deviceHandle: '/dev/not-opaque' }],
		direction: 'duplex', mode: 'shared', sampleRate: 48_000,
		periodFrames: 256, channelCount: 2,
	}), /opaque|exclusive/iu);
	await reloaded.setNativeAudioRoutePreference({
		candidates: [{ backend: 'wasapi', deviceHandle: 'device-1' }],
		direction: 'duplex', mode: 'exclusive', sampleRate: 48_000,
		periodFrames: 256, channelCount: 32,
	});
	for (const invalid of [
		{
			candidates: [{ backend: 'wasapi', deviceHandle: 'device-1' }],
			direction: 'duplex', mode: 'exclusive', sampleRate: 48_000,
			periodFrames: 256, channelCount: 33,
		},
		{
			candidates: [{ backend: 'wasapi', deviceHandle: 'device-1' }, { backend: 'asio', deviceHandle: 'device-2' }],
			direction: 'duplex', mode: 'shared', sampleRate: 48_000,
			periodFrames: 256, channelCount: 2,
		},
		{
			candidates: [{ backend: 'jack', deviceHandle: 'device-3' }],
			direction: 'duplex', mode: 'exclusive', sampleRate: 48_000,
			periodFrames: 256, channelCount: 2,
		},
	]) await assert.rejects(() => reloaded.setNativeAudioRoutePreference(invalid), /channel|ASIO|JACK/iu);
	assert.throws(() => reloaded.resolveNativeAudioCalibration({
		...identity, backend: 'jack',
		inputDeviceId: 'native:jack:in:device-1', outputDeviceId: 'native:jack:out:device-1',
	}), /JACK/iu);
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
		currentVersion: '1.0.0-rc.1',
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
