/* SPDX-License-Identifier: AGPL-3.0-only */

import { checkedRange, failMetadata, matchesBytes, MetadataBudget, MetadataReadError,
	metadataCrc32, readMetadataInput } from './image-metadata-binary.ts';
import { readExifMetadataV1 } from './exif-metadata-reader-v1.ts';
import { PHOTOSHOP_APP13_PREFIX, readIptcMetadataV1, readPhotoshopIptcResources } from './iptc-metadata-reader-v1.ts';
import { type ImageExifMetadataV1, type ImageIptcMetadataV1, type ImageMetadataIssueV1,
	type ImageMetadataV1 } from './image-metadata-model-v1.ts';

export { IMAGE_METADATA_LIMITS_V1 } from './image-metadata-model-v1.ts';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const EXIF_PREFIX = [69, 120, 105, 102, 0, 0] as const;

/**
 * Read classic TIFF, JPEG Exif/Photoshop IPTC and PNG eXIf, without decoding pixels.
 * Unknown tags/resources are bounded and skipped. XMP, maker notes, GPS, thumbnail
 * metadata and RAW admission remain outside this descriptive read model.
 * The caller owns borrowed bytes and must not mutate them during this synchronous read.
 */
export function readImageMetadataV1(value: unknown): Readonly<ImageMetadataV1> {
	const bytes = readMetadataInput(value);
	const issues: ImageMetadataIssueV1[] = [];
	const profile = new MetadataProfiles(issues);
	let container: ImageMetadataV1['container'] = 'unsupported';
	try {
		if (matchesBytes(bytes, 0, [0xff, 0xd8])) {
			container = 'jpeg'; readJpeg(bytes, profile);
		} else if (matchesBytes(bytes, 0, PNG_SIGNATURE)) {
			container = 'png'; readPng(bytes, profile);
		} else if (matchesBytes(bytes, 0, [0x49, 0x49]) || matchesBytes(bytes, 0, [0x4d, 0x4d])) {
			container = 'tiff'; profile.addExif(bytes);
		}
	} catch (error) {
		if (!(error instanceof MetadataReadError)) throw error;
		issues.push(error.issue);
		profile.invalidate();
	}
	return Object.freeze({ schemaVersion: 1, container, exif: profile.exif, iptc: profile.iptc,
		issues: Object.freeze([...new Set(issues)]) });
}

class MetadataProfiles {
	exif: Readonly<ImageExifMetadataV1> | null = null;
	iptc: Readonly<ImageIptcMetadataV1> | null = null;
	private exifCount = 0;
	private iptcCount = 0;
	constructor(private readonly issues: ImageMetadataIssueV1[]) {}
	invalidate(): void { this.exif = null; this.iptc = null; }
	addExif(bytes: Uint8Array): void {
		if (++this.exifCount > 1) { this.exif = null; this.issues.push('duplicate-metadata'); return; }
		this.exif = this.attempt(() => readExifMetadataV1(bytes));
	}
	addIptc(bytes: Uint8Array): void {
		if (++this.iptcCount > 1) { this.iptc = null; this.issues.push('duplicate-metadata'); return; }
		this.iptc = this.attempt(() => readIptcMetadataV1(bytes));
	}
	private attempt<T>(read: () => T): T | null {
		try { return read(); }
		catch (error) {
			if (!(error instanceof MetadataReadError)) throw error;
			this.issues.push(error.issue); return null;
		}
	}
}

function readJpeg(bytes: Uint8Array, profile: MetadataProfiles): void {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const budget = new MetadataBudget();
	let offset = 2;
	while (offset < bytes.length) {
		budget.addRecord();
		if (bytes[offset++] !== 0xff) failMetadata('malformed-container');
		while (bytes[offset] === 0xff) offset++;
		checkedRange(bytes, offset, 1, 'malformed-container');
		const marker = bytes[offset++] ?? 0;
		if (marker === 0xd9) return;
		if (marker === 0 || marker === 0xd8) failMetadata('malformed-container');
		if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue;
		checkedRange(bytes, offset, 2, 'malformed-container');
		const length = view.getUint16(offset);
		if (length < 2) failMetadata('malformed-container');
		checkedRange(bytes, offset, length, 'malformed-container');
		if (marker === 0xda) return; // Never interpret compressed scan bytes as metadata.
		const body = bytes.subarray(offset + 2, offset + length);
		if (marker === 0xe1 && matchesBytes(body, 0, EXIF_PREFIX)) {
			budget.addBytes(body.length); profile.addExif(body.subarray(EXIF_PREFIX.length));
		} else if (marker === 0xed && matchesBytes(body, 0, PHOTOSHOP_APP13_PREFIX)) {
			budget.addBytes(body.length);
			for (const data of readPhotoshopIptcResources(body, budget)) profile.addIptc(data);
		}
		offset += length;
	}
	failMetadata('malformed-container');
}

function readPng(bytes: Uint8Array, profile: MetadataProfiles): void {
	// PNG third edition: eXIf is a direct TIFF profile; offsets are chunk-relative.
	// https://www.w3.org/TR/png-3/
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const budget = new MetadataBudget();
	let offset = PNG_SIGNATURE.length;
	let first = true;
	while (offset < bytes.length) {
		budget.addRecord();
		checkedRange(bytes, offset, 12, 'malformed-container');
		const length = view.getUint32(offset);
		if (length > 0x7fffffff) failMetadata('malformed-container');
		checkedRange(bytes, offset + 8, length + 4, 'malformed-container');
		const type = bytes.subarray(offset + 4, offset + 8);
		if (!type.every(byte => byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122)) failMetadata('malformed-container');
		if (first && (!matchesBytes(type, 0, [73, 72, 68, 82]) || length !== 13)) failMetadata('malformed-container');
		first = false;
		if (matchesBytes(type, 0, [101, 88, 73, 102])) {
			budget.addBytes(length);
			if (metadataCrc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) {
				failMetadata('malformed-container');
			}
			profile.addExif(bytes.subarray(offset + 8, offset + 8 + length));
		}
		if (matchesBytes(type, 0, [73, 69, 78, 68])) {
			if (length !== 0 || offset + 12 !== bytes.length) failMetadata('malformed-container');
			return;
		}
		offset += length + 12;
	}
	failMetadata('malformed-container');
}
