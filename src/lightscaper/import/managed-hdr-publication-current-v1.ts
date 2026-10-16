/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { IMAGE_HDR_ORIGINAL_LIMITS_V1 as LIMITS, IMAGE_HDR_ORIGINAL_MIME_TYPE_V1 } from '../../common/editor/imaging/image-hdr-original-profile-v1.ts';
import { readImageHdrOriginalV1 } from '../../common/editor/imaging/image-hdr-original-v1.ts';
import { planPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import { defaultPhotoDevelopV1 } from '../catalog/develop-state.ts';
import { capturePhotoDerivedPublicationGuardCurrentV1, type PhotoDerivedPublicationSelectionCurrentV1 } from '../catalog/photo-derived-publication-current-v1.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import type { PhotoCatalogRepositoryCurrentV1 } from '../catalog/photo-catalog-repository-current-v1.ts';
import { id, integer } from '../catalog/value-validation.ts';
import { capturePhotoManagedImportPortsCurrentV1, type PhotoManagedImportPortsCurrentV1 } from './managed-import-ports-current-v1.ts';
import type { PhotoManagedImportOptionsV1, PhotoManagedImportReceiptV1 } from './managed-import-ports-v1.ts';
import { importManagedPhotosForProfileV1 } from './internal/managed-import-kernel-v1.ts';

export interface PhotoManagedHdrPublicationPortsCurrentV1 extends Omit<PhotoManagedImportPortsCurrentV1, 'catalog'> {
	readonly catalog: Pick<PhotoCatalogRepositoryCurrentV1, 'loadCatalog' | 'loadPhoto' | 'publishDerivedPhotoCurrentV1'>;
}
export interface PhotoManagedHdrPublicationAdmissionCurrentV1 {
	readonly catalogId: string;
	readonly selections: readonly Readonly<PhotoDerivedPublicationSelectionCurrentV1>[];
	readonly photo: PhotoDocumentCurrentV1;
	readonly originalByteLength: number;
}
const NativeBytes = Uint8Array, READ = Blob.prototype.arrayBuffer, FILL = NativeBytes.prototype.fill;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const RAW_MIME_TYPES: readonly string[] = ['image/x-adobe-dng', 'image/x-canon-crw'];

/** Scalar admission proves capacity and a fresh default result, never that a
 * large body was decoded, reconstructed or published. The actual body proof
 * below is independent and must complete before journal/media writes. */
export function admitManagedHdrPhotoPublicationCurrentV1(catalogIdValue: unknown, selectionsValue: unknown,
	photoValue: unknown, originalByteLengthValue: unknown): Readonly<PhotoManagedHdrPublicationAdmissionCurrentV1> {
	const catalogId = id(catalogIdValue, 'HDR result catalog'), photo = normalizePhotoDocumentCurrentV1(photoValue);
	const originalByteLength = integer(originalByteLengthValue, 1, LIMITS.maximumEncodedBytes, 'generated HDR Original byte length');
	if (photo.schemaVersion !== 3 || photo.catalogId !== catalogId || photo.revision !== 0) throw new RangeError('Generated HDR publication requires an initial Current Photo3 in the selected catalog.');
	if (photo.original.mimeType !== IMAGE_HDR_ORIGINAL_MIME_TYPE_V1 || photo.original.retention !== 'managed'
		|| photo.original.hasAlpha || photo.original.byteLength !== originalByteLength) throw new RangeError('Generated HDR publication requires its exact opaque managed Original binding.');
	planPixelFrameV1({ schemaVersion: 1, width: photo.original.width, height: photo.original.height,
		sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, { maximumSidePixels: LIMITS.maximumSide,
		maximumPixels: LIMITS.maximumPixels, maximumBytes: LIMITS.maximumDecodedBytes });
	const version = photo.versions[0];
	if (photo.versions.length !== 1 || !version || version.kind !== 'master' || version.id !== photo.activeVersionId
		|| Object.hasOwn(version, 'workspace') || JSON.stringify(version.develop) !== JSON.stringify(defaultPhotoDevelopV1())) {
		throw new RangeError('Generated HDR publication starts with one default master and no copied Develop history.');
	}
	const metadata = photo.metadata;
	if (photo.extractedMetadata !== null || metadata.orientation !== 1 || [metadata.cameraMake, metadata.cameraModel, metadata.lens,
		metadata.exposureSeconds, metadata.aperture, metadata.iso, metadata.focalLengthMm, metadata.captureTime].some(value => value !== null)) {
		throw new RangeError('A generated HDR result cannot claim single-exposure capture facts.');
	}
	const guard = capturePhotoDerivedPublicationGuardCurrentV1(catalogId, selectionsValue, photo.id);
	for (const selection of guard.selections) {
		const original = selection.original;
		if (original.byteLength > LIMITS.maximumInputOriginalBytes || original.mimeType === IMAGE_HDR_ORIGINAL_MIME_TYPE_V1) throw new RangeError('HDR merge sources require canonical byte or RAW-word Originals within 64MiB.');
		planPixelFrameV1({ schemaVersion: 1, width: original.width, height: original.height,
			sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' }, { maximumSidePixels: LIMITS.maximumSide,
			maximumPixels: LIMITS.maximumPixels, maximumBytes: LIMITS.maximumPixels * 8 });
	}
	return Object.freeze({ catalogId, photo, selections: guard.selections, originalByteLength });
}

/** One generated result reuses Intent1, staged roots, native ACK, promotion and
 * recovery. Source guards exist only at insertion, never during recovery of an
 * already committed result. No new queue, writer lease or catalog is owned. */
export async function publishManagedHdrPhotoCurrentV1(catalogIdValue: string,
	selectionsValue: readonly PhotoDerivedPublicationSelectionCurrentV1[], entryValue: unknown,
	ports: PhotoManagedHdrPublicationPortsCurrentV1, options: PhotoManagedImportOptionsV1 = {}): Promise<readonly PhotoManagedImportReceiptV1[]> {
	const ownSignal = typeof options === 'object' && options !== null ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('HDR publication signal requires own data.');
	const signal = captureRepairSignalV1(ownSignal?.value); checkRepairSignalV1(signal);
	const inputOptions = record(options, 'HDR publication options', ['signal', 'onPublished'], []);
	if ((Object.hasOwn(inputOptions, 'signal') ? field(inputOptions, 'signal', 'HDR publication options') : undefined) !== signal) throw new TypeError('HDR publication signal changed during admission.');
	const observer = Object.hasOwn(inputOptions, 'onPublished') ? field(inputOptions, 'onPublished', 'HDR publication options') : undefined;
	if (observer !== undefined && typeof observer !== 'function') throw new TypeError('HDR publication observer must be callable.');
	const publicationObserver = typeof observer === 'function' ? observer : undefined;
	const entry = record(entryValue, 'generated HDR entry', ['photo', 'original']);
	const original = canonicalMediaContentBlob(field(entry, 'original', 'generated HDR entry'));
	const admitted = admitManagedHdrPhotoPublicationCurrentV1(catalogIdValue, selectionsValue, field(entry, 'photo', 'generated HDR entry'), original.size);
	const catalog = ports.catalog, publish = catalog.publishDerivedPhotoCurrentV1, loadCatalog = catalog.loadCatalog, loadPhoto = catalog.loadPhoto;
	const verify = ports.verifyResources, exclusive = ports.exclusive, allocate = ports.createImportId;
	if ([publish, loadCatalog, loadPhoto].some(method => typeof method !== 'function')
		|| [verify, exclusive, allocate].some(method => method !== undefined && typeof method !== 'function')) throw new TypeError('Generated HDR publication requires complete native ownership capabilities.');
	const compatible = capturePhotoManagedImportPortsCurrentV1({
		catalog: { loadCatalog: (...args) => Reflect.apply(loadCatalog, catalog, args) as ReturnType<typeof loadCatalog>,
			loadPhoto: (...args) => Reflect.apply(loadPhoto, catalog, args) as ReturnType<typeof loadPhoto>,
			publishPhotos: (catalogId, expectedRevision, values, publicationOptions) => {
				if (catalogId !== admitted.catalogId || values.length !== 1) throw new RangeError('Generated HDR publication owns exactly one selected result.');
				return Reflect.apply(publish, catalog, [catalogId, expectedRevision, admitted.selections, values[0], publicationOptions]) as ReturnType<typeof publish>;
			} },
		media: ports.media, journal: ports.journal,
		...(verify ? { verifyResources: (...args: Parameters<NonNullable<typeof verify>>) => Reflect.apply(verify, ports, args) as ReturnType<NonNullable<typeof verify>> } : {}),
		...(exclusive ? { exclusive: <Result>(catalogId: string, run: (signal?: AbortSignal) => Promise<Result>, external?: AbortSignal) =>
			Reflect.apply(exclusive, ports, [catalogId, run, external]) as Promise<Result> } : {}),
		...(allocate ? { createImportId: () => Reflect.apply(allocate, ports, []) as string } : {}),
	});
	checkRepairSignalV1(signal);
	await proveBody(admitted, original, signal);
	return importManagedPhotosForProfileV1('current3', admitted.catalogId, [{ photo: admitted.photo, original }], compatible,
		{ ...(signal ? { signal } : {}), ...(publicationObserver ? { onPublished: (receipt: PhotoManagedImportReceiptV1) => { Reflect.apply(publicationObserver, options, [receipt]); } } : {}) }, 'generated-hdr-v1');
}

async function proveBody(admitted: Readonly<PhotoManagedHdrPublicationAdmissionCurrentV1>, body: Blob, signal?: AbortSignal): Promise<void> {
	let backing: ArrayBuffer | undefined, length = 0, primary: { error: unknown } | undefined;
	try {
		const loaded: unknown = await Reflect.apply(READ, body, []);
		length = Number(Reflect.apply(SIZE, loaded, [])); backing = loaded as ArrayBuffer;
		checkRepairSignalV1(signal);
		if (Reflect.apply(RESIZABLE, backing, []) || length !== admitted.originalByteLength) throw new RangeError('Generated HDR body requires exact fixed encoded storage.');
		// Only immutable Blob +one encoded read are held in this proof. Native
		// reconstruction/Float32 planes have already joined before publication.
		if (2n * BigInt(length) + 1024n * 1024n > 512n * 1024n * 1024n) throw new RangeError('Generated HDR body proof exceeds its physical phase budget.');
		const bytes = new NativeBytes(backing);
		if (bytesToHex(sha256(bytes)) !== admitted.photo.original.contentSha256) throw new RangeError('Generated HDR Original SHA-256 disagrees with its body.');
		const parsed = readImageHdrOriginalV1(bytes), provenance = parsed.provenance;
		if (parsed.descriptor.width !== admitted.photo.original.width || parsed.descriptor.height !== admitted.photo.original.height
			|| provenance.inputs.length !== admitted.selections.length) throw new RangeError('Generated HDR body extent/source count differs from publication.');
		for (let index = 0; index < admitted.selections.length; index++) {
			const selection = admitted.selections[index]!, input = provenance.inputs[index]!, original = selection.original, facts = input.original;
			const profile = RAW_MIME_TYPES.includes(original.mimeType) ? 'linear-srgb16' : 'encoded-srgb8';
			if (input.product !== 'lightscaper' || input.ownerId !== admitted.catalogId || input.sourceId !== selection.photoId || input.revision !== selection.revision
				|| input.profile !== profile || facts.fileName !== original.name || facts.mimeType !== original.mimeType || facts.sha256 !== original.contentSha256
				|| facts.byteLength !== original.byteLength || facts.width !== original.width || facts.height !== original.height) throw new RangeError('Generated HDR provenance differs from its captured source selection.');
		}
		checkRepairSignalV1(signal);
	} catch (error) { primary = { error }; }
	const failures: unknown[] = primary ? [primary.error] : [];
	try {
		if (backing) {
			if (Reflect.apply(SIZE, backing, []) !== length) throw new TypeError('Generated HDR encoded proof detached before retirement.');
			Reflect.apply(FILL, new NativeBytes(backing), [0]);
		}
	} catch (error) { if (!failures.some(reason => Object.is(reason, error))) failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Generated HDR body proof and physical retirement failed.', { cause: failures[0] });
}
