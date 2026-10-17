/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import type { PhotoLibraryHdrMergeRequestCurrentV1, PhotoLibraryHdrMergeSelectionCurrentV1, PhotoLibraryHdrMergeSourceCurrentV1 } from '../../../common/editor/photo-library-hdr-merge-port-current-v1.ts';
import type { ImageHdrMergeRequestCurrentV1 } from '../../../common/editor/controller/shared/image-hdr-merge-current-v1.ts';
import { prepareImageHdrMergeV1, IMAGE_HDR_INPUT_LIMITS_V1 } from '../../../common/editor/imaging/image-hdr-merge-contract-v1.ts';
import { IMAGE_HDR_ORIGINAL_LIMITS_V1, IMAGE_HDR_ORIGINAL_MIME_TYPE_V1 } from '../../../common/editor/imaging/image-hdr-original-profile-v1.ts';
import { planPixelFrameV1 } from '../../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../../catalog/photo-document-current-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../../catalog/repository-types.ts';
import { capturePhotoDerivedPublicationGuardCurrentV1 } from '../../catalog/photo-derived-publication-current-v1.ts';
import { id, integer, name, number, oneOf } from '../../catalog/value-validation.ts';

export function captureHdrPhotoIdsCurrentV1(value: unknown): readonly string[] {
	const input = record(value, 'HDR selection', ['schemaVersion', 'photoIds']);
	version(input); return ids(field(input, 'photoIds', 'HDR selection'));
}
export function captureHdrPhotoMergeCurrentV1(value: unknown): Readonly<PhotoLibraryHdrMergeRequestCurrentV1> {
	const input = record(value, 'HDR Photo merge', ['schemaVersion', 'inputs', 'referenceIndex', 'alignment', 'deghost', 'fileName']); version(input);
	const inputs = array(field(input, 'inputs', 'HDR Photo merge'), 'HDR selected inputs', 2, 9).map(value => {
		const input = record(value, 'HDR selected source', ['photoId', 'expectedRevision', 'exposureMultiplier']);
		return Object.freeze({ photoId: id(field(input, 'photoId', 'HDR selected source'), 'HDR photo ID'),
			expectedRevision: integer(field(input, 'expectedRevision', 'HDR selected source'), 0, Number.MAX_SAFE_INTEGER, 'HDR source revision'),
			exposureMultiplier: number(field(input, 'exposureMultiplier', 'HDR selected source'), 1 / 65536, 65536, 'HDR exposure multiplier') });
	});
	unique(inputs.map(input => input.photoId));
	const referenceIndex = integer(field(input, 'referenceIndex', 'HDR Photo merge'), 0, inputs.length - 1, 'HDR reference index');
	if (inputs[referenceIndex]!.exposureMultiplier !== 1) throw new RangeError('HDR reference exposure must explicitly equal one.');
	const ghost = record(field(input, 'deghost', 'HDR Photo merge'), 'HDR deghost', ['mode', 'threshold']);
	const fileName = name(field(input, 'fileName', 'HDR Photo merge'), 'HDR result filename');
	if (/[\\/]/u.test(fileName) || fileName === '.' || fileName === '..') throw new RangeError('HDR result requires a filename without a path.');
	return Object.freeze({ schemaVersion: 1, inputs: Object.freeze(inputs), referenceIndex, fileName,
		alignment: oneOf(field(input, 'alignment', 'HDR Photo merge'), ['none', 'ward-mtb-v1'] as const, 'HDR alignment'),
		deghost: Object.freeze({ mode: oneOf(field(ghost, 'mode', 'HDR deghost'), ['off', 'reference-v1'] as const, 'HDR deghost mode'),
			threshold: number(field(ghost, 'threshold', 'HDR deghost'), 0, 1, 'HDR deghost threshold') }) });
}

export function describeHdrPhotoSourceCurrentV1(photo: PhotoDocumentCurrentV1): Readonly<PhotoLibraryHdrMergeSourceCurrentV1> {
	const original = photo.original;
	if (original.byteLength > IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumInputOriginalBytes || original.mimeType === IMAGE_HDR_ORIGINAL_MIME_TYPE_V1) {
		throw new RangeError('HDR merge inputs require canonical raster or RAW-word Originals within 64MiB.');
	}
	if (original.hasAlpha) throw new RangeError('HDR merge inputs require opaque Originals.');
	const profile = original.mimeType === 'image/x-adobe-dng' || original.mimeType === 'image/x-canon-crw' ? 'linear-srgb16' : 'encoded-srgb8';
	planPixelFrameV1({ schemaVersion: 1, width: original.width, height: original.height,
		sampleFormat: profile === 'linear-srgb16' ? 'unorm16' : 'unorm8', primaries: 'srgb', transfer: profile === 'linear-srgb16' ? 'linear' : 'srgb' }, IMAGE_HDR_INPUT_LIMITS_V1);
	const exif = photo.extractedMetadata?.exif;
	return Object.freeze({ photoId: photo.id, revision: photo.revision, fileName: original.name,
		width: original.width, height: original.height, mimeType: original.mimeType, profile,
		exposureSeconds: exif?.exposureSeconds ?? null, aperture: exif?.aperture ?? null, iso: exif?.iso ?? null });
}

export function hdrPhotoSelectionCurrentV1(catalogId: string, photos: readonly PhotoDocumentCurrentV1[]): Readonly<PhotoLibraryHdrMergeSelectionCurrentV1> {
	const sources = photos.map(describeHdrPhotoSourceCurrentV1), first = sources[0]!;
	if (sources.some(source => source.width !== first.width || source.height !== first.height)) throw new RangeError('HDR inputs require matching oriented extents.');
	let suggestedExposureMultipliers: readonly number[] | null = null;
	if (first.exposureSeconds !== null && first.exposureSeconds > 0 && first.aperture !== null && first.iso !== null
		&& sources.every(source => source.exposureSeconds !== null && source.exposureSeconds > 0 && source.aperture === first.aperture && source.iso === first.iso)) {
		const values = sources.map(source => source.exposureSeconds! / first.exposureSeconds!);
		if (values.every(value => Number.isFinite(value) && value >= 1 / 65536 && value <= 65536)) suggestedExposureMultipliers = Object.freeze(values);
	}
	return Object.freeze({ schemaVersion: 1, catalogId, sources: Object.freeze(sources), suggestedExposureMultipliers });
}

export async function readHdrPhotoSourcesCurrentV1(catalogId: string, photoIds: readonly string[],
	load: (catalogId: string, photoId: string) => Promise<unknown>, check: () => void, revisions?: readonly number[]): Promise<readonly PhotoDocumentCurrentV1[]> {
	const photos: PhotoDocumentCurrentV1[] = [];
	for (const [index, photoId] of photoIds.entries()) {
		check(); const raw = await load(catalogId, photoId); check();
		if (raw === null) throw new ReferenceError('An HDR source Photo is missing.');
		const photo = normalizePhotoDocumentCurrentV1(raw); check();
		if (photo.catalogId !== catalogId || photo.id !== photoId) throw new ReferenceError('An HDR source changed its selected identity.');
		if (revisions && photo.revision !== revisions[index]) throw new PhotoCatalogRevisionConflictError('photo');
		describeHdrPhotoSourceCurrentV1(photo); photos.push(photo);
	}
	hdrPhotoSelectionCurrentV1(catalogId, photos); return Object.freeze(photos);
}

export function prepareHdrPhotoEngineCurrentV1(catalogId: string, photos: readonly PhotoDocumentCurrentV1[],
	request: Readonly<PhotoLibraryHdrMergeRequestCurrentV1>, signal: AbortSignal): Readonly<ImageHdrMergeRequestCurrentV1> {
	const inputs = photos.map((photo, index) => { const source = describeHdrPhotoSourceCurrentV1(photo), original = photo.original;
		return Object.freeze({ product: 'lightscaper' as const, ownerId: catalogId, sourceId: photo.id, revision: photo.revision,
			original: Object.freeze({ fileName: original.name, mimeType: original.mimeType, sha256: original.contentSha256, byteLength: original.byteLength,
				width: original.width, height: original.height }), exposureMultiplier: request.inputs[index]!.exposureMultiplier,
			descriptor: Object.freeze({ schemaVersion: 1 as const, width: original.width, height: original.height,
				sampleFormat: source.profile === 'linear-srgb16' ? 'unorm16' as const : 'unorm8' as const,
				primaries: 'srgb' as const, transfer: source.profile === 'linear-srgb16' ? 'linear' as const : 'srgb' as const }) });
	});
	prepareImageHdrMergeV1({ schemaVersion: 1, inputs: inputs.map(input => ({ descriptor: input.descriptor, exposureMultiplier: input.exposureMultiplier })),
		referenceIndex: request.referenceIndex, alignment: request.alignment, deghost: request.deghost });
	return Object.freeze({ schemaVersion: 1, inputs: Object.freeze(inputs), referenceIndex: request.referenceIndex, alignment: request.alignment, deghost: request.deghost, signal });
}
export function hdrPhotoGuardsCurrentV1(catalogId: string, photos: readonly PhotoDocumentCurrentV1[], resultPhotoId: string) {
	return capturePhotoDerivedPublicationGuardCurrentV1(catalogId, photos.map(photo => ({ photoId: photo.id, revision: photo.revision, original: photo.original })), resultPhotoId).selections;
}
function ids(value: unknown): readonly string[] { const values = array(value, 'HDR selected Photo IDs', 2, 9).map(value => id(value, 'HDR photo ID')); unique(values); return Object.freeze(values); }
function unique(values: readonly string[]): void { if (new Set(values).size !== values.length) throw new RangeError('HDR selected Photos must be unique.'); }
function version(input: Readonly<Record<string, unknown>>): void { if (field(input, 'schemaVersion', 'HDR request') !== 1) throw new RangeError('Unsupported HDR request version.'); }
