/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { capturePhotoRasterExportOutput, type PhotoRasterExportOutput } from './photo-raster-export-contract-v1.ts';

export interface PhotoRasterExportOutputV2 extends PhotoRasterExportOutput {
	readonly schemaVersion: 2;
	readonly bitDepth: 8 | 16;
}
export type PhotoRasterExportOutputCurrentV1 = PhotoRasterExportOutput | PhotoRasterExportOutputV2;
const FIELDS = ['sizing', 'quality', 'sharpen', 'metadataScope', 'textWatermark'] as const;

/** Explicit Current output version; unchanged unversioned requests retain their exact byte defaults. */
export function capturePhotoRasterExportOutputCurrentV1(value: unknown, format: 'png' | 'jpeg'): Readonly<PhotoRasterExportOutputCurrentV1> {
	if (format !== 'png' && format !== 'jpeg') throw new RangeError('Unsupported Current raster output format.');
	const input = record(value, 'Current Photo raster output', [...FIELDS, 'schemaVersion', 'bitDepth'], ['sizing', 'quality']);
	if (!Object.hasOwn(input, 'schemaVersion') && !Object.hasOwn(input, 'bitDepth')) return capturePhotoRasterExportOutput(input);
	if (field(input, 'schemaVersion', 'Current Photo raster output') !== 2) throw new RangeError('Unsupported Current raster output version.');
	const bitDepth = field(input, 'bitDepth', 'Current Photo raster output');
	if (bitDepth !== 8 && bitDepth !== 16) throw new RangeError('Current raster output bit depth must be 8 or 16.');
	if (format === 'jpeg' && bitDepth === 16) throw new RangeError('Sixteen-bit output requires PNG.');
	// The existing owner normalizes the unchanged common field vocabulary;
	// this owner preserves and validates the additional version/depth fields.
	const common = capturePhotoRasterExportOutput(Object.fromEntries(FIELDS.filter(key => Object.hasOwn(input, key))
		.map(key => [key, field(input, key, 'Current Photo raster output')])));
	return Object.freeze({ schemaVersion: 2, bitDepth, ...common });
}
