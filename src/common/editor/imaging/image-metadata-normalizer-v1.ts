/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord, type ClosedDomainRecord } from '../closed-domain-value.ts';
import { readExifCaptureTimeV1 } from './exif-capture-time-v1.ts';
import { MetadataReadError } from './image-metadata-binary.ts';
import { validateIptcDateTextV1, validateIptcTimeTextV1 } from './iptc-metadata-reader-v1.ts';
import { IMAGE_METADATA_LIMITS_V1 as LIMITS, type ImageCaptureTimeV1, type ImageExifCaptureTimeRawV1,
	type ImageExifMetadataV1, type ImageIptcMetadataV1, type ImageMetadataIssueV1, type ImageMetadataV1 } from './image-metadata-model-v1.ts';

const EXIF_FIELDS = ['orientation', 'cameraMake', 'cameraModel', 'lensModel', 'artist', 'copyright', 'description',
	'exposureSeconds', 'aperture', 'iso', 'focalLengthMm', 'captureTime'] as const;
const IPTC_TEXT = { objectName: 64, headline: 256, caption: 2_000, copyright: 128, city: 32,
	sublocation: 32, state: 32, country: 64, captureDate: 8, captureTime: 11 } as const;
const ISSUES = ['malformed-container', 'malformed-exif', 'malformed-iptc', 'metadata-limit',
	'duplicate-metadata', 'unsupported-text-encoding'] as const;

/** Validate untrusted persisted facts without invoking getters or trusting a TypeScript cast. */
export function normalizeImageMetadataV1(value: unknown): Readonly<ImageMetadataV1> {
	const input = readClosedDomainRecord(value, 'image metadata', ['schemaVersion', 'container', 'exif', 'iptc', 'issues']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported image metadata schema version.');
	const container = member(field(input, 'container'), ['jpeg', 'tiff', 'png', 'unsupported'] as const);
	const exifValue = field(input, 'exif'), iptcValue = field(input, 'iptc');
	if (container === 'unsupported' && (exifValue !== null || iptcValue !== null)
		|| container !== 'jpeg' && iptcValue !== null) throw new RangeError('Metadata facts disagree with their container.');
	const issues = readClosedDomainArray(field(input, 'issues'), 'metadata issues', 0, ISSUES.length)
		.map(value => member(value, ISSUES));
	if (new Set(issues).size !== issues.length) throw new RangeError('Metadata issues may not repeat.');
	return Object.freeze({ schemaVersion: 1, container,
		exif: exifValue === null ? null : exif(exifValue), iptc: iptcValue === null ? null : iptc(iptcValue),
		issues: Object.freeze(issues as ImageMetadataIssueV1[]) });
}

function exif(value: unknown): Readonly<ImageExifMetadataV1> {
	const input = readClosedDomainRecord(value, 'Exif metadata', [...EXIF_FIELDS, 'captureTimeRaw'], EXIF_FIELDS);
	const string = (key: string) => nullableString(field(input, key), LIMITS.maximumStringBytes - 1, 'ascii', true);
	const number = (key: string, minimum = 0, maximum = 0xffffffff, integer = false) => nullableNumber(field(input, key), minimum, maximum, integer);
	const captureValue = field(input, 'captureTime');
	const captureTime = captureValue === null ? null : capture(captureValue);
	const rawValue = Object.hasOwn(input, 'captureTimeRaw') ? field(input, 'captureTimeRaw') : null;
	const captureTimeRaw = rawValue === null ? null : rawCapture(rawValue);
	if (captureTimeRaw !== null) {
		const expected = captureTimeRaw.dateTimeOriginal === null ? null : checkedCapture(() => readExifCaptureTimeV1(
			captureTimeRaw.dateTimeOriginal as string, captureTimeRaw.offsetTimeOriginal, captureTimeRaw.subsecondOriginal));
		if (JSON.stringify(expected) !== JSON.stringify(captureTime)) throw new RangeError('Exif capture facts disagree with their raw fields.');
	}
	return Object.freeze({ orientation: number('orientation', 1, 8, true), cameraMake: string('cameraMake'),
		cameraModel: string('cameraModel'), lensModel: string('lensModel'), artist: string('artist'),
		copyright: string('copyright'), description: string('description'), exposureSeconds: number('exposureSeconds'),
		aperture: number('aperture'), iso: number('iso', 1, 0xffffffff, true), focalLengthMm: number('focalLengthMm'),
		captureTime, captureTimeRaw });
}

function capture(value: unknown): Readonly<ImageCaptureTimeV1> {
	const input = readClosedDomainRecord(value, 'Exif capture time', ['local', 'offsetMinutes', 'subsecond']);
	const local = field(input, 'local');
	if (typeof local !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(local)) throw new RangeError('Invalid Exif capture timestamp.');
	const offset = nullableNumber(field(input, 'offsetMinutes'), -1_439, 1_439, true);
	const subsecond = nullableString(field(input, 'subsecond'), LIMITS.maximumStringBytes - 1, 'ascii');
	if (subsecond !== null && !/^\d+$/u.test(subsecond)) throw new RangeError('Invalid Exif capture subsecond.');
	const offsetText = offset === null ? null : `${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
	const result = checkedCapture(() => readExifCaptureTimeV1(`${local.slice(0, 10).replaceAll('-', ':')} ${local.slice(11)}`, offsetText, subsecond));
	if (result === null) throw new RangeError('Invalid Exif capture timestamp.');
	return result;
}

function rawCapture(value: unknown): Readonly<ImageExifCaptureTimeRawV1> {
	const input = readClosedDomainRecord(value, 'raw Exif capture time', ['dateTimeOriginal', 'offsetTimeOriginal', 'subsecondOriginal']);
	const dateTimeOriginal = nullableString(field(input, 'dateTimeOriginal'), 19, 'ascii');
	const offsetTimeOriginal = nullableString(field(input, 'offsetTimeOriginal'), 6, 'ascii');
	const subsecondOriginal = nullableString(field(input, 'subsecondOriginal'), LIMITS.maximumStringBytes - 1, 'ascii');
	if (dateTimeOriginal === null) {
		if (offsetTimeOriginal !== null || subsecondOriginal !== null) throw new RangeError('Raw Exif capture components require a date field.');
	} else checkedCapture(() => readExifCaptureTimeV1(dateTimeOriginal, offsetTimeOriginal, subsecondOriginal));
	return Object.freeze({ dateTimeOriginal, offsetTimeOriginal, subsecondOriginal });
}

function iptc(value: unknown): Readonly<ImageIptcMetadataV1> {
	const input = readClosedDomainRecord(value, 'IPTC metadata', ['encoding', ...Object.keys(IPTC_TEXT), 'creators', 'keywords']);
	const encoding = member(field(input, 'encoding'), ['ascii', 'utf8'] as const);
	const strings = Object.fromEntries(Object.entries(IPTC_TEXT).map(([key, maximum]) =>
		[key, nullableString(field(input, key), maximum, encoding, key === 'caption')])) as {
		readonly [K in keyof typeof IPTC_TEXT]: string | null;
	};
	const repeated = (key: 'creators' | 'keywords', maximum: number) => Object.freeze(readClosedDomainArray(
		field(input, key), `IPTC ${key}`, 0, LIMITS.maximumRepeatedValues).map(value => {
		const text = nullableString(value, maximum, encoding);
		if (text === null) throw new TypeError('Repeated IPTC facts require text.');
		return text;
	}));
	try {
		if (strings.captureDate !== null) validateIptcDateTextV1(strings.captureDate);
		if (strings.captureTime !== null) validateIptcTimeTextV1(strings.captureTime);
	} catch (error) {
		if (!(error instanceof MetadataReadError)) throw error;
		throw new RangeError('Invalid IPTC capture fields.', { cause: error });
	}
	return Object.freeze({ encoding, ...strings, creators: repeated('creators', 32), keywords: repeated('keywords', 64) });
}

function field(input: ClosedDomainRecord, key: string): unknown { return readClosedDomainField(input, key, 'image metadata'); }

function member<const T extends readonly string[]>(value: unknown, values: T): T[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new RangeError('Unsupported image metadata value.');
	return value;
}

function nullableString(value: unknown, maximum: number, encoding: 'ascii' | 'utf8', multiline = false): string | null {
	if (value === null) return null;
	if (typeof value !== 'string' || value.length > maximum || /[\uD800-\uDFFF]/u.test(value)
		|| new TextEncoder().encode(value).byteLength > maximum) throw new TypeError('Metadata requires bounded text.');
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (encoding === 'ascii' && code > 127 || code < 32 && !(multiline && (code === 10 || code === 13)) || code === 127) {
			throw new TypeError('Metadata text disagrees with its encoding.');
		}
	}
	return value;
}

function nullableNumber(value: unknown, minimum: number, maximum: number, integer: boolean): number | null {
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || integer && !Number.isSafeInteger(value)) {
		throw new RangeError('Metadata numeric value exceeds its bounds.');
	}
	return Object.is(value, -0) ? 0 : value;
}

function checkedCapture<T>(read: () => T): T {
	try { return read(); }
	catch (error) {
		if (!(error instanceof MetadataReadError)) throw error;
		throw new RangeError('Invalid Exif capture fields.', { cause: error });
	}
}
