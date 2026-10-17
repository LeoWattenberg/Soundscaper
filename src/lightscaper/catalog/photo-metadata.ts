/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoMetadataV1 } from './types.ts';
import { field, integer, localTimestamp, name, number, record, text, utcTimestamp } from './value-validation.ts';

const METADATA_FIELDS = ['fileName', 'modifiedTime', 'captureTime', 'orientation', 'cameraMake', 'cameraModel', 'lens', 'exposureSeconds', 'aperture', 'iso', 'focalLengthMm', 'title', 'caption', 'creator', 'copyright', 'location'];

export function normalizePhotoMetadataV1(value: unknown): PhotoMetadataV1 {
	const input = record(value, 'photo metadata', METADATA_FIELDS);
	const captureValue = field(input, 'captureTime');
	let captureTime: PhotoMetadataV1['captureTime'] = null;
	if (captureValue !== null) {
		const capture = record(captureValue, 'photo capture time', ['local', 'offsetMinutes']);
		const offset = field(capture, 'offsetMinutes');
		captureTime = Object.freeze({
			local: localTimestamp(field(capture, 'local'), 'photo capture time'),
			offsetMinutes: offset === null ? null : integer(offset, -840, 840, 'capture timezone offset'),
		});
	}
	const modified = field(input, 'modifiedTime');
	return Object.freeze({
		fileName: name(field(input, 'fileName'), 'photo filename'),
		modifiedTime: modified === null ? null : utcTimestamp(modified, 'photo modification time'),
		captureTime,
		orientation: integer(field(input, 'orientation'), 1, 8, 'photo EXIF orientation'),
		cameraMake: optionalText(field(input, 'cameraMake'), 'camera make'),
		cameraModel: optionalText(field(input, 'cameraModel'), 'camera model'),
		lens: optionalText(field(input, 'lens'), 'lens'),
		exposureSeconds: optionalNumber(field(input, 'exposureSeconds'), 0.000_000_001, 86_400, 'exposure seconds'),
		aperture: optionalNumber(field(input, 'aperture'), 0.1, 1_024, 'aperture'),
		iso: optionalInteger(field(input, 'iso'), 1, 100_000_000, 'ISO'),
		focalLengthMm: optionalNumber(field(input, 'focalLengthMm'), 0.1, 1_000_000, 'focal length'),
		title: text(field(input, 'title'), 'photo title'),
		caption: text(field(input, 'caption'), 'photo caption', 16_384, 0, true),
		creator: text(field(input, 'creator'), 'photo creator'),
		copyright: text(field(input, 'copyright'), 'photo copyright', 16_384, 0, true),
		location: text(field(input, 'location'), 'photo location'),
	});
}

export function emptyPhotoMetadataV1(fileName: string): PhotoMetadataV1 {
	return normalizePhotoMetadataV1({
		fileName, modifiedTime: null, captureTime: null, orientation: 1,
		cameraMake: null, cameraModel: null, lens: null, exposureSeconds: null,
		aperture: null, iso: null, focalLengthMm: null,
		title: '', caption: '', creator: '', copyright: '', location: '',
	});
}

function optionalText(value: unknown, label: string): string | null {
	return value === null ? null : text(value, label, 1_024);
}

function optionalNumber(value: unknown, minimum: number, maximum: number, label: string): number | null {
	return value === null ? null : number(value, minimum, maximum, label);
}

function optionalInteger(value: unknown, minimum: number, maximum: number, label: string): number | null {
	return value === null ? null : integer(value, minimum, maximum, label);
}
