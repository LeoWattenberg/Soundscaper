/* SPDX-License-Identifier: AGPL-3.0-only */

import { appendOriginalAlphaEffectFfmpegV1 } from './video-original-alpha-ffmpeg-v1.ts';

/** Native RGBA→GBRAP scaling can change alpha bytes before GEQ. Extract alpha
 * from untouched RGBA separately, then merge the original byte plane with RGB.
 * The original alpha plane is also retained for final exact publication. */
export function appendDetailSharpenFfmpegOperationV1(context: Readonly<{ filters: string[]; inputLabel: string; outputLabel: string;
	operation: Readonly<Record<string, unknown>> }>): void {
	const { filters, inputLabel, outputLabel, operation } = context;
	if (operation.kind !== 'detail-sharpen-v1' || typeof operation.expression !== 'string' || operation.preserveAlpha !== true) {
		throw new TypeError('Detail sharpening requires its owning compiled neighborhood operation.');
	}
	appendOriginalAlphaEffectFfmpegV1({ filters, inputLabel, outputLabel, operation: { expression: operation.expression, preserveAlpha: true } });
}
