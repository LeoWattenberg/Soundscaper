/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import type { GraphicWatermarkPlacementV1 } from './imaging/pixel-frame-graphic-watermark-v1.ts';
import { IMAGE_IMPORT_LIMITS } from './image-import-admission.ts';

export interface ImageExportGraphicRequest {
	readonly body: Blob;
	readonly anchor: GraphicWatermarkPlacementV1['anchor'];
	readonly widthFraction: number;
	readonly marginFraction: number;
	readonly opacity: number;
}
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;

/** A gesture captures only an ephemeral file and scalar placement; decoding belongs to the export borrow. */
export function captureImageExportGraphicRequest(value: unknown): Readonly<ImageExportGraphicRequest> {
	const input = record(value, 'export graphic request', ['body', 'anchor', 'widthFraction', 'marginFraction', 'opacity']);
	const body = field(input, 'body', 'export graphic request') as Blob;
	const size = Reflect.apply(SIZE, body, []) as number;
	if (size < 1 || size > IMAGE_IMPORT_LIMITS.maximumFileInputBytes) throw new RangeError('Select a nonempty graphic within the image byte limit.');
	const anchor = field(input, 'anchor', 'export graphic request');
	if (typeof anchor !== 'string' || !/^(?:top|middle|bottom)-(?:left|center|right)$/u.test(anchor)) throw new RangeError('Unsupported export graphic anchor.');
	const unit = (key: string, minimum: number, maximum: number) => {
		const value = field(input, key, 'export graphic request');
		if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError('Check the graphic size, margin and opacity.');
		return value;
	};
	return Object.freeze({ body, anchor: anchor as ImageExportGraphicRequest['anchor'], widthFraction: unit('widthFraction', Number.MIN_VALUE, 1),
		marginFraction: unit('marginFraction', 0, 0.49), opacity: unit('opacity', 0, 1) });
}

export function imageExportGraphicPlacement(request: Readonly<Pick<ImageExportGraphicRequest, 'anchor' | 'widthFraction' | 'marginFraction' | 'opacity'>>, width: number, height: number): Readonly<GraphicWatermarkPlacementV1> {
	if (![width, height].every(side => Number.isSafeInteger(side) && side > 0)) throw new RangeError('Graphic delivery dimensions are invalid.');
	return Object.freeze({ anchor: request.anchor, widthFraction: request.widthFraction,
		marginPixels: Math.min(Math.floor((Math.min(width, height) - 1) / 2), Math.floor(Math.min(width, height) * request.marginFraction)), opacity: request.opacity });
}
