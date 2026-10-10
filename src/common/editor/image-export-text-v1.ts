/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { readCanonicalSafeVisualText } from './safe-visual-text.ts';
import { hasOnlyUnicodeScalars } from './unicode-scalar-text.ts';
import type { GraphicWatermarkPlacementV1 } from './imaging/pixel-frame-graphic-watermark-v1.ts';

export interface ImageExportTextV1 {
	readonly schemaVersion: 1;
	readonly text: string;
	readonly font: 'inter-600-latin';
	readonly color: string;
	readonly anchor: GraphicWatermarkPlacementV1['anchor'];
	readonly widthFraction: number;
	readonly marginFraction: number;
	readonly opacity: number;
}
const GLYPH = /^[\u0020-\u007e\u00a0-\u00ac\u00ae-\u00ff\u20ac\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u2122]$/u;

/** One output-only line, with explicit pinned Latin coverage. No fallback font,
 * file, decoded plane or browser capability enters the scalar request. */
export function captureImageExportTextV1(value: unknown): Readonly<ImageExportTextV1> {
	const input = record(value, 'export text', ['schemaVersion', 'text', 'font', 'color', 'anchor', 'widthFraction', 'marginFraction', 'opacity']);
	if (field(input, 'schemaVersion', 'export text') !== 1) throw new RangeError('Unsupported export text version.');
	if (field(input, 'font', 'export text') !== 'inter-600-latin') throw new RangeError('Export text requires the pinned Inter Latin font.');
	const text = readCanonicalSafeVisualText(field(input, 'text', 'export text'), 'Export text', 256, false);
	if (!text.trim() || !hasOnlyUnicodeScalars(text)) throw new RangeError('Export text requires a nonblank Unicode scalar line.');
	for (const glyph of text) if (!GLYPH.test(glyph)) throw new RangeError(`Export text does not support U+${glyph.codePointAt(0)!.toString(16).toUpperCase()}.`);
	const color = field(input, 'color', 'export text'), anchor = field(input, 'anchor', 'export text');
	if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/u.test(color)) throw new RangeError('Export text requires a lowercase RGB color.');
	if (typeof anchor !== 'string' || !/^(?:top|middle|bottom)-(?:left|center|right)$/u.test(anchor)) throw new RangeError('Unsupported export text anchor.');
	const unit = (key: string, minimum: number, maximum: number) => {
		const number = field(input, key, 'export text');
		if (typeof number !== 'number' || !Number.isFinite(number) || number < minimum || number > maximum) throw new RangeError('Check export text size, margin and opacity.');
		return number;
	};
	return Object.freeze({ schemaVersion: 1, text, font: 'inter-600-latin', color, anchor: anchor as ImageExportTextV1['anchor'],
		widthFraction: unit('widthFraction', Number.MIN_VALUE, 1), marginFraction: unit('marginFraction', 0, .49), opacity: unit('opacity', 0, 1) });
}
