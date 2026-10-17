/* SPDX-License-Identifier: AGPL-3.0-only */
import { captureBrowserFrame } from './selected-finishing-exact-frame-support.ts';
import type { CaptureFrameFinishing } from './selected-finishing-exact-frame-execution.ts';
import type { FramescaperVideoFrameAddressFinishing } from './video-frame-address-finishing.ts';
import type { FramescaperCompositionFrameSource } from './editor-composition-link-frame-source.ts';

/** Composition authority is consulted before a browser drawable or encoded decoder. */
export function framescaperCompositionCapture(compositions: FramescaperCompositionFrameSource, fallback: CaptureFrameFinishing = captureBrowserFrame): CaptureFrameFinishing {
	return async (entry, signal) => await compositions.capture(entry, signal) ?? await fallback(entry, signal);
}
/** The caller owns composition lifetime; this adapter closes only its encoded-media fallback. */
export function framescaperCompositionFrameAddress(compositions: FramescaperCompositionFrameSource, encoded?: FramescaperVideoFrameAddressFinishing): FramescaperVideoFrameAddressFinishing {
	return Object.freeze({
		resolve: (request: Parameters<FramescaperVideoFrameAddressFinishing['resolve']>[0]) => {
			if (compositions.ownsSource(request.sourceId)) return compositions.resolve(request);
			if (!encoded) return Promise.reject(new ReferenceError('Encoded source frame is unavailable.'));
			return encoded.resolve(request);
		},
		async dispose() { await encoded?.dispose(); },
	});
}
