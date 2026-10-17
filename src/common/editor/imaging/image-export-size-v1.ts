/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { PIXEL_FRAME_HARD_LIMITS_V1, planPixelFrameV1, type PixelFrameDescriptorV1 } from './pixel-frame-contract-v1.ts';

export type ImageExportSizingV1 =
	| Readonly<{ kind: 'original' }>
	| Readonly<{ kind: 'fit'; width: number; height: number; allowUpscale: boolean }>
	| Readonly<{ kind: 'long-edge'; pixels: number; allowUpscale: boolean }>
	| Readonly<{ kind: 'megapixels'; megapixels: number; allowUpscale: boolean }>
	| Readonly<{ kind: 'percentage'; percentage: number }>;

export interface ImageExportSizePlanV1 {
	readonly source: Readonly<PixelFrameDescriptorV1>;
	readonly target: Readonly<PixelFrameDescriptorV1>;
	readonly pixelCount: number;
	readonly byteLength: number;
}

const FIELDS = Object.freeze({ original: ['kind'], fit: ['kind', 'width', 'height', 'allowUpscale'],
	'long-edge': ['kind', 'pixels', 'allowUpscale'], megapixels: ['kind', 'megapixels', 'allowUpscale'],
	percentage: ['kind', 'percentage'] });

/** Plan only: no samples, conversion or allocation. Fit/long-edge/percentage
 * round to the nearest pixel, with a one-pixel minimum. Megapixels round down
 * and cap the longer side when a one-pixel minimum would exceed the requested
 * area. These are output dimensions, never an extra crop. Source and target
 * both obey the caller's same existing frame limits. Admission stays at the
 * codec/render boundary; planning preserves every declared depth and profile. */
export function planImageExportSizeV1(descriptor: unknown, sizing: unknown, limits: unknown = {}): Readonly<ImageExportSizePlanV1> {
	const limitRecord = record(limits, 'image export limits', ['maximumSidePixels', 'maximumPixels', 'maximumBytes'], []);
	const capturedLimits = Object.freeze(Object.fromEntries(Object.keys(limitRecord)
		.map(key => [key, field(limitRecord, key, 'image export limits')])));
	const source = planPixelFrameV1(descriptor, capturedLimits).descriptor;
	const candidate = record(sizing, 'image export sizing', ['kind', 'width', 'height', 'allowUpscale', 'pixels', 'megapixels', 'percentage'], ['kind']);
	const kind = field(candidate, 'kind', 'image export sizing');
	if (typeof kind !== 'string' || !Object.hasOwn(FIELDS, kind)) throw new RangeError('Unsupported image export sizing kind.');
	const input = record(candidate, 'image export sizing', FIELDS[kind as keyof typeof FIELDS]);
	const read = (key: string) => field(input, key, 'image export sizing');
	let scale = 1, maximumPixels: number | undefined;
	if (kind === 'fit') {
		scale = Math.min(side(read('width')) / source.width, side(read('height')) / source.height);
	} else if (kind === 'long-edge') {
		scale = side(read('pixels')) / Math.max(source.width, source.height);
	} else if (kind === 'megapixels') {
		maximumPixels = Math.floor(positive(read('megapixels'), 1 / 1_000_000, PIXEL_FRAME_HARD_LIMITS_V1.maximumPixels / 1_000_000) * 1_000_000);
		scale = Math.sqrt(maximumPixels / (source.width * source.height));
	} else if (kind === 'percentage') {
		scale = positive(read('percentage'), Number.MIN_VALUE, 10_000) / 100;
	}
	if (kind === 'fit' || kind === 'long-edge' || kind === 'megapixels') {
		const allowUpscale = read('allowUpscale');
		if (typeof allowUpscale !== 'boolean') throw new TypeError('Image export upscaling requires an explicit boolean.');
		if (!allowUpscale) scale = Math.min(1, scale);
	}
	const round = kind === 'megapixels' ? Math.floor : Math.round;
	let width = Math.max(1, round(source.width * scale)), height = Math.max(1, round(source.height * scale));
	if (maximumPixels !== undefined && width * height > maximumPixels) {
		if (width >= height) width = Math.max(1, Math.floor(maximumPixels / height));
		else height = Math.max(1, Math.floor(maximumPixels / width));
	}
	const target = planPixelFrameV1({ ...source, width, height }, capturedLimits);
	return Object.freeze({ source, target: target.descriptor, pixelCount: target.pixelCount, byteLength: target.byteLength });
}

function side(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > PIXEL_FRAME_HARD_LIMITS_V1.maximumSidePixels) {
		throw new RangeError('Image export dimensions require bounded positive integers.');
	}
	return value;
}

function positive(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError('Image export sizing value is outside its numeric domain.');
	}
	return value;
}
