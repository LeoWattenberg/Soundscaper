/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoMetadataQueryByteFixtureV1, PhotoMetadataQueryByteCaseV1 } from './lightscaper-metadata-query-byte-fixture.ts';
import { encodePhotoOrientationGridJpegFixtureV1 } from './lightscaper-photo-orientation-native-fixture.ts';
import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord } from '../../src/common/editor/closed-domain-value.ts';
import { readImageMetadataV1 } from '../../src/common/editor/imaging/image-metadata-reader-v1.ts';
import { normalizeCatalogOriginalRoot } from '../../src/common/editor/storage/media-catalog-original-schema.ts';
import { validateLightscaperDocumentV1 } from '../../src/lightscaper/catalog/documents.ts';
import { id, name } from '../../src/lightscaper/catalog/value-validation.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { photoImportIntentKeyV1, normalizePhotoImportIntentV1 } from '../../src/lightscaper/import/import-intent-v1.ts';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../../src/lightscaper/storage/photo-library-catalog-pointer.ts';

// Qualification-only budgets: exactly7 source cases, seed<=64KiB, APP<=8KiB,
// each selected JPEG<=96KiB / gesture<=672KiB; one native encode/body read at a
// time. Observer<=7 photos +7 point media rows, facts<=64KiB/photo, return<=4MiB
// UTF8. No authored facts, intended query results, whole inventory or pixels.
const MAXIMUM_PHOTOS = 7;
const MAXIMUM_ORIGINAL_BYTES = 96 * 1_024;
const MAXIMUM_REPORT_BYTES = 4 * 1_024 * 1_024;

export interface PhotoMetadataQuerySelectedSourceV1 {
	readonly caseId: string;
	readonly fileName: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly bytes: readonly number[];
}

interface ObservedMediaAuthorityV1 {
	readonly assetId: string;
	readonly mediaContentToken: string;
	readonly catalogRootCount: number;
	readonly sha256: string;
	readonly size: number;
	readonly storage: string;
}

/** Admit inert wire data before requesting the real browser canvas encoder. */
export function readPhotoMetadataQueryByteFixtureV1(value: unknown): PhotoMetadataQueryByteFixtureV1 {
	const input = readClosedDomainRecord(value, 'metadata fixture', ['schemaVersion', 'cases']);
	if (field(input, 'schemaVersion', 'metadata fixture') !== 1) throw new RangeError('Unsupported metadata fixture schema.');
	const seen = new Set<string>();
	const cases = readClosedDomainArray(field(input, 'cases', 'metadata fixture'), 'metadata cases', MAXIMUM_PHOTOS, MAXIMUM_PHOTOS).map(value => {
		const record = readClosedDomainRecord(value, 'metadata case', ['id', 'fileName', 'appSegments', 'duplicateOf']);
		const caseId = id(field(record, 'id', 'metadata case'), 'metadata case ID');
		if (seen.has(caseId)) throw new RangeError('Metadata case IDs must be unique.');
		const duplicate = field(record, 'duplicateOf', 'metadata case');
		const duplicateOf = duplicate === null ? null : id(duplicate, 'duplicate case ID');
		if (duplicateOf !== null && !seen.has(duplicateOf)) throw new RangeError('Duplicate source must refer to an earlier case.');
		const appSegments = readClosedDomainArray(field(record, 'appSegments', 'metadata case'), 'APP segments', 0, 2).map(readSegment);
		if (appSegments.reduce((size, segment) => size + segment.length, 0) > 8 * 1_024) throw new RangeError('APP segments exceed 8KiB.');
		if (duplicateOf !== null && appSegments.length !== 0) throw new TypeError('Duplicate cases cannot supply replacement metadata.');
		seen.add(caseId);
		return Object.freeze({ id: caseId, fileName: name(field(record, 'fileName', 'metadata case'), 'selected filename'),
			appSegments: Object.freeze(appSegments), duplicateOf });
	});
	const result = Object.freeze({ schemaVersion: 1 as const, cases: Object.freeze(cases) });
	checkBytes(result, 256 * 1_024, 'metadata wire payload');
	return result;
}

/** Encoded bytes, digests and exact duplicates are local to this browser engine. */
export async function createPhotoMetadataQuerySelectedFilesV1(value: unknown): Promise<Readonly<{
	files: readonly File[]; sources: readonly PhotoMetadataQuerySelectedSourceV1[];
}>> {
	const payload = readPhotoMetadataQueryByteFixtureV1(value);
	const seed = (await encodePhotoOrientationGridJpegFixtureV1()).jpeg;
	const cache = new Map<string, Uint8Array>();
	try {
		if (seed.length > 64 * 1_024 || seed[0] !== 0xff || seed[1] !== 0xd8) throw new RangeError('Native seed exceeds its JPEG/64KiB boundary.');
		const baseline = readImageMetadataV1(seed);
		if (baseline.exif !== null || baseline.iptc !== null || baseline.issues.length !== 0) throw new Error('The native sRGB seed must be metadata-free.');
		const files: File[] = [], sources: PhotoMetadataQuerySelectedSourceV1[] = [];
		for (const item of payload.cases) {
			const bytes = item.duplicateOf === null ? inject(seed, item) : cache.get(item.duplicateOf);
			if (!bytes || bytes.length > MAXIMUM_ORIGINAL_BYTES) throw new RangeError('Selected JPEG exceeds 96KiB.');
			cache.set(item.id, bytes);
			files.push(new File([bytes.slice()], item.fileName, { type: 'image/jpeg', lastModified: 0 }));
			sources.push(Object.freeze({ caseId: item.id, fileName: item.fileName, byteLength: bytes.length,
				sha256: await hash(bytes), bytes: Object.freeze(Array.from(bytes)) }));
		}
		checkBytes(sources, MAXIMUM_REPORT_BYTES, 'selected source report');
		return Object.freeze({ files: Object.freeze(files), sources: Object.freeze(sources) });
	} finally {
		seed.fill(0); for (const bytes of cache.values()) bytes.fill(0); cache.clear();
	}
}

/** Read-only persisted facts after real Session/menu import; no recovery or seeding. */
export async function observePhotoMetadataQueryLibraryV1(value: readonly string[]) {
	const photoIds = readClosedDomainArray(value, 'observed photo IDs', 0, MAXIMUM_PHOTOS).map(value => id(value, 'observed photo ID'));
	if (new Set(photoIds).size !== photoIds.length) throw new RangeError('Observed photo IDs must be unique.');
	const media = new PhotoMediaStoreV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: media.verifyOriginal });
	let observation: Awaited<ReturnType<typeof inspect>> | undefined, failed = false, failure: unknown;
	try { observation = await inspect(); }
	catch (error) { failed = true; failure = error; }
	const outcomes = await Promise.allSettled([Promise.resolve().then(() => catalog.close()), Promise.resolve().then(() => media.close())]);
	const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected').map(outcome => outcome.reason as unknown);
	if (failures.length) throw new AggregateError(failed ? [failure, ...failures] : failures, 'Metadata observer owner cleanup failed.');
	if (failed) throw failure;
	if (!observation) throw new Error('Metadata observer did not produce its result.');
	return observation;

	async function inspect() {
		await media.ready();
		const pointer = readClosedDomainRecord(await media.settingsRepository.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1),
			'library pointer', ['schemaVersion', 'kind', 'catalogId']);
		if (field(pointer, 'schemaVersion', 'library pointer') !== 1 || field(pointer, 'kind', 'library pointer') !== 'photo-library') throw new TypeError('Unsupported library pointer.');
		const catalogId = id(field(pointer, 'catalogId', 'library pointer'), 'catalog ID');
		const root = validateLightscaperDocumentV1(await catalog.loadCatalog(catalogId));
		if (root.kind !== 'photo-catalog' || root.id !== catalogId || root.photoCount > MAXIMUM_PHOTOS) throw new RangeError('Observation requires this bounded fixture catalog.');
		const active = await media.settingsRepository.get(photoImportIntentKeyV1(catalogId));
		const intent = active === undefined ? null : normalizePhotoImportIntentV1(active, catalogId);
		const permanent = await media.mediaRepository.catalogOriginals.readPage({ catalogId });
		const staged = intent ? await media.mediaRepository.catalogOriginals.readPage({ catalogId, importId: intent.importId }) : null;
		if (permanent.afterKey !== null || staged?.afterKey || permanent.roots.length + (staged?.roots.length ?? 0) > MAXIMUM_PHOTOS) throw new RangeError('Observation exceeds seven custody roots.');
		const roots = [...permanent.roots, ...(staged?.roots ?? [])].map(normalizeCatalogOriginalRoot);
		const photos = [];
		for (const photoId of photoIds) {
			const photo = validateLightscaperDocumentV1(await catalog.loadPhoto(catalogId, photoId));
			if (photo.kind !== 'photo' || photo.catalogId !== catalogId || photo.id !== photoId) throw new TypeError('Observed photo identity differs from its catalog.');
			const facts = { metadata: photo.metadata, extractedMetadata: photo.extractedMetadata };
			checkBytes(facts, 64 * 1_024, 'observed photo facts');
			await media.verifyOriginal(photo.original);
			const body = await media.mediaRepository.loadAsset(photo.original.storageKey, { expectedSize: photo.original.byteLength });
			if (!(body instanceof Blob) || body.size > MAXIMUM_ORIGINAL_BYTES) throw new RangeError('Observed original exceeds 96KiB.');
			const bytes = new Uint8Array(await body.arrayBuffer());
			try {
				const actualSha256 = await hash(bytes);
				photos.push({ id: photo.id, revision: photo.revision, ...facts,
					original: { id: photo.original.id, name: photo.original.name, storageKey: photo.original.storageKey,
						mimeType: photo.original.mimeType, sha256: photo.original.contentSha256, byteLength: photo.original.byteLength },
					actualSha256, actualBytes: Array.from(bytes) });
			} finally { bytes.fill(0); }
		}
		const assets = await readAssetAuthority([...new Set(photos.map(photo => photo.original.storageKey))]);
		const result = { catalogId, catalogRevision: root.revision, photoCount: root.photoCount, photos, roots, intent, assets };
		checkBytes(result, MAXIMUM_REPORT_BYTES, 'native metadata observation');
		return result;
	}
}

function readSegment(value: unknown): readonly number[] {
	const bytes = readClosedDomainArray(value, 'APP bytes', 4, 8 * 1_024).map(value => {
		if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) throw new TypeError('APP bytes must be octets.');
		return value;
	});
	if (bytes[0] !== 0xff || (bytes[1] !== 0xe1 && bytes[1] !== 0xed) || bytes[2]! * 256 + bytes[3]! !== bytes.length - 2) throw new TypeError('Metadata requires a complete APP1/APP13 segment.');
	return Object.freeze(bytes);
}

function inject(seed: Uint8Array, item: PhotoMetadataQueryByteCaseV1): Uint8Array {
	const length = seed.length + item.appSegments.reduce((size, segment) => size + segment.length, 0);
	const bytes = new Uint8Array(length); bytes.set(seed.subarray(0, 2)); let position = 2;
	for (const segment of item.appSegments) { bytes.set(segment, position); position += segment.length; }
	bytes.set(seed.subarray(2), position); return bytes;
}

async function hash(bytes: Uint8Array): Promise<string> {
	const input = bytes.slice();
	try {
		const digest = await crypto.subtle.digest('SHA-256', input);
		return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
	} finally { input.fill(0); }
}
function checkBytes(value: unknown, maximum: number, label: string): void {
	if (new TextEncoder().encode(JSON.stringify(value)).length > maximum) throw new RangeError(`${label} exceeds its UTF8 byte bound.`);
}

async function readAssetAuthority(assetIds: readonly string[]): Promise<readonly ObservedMediaAuthorityV1[]> {
	if (assetIds.length > MAXIMUM_PHOTOS) throw new RangeError('Observation exceeds seven media point reads.');
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open(PHOTO_MEDIA_NAMESPACES_V1.databaseName);
		opening.onupgradeneeded = () => { opening.transaction?.abort(); };
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
	});
	try {
		return await new Promise<readonly ObservedMediaAuthorityV1[]>((resolve, reject) => {
			const transaction = database.transaction('mediaAssets', 'readonly');
			const rows: ObservedMediaAuthorityV1[] = [];
			let failure: unknown;
			transaction.oncomplete = () => { resolve(rows); }; transaction.onabort = () => { reject(failure ?? transaction.error); };
			for (const assetId of assetIds) {
				const request = transaction.objectStore('mediaAssets').get(assetId);
				request.onsuccess = () => {
					try {
						const row = request.result as Record<string, unknown> | undefined;
						if (!row || row.sourceId !== assetId || typeof row.mediaContentToken !== 'string' || !/^media-content-[a-z0-9-]+$/u.test(row.mediaContentToken)
							|| typeof row.catalogRootCount !== 'number' || !Number.isSafeInteger(row.catalogRootCount) || row.catalogRootCount < 1 || row.catalogRootCount > MAXIMUM_PHOTOS
							|| typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sha256)
							|| typeof row.size !== 'number' || !Number.isSafeInteger(row.size) || row.size < 1 || row.size > MAXIMUM_ORIGINAL_BYTES
							|| typeof row.storage !== 'string') throw new TypeError('Observed media authority is malformed.');
						rows.push({ assetId, mediaContentToken: row.mediaContentToken, catalogRootCount: row.catalogRootCount, sha256: row.sha256, size: row.size, storage: row.storage });
					} catch (error) { failure = error; transaction.abort(); }
				};
			}
		});
	} finally { database.close(); }
}
