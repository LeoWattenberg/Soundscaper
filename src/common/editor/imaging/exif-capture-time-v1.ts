/* SPDX-License-Identifier: AGPL-3.0-only */

import { failMetadata } from './image-metadata-binary.ts';
import type { ImageCaptureTimeV1 } from './image-metadata-model-v1.ts';

/** Validate CIPA's original fields while retaining unknown wall-clock components. */
export function readExifCaptureTimeV1(date: string, offset: string | null, subsecond: string | null): Readonly<ImageCaptureTimeV1> | null {
	if (date === ' '.repeat(19)) date = '    :  :     :  :  ';
	if (!/^(?:\d{4}| {4}):(?:\d{2}| {2}):(?:\d{2}| {2}) (?:\d{2}| {2}):(?:\d{2}| {2}):(?:\d{2}| {2})$/.test(date)) {
		failMetadata('malformed-exif');
	}
	const year = timestampComponent(date.slice(0, 4), 1, 9_999), month = timestampComponent(date.slice(5, 7), 1, 12);
	const day = timestampComponent(date.slice(8, 10), 1, 31), hour = timestampComponent(date.slice(11, 13), 0, 23);
	const minute = timestampComponent(date.slice(14, 16), 0, 59), second = timestampComponent(date.slice(17, 19), 0, 59);
	const unknownDate = [year, month, day, hour, minute, second].includes(null);
	const leap = year === null || year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	if (month !== null && day !== null && day > (days[month - 1] ?? 0)) failMetadata('malformed-exif');
	let offsetMinutes: number | null = null;
	if (offset !== null && offset !== '      ' && offset !== '   :  ') {
		if (!/^[+-]\d{2}:\d{2}$/.test(offset)) failMetadata('malformed-exif');
		const hours = Number(offset.slice(1, 3)), minutes = Number(offset.slice(4, 6));
		if (hours > 23 || minutes > 59) failMetadata('malformed-exif');
		const absolute = hours * 60 + minutes;
		offsetMinutes = offset[0] === '-' && absolute !== 0 ? -absolute : absolute;
	}
	if (subsecond !== null && /^ *$/.test(subsecond)) subsecond = null;
	if (subsecond !== null && !/^\d+$/.test(subsecond)) failMetadata('malformed-exif');
	if (unknownDate) return null;
	return Object.freeze({ local: `${date.slice(0, 10).replaceAll(':', '-')}T${date.slice(11)}`, offsetMinutes, subsecond });
}

function timestampComponent(text: string, minimum: number, maximum: number): number | null {
	if (/^ +$/.test(text)) return null;
	const value = Number(text);
	if (value < minimum || value > maximum) failMetadata('malformed-exif');
	return value;
}
