/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMediaExportCapabilities } from './media-export.js';
import {
	createDesktopAudioCodecRuntime,
	type DesktopAudioCodecRendererBridge,
} from './desktop-audio-codec-runtime.ts';
import {
	createDesktopVideoCodecOperationRunner,
	type DesktopVideoCodecRendererBridge,
} from './desktop-video-codec-runtime.ts';

export class DesktopCodecRuntimeUnavailableError extends Error {
	readonly code = 'DESKTOP_CODEC_RUNTIME_UNAVAILABLE';

	constructor() {
		super('Desktop codec providers are unavailable for this operation.');
		this.name = 'DesktopCodecRuntimeUnavailableError';
	}
}

const CAPABILITIES = createMediaExportCapabilities({
	ffmpegAvailable: false,
	profile: Object.freeze({ id: 'desktop-main-process', encoders: [], muxers: [] }),
});

/**
 * Fail-closed desktop composition. Operations become available only through
 * the typed main-process codec bridge; a desktop build never loads WebAssembly
 * or silently falls back to the browser FFmpeg runtime.
 */
export function createEditorCodecRuntime(options: unknown = {}) {
	const audioBridge = desktopAudioCodecBridge(options);
	const base = audioBridge === null ? unavailableRuntime() : createDesktopAudioCodecRuntime(audioBridge);
	const videoBridge = desktopVideoCodecBridge(options);
	if (videoBridge === null) return base;
	const runVideoKeyframeEncoderOperation = createDesktopVideoCodecOperationRunner(videoBridge);
	const runtime = Object.freeze({
		...base,
		async load() { await base.load(); return runtime; },
		runVideoKeyframeEncoderOperation,
	});
	return runtime;
}

function unavailableRuntime() {
	const unavailable = (..._arguments: unknown[]): Promise<never> => (
		Promise.reject(new DesktopCodecRuntimeUnavailableError())
	);
	return Object.freeze({
		load: unavailable,
		encode: unavailable,
		encodeFile: unavailable,
		encodeFileToSink: unavailable,
		encodeVideo: unavailable,
		encodeVideoToSink: unavailable,
		decode: unavailable,
		probeVideoTiming: unavailable,
		conformVideoToCfr: unavailable,
		runVideoKeyframeEncoderOperation: unavailable,
		runTrimMediaOperation: unavailable,
		runProxyMediaOperation: unavailable,
		dispose() {},
		capabilities: () => CAPABILITIES,
	});
}

function desktopAudioCodecBridge(options: unknown): DesktopAudioCodecRendererBridge | null {
	if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
	const fileService = (options as { readonly fileService?: unknown }).fileService;
	if (!fileService || typeof fileService !== 'object' || Array.isArray(fileService)) return null;
	const execute = callable(fileService, 'runDesktopAudioCodecOperation');
	const cancel = callable(fileService, 'cancelDesktopAudioCodecOperation');
	const capabilities = callable(fileService, 'getDesktopAudioCodecCapabilities');
	if (execute === null || cancel === null || capabilities === null) return null;
	return Object.freeze({
		capabilities(query: Parameters<DesktopAudioCodecRendererBridge['capabilities']>[0]) {
			return Reflect.apply(capabilities, fileService, [query]);
		},
		execute(request: Parameters<DesktopAudioCodecRendererBridge['execute']>[0]) {
			return Reflect.apply(execute, fileService, [request]);
		},
		cancel(requestId: string) { return Reflect.apply(cancel, fileService, [requestId]); },
	});
}

function desktopVideoCodecBridge(options: unknown): DesktopVideoCodecRendererBridge | null {
	if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
	const fileService = (options as { readonly fileService?: unknown }).fileService;
	if (!fileService || typeof fileService !== 'object' || Array.isArray(fileService)) return null;
	const names = Object.freeze({
		begin: 'beginDesktopVideoCodecOperation', write: 'writeDesktopVideoCodecInput',
		close: 'closeDesktopVideoCodecInput', execute: 'executeDesktopVideoCodecOperation',
		stat: 'statDesktopVideoCodecOutput', read: 'readDesktopVideoCodecOutput',
		delete: 'deleteDesktopVideoCodecOperation', cancel: 'cancelDesktopVideoCodecOperation',
	} as const);
	const result: Record<string, (...arguments_: unknown[]) => unknown> = {};
	for (const [name, fileServiceName] of Object.entries(names)) {
		const method = callable(fileService, fileServiceName);
		if (method === null) return null;
		result[name] = (...arguments_: unknown[]) => Reflect.apply(method, fileService, arguments_);
	}
	return Object.freeze(result) as unknown as DesktopVideoCodecRendererBridge;
}

function callable(value: object, key: string): ((...arguments_: never[]) => unknown) | null {
	const candidate = (value as Record<string, unknown>)[key];
	return typeof candidate === 'function' ? candidate as (...arguments_: never[]) => unknown : null;
}
