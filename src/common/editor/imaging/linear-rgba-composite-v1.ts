/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoClipCompositionBlendMode } from '../video-clip-composition.ts';

export type LinearRgbaBlendModeV1 = VideoClipCompositionBlendMode | 'add';

/** The exact existing V13 blend span, shared by picture and output-only composition.
 * Callers own/admit equal packed premultiplied linear spans and their lifetime. */
export function compositeLinearPremultipliedRgbaSpanV1(target: Float64Array<ArrayBuffer>,
	source: Float64Array<ArrayBuffer>, blendMode: LinearRgbaBlendModeV1): void {
	if (target.length !== source.length || target.length % 4 !== 0) throw new RangeError('Linear RGBA spans must have equal packed geometry.');
	for (let offset = 0; offset < target.length; offset += 4) {
		const targetAlpha = clamp(target[offset + 3]!);
		const sourceAlpha = clamp(source[offset + 3]!);
		const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
		for (let channel = 0; channel < 3; channel += 1) {
			const backdrop = targetAlpha > 1e-12 ? target[offset + channel]! / targetAlpha : 0;
			const foreground = sourceAlpha > 1e-12 ? source[offset + channel]! / sourceAlpha : 0;
			const blended = blend(backdrop, foreground, blendMode);
			target[offset + channel] = clamp(
				(1 - sourceAlpha) * target[offset + channel]!
				+ sourceAlpha * ((1 - targetAlpha) * foreground + targetAlpha * blended),
			);
		}
		target[offset + 3] = outputAlpha;
	}
}

function blend(backdrop: number, source: number, mode: LinearRgbaBlendModeV1): number {
	if (mode === 'add') return Math.min(1, backdrop + source);
	if (mode === 'multiply') return backdrop * source;
	if (mode === 'screen') return backdrop + source - backdrop * source;
	if (mode === 'overlay') return backdrop <= 0.5 ? 2 * backdrop * source
		: 1 - 2 * (1 - backdrop) * (1 - source);
	if (mode === 'darken') return Math.min(backdrop, source);
	if (mode === 'lighten') return Math.max(backdrop, source);
	if (mode === 'difference') return Math.abs(backdrop - source);
	if (mode === 'exclusion') return backdrop + source - 2 * backdrop * source;
	return source;
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
