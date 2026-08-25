/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir as nodeMkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { createDesktopAudioCodecReceiptJournal } from './desktop-audio-codec-receipt-journal.mjs';

const TARGETS = Object.freeze(new Map([
	['linux:x64', 'linux-x64'],
	['linux:arm64', 'linux-arm64'],
	['darwin:arm64', 'mac-arm64'],
	['win32:x64', 'win-x64'],
	['win32:arm64', 'win-arm64'],
]));
const MODULE_METHODS = Object.freeze([
	'createBundledAudioCodecElectronSpawn', 'createBundledAudioCodecRuntimeVerifier',
	'createDesktopAudioCodecRuntimeComposition',
	'createOperatingSystemAudioCodecElectronSpawn', 'createOsAudioCodecNativeVerifier',
	'loadIsolatedBundledAudioCodecRuntime',
	'loadOperatingSystemAudioCodecRuntime',
	'registerDesktopAudioCodecMainIpc',
]);

/** Resolve Electron's runtime tuple to the closed, reviewed desktop target set. */
export function desktopAudioCodecTargetFor(platform, architecture) {
	if (platform === 'darwin' && architecture === 'x64') {
		throw new Error('macOS x64 desktop audio codecs are explicitly unsupported.');
	}
	const target = TARGETS.get(`${String(platform)}:${String(architecture)}`);
	if (!target) throw new Error('The desktop audio codec target is unsupported.');
	return target;
}

/** Compose request-scoped desktop audio codecs behind renderer-owned main IPC. */
export async function registerDesktopAudioCodecs(options) {
	validateOptions(options);
	const target = desktopAudioCodecTargetFor(options.platform, options.architecture);
	const modules = await (options.loadModules ?? loadRuntimeModules)();
	validateModules(modules);
	const scratchRoot = resolve(options.userDataPath, 'desktop-audio-codecs');
	await (options.mkdir ?? nodeMkdir)(scratchRoot, { recursive: true, mode: 0o700 });
	const verifyBundledPayload = modules.createBundledAudioCodecRuntimeVerifier(Object.freeze({
		desktopRoot: options.desktopRoot, target,
	}));
	const spawnBundled = modules.createBundledAudioCodecElectronSpawn({
		fork: options.forkUtilityProcess,
		helperPath: join(
			options.desktopRoot,
			'project-library-runtime/desktop/bundled-audio-codec-helper-process.js',
		),
	});
	const bundledRuntime = await modules.loadIsolatedBundledAudioCodecRuntime({
		target, scratchRoot, verifyPayload: verifyBundledPayload, spawn: spawnBundled,
	});
	const verifyAddon = modules.createOsAudioCodecNativeVerifier(Object.freeze({
		runtimeRoot: options.runtimeRoot, platform: options.platform, arch: options.architecture,
	}));
	const spawn = modules.createOperatingSystemAudioCodecElectronSpawn({
		fork: options.forkUtilityProcess,
		helperPath: join(options.desktopRoot, 'os-audio-codec-helper-process.js'),
	});
	const operatingSystemRuntime = await modules.loadOperatingSystemAudioCodecRuntime({
		target, osVersion: options.operatingSystemVersion, scratchRoot, verifyAddon, spawn,
	});
	const receipts = createDesktopAudioCodecReceiptJournal();
	const service = modules.createDesktopAudioCodecRuntimeComposition({
		target, scratchRoot, externalFfmpegPreferences: options.externalFfmpegPreferences,
		...(bundledRuntime === null ? {} : { createBundledRuntime: () => bundledRuntime }),
		...(operatingSystemRuntime === null
			? {} : { createOperatingSystemRuntime: () => operatingSystemRuntime }),
		onReceipt: (observation) => { receipts.record(observation); },
	});
	const ipc = modules.registerDesktopAudioCodecMainIpc({
		channels: Object.freeze({
			desktopAudioCodecExecute: options.channels.desktopAudioCodecExecute,
			desktopAudioCodecCancel: options.channels.desktopAudioCodecCancel,
			desktopAudioCodecCapabilities: options.channels.desktopAudioCodecCapabilities,
		}),
		handle: options.handle, removeHandler: options.removeHandler,
		ownerFor: options.ownerFor, service,
	});
	validateIpcRegistration(ipc);
	let disposal = null;
	return Object.freeze({
		revokeOwner(owner) { return ipc.revokeOwner(owner); },
		receiptSnapshot() { return receipts.snapshot(); },
		dispose() {
			if (disposal !== null) return disposal;
			receipts.clear();
			disposal = ipc.dispose();
			return disposal;
		},
	});
}

async function loadRuntimeModules() {
	const [bundled, bundledPayload, bundledSpawn, composition, ipc, operatingSystem, electronSpawn, nativePayload]
		= await Promise.all([
		import('./project-library-runtime/desktop/bundled-audio-codec-isolated-runtime.js'),
		import('./bundled-audio-codec-runtime-payload.mjs'),
		import('./bundled-audio-codec-electron-spawn.mjs'),
		import('./project-library-runtime/desktop/desktop-audio-codec-runtime-composition.js'),
		import('./project-library-runtime/desktop/desktop-audio-codec-main-ipc.js'),
		import('./project-library-runtime/desktop/os-audio-codec-runtime.js'),
		import('./os-audio-codec-electron-spawn.mjs'),
		import('./os-audio-codec-native-payload.mjs'),
	]);
	return Object.freeze({
		createBundledAudioCodecElectronSpawn: bundledSpawn.createBundledAudioCodecElectronSpawn,
		createBundledAudioCodecRuntimeVerifier: bundledPayload.createBundledAudioCodecRuntimeVerifier,
		createDesktopAudioCodecRuntimeComposition: composition.createDesktopAudioCodecRuntimeComposition,
		createOperatingSystemAudioCodecElectronSpawn: electronSpawn.createOperatingSystemAudioCodecElectronSpawn,
		createOsAudioCodecNativeVerifier: nativePayload.createOsAudioCodecNativeVerifier,
		loadIsolatedBundledAudioCodecRuntime: bundled.loadIsolatedBundledAudioCodecRuntime,
		loadOperatingSystemAudioCodecRuntime: operatingSystem.loadOperatingSystemAudioCodecRuntime,
		registerDesktopAudioCodecMainIpc: ipc.registerDesktopAudioCodecMainIpc,
	});
}

function validateOptions(options) {
	if (!options || typeof options !== 'object' || !options.channels
		|| typeof options.channels.desktopAudioCodecExecute !== 'string'
		|| typeof options.channels.desktopAudioCodecCancel !== 'string'
		|| typeof options.channels.desktopAudioCodecCapabilities !== 'string'
		|| typeof options.handle !== 'function' || typeof options.removeHandler !== 'function'
		|| typeof options.ownerFor !== 'function' || !options.externalFfmpegPreferences
		|| typeof options.externalFfmpegPreferences.admission !== 'function'
		|| typeof options.externalFfmpegPreferences.invalidateAdmission !== 'function'
		|| typeof options.platform !== 'string' || typeof options.architecture !== 'string'
		|| typeof options.operatingSystemVersion !== 'string'
		|| options.operatingSystemVersion.length < 1 || options.operatingSystemVersion.length > 256
		|| options.operatingSystemVersion.includes('\0')
		|| typeof options.userDataPath !== 'string' || options.userDataPath.length > 4_096
		|| options.userDataPath.includes('\0') || !isAbsolute(options.userDataPath)
		|| typeof options.desktopRoot !== 'string' || options.desktopRoot.length > 4_096
		|| options.desktopRoot.includes('\0') || !isAbsolute(options.desktopRoot)
		|| typeof options.runtimeRoot !== 'string' || options.runtimeRoot.length > 4_096
		|| options.runtimeRoot.includes('\0') || !isAbsolute(options.runtimeRoot)
		|| typeof options.resourcesPath !== 'string' || options.resourcesPath.length > 4_096
		|| options.resourcesPath.includes('\0') || !isAbsolute(options.resourcesPath)
		|| typeof options.packaged !== 'boolean' || typeof options.forkUtilityProcess !== 'function'
		|| options.loadModules !== undefined && typeof options.loadModules !== 'function'
		|| options.mkdir !== undefined && typeof options.mkdir !== 'function') {
		throw new TypeError('Desktop audio codec registration ports are invalid.');
	}
}

function validateModules(modules) {
	if (!modules || typeof modules !== 'object'
		|| MODULE_METHODS.some((method) => typeof modules[method] !== 'function')) {
		throw new TypeError('The desktop audio codec runtime modules are invalid.');
	}
}

function validateIpcRegistration(registration) {
	if (!registration || typeof registration !== 'object'
		|| typeof registration.revokeOwner !== 'function'
		|| typeof registration.dispose !== 'function') {
		throw new TypeError('The desktop audio codec IPC registration is invalid.');
	}
}
