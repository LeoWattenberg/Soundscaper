/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderVisualFrameEntryV13 } from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import { evaluateVideoMaskMatteRgbaV13 } from '../common/editor/video-mask-matte-rgba-v13.ts';
import { renderVideoNoiseRgba } from '../common/editor/video-test-image-noise-rgba.ts';

interface Drawable {
	readonly drawable: HTMLCanvasElement;
	readonly videoWidth: number;
	readonly videoHeight: number;
}

/** Repaint noise only when the selected output frame advances. */
export function createSelectedFinishingNoisePreview(options: Readonly<{
	readonly drawables: ReadonlyMap<string, Drawable>;
	readonly signal: AbortSignal;
}>): Readonly<{
	update(entry: UnifiedExactRenderVisualFrameEntryV13, outputOrdinal: number): void;
	dispose(): void;
}> {
	const paintedOrdinals = new Map<string, number>();
	let disposed = false;

	function update(entry: UnifiedExactRenderVisualFrameEntryV13, outputOrdinal: number): void {
		if (disposed) throw new Error('The noise preview is disposed.');
		if (entry.modelKind !== 'noise' || paintedOrdinals.get(entry.modelId) === outputOrdinal) return;
		if (!('source' in entry.authoredState)) throw new TypeError('Noise preview has no generator source.');
		const source = entry.authoredState.source;
		if (source.kind !== 'generator' || source.generator.kind !== 'noise') {
			throw new TypeError('Noise preview has inconsistent generator state.');
		}
		const drawable = options.drawables.get(entry.modelId);
		if (!drawable) throw new ReferenceError(`Noise drawable ${entry.modelId} is unavailable.`);
		const context = drawable.drawable.getContext('2d');
		if (!context) throw new Error('Noise drawable has no 2D context.');
		const frame = renderVideoNoiseRgba({
			mode: source.generator.mode,
			grainSize: source.generator.grainSize,
			seed: source.generator.seed,
			outputOrdinal,
			width: drawable.videoWidth,
			height: drawable.videoHeight,
			signal: options.signal,
		});
		for (const graph of entry.masks) {
			const mask = evaluateVideoMaskMatteRgbaV13(graph, frame.width, frame.height, new Map());
			for (let index = 0; index < mask.length; index += 1) {
				frame.pixels[index * 4 + 3] = Math.round(frame.pixels[index * 4 + 3]! * mask[index]! / 255);
			}
		}
		context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
		paintedOrdinals.set(entry.modelId, outputOrdinal);
	}

	return Object.freeze({
		update,
		dispose(): void {
			disposed = true;
			paintedOrdinals.clear();
		},
	});
}
