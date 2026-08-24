/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir as nodeMkdir } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const TARGETS = Object.freeze(new Map([
	['linux:x64', 'linux-x64'],
	['linux:arm64', 'linux-arm64'],
	['darwin:arm64', 'mac-arm64'],
	['win32:x64', 'win-x64'],
	['win32:arm64', 'win-arm64'],
]));
const MODULE_METHODS = Object.freeze([
	'createBundledDesktopAudioCodecRuntime', 'createDesktopAudioCodecRuntimeComposition',
	'loadBundledFlacAudioCodecRuntime', 'loadBundledWavPackAudioCodecRuntime',
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
	const reviewedRuntimes = (await Promise.all([
		modules.loadBundledWavPackAudioCodecRuntime({ target }),
		modules.loadBundledFlacAudioCodecRuntime({ target }),
	])).filter((runtime) => runtime !== null);
	const bundledRuntime = reviewedRuntimes.length === 0
		? null
		: modules.createBundledDesktopAudioCodecRuntime({ target, runtimes: reviewedRuntimes });
	const scratchRoot = resolve(options.userDataPath, 'desktop-audio-codecs');
	await (options.mkdir ?? nodeMkdir)(scratchRoot, { recursive: true, mode: 0o700 });
	const service = modules.createDesktopAudioCodecRuntimeComposition({
		target, scratchRoot, externalFfmpegPreferences: options.externalFfmpegPreferences,
		...(bundledRuntime === null ? {} : { createBundledRuntime: () => bundledRuntime }),
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
	let disposed = false;
	return Object.freeze({
		revokeOwner(owner) { return ipc.revokeOwner(owner); },
		dispose() {
			if (disposed) return;
			disposed = true;
			ipc.dispose();
		},
	});
}

async function loadRuntimeModules() {
	const [bundled, composition, flac, ipc, wavPack] = await Promise.all([
		import('./project-library-runtime/desktop/bundled-audio-codec-runtime.js'),
		import('./project-library-runtime/desktop/desktop-audio-codec-runtime-composition.js'),
		import('./project-library-runtime/desktop/bundled-flac-audio-codec-runtime.js'),
		import('./project-library-runtime/desktop/desktop-audio-codec-main-ipc.js'),
		import('./project-library-runtime/desktop/bundled-wavpack-audio-codec-runtime.js'),
	]);
	return Object.freeze({
		createBundledDesktopAudioCodecRuntime: bundled.createBundledDesktopAudioCodecRuntime,
		createDesktopAudioCodecRuntimeComposition: composition.createDesktopAudioCodecRuntimeComposition,
		loadBundledFlacAudioCodecRuntime: flac.loadBundledFlacAudioCodecRuntime,
		loadBundledWavPackAudioCodecRuntime: wavPack.loadBundledWavPackAudioCodecRuntime,
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
		|| typeof options.userDataPath !== 'string' || options.userDataPath.length > 4_096
		|| options.userDataPath.includes('\0') || !isAbsolute(options.userDataPath)
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
