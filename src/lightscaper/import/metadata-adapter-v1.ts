/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord, type ClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { admitImageImportGesture, IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { normalizeImageMetadataV1 } from '../../common/editor/imaging/image-metadata-normalizer-v1.ts';
import type { ImageMetadataV1 } from '../../common/editor/imaging/image-metadata-model-v1.ts';
import { emptyPhotoMetadataV1, normalizePhotoMetadataV1 } from '../catalog/photo-metadata.ts';
import { name } from '../catalog/value-validation.ts';
import type { PhotoMetadataV1 } from '../catalog/types.ts';

export interface PhotoImportMappingNoticeV1 {
	readonly field: keyof PhotoMetadataV1 | 'headline' | 'keywords';
	readonly reason: 'display-bound' | 'alternate-fact' | 'repeated-values' | 'partial-time' | 'precision';
}

export interface PhotoImportMetadataV1 {
	readonly metadata: PhotoMetadataV1;
	/** Persist beside authored metadata and the immutable original, never inside its bytes. */
	readonly extractedMetadata: Readonly<ImageMetadataV1>;
	/** Exact declared order/repetitions. Catalog hierarchy resolution is a separate operation. */
	readonly keywordNames: readonly string[];
	readonly notices: readonly Readonly<PhotoImportMappingNoticeV1>[];
}

/** This adapter prepares facts only; it neither reads/writes originals nor publishes photos. */
export function adaptPhotoImportMetadataV1(value: unknown): Readonly<PhotoImportMetadataV1> {
	const input = request(value);
	admitImageImportGesture({ fileByteLengths: [field(input, 'byteLength')] });
	return adapt(input);
}

/** Admit the whole bounded batch before any individual result is produced. */
export function adaptPhotoImportMetadataBatchV1(value: unknown): readonly Readonly<PhotoImportMetadataV1>[] {
	const inputs = readClosedDomainArray(value, 'photo import files', 1, IMAGE_IMPORT_LIMITS.maximumFilesPerGesture).map(request);
	admitImageImportGesture({ fileByteLengths: inputs.map(input => field(input, 'byteLength')) });
	return Object.freeze(inputs.map(adapt));
}

function request(value: unknown): ClosedDomainRecord {
	return readClosedDomainRecord(value, 'photo import metadata', ['fileName', 'modifiedTime', 'byteLength', 'extractedMetadata']);
}

function field(input: ClosedDomainRecord, key: string): unknown { return readClosedDomainField(input, key, 'photo import metadata'); }

function adapt(input: ClosedDomainRecord): Readonly<PhotoImportMetadataV1> {
	const extractedMetadata = normalizeImageMetadataV1(field(input, 'extractedMetadata'));
	const exif = extractedMetadata.exif, iptc = extractedMetadata.iptc;
	let metadata = normalizePhotoMetadataV1({ ...emptyPhotoMetadataV1(name(field(input, 'fileName'), 'photo filename')),
		modifiedTime: field(input, 'modifiedTime') });
	const notices: Readonly<PhotoImportMappingNoticeV1>[] = [];
	const notice = (field: PhotoImportMappingNoticeV1['field'], reason: PhotoImportMappingNoticeV1['reason']) => {
		notices.push(Object.freeze({ field, reason }));
	};
	const assign = (field: keyof PhotoMetadataV1, value: unknown) => {
		try { metadata = normalizePhotoMetadataV1({ ...metadata, [field]: value }); }
		catch (error) {
			if (!(error instanceof TypeError) && !(error instanceof RangeError)) throw error;
			notice(field, 'display-bound');
		}
	};
	if (exif) {
		assign('orientation', exif.orientation ?? 1);
		assign('cameraMake', exif.cameraMake); assign('cameraModel', exif.cameraModel); assign('lens', exif.lensModel);
		assign('exposureSeconds', exif.exposureSeconds); assign('aperture', exif.aperture);
		assign('iso', exif.iso); assign('focalLengthMm', exif.focalLengthMm);
	}
	assign('title', iptc?.objectName ?? iptc?.headline ?? '');
	assign('caption', iptc?.caption ?? exif?.description ?? '');
	assign('copyright', iptc?.copyright ?? exif?.copyright ?? '');
	assign('creator', iptc?.creators.length ? iptc.creators.join('; ') : exif?.artist ?? '');
	if (iptc) {
		assign('location', [iptc.sublocation, iptc.city, iptc.state, iptc.country].filter(value => value !== null).join(', '));
		if (iptc.creators.length > 1) notice('creator', 'repeated-values');
		if (iptc.objectName !== null && iptc.headline !== null) notice('headline', 'alternate-fact');
		if (exif) {
			if (iptc.caption !== null && exif.description !== null && iptc.caption !== exif.description) notice('caption', 'alternate-fact');
			if (iptc.copyright !== null && exif.copyright !== null && iptc.copyright !== exif.copyright) notice('copyright', 'alternate-fact');
			if (iptc.creators.length > 0 && exif.artist !== null && iptc.creators.join('; ') !== exif.artist) notice('creator', 'alternate-fact');
		}
	}
	if (exif?.captureTime) {
		if (iptc && (iptc.captureDate !== null || iptc.captureTime !== null)) notice('captureTime', 'alternate-fact');
		const time = exif.captureTime;
		if (time.subsecond !== null && time.subsecond.length > 3) notice('captureTime', 'precision');
		else assign('captureTime', { local: time.local + (time.subsecond === null ? '' : `.${time.subsecond}`), offsetMinutes: time.offsetMinutes });
	} else {
		if (exif?.captureTimeRaw !== null && exif?.captureTimeRaw !== undefined) notice('captureTime', 'partial-time');
		if (iptc?.captureDate !== null && iptc?.captureDate !== undefined || iptc?.captureTime !== null && iptc?.captureTime !== undefined) {
			const date = iptc?.captureDate, time = iptc?.captureTime;
			if (!date || !time || date.slice(0, 4) === '0000' || date.slice(4, 6) === '00' || date.slice(6) === '00') {
				notice('captureTime', 'partial-time');
			} else {
				const absolute = Number(time.slice(7, 9)) * 60 + Number(time.slice(9, 11));
				assign('captureTime', { local: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`,
					offsetMinutes: time[6] === '-' && absolute !== 0 ? -absolute : absolute });
			}
		}
	}
	const keywordNames = Object.freeze([...(iptc?.keywords ?? [])]);
	for (const keyword of keywordNames) {
		try { name(keyword, 'imported keyword'); }
		catch (error) {
			if (!(error instanceof TypeError)) throw error;
			notice('keywords', 'display-bound'); break;
		}
	}
	return Object.freeze({ metadata, extractedMetadata, keywordNames, notices: Object.freeze(notices) });
}
