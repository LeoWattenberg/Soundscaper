/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMediaExportCapabilities } from './media-export.js';
import {
	createDesktopAudioCodecRuntime,
	type DesktopAudioCodecRendererBridge,
} from './desktop-audio-codec-runtime.ts';

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
	const bridge = desktopAudioCodecBridge(options);
	if (bridge !== null) return createDesktopAudioCodecRuntime(bridge);

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
	if (execute === null || cancel === null) return null;
	return Object.freeze({
		execute(request: Parameters<DesktopAudioCodecRendererBridge['execute']>[0]) {
			return Reflect.apply(execute, fileService, [request]);
		},
		cancel(requestId: string) { return Reflect.apply(cancel, fileService, [requestId]); },
	});
}

function callable(value: object, key: string): ((...arguments_: never[]) => unknown) | null {
	const candidate = (value as Record<string, unknown>)[key];
	return typeof candidate === 'function' ? candidate as (...arguments_: never[]) => unknown : null;
}
