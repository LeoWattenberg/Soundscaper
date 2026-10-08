/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderRgbaFrameV13 } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../common/editor/video-clip-composition.ts';
import { resolveVideoRenderDescription } from '../common/editor/video-render-description.ts';
import { withGlobalDevelopPixelFrameV1 } from '../common/editor/imaging/pixel-frame-global-develop-v1.ts';
import { isGlobalDevelopEffectTypeV1, normalizeGlobalDevelopEffectV1 } from '../common/editor/video-global-develop-v1.ts';
import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';

const CHECK_ABORT = AbortSignal.prototype.throwIfAborted;

/** Execute maintained browser effects over straight RGBA without changing transfer encoding. */
export async function applyVideoExactBrowserEffectsFinishing(
	frame: UnifiedExactRenderRgbaFrameV13,
	effects: readonly unknown[],
	signal: AbortSignal,
): Promise<UnifiedExactRenderRgbaFrameV13> {
	throwIfAborted(signal);
	// A valid owning project is already bounded by the 100,000-node interchange ceiling.
	const admitted = readClosedDomainArray(effects, 'Frame browser effects', 0, 100_000).map(value => {
		const effect = readClosedDomainRecord(value, 'Frame browser effect', ['id', 'type', 'enabled', 'params']);
		return isGlobalDevelopEffectTypeV1(readClosedDomainField(effect, 'type', 'Frame browser effect'))
			? normalizeGlobalDevelopEffectV1(value) : value;
	});
	if (admitted.length === 0) return clone(frame);
	if (admitted.every(value => isGlobalDevelopEffectTypeV1(Object.getOwnPropertyDescriptor(value, 'type')?.value))) {
		return withGlobalDevelopPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: frame.width, height: frame.height,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: frame.pixels }, effects: admitted, signal },
			output => Object.freeze({ width: output.descriptor.width, height: output.descriptor.height, pixels: output.pixels.slice() }),
			{ maximumEffects: 100_000, limits: { maximumSidePixels: 65_536, maximumPixels: 33_554_432, maximumBytes: 128 * 1024 * 1024 } });
	}
	if (!globalThis.document?.createElement) {
		throw new Error('Selected finishing browser effects are unavailable outside a WebGL2 document.');
	}
	const source = globalThis.document.createElement('canvas');
	source.width = frame.width;
	source.height = frame.height;
	const context = source.getContext('2d');
	if (!context) throw new Error('Selected finishing browser effect source has no 2D context.');
	context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
	const output = globalThis.document.createElement('canvas');
	const module = await import('../common/editor/ui/video-preview-compositor.js');
	throwIfAborted(signal);
	const compositor = module.createVideoPreviewCompositor(output);
	try {
		const report = compositor.render([{
			trackId: 'finishing-exact-effect-track', trackIndex: 0,
			entries: [{
				clipId: 'finishing-exact-effect-source',
				video: { drawable: source, videoWidth: frame.width, videoHeight: frame.height,
					readyState: 4, currentTime: 0, pause() {} },
				effects: admitted, opacity: 1, displayWidth: frame.width, displayHeight: frame.height,
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
			throw new Error('Selected finishing browser effect execution omitted authored state.');
		}
		const captured = compositor.captureEvaluatedRgba();
		if (!captured || captured.width !== frame.width || captured.height !== frame.height
			|| captured.rgba.byteLength !== frame.pixels.byteLength) {
			throw new RangeError('Selected finishing browser effect output geometry changed.');
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
	Reflect.apply(CHECK_ABORT, signal, []);
}
