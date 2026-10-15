/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../../common/editor/image-import-admission.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../../common/editor/storage/media-content-digest.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../catalog/photo-document-current-v1.ts';
import { capturePhotoManagedImportPortsCurrentV1, type PhotoManagedImportPortsCurrentV1 } from '../managed-import-ports-current-v1.ts';
import type { CatalogOriginalReferenceV1 } from '../../../common/editor/storage/media-catalog-original-schema.ts';
import type { PhotoCatalogPackInputCurrentV1 } from '../../archive/catalog-pack-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../../catalog/catalog-root.ts';
import { normalizePhotoDocumentV1OrV2 } from '../../catalog/photo-document-v2.ts';
import { validatePhotoCatalogReferencesV1 } from '../../catalog/photo-document.ts';
import { id } from '../../catalog/value-validation.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1, type PhotoImportIntentV1 } from '../import-intent-v1.ts';
import { checkManagedImportSignalV2 as check, settlePhotoImportRootsForProfileV1, verifyManagedImportResourcesForProfileV1 } from '../import-root-settlement-kernel-v2.ts';
import { capturePhotoManagedImportPortsV2, type PhotoManagedImportOptionsV1, type PhotoManagedImportPortsV2, type PhotoManagedImportReceiptV1 } from '../managed-import-ports-v2.ts';

export { photoImportIntentKeyV1 } from '../import-intent-v1.ts';
export type { PhotoManagedImportPortsV2, PhotoManagedImportReceiptV1 } from '../managed-import-ports-v2.ts';
type Photo = ReturnType<typeof normalizePhotoDocumentCurrentV1>;
type Profile = 'legacy2' | 'current3';
type Ports = PhotoManagedImportPortsV2 | PhotoManagedImportPortsCurrentV1;
function normalizePhoto(profile: Profile, value: unknown): Photo { return profile === 'legacy2' ? normalizePhotoDocumentV1OrV2(value) : normalizePhotoDocumentCurrentV1(value); }
function assertProfile(profile: unknown): asserts profile is Profile { if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed managed photo publication profile.'); }
const SIGNAL_PROTO = AbortSignal.prototype;

/** Current managed publication keeps Preparation1, Intent1, Root1 and receipt1
 * exact. Full mixed recipes and selected resources enter the owning boundary;
 * no original/source fact is reconstructed through a legacy placeholder. */
export async function importManagedPhotosForProfileV1(profile: Profile, catalogId: string,
	photos: Iterable<PhotoCatalogPackInputCurrentV1> | AsyncIterable<PhotoCatalogPackInputCurrentV1>,
	portsValue: Ports, options: PhotoManagedImportOptionsV1 = {}): Promise<readonly PhotoManagedImportReceiptV1[]> {
	assertProfile(profile); const catalog = id(catalogId, 'catalog ID'), request = admitOptions(options);
	check(request.signal); const ports = profile === 'legacy2' ? capturePhotoManagedImportPortsV2(portsValue as PhotoManagedImportPortsV2) : capturePhotoManagedImportPortsCurrentV1(portsValue as PhotoManagedImportPortsCurrentV1);
	check(request.signal);
	return ports.exclusive!(catalog, async signal => {
		await recoverIntent(profile, catalog, ports, signal); await loadCatalog(catalog, ports, signal);
		const intent = normalizePhotoImportIntentV1({ schemaVersion: 1, kind: 'photo-import', catalogId: catalog, importId: ports.createImportId!() }, catalog);
		check(signal);
		if (!await ports.journal.putIfAbsent(photoImportIntentKeyV1(catalog), intent)) throw new Error('Another photo import intent is active.');
		const results: PhotoManagedImportReceiptV1[] = []; let totalBytes = 0;
		for await (const value of photos) {
			check(signal);
			if (results.length >= IMAGE_IMPORT_LIMITS.maximumFilesPerGesture) throw new RangeError('Photo publication exceeds its gesture file bound.');
			let candidate: Photo | undefined, reusedOriginal = false, acknowledged: PhotoManagedImportReceiptV1 | null = null;
			const acknowledge = () => {
				if (acknowledged || !candidate) return;
				acknowledged = receipt(results.length, candidate.id, reusedOriginal);
				try { request.onPublished?.(acknowledged); } catch { /* Observers cannot veto native publication. */ }
			};
			try {
				const input = readClosedDomainRecord(value, 'managed photo input', ['photo', 'original']);
				const document = normalizePhoto(profile, readClosedDomainField(input, 'photo', 'managed photo input'));
				if (document.catalogId !== catalog || document.revision !== 0) throw new RangeError('Managed import requires an initial photo in the selected catalog.');
				validatePhotoCatalogReferencesV1(document, await loadCatalog(catalog, ports, signal));
				const existing = await ports.catalog.loadPhoto(catalog, document.id); check(signal);
				if (existing) throw new RangeError('Photo identity already exists in the selected catalog.');
				const original = canonicalMediaContentBlob(readClosedDomainField(input, 'original', 'managed photo input'));
				totalBytes += original.size;
				if (original.size < 1 || original.size > IMAGE_IMPORT_LIMITS.maximumFileInputBytes
					|| totalBytes > IMAGE_IMPORT_LIMITS.maximumGestureInputBytes || original.size !== document.original.byteLength) throw new RangeError('Managed original exceeds its admitted byte bounds.');
				await verifyManagedImportResourcesForProfileV1(profile, document, ports, signal);
				const retained = await prepareOriginal(profile, document, original, ports, signal);
				candidate = retained.photo; reusedOriginal = retained.reused;
				await ports.media.custody.stage(catalog, intent.importId, [retained.reference], { signal }); check(signal);
				const current = await loadCatalog(catalog, ports, signal);
				await Reflect.apply(ports.catalog.publishPhotos, ports.catalog, [catalog, current.revision, [candidate], { signal }]);
				acknowledge(); check(signal);
				await ports.media.custody.promote(catalog, intent.importId, [candidate.id], { signal });
				results.push(receipt(results.length, candidate.id, reusedOriginal));
			} catch (error) {
				check(signal);
				await settlePhotoImportRootsForProfileV1(profile, intent, ports, signal);
				const value = candidate ? await ports.catalog.loadPhoto(catalog, candidate.id) : null;
				check(signal);
				const stored = value === null ? null : normalizePhoto(profile, value);
				check(signal);
				if (stored && candidate && (profile === 'current3' ? JSON.stringify(stored) === JSON.stringify(candidate) : sameImportIdentity(stored, candidate))) { acknowledge(); results.push(receipt(results.length, candidate.id, reusedOriginal)); }
				else results.push(Object.freeze({ index: results.length, photoId: candidate?.id ?? null, status: 'failed', reusedOriginal, message: failureMessage(error) }));
			}
		}
		check(signal); await settlePhotoImportRootsForProfileV1(profile, intent, ports, signal); await retireIntent(intent, ports);
		return Object.freeze(results);
	}, request.signal);
}

export async function recoverManagedPhotoImportForProfileV1(profile: Profile, catalogId: string, portsValue: Ports,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<void> {
	assertProfile(profile); const catalog = id(catalogId, 'catalog ID'), request = admitOptions(options);
	check(request.signal); const ports = profile === 'legacy2' ? capturePhotoManagedImportPortsV2(portsValue as PhotoManagedImportPortsV2) : capturePhotoManagedImportPortsCurrentV1(portsValue as PhotoManagedImportPortsCurrentV1);
	check(request.signal);
	await ports.exclusive!(catalog, signal => recoverIntent(profile, catalog, ports, signal), request.signal);
}

function admitOptions(value: unknown): PhotoManagedImportOptionsV1 {
	const input = readClosedDomainRecord(value, 'managed import options', ['signal', 'onPublished'], []);
	const signal = Object.hasOwn(input, 'signal') ? readClosedDomainField(input, 'signal', 'managed import options') as AbortSignal | undefined : undefined;
	check(signal);
	if (signal !== undefined && (Object.getPrototypeOf(signal) !== SIGNAL_PROTO
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key)))) {
		throw new TypeError('Managed import requires native signal behavior without overrides.');
	}
	const observer = Object.hasOwn(input, 'onPublished') ? readClosedDomainField(input, 'onPublished', 'managed import options') : undefined;
	if (observer !== undefined && typeof observer !== 'function') throw new TypeError('Managed import requires a publication observer function.');
	return Object.freeze({ signal, onPublished: observer as PhotoManagedImportOptionsV1['onPublished'] });
}
async function loadCatalog(catalogId: string, ports: Ports, signal?: AbortSignal) {
	const value = await ports.catalog.loadCatalog(catalogId);
	check(signal);
	if (value === null) throw new ReferenceError('Photo catalog is missing.');
	const root = normalizePhotoCatalogRootV1(value);
	check(signal);
	if (root.id !== catalogId) throw new RangeError('Photo import catalog identity differs from the selected catalog.');
	return root;
}
async function recoverIntent(profile: Profile, catalogId: string, ports: Ports, signal?: AbortSignal): Promise<void> {
	check(signal); const value = await ports.journal.get(photoImportIntentKeyV1(catalogId));
	check(signal);
	if (value === undefined) return;
	const intent = normalizePhotoImportIntentV1(value, catalogId);
	check(signal);
	await settlePhotoImportRootsForProfileV1(profile, intent, ports, signal); check(signal); await retireIntent(intent, ports);
}
async function retireIntent(intent: PhotoImportIntentV1, ports: Ports): Promise<void> {
	if (!await ports.journal.deleteIfCurrent(photoImportIntentKeyV1(intent.catalogId), intent)) throw new Error('The photo import intent changed before retirement.');
}
async function prepareOriginal(profile: Profile, photo: Photo, original: Blob, ports: Ports, signal?: AbortSignal): Promise<Readonly<{
	photo: Photo; reused: boolean; reference: CatalogOriginalReferenceV1 }>> {
	const sha256 = await digestMediaContent(original, { signal }); check(signal);
	if (sha256 !== photo.original.contentSha256) throw new Error('Selected photo original digest differs from its verified preparation.');
	let afterAssetId: string | null = null, assetId: string | null;
	do {
		check(signal); const page = await ports.media.custody.findDigestPage(photo.original.contentSha256, afterAssetId, { signal });
		check(signal);
		assetId = page.matches.find(match => match.size === original.size)?.assetId ?? null; afterAssetId = page.afterAssetId;
	} while (assetId === null && afterAssetId !== null);
	const reused = assetId !== null;
	if (assetId === null) {
		assetId = photo.original.storageKey;
		const stored = await ports.media.writeAsset(assetId, original, { name: photo.original.name, mimeType: photo.original.mimeType }, { signal });
		check(signal);
		if (stored.sha256 !== photo.original.contentSha256 || stored.size !== original.size) throw new Error('Stored photo original differs from its verified preparation.');
	}
	const reference: CatalogOriginalReferenceV1 = { photoId: photo.id, sourceId: photo.original.id, assetId, sha256: photo.original.contentSha256, size: original.size };
	return Object.freeze({ reused, reference, photo: normalizePhoto(profile, { ...photo, original: { ...photo.original, storageKey: assetId } }) });
}
function sameImportIdentity(stored: Photo, candidate: Photo): boolean {
	return stored.catalogId === candidate.catalogId && stored.id === candidate.id
		&& JSON.stringify(stored.original) === JSON.stringify(candidate.original)
		&& JSON.stringify(stored.extractedMetadata) === JSON.stringify(candidate.extractedMetadata);
}
function receipt(index: number, photoId: string, reusedOriginal: boolean): PhotoManagedImportReceiptV1 {
	return Object.freeze({ index, photoId, status: 'imported', reusedOriginal, message: null });
}
function failureMessage(error: unknown): string {
	try {
		const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message') : undefined;
		return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value.slice(0, 2_048) : 'Photo import failed.';
	} catch { return 'Photo import failed.'; }
}
