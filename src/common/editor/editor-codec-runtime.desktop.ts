/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMediaExportCapabilities } from './media-export.js';

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
export function createEditorCodecRuntime() {
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
