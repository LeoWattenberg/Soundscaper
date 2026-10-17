/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { capturePhotoRasterExportOutput, type PhotoRasterExportOutput } from './photo-raster-export-contract-v1.ts';
import { normalizeImageOutputColorProfileV1, type ImageOutputColorProfileV1 } from '../../common/editor/imaging/image-output-color-profile-v1.ts';

export interface PhotoRasterExportOutputV2 extends PhotoRasterExportOutput {
	readonly schemaVersion: 2;
	readonly bitDepth: 8 | 16;
}
export interface PhotoRasterExportOutputV3 extends PhotoRasterExportOutput {
	readonly schemaVersion: 3;
	readonly profile: ImageOutputColorProfileV1;
	readonly bitDepth: 8 | 16;
}
export type PhotoRasterExportOutputCurrentV1 = PhotoRasterExportOutput | PhotoRasterExportOutputV2 | PhotoRasterExportOutputV3;
const FIELDS = ['sizing', 'quality', 'sharpen', 'metadataScope', 'textWatermark'] as const;

/** Explicit Current output version; unchanged unversioned requests retain their exact byte defaults. */
export function capturePhotoRasterExportOutputCurrentV1(value: unknown, format: 'png' | 'jpeg'): Readonly<PhotoRasterExportOutputCurrentV1> {
	if (format !== 'png' && format !== 'jpeg') throw new RangeError('Unsupported Current raster output format.');
	const input = record(value, 'Current Photo raster output', [...FIELDS, 'schemaVersion', 'bitDepth', 'profile'], ['sizing', 'quality']);
	if (!Object.hasOwn(input, 'schemaVersion') && !Object.hasOwn(input, 'bitDepth') && !Object.hasOwn(input, 'profile')) return capturePhotoRasterExportOutput(input);
	const version = field(input, 'schemaVersion', 'Current Photo raster output');
	if (version !== 2 && version !== 3) throw new RangeError('Unsupported Current raster output version.');
	if (version === 2 && Object.hasOwn(input, 'profile')) throw new TypeError('Current raster Output2 contains an unsupported field.');
	const bitDepth = field(input, 'bitDepth', 'Current Photo raster output');
	if (bitDepth !== 8 && bitDepth !== 16) throw new RangeError('Current raster output bit depth must be 8 or 16.');
	const profile = version === 3 ? normalizeImageOutputColorProfileV1(field(input, 'profile', 'Current Photo raster output')) : undefined;
	if (format === 'jpeg' && profile === 'display-p3') throw new RangeError('Display P3 output requires PNG. Choose PNG or sRGB.');
	if (format === 'jpeg' && bitDepth === 16) throw new RangeError('Sixteen-bit output requires PNG.');
	// The existing owner normalizes the unchanged common field vocabulary;
	// explicit successors retain their version, depth and profile independently.
	const common = capturePhotoRasterExportOutput(Object.fromEntries(FIELDS.filter(key => Object.hasOwn(input, key))
		.map(key => [key, field(input, key, 'Current Photo raster output')])));
	return profile === undefined ? Object.freeze({ schemaVersion: 2, bitDepth, ...common })
		: Object.freeze({ schemaVersion: 3, profile, bitDepth, ...common });
}
