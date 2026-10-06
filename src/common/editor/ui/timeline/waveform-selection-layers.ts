/* SPDX-License-Identifier: AGPL-3.0-only */

import { createTimelineSpectrogramCache } from '../../controller/source/timeline-spectrogram-cache.ts';

interface SelectionLayers { base: HTMLCanvasElement | null; selected: HTMLCanvasElement | null; }
interface ColumnRange { readonly start: number; readonly end: number; }

const cache = createTimelineSpectrogramCache<SelectionLayers>({
	releaseImage(layers) {
		if (layers.base) { layers.base.width = 0; layers.base.height = 0; }
		if (layers.selected) { layers.selected.width = 0; layers.selected.height = 0; }
	},
});

export function releaseWaveformSelectionLayers(owner: object) { cache.release(owner); }

/** Copy complete columns; redraw only the two fractional selection-edge columns. */
export function paintWaveformSelectionLayers(context: CanvasRenderingContext2D, options: Readonly<{
	key: readonly unknown[];
	width: number;
	start: number;
	end: number;
	draw(surface: HTMLCanvasElement, selected: boolean): boolean;
	drawEdges(ranges: readonly ColumnRange[]): void;
}>): boolean {
	const owner = context.canvas;
	if (!owner) return false;
	if (owner.width !== options.width || !owner.ownerDocument || typeof context.drawImage !== 'function') {
		cache.release(owner); return false;
	}
	const selected = options.end > options.start;
	const start = selected ? Math.ceil(options.start) : 0;
	const end = selected ? Math.floor(options.end) : 0;
	const wholeSelection = selected && start <= 0 && end >= owner.width;
	const make = (selected: boolean) => {
		const surface = owner.ownerDocument.createElement('canvas');
		surface.width = owner.width; surface.height = owner.height;
		try { if (options.draw(surface, selected)) return surface; }
		catch (error) { surface.width = 0; surface.height = 0; throw error; }
		surface.width = 0; surface.height = 0; return null;
	};
	// Reserve both layers in the byte budget even before selection first needs one.
	const layers = cache.image(owner, options.key, owner.width * 2, owner.height, () => {
		const image = make(wholeSelection);
		return image ? { base: wholeSelection ? null : image, selected: wholeSelection ? image : null } : null;
	});
	if (!layers) return false;
	if (!wholeSelection && !layers.base) layers.base = make(false);
	if (end > start && !layers.selected) layers.selected = make(true);
	const dominantImage = wholeSelection ? layers.selected : layers.base;
	if (!dominantImage || (end > start && !layers.selected)) return false;
	context.save();
	try {
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
	context.clearRect(0, 0, owner.width, owner.height);
	context.drawImage(dominantImage, 0, 0);
	if (!wholeSelection && end > start && layers.selected) {
		context.clearRect(start, 0, end - start, owner.height);
		context.drawImage(layers.selected, start, 0, end - start, owner.height, start, 0, end - start, owner.height);
	}
	const edgeColumns = selected ? new Set([options.start, options.end].filter(value => !Number.isInteger(value)).map(Math.floor)) : new Set<number>();
	const ranges = [...edgeColumns].filter(column => column >= 0 && column < owner.width).map(column => ({ start: column, end: column + 1 }));
	if (ranges.length) {
		context.beginPath();
		for (const range of ranges) context.rect(range.start, 0, range.end - range.start, owner.height);
		context.clip();
		options.drawEdges(ranges);
	}
	} finally { context.restore(); }
	return true;
}
