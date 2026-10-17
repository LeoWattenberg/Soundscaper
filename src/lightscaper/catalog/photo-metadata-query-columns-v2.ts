/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoMetadataQueryColumnV2, PhotoQuerySubjectV2 } from './photo-smart-query-types-v2.ts';

export const PHOTO_METADATA_TEXT_COLUMNS_V2 = Object.freeze([
	'file-name', 'title', 'caption', 'creator', 'copyright', 'location', 'camera-make', 'camera-model', 'lens',
] as const);
export const PHOTO_METADATA_NUMBER_COLUMNS_V2 = Object.freeze([
	'orientation', 'capture-offset-minutes', 'exposure-seconds', 'aperture', 'iso', 'focal-length-mm', 'width', 'height',
] as const);
export const PHOTO_METADATA_TIME_COLUMNS_V2 = Object.freeze(['capture-time', 'modified-time'] as const);
export const PHOTO_METADATA_QUERY_COLUMN_IDS_V2 = Object.freeze([
	...PHOTO_METADATA_TEXT_COLUMNS_V2, ...PHOTO_METADATA_NUMBER_COLUMNS_V2, ...PHOTO_METADATA_TIME_COLUMNS_V2,
]);

const textColumn = (maximumUnits: number, nullable: boolean, multiline = false) =>
	Object.freeze({ type: 'text' as const, maximumUnits, nullable, multiline });
const numberColumn = (minimum: number, maximum: number, integer: boolean, nullable: boolean, unit: string) =>
	Object.freeze({ type: 'number' as const, minimum, maximum, integer, nullable, unit });

/** Effective L2 metadata only. Empty authored strings are known; unknown nullable facts stay null. */
export const PHOTO_METADATA_QUERY_COLUMNS_V2 = Object.freeze({
	'file-name': textColumn(256, false), title: textColumn(16_384, false), caption: textColumn(16_384, false, true),
	creator: textColumn(16_384, false), copyright: textColumn(16_384, false, true), location: textColumn(16_384, false),
	'camera-make': textColumn(1_024, true), 'camera-model': textColumn(1_024, true), lens: textColumn(1_024, true),
	orientation: numberColumn(1, 8, true, false, 'orientation'),
	'capture-offset-minutes': numberColumn(-840, 840, true, true, 'minutes'),
	'exposure-seconds': numberColumn(0.000_000_001, 86_400, false, true, 'seconds'),
	aperture: numberColumn(0.1, 1_024, false, true, 'f-number'),
	iso: numberColumn(1, 100_000_000, true, true, 'iso'),
	'focal-length-mm': numberColumn(0.1, 1_000_000, false, true, 'millimetres'),
	// Persisted still dimensions have a wider bound than today's native decoder admission.
	width: numberColumn(1, 65_536, true, false, 'pixels'), height: numberColumn(1, 65_536, true, false, 'pixels'),
	'capture-time': Object.freeze({ type: 'time' as const, clock: 'local' as const, nullable: true }),
	'modified-time': Object.freeze({ type: 'time' as const, clock: 'utc' as const, nullable: true }),
});

/** Closed column access, without arbitrary paths or any fallback to immutable extracted facts. */
export function readPhotoMetadataQueryColumnV2(photo: PhotoQuerySubjectV2, column: PhotoMetadataQueryColumnV2): string | number | null {
	switch (column) {
		case 'file-name': return photo.metadata.fileName;
		case 'title': return photo.metadata.title;
		case 'caption': return photo.metadata.caption;
		case 'creator': return photo.metadata.creator;
		case 'copyright': return photo.metadata.copyright;
		case 'location': return photo.metadata.location;
		case 'camera-make': return photo.metadata.cameraMake;
		case 'camera-model': return photo.metadata.cameraModel;
		case 'lens': return photo.metadata.lens;
		case 'orientation': return photo.metadata.orientation;
		case 'capture-offset-minutes': return photo.metadata.captureTime?.offsetMinutes ?? null;
		case 'exposure-seconds': return photo.metadata.exposureSeconds;
		case 'aperture': return photo.metadata.aperture;
		case 'iso': return photo.metadata.iso;
		case 'focal-length-mm': return photo.metadata.focalLengthMm;
		case 'width': return photo.width;
		case 'height': return photo.height;
		case 'capture-time': return photo.metadata.captureTime?.local ?? null;
		case 'modified-time': return photo.metadata.modifiedTime;
	}
}
