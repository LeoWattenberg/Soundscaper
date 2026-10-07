/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded descriptive metadata; this contract admits no image decoder or RAW format. */
export const IMAGE_METADATA_LIMITS_V1 = Object.freeze({
	maximumInputBytes: 64 * 1024 * 1024,
	maximumMetadataBytes: 8 * 1024 * 1024,
	maximumContainerRecords: 4_096,
	maximumIfdEntries: 512,
	maximumIfdDirectories: 16,
	maximumIptcDataSets: 1_024,
	maximumRepeatedValues: 256,
	maximumStringBytes: 4_096,
});

export type ImageMetadataIssueV1 = 'malformed-container' | 'malformed-exif' | 'malformed-iptc'
	| 'metadata-limit' | 'duplicate-metadata' | 'unsupported-text-encoding';

export interface ImageCaptureTimeV1 {
	/** Calendar time as recorded, without projecting an unknown offset into a timezone. */
	readonly local: string;
	readonly offsetMinutes: number | null;
	readonly subsecond: string | null;
}

export interface ImageExifCaptureTimeRawV1 {
	readonly dateTimeOriginal: string | null;
	readonly offsetTimeOriginal: string | null;
	readonly subsecondOriginal: string | null;
}

export interface ImageExifMetadataV1 {
	readonly orientation: number | null;
	readonly cameraMake: string | null;
	readonly cameraModel: string | null;
	readonly lensModel: string | null;
	readonly artist: string | null;
	/** Exif's optional photographer/editor pair is preserved with a newline separator. */
	readonly copyright: string | null;
	readonly description: string | null;
	readonly exposureSeconds: number | null;
	readonly aperture: number | null;
	readonly iso: number | null;
	readonly focalLengthMm: number | null;
	readonly captureTime: Readonly<ImageCaptureTimeV1> | null;
	/** Optional in legacy v1 records; exact fields also preserve partial/unknown times. */
	readonly captureTimeRaw?: Readonly<ImageExifCaptureTimeRawV1> | null;
}

export interface ImageIptcMetadataV1 {
	readonly encoding: 'ascii' | 'utf8';
	readonly objectName: string | null;
	readonly headline: string | null;
	readonly caption: string | null;
	readonly copyright: string | null;
	readonly creators: readonly string[];
	readonly keywords: readonly string[];
	readonly city: string | null;
	readonly sublocation: string | null;
	readonly state: string | null;
	readonly country: string | null;
	/** IPTC's date and time remain separate; partial dates are not invented as instants. */
	readonly captureDate: string | null;
	readonly captureTime: string | null;
}

export interface ImageMetadataV1 {
	readonly schemaVersion: 1;
	readonly container: 'jpeg' | 'tiff' | 'png' | 'unsupported';
	readonly exif: Readonly<ImageExifMetadataV1> | null;
	readonly iptc: Readonly<ImageIptcMetadataV1> | null;
	readonly issues: readonly ImageMetadataIssueV1[];
}
