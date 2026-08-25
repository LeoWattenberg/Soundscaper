/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('registration imports only the isolated bundled codec boundary', async () => {
	const source = await readFile(new URL(
		'../desktop/desktop-audio-codec-registration.mjs', import.meta.url,
	), 'utf8');
	assert.match(source, /bundled-audio-codec-isolated-runtime\.js/u);
	assert.match(source, /bundled-audio-codec-runtime-payload\.mjs/u);
	assert.match(source, /bundled-audio-codec-electron-spawn\.mjs/u);
	for (const directLoader of [
		'bundled-flac-audio-codec-runtime.js',
		'bundled-lame-audio-codec-runtime.js',
		'bundled-mpg123-audio-codec-runtime.js',
		'bundled-opus-audio-codec-runtime.js',
		'bundled-twolame-audio-codec-runtime.js',
		'bundled-vorbis-audio-codec-runtime.js',
		'bundled-wavpack-audio-codec-runtime.js',
	]) assert.doesNotMatch(source, new RegExp(directLoader.replace('.', '\\.'), 'u'));
});

test('registration composes main-owned runtime and bounded IPC from one private scratch root', async () => {
	const directories = [];
	const compositionOptions = [];
	const ipcOptions = [];
	const isolatedLoads = [];
	const operatingSystemLoads = [];
	const payloadLocations = [];
	const spawnOptions = [];
	const bundledPayloadLocations = [];
	const bundledSpawnOptions = [];
	const revoked = [];
	let disposals = 0;
	const ipcDisposal = deferred();
	const service = Object.freeze({ execute: async () => ({}), capabilities: async () => ({}) });
	const bundledRuntime = Object.freeze({ provider: Object.freeze({ kind: 'bundled' }), execute: async () => ({}) });
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
		desktopRoot: '/app/desktop', runtimeRoot: '/runtime', packaged: false,
		resourcesPath: '/resources',
		operatingSystemVersion: '15.6.1', forkUtilityProcess() {},
		mkdir: async (...arguments_) => { directories.push(arguments_); },
		loadModules: async () => ({
			createBundledAudioCodecRuntimeVerifier(options) {
				bundledPayloadLocations.push(options);
				return async () => ({});
			},
			createBundledAudioCodecElectronSpawn(options) {
				bundledSpawnOptions.push(options);
				return () => ({});
			},
			async loadIsolatedBundledAudioCodecRuntime(options) {
				isolatedLoads.push(options);
				await Promise.resolve();
				return bundledRuntime;
			},
			createOperatingSystemAudioCodecElectronSpawn(options) {
				spawnOptions.push(options);
				return () => ({});
			},
			createOsAudioCodecNativeVerifier(location) {
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
					dispose: () => { disposals += 1; return ipcDisposal.promise; },
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
		'createOperatingSystemRuntime', 'onReceipt',
	]);
	assert.deepEqual(bundledPayloadLocations, [{
		desktopRoot: '/app/desktop', target: 'mac-arm64',
	}]);
	assert.equal(bundledSpawnOptions.length, 1);
	assert.equal(
		bundledSpawnOptions[0].helperPath,
		'/app/desktop/project-library-runtime/desktop/bundled-audio-codec-helper-process.js',
	);
	assert.equal(typeof bundledSpawnOptions[0].fork, 'function');
	assert.equal(isolatedLoads.length, 1);
	assert.equal(isolatedLoads[0].target, 'mac-arm64');
	assert.equal(isolatedLoads[0].scratchRoot, '/user-data/desktop-audio-codecs');
	assert.equal(typeof isolatedLoads[0].verifyPayload, 'function');
	assert.equal(typeof isolatedLoads[0].spawn, 'function');
	assert.deepEqual(payloadLocations, [{
		runtimeRoot: '/runtime', platform: 'darwin', arch: 'arm64',
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
	assert.equal(compositionOptions[0].createBundledRuntime({ target: 'mac-arm64' }), bundledRuntime);
	assert.equal(compositionOptions[0].createOperatingSystemRuntime({ target: 'mac-arm64' }), operatingSystemRuntime);
	const observation = Object.freeze({ requestId: 'request-a', receipt: Object.freeze({ provider: {} }) });
	compositionOptions[0].onReceipt(observation);
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
	assert.deepEqual(Reflect.ownKeys(registration), ['revokeOwner', 'receiptSnapshot', 'dispose']);
	assert.equal(Object.isFrozen(registration), true);
	assert.deepEqual(registration.receiptSnapshot(), [observation]);
	const owner = { id: 'owner' };
	assert.equal(await registration.revokeOwner(owner), true);
	assert.deepEqual(revoked, [owner]);
	const firstDisposal = registration.dispose();
	const secondDisposal = registration.dispose();
	assert.equal(firstDisposal, secondDisposal);
	assert.equal(disposals, 1);
	assert.deepEqual(registration.receiptSnapshot(), []);
	let disposed = false;
	void firstDisposal.then(() => { disposed = true; });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(disposed, false);
	ipcDisposal.resolve();
	await firstDisposal;
	assert.equal(disposed, true);
});

test('registration fails closed without any admitted bundled runtime', async () => {
	const compositionOptions = [];
	await registerDesktopAudioCodecs({
		channels: CHANNELS, handle() {}, removeHandler() {}, ownerFor: () => ({}),
		externalFfmpegPreferences: externalPreferences(),
		platform: 'win32', architecture: 'arm64', userDataPath: '/user-data',
		desktopRoot: '/app/desktop', runtimeRoot: '/runtime', packaged: true,
		resourcesPath: '/resources',
		operatingSystemVersion: '10.0.26100', forkUtilityProcess() {},
		mkdir: async () => undefined,
		loadModules: async () => ({
			createBundledAudioCodecRuntimeVerifier: () => async () => ({}),
			createBundledAudioCodecElectronSpawn: () => () => ({}),
			loadIsolatedBundledAudioCodecRuntime: async ({ target }) => {
				assert.equal(target, 'win-arm64');
				return null;
			},
			createOperatingSystemAudioCodecElectronSpawn: () => () => ({}),
			createOsAudioCodecNativeVerifier: () => async () => ({}),
			loadOperatingSystemAudioCodecRuntime: async ({ target }) => {
				assert.equal(target, 'win-arm64');
				return null;
			},
			createDesktopAudioCodecRuntimeComposition(options) {
				compositionOptions.push(options);
				return {};
			},
			registerDesktopAudioCodecMainIpc: () => ({
				revokeOwner: async () => false,
				dispose: async () => undefined,
			}),
		}),
	});
	assert.deepEqual(Reflect.ownKeys(compositionOptions[0]), [
		'target', 'scratchRoot', 'externalFfmpegPreferences', 'onReceipt',
	]);
});

test('unsupported targets and invalid runtime modules fail before IPC registration', async () => {
	let loads = 0;
	let directories = 0;
	await assert.rejects(() => registerDesktopAudioCodecs({
		channels: CHANNELS, handle() {}, removeHandler() {}, ownerFor: () => ({}),
		externalFfmpegPreferences: externalPreferences(),
		platform: 'darwin', architecture: 'x64', userDataPath: '/user-data',
		desktopRoot: '/app/desktop', runtimeRoot: '/runtime', packaged: false,
		resourcesPath: '/resources',
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
		desktopRoot: '/app/desktop', runtimeRoot: '/runtime', packaged: false,
		resourcesPath: '/resources',
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

function deferred() {
	let resolve;
	const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}
