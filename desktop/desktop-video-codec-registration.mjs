/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';

/** Compose the external-FFmpeg video session service behind owner-scoped IPC. */
export async function registerDesktopVideoCodecs(options) {
	validateOptions(options);
	const modules = await (options.loadModules ?? loadRuntimeModules)();
	if (!modules || typeof modules.createExternalFfmpegVideoOperationService !== 'function'
		|| typeof modules.registerDesktopVideoCodecMainIpc !== 'function') {
		throw new TypeError('Desktop video codec runtime modules are invalid.');
	}
	const service = modules.createExternalFfmpegVideoOperationService({
		productId: options.productId,
		scratchRoot: resolve(options.userDataPath, 'desktop-video-codecs'),
		preferences: options.externalFfmpegPreferences,
		environment: options.environment,
	});
	const ipc = modules.registerDesktopVideoCodecMainIpc({
		channels: Object.freeze(Object.fromEntries(CHANNEL_FIELDS.map((field) => [
			field, options.channels[field],
		]))),
		handle: options.handle,
		removeHandler: options.removeHandler,
		ownerFor: options.ownerFor,
		service,
	});
	let disposal = null;
	return Object.freeze({
		capabilities: () => service.capabilities(),
		revokeOwner(owner) { return ipc.revokeOwner(owner); },
		dispose() {
			if (disposal !== null) return disposal;
			ipc.dispose();
			try { disposal = Promise.resolve(service.dispose()).then(() => undefined); }
			catch (error) { disposal = Promise.reject(error); }
			return disposal;
		},
	});
}

const CHANNEL_FIELDS = Object.freeze([
	'desktopVideoCodecCapabilities', 'desktopVideoCodecBegin', 'desktopVideoCodecWrite',
	'desktopVideoCodecClose', 'desktopVideoCodecExecute', 'desktopVideoCodecStat',
	'desktopVideoCodecRead', 'desktopVideoCodecDelete', 'desktopVideoCodecCancel',
]);

async function loadRuntimeModules() {
	const [service, ipc] = await Promise.all([
		import('./project-library-runtime/desktop/external-ffmpeg-video-operation-service.js'),
		import('./project-library-runtime/desktop/desktop-video-codec-main-ipc.js'),
	]);
	return Object.freeze({
		createExternalFfmpegVideoOperationService: service.createExternalFfmpegVideoOperationService,
		registerDesktopVideoCodecMainIpc: ipc.registerDesktopVideoCodecMainIpc,
	});
}

function validateOptions(options) {
	if (!options || typeof options !== 'object' || !options.channels
		|| CHANNEL_FIELDS.some((field) => typeof options.channels[field] !== 'string')
		|| typeof options.handle !== 'function' || typeof options.removeHandler !== 'function'
		|| typeof options.ownerFor !== 'function'
		|| (options.productId !== 'soundscaper' && options.productId !== 'framescaper')
		|| !options.externalFfmpegPreferences
		|| typeof options.externalFfmpegPreferences.admission !== 'function'
		|| typeof options.externalFfmpegPreferences.invalidateAdmission !== 'function'
		|| typeof options.userDataPath !== 'string' || !isAbsolute(options.userDataPath)
		|| options.userDataPath.length > 4_096 || options.userDataPath.includes('\0')
		|| !options.environment || typeof options.environment !== 'object'
		|| options.loadModules !== undefined && typeof options.loadModules !== 'function') {
		throw new TypeError('Desktop video codec registration ports are invalid.');
	}
}
