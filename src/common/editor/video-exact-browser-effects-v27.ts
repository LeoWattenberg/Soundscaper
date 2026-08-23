/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderRgbaFrameV13 } from './unified-exact-render-finishing-consumers-v13.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from './video-clip-composition.ts';
import { resolveVideoRenderDescription } from './video-render-description.ts';

/** Execute maintained browser effects over straight RGBA without changing transfer encoding. */
export async function applyVideoExactBrowserEffectsV27(
	frame: UnifiedExactRenderRgbaFrameV13,
	effects: readonly unknown[],
	signal: AbortSignal,
): Promise<UnifiedExactRenderRgbaFrameV13> {
	throwIfAborted(signal);
	if (effects.length === 0) return clone(frame);
	if (!globalThis.document?.createElement) {
		throw new Error('Selected V27 browser effects are unavailable outside a WebGL2 document.');
	}
	const source = globalThis.document.createElement('canvas');
	source.width = frame.width;
	source.height = frame.height;
	const context = source.getContext('2d');
	if (!context) throw new Error('Selected V27 browser effect source has no 2D context.');
	context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
	const output = globalThis.document.createElement('canvas');
	const module = await import('./ui/video-preview-compositor.js');
	throwIfAborted(signal);
	const compositor = module.createVideoPreviewCompositor(output);
	try {
		const report = compositor.render([{
			trackId: 'v27-exact-effect-track', trackIndex: 0,
			entries: [{
				clipId: 'v27-exact-effect-source',
				video: { drawable: source, videoWidth: frame.width, videoHeight: frame.height,
					readyState: 4, currentTime: 0, pause() {} },
				effects, opacity: 1, displayWidth: frame.width, displayHeight: frame.height,
				renderDescription: resolveVideoRenderDescription({
					composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
					sourceDisplaySize: { width: frame.width, height: frame.height },
					canvas: { width: frame.width, height: frame.height }, opacityStart: 1,
				}),
			}],
		}], {
			referenceWidth: frame.width, referenceHeight: frame.height,
			outputWidth: frame.width, outputHeight: frame.height,
			backgroundColor: '#00000000', outputColorModel: 'rgba',
		});
		if (report.status !== 'rendered' || report.rendererStatus !== 'available'
			|| report.renderedEntryCount !== 1 || report.effects.omitted.length !== 0
			|| report.effects.fallbackRendered.length !== 0) {
			throw new Error('Selected V27 browser effect execution omitted authored state.');
		}
		const captured = compositor.captureEvaluatedRgba();
		if (!captured || captured.width !== frame.width || captured.height !== frame.height
			|| captured.rgba.byteLength !== frame.pixels.byteLength) {
			throw new RangeError('Selected V27 browser effect output geometry changed.');
		}
		throwIfAborted(signal);
		return Object.freeze({
			width: captured.width, height: captured.height,
			pixels: captured.rgba.slice() as Uint8Array<ArrayBuffer>,
		});
	} finally { compositor.dispose(); }
}

function clone(frame: UnifiedExactRenderRgbaFrameV13): UnifiedExactRenderRgbaFrameV13 {
	return Object.freeze({ width: frame.width, height: frame.height, pixels: frame.pixels.slice() });
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new DOMException('Selected V27 effects were cancelled.', 'AbortError');
}
