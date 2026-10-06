/* SPDX-License-Identifier: AGPL-3.0-only */

import { paintSpectrogram } from '../../pffft-spectrogram.js';

interface RasterImage {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8ClampedArray;
}

interface RasterContext<Image extends RasterImage> {
	getTransform?(): { a: number; b: number; c: number; d: number; e: number; f: number };
	createImageData?(width: number, height: number): Image;
	putImageData?(image: Image, x: number, y: number): void;
}

const littleEndian = new Uint32Array(new Uint8Array([1, 0, 0, 0]).buffer)[0] === 1;
const packedColors = new Map<string, number>();
const verticalAlignment = new Map<string, boolean>();

/** Bulk paint a dedicated offscreen canvas when every rectangle is backing-pixel aligned. */
export function paintSpectrogramImageData<Image extends RasterImage>(
	context: RasterContext<Image>,
	columns: readonly (readonly number[])[],
	x: number,
	y: number,
	width: number,
	height: number,
	options: { readonly pixelSkip?: number; readonly [setting: string]: unknown } = {},
): boolean {
	const transform = context.getTransform?.();
	if (!transform || !context.createImageData || !context.putImageData || !columns.length
		|| transform.b !== 0 || transform.c !== 0
		|| !Number.isFinite(transform.a) || transform.a <= 0
		|| !Number.isFinite(transform.d) || transform.d <= 0) return false;
	const pixelSkip = Math.max(1, Math.floor(Number(options.pixelSkip) || 1));
	const paintWidth = Math.min(width, columns.length * pixelSkip);
	const backingWidth = paintWidth * transform.a;
	const backingHeight = height * transform.d;
	const left = x * transform.a + transform.e;
	const top = y * transform.d + transform.f;
	if (![backingWidth, backingHeight, left, top].every(Number.isSafeInteger)
		|| backingWidth <= 0 || backingHeight <= 0 || !Number.isSafeInteger(pixelSkip * transform.a)) return false;
	if (!Number.isSafeInteger(transform.d) && !alignedVerticalSpans(columns[0]!, height, transform.d, options)) return false;
	const image = context.createImageData(backingWidth, backingHeight);
	const pixels = new Uint32Array(image.data.buffer, image.data.byteOffset, image.data.byteLength / 4);
	let color = 0;
	// Reuse the rectangle painter's frequency projection, intensity math, and palette.
	// Only its canvas writes are replaced; the transient buffer is never retained.
	paintSpectrogram({
		set fillStyle(value: string) { color = packedSpectrogramColor(value); },
		fillRect(rectX: number, rectY: number, rectWidth: number, rectHeight: number) {
			const column = rectX * transform.a;
			const endColumn = column + rectWidth * transform.a;
			const endRow = (rectY + rectHeight) * transform.d;
			for (let row = rectY * transform.d; row < endRow; row += 1) {
				const start = row * backingWidth + column;
				if (endColumn - column === 1) pixels[start] = color;
				else pixels.fill(color, start, row * backingWidth + endColumn);
			}
		},
	}, columns, 0, 0, width, height, options);
	context.putImageData(image, left, top);
	return true;
}

function alignedVerticalSpans(column: readonly number[], height: number, scale: number, options: Readonly<Record<string, unknown>>) {
	const key = JSON.stringify([height, scale, column.length, options.scale, options.minFreq, options.maxFreq,
		options.nyquistFrequency, options.sampleRate, options.frequencyBands, options.fftWindowSize]);
	const cached = verticalAlignment.get(key);
	if (cached !== undefined) return cached;
	let aligned = true;
	// A one-column geometry probe reuses the exact painter's bounded row-span cache.
	paintSpectrogram({ set fillStyle(_color: string) {},
		fillRect(_x: number, y: number, _width: number, spanHeight: number) {
			aligned &&= Number.isSafeInteger(y * scale) && Number.isSafeInteger(spanHeight * scale);
		},
	}, [column], 0, 0, 1, height, { ...options, pixelSkip: 1 });
	verticalAlignment.set(key, aligned);
	if (verticalAlignment.size > 64) verticalAlignment.delete(verticalAlignment.keys().next().value!);
	return aligned;
}

function packedSpectrogramColor(value: string): number {
	const cached = packedColors.get(value);
	if (cached !== undefined) return cached;
	const rgb = Number.parseInt(value.slice(1), 16);
	const packed = littleEndian
		? (0xff000000 | ((rgb & 255) << 16) | (rgb & 0xff00) | (rgb >>> 16)) >>> 0
		: ((rgb << 8) | 255) >>> 0;
	packedColors.set(value, packed);
	return packed;
}
