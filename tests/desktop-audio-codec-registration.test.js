/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	desktopAudioCodecTargetFor,
	registerDesktopAudioCodecs,
} from '../desktop/desktop-audio-codec-registration.mjs';

const CHANNELS = Object.freeze({
	desktopAudioCodecExecute: 'soundscaper:v1:codecs:audio:execute',
	desktopAudioCodecCancel: 'soundscaper:v1:codecs:audio:cancel',
	desktopAudioCodecCapabilities: 'soundscaper:v1:codecs:audio:capabilities',
	externalFfmpegStatus: 'soundscaper:v1:ffmpeg:status',
});

test('desktop audio codec registration maps only the five supported targets', () => {
	assert.deepEqual([
		['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'arm64'],
		['win32', 'x64'], ['win32', 'arm64'],
	].map(([platform, architecture]) => desktopAudioCodecTargetFor(platform, architecture)), [
		'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
	]);
	assert.throws(
		() => desktopAudioCodecTargetFor('darwin', 'x64'),
		/macOS x64 desktop audio codecs are explicitly unsupported/u,
	);
	for (const [platform, architecture] of [
		['linux', 'ia32'], ['darwin', 'ia32'], ['win32', 'ia32'], ['freebsd', 'x64'],
	]) {
		assert.throws(
			() => desktopAudioCodecTargetFor(platform, architecture),
			/desktop audio codec target is unsupported/u,
		);
	}
});

test('registration composes main-owned runtime and bounded IPC from one private scratch root', async () => {
	const directories = [];
	const compositionOptions = [];
	const ipcOptions = [];
	const wavPackLoads = [];
	const flacLoads = [];
	const operatingSystemLoads = [];
	const payloadLocations = [];
	const spawnOptions = [];
	const bundledCompositions = [];
	const revoked = [];
	let disposals = 0;
	const service = Object.freeze({ execute: async () => ({}), capabilities: async () => ({}) });
	const bundledRuntime = Object.freeze({ provider: Object.freeze({ kind: 'bundled' }), execute: async () => ({}) });
	const flacRuntime = Object.freeze({ provider: Object.freeze({ kind: 'bundled' }), execute: async () => ({}) });
	const compositeRuntime = Object.freeze({ provider: Object.freeze({ kind: 'bundled' }), execute: async () => ({}) });
	const operatingSystemRuntime = Object.freeze({
		provider: Object.freeze({ kind: 'operating-system' }), execute: async () => ({}),
	});
	const externalFfmpegPreferences = externalPreferences();
	const handle = () => undefined;
	const removeHandler = () => undefined;
	const ownerFor = () => ({ id: 'renderer' });
	const registration = await registerDesktopAudioCodecs({
		channels: CHANNELS, handle, removeHandler, ownerFor,
		externalFfmpegPreferences,
		platform: 'darwin', architecture: 'arm64', userDataPath: '/user-data',
		desktopRoot: '/app/desktop', packaged: false, resourcesPath: '/resources',
		operatingSystemVersion: '15.6.1', forkUtilityProcess() {},
		mkdir: async (...arguments_) => { directories.push(arguments_); },
		loadModules: async () => ({
			createBundledDesktopAudioCodecRuntime(options) {
				bundledCompositions.push(options);
				return compositeRuntime;
			},
			async loadBundledFlacAudioCodecRuntime(options) {
				flacLoads.push(options);
				await Promise.resolve();
				return flacRuntime;
			},
			async loadBundledWavPackAudioCodecRuntime(options) {
				wavPackLoads.push(options);
				await Promise.resolve();
				return bundledRuntime;
			},
			createOperatingSystemAudioCodecElectronSpawn(options) {
				spawnOptions.push(options);
				return () => ({});
			},
			createSoundscaperProfessionalNativeVerifier(location) {
				payloadLocations.push(location);
				return async () => ({});
			},
			async loadOperatingSystemAudioCodecRuntime(options) {
				operatingSystemLoads.push(options);
				return operatingSystemRuntime;
			},
			createDesktopAudioCodecRuntimeComposition(options) {
				compositionOptions.push(options);
				return service;
			},
			registerDesktopAudioCodecMainIpc(options) {
				ipcOptions.push(options);
				return {
					revokeOwner: async (owner) => { revoked.push(owner); return true; },
					dispose: () => { disposals += 1; },
				};
			},
		}),
	});

	assert.deepEqual(directories, [[
		'/user-data/desktop-audio-codecs', { recursive: true, mode: 0o700 },
	]]);
	assert.equal(compositionOptions.length, 1);
	assert.deepEqual(Reflect.ownKeys(compositionOptions[0]), [
		'target', 'scratchRoot', 'externalFfmpegPreferences', 'createBundledRuntime',
		'createOperatingSystemRuntime',
	]);
	assert.deepEqual(wavPackLoads, [{ target: 'mac-arm64' }]);
	assert.deepEqual(flacLoads, [{ target: 'mac-arm64' }]);
	assert.deepEqual(bundledCompositions, [{
		target: 'mac-arm64', runtimes: [bundledRuntime, flacRuntime],
	}]);
	assert.deepEqual(payloadLocations, [{
		applicationRoot: '/app', packaged: false, resourcesPath: '/resources',
		platform: 'darwin', arch: 'arm64',
	}]);
	assert.equal(spawnOptions.length, 1);
	assert.equal(spawnOptions[0].helperPath, '/app/desktop/os-audio-codec-helper-process.js');
	assert.equal(typeof spawnOptions[0].fork, 'function');
	assert.equal(operatingSystemLoads.length, 1);
	assert.equal(operatingSystemLoads[0].target, 'mac-arm64');
	assert.equal(operatingSystemLoads[0].osVersion, '15.6.1');
	assert.equal(operatingSystemLoads[0].scratchRoot, '/user-data/desktop-audio-codecs');
	assert.equal(typeof operatingSystemLoads[0].verifyAddon, 'function');
	assert.equal(typeof operatingSystemLoads[0].spawn, 'function');
	assert.equal(compositionOptions[0].target, 'mac-arm64');
	assert.equal(compositionOptions[0].scratchRoot, '/user-data/desktop-audio-codecs');
	assert.equal(compositionOptions[0].externalFfmpegPreferences, externalFfmpegPreferences);
	assert.equal(compositionOptions[0].createBundledRuntime({ target: 'mac-arm64' }), compositeRuntime);
	assert.equal(compositionOptions[0].createOperatingSystemRuntime({ target: 'mac-arm64' }), operatingSystemRuntime);
	assert.equal(ipcOptions.length, 1);
	assert.deepEqual(ipcOptions[0].channels, {
		desktopAudioCodecExecute: CHANNELS.desktopAudioCodecExecute,
		desktopAudioCodecCancel: CHANNELS.desktopAudioCodecCancel,
		desktopAudioCodecCapabilities: CHANNELS.desktopAudioCodecCapabilities,
	});
	assert.equal(ipcOptions[0].handle, handle);
	assert.equal(ipcOptions[0].removeHandler, removeHandler);
	assert.equal(ipcOptions[0].ownerFor, ownerFor);
	assert.equal(ipcOptions[0].service, service);
	assert.deepEqual(Reflect.ownKeys(registration), ['revokeOwner', 'dispose']);
	assert.equal(Object.isFrozen(registration), true);
	const owner = { id: 'owner' };
	assert.equal(await registration.revokeOwner(owner), true);
	assert.deepEqual(revoked, [owner]);
	registration.dispose();
	registration.dispose();
	assert.equal(disposals, 1);
});

test('registration fails closed without any admitted bundled runtime', async () => {
	const compositionOptions = [];
	await registerDesktopAudioCodecs({
		channels: CHANNELS, handle() {}, removeHandler() {}, ownerFor: () => ({}),
		externalFfmpegPreferences: externalPreferences(),
		platform: 'win32', architecture: 'arm64', userDataPath: '/user-data',
		desktopRoot: '/app/desktop', packaged: true, resourcesPath: '/resources',
		operatingSystemVersion: '10.0.26100', forkUtilityProcess() {},
		mkdir: async () => undefined,
		loadModules: async () => ({
			createBundledDesktopAudioCodecRuntime: () => { throw new Error('must not compose'); },
			loadBundledFlacAudioCodecRuntime: async ({ target }) => {
				assert.equal(target, 'win-arm64');
				return null;
			},
			loadBundledWavPackAudioCodecRuntime: async ({ target }) => {
				assert.equal(target, 'win-arm64');
				return null;
			},
			createOperatingSystemAudioCodecElectronSpawn: () => () => ({}),
			createSoundscaperProfessionalNativeVerifier: () => async () => ({}),
			loadOperatingSystemAudioCodecRuntime: async ({ target }) => {
				assert.equal(target, 'win-arm64');
				return null;
			},
			createDesktopAudioCodecRuntimeComposition(options) {
				compositionOptions.push(options);
				return {};
			},
			registerDesktopAudioCodecMainIpc: () => ({ revokeOwner() {}, dispose() {} }),
		}),
	});
	assert.deepEqual(Reflect.ownKeys(compositionOptions[0]), [
		'target', 'scratchRoot', 'externalFfmpegPreferences',
	]);
});

test('unsupported targets and invalid runtime modules fail before IPC registration', async () => {
	let loads = 0;
	let directories = 0;
	await assert.rejects(() => registerDesktopAudioCodecs({
		channels: CHANNELS, handle() {}, removeHandler() {}, ownerFor: () => ({}),
		externalFfmpegPreferences: externalPreferences(),
		platform: 'darwin', architecture: 'x64', userDataPath: '/user-data',
		desktopRoot: '/app/desktop', packaged: false, resourcesPath: '/resources',
		operatingSystemVersion: '15.6.1', forkUtilityProcess() {},
		mkdir: async () => { directories += 1; },
		loadModules: async () => { loads += 1; return {}; },
	}), /macOS x64 desktop audio codecs are explicitly unsupported/u);
	assert.equal(loads, 0);
	assert.equal(directories, 0);

	await assert.rejects(() => registerDesktopAudioCodecs({
		channels: CHANNELS, handle() {}, removeHandler() {}, ownerFor: () => ({}),
		externalFfmpegPreferences: externalPreferences(),
		platform: 'linux', architecture: 'x64', userDataPath: '/user-data',
		desktopRoot: '/app/desktop', packaged: false, resourcesPath: '/resources',
		operatingSystemVersion: '6.16.0', forkUtilityProcess() {},
		mkdir: async () => { directories += 1; },
		loadModules: async () => ({ createDesktopAudioCodecRuntimeComposition() {} }),
	}), /desktop audio codec runtime modules are invalid/u);
	assert.equal(directories, 0);
});

function externalPreferences() {
	return Object.freeze({
		admission: () => null,
		invalidateAdmission: async () => Object.freeze({
			state: 'quarantined', location: null, version: null, detail: '',
			canInstall: false, canBrowse: true, canClear: false,
		}),
	});
}
