/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from '../../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../../common/editor/image-import-admission.ts';
import type { PhotoLibraryImportItemV1 } from '../../../common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryImportRequestOptionsV1 } from '../../../common/editor/photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryDevelopImportRequestV2 } from '../../../common/editor/photo-library-develop-import-port-v2.ts';
import type { PhotoLibraryDevelopImportRequestCurrentV1 } from '../../../common/editor/photo-library-develop-import-port-current-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../../catalog/photo-document-v2.ts';
import type { PhotoDocumentV2 } from '../../catalog/photo-document-v2.ts';
import type { PhotoDocumentV1 } from '../../catalog/types.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../catalog/photo-document-current-v1.ts';
import type { PhotoCatalogPackInputV2 } from '../../archive/catalog-pack-v2.ts';
import type { PhotoCatalogPackInputV4 } from '../../archive/catalog-pack-v4.ts';
import { importManagedPhotosV2 } from '../../import/managed-import-v2.ts';
import { importManagedPhotosCurrentV1 } from '../../import/managed-import-current-v1.ts';
import type { PhotoManagedImportPortsV2 } from '../../import/managed-import-ports-v2.ts';
import type { PhotoManagedImportPortsCurrentV1 } from '../../import/managed-import-ports-current-v1.ts';
import type { PhotoManagedImportReceiptV1 } from '../../import/managed-import-ports-v1.ts';
import { preparePhotoImportGestureV1 } from '../../import/photo-import-preparation-v1.ts';
import { preparePhotoImportGestureCurrentV1 } from '../../import/photo-import-preparation-current-v1.ts';
import { applyPhotoImportSettingsV1, planPhotoImportSettingsV1 } from '../../import/photo-import-settings-v1.ts';
import { borrowPhotoImportDevelopPresetV2 } from '../../import/photo-import-develop-preset-v2.ts';
import { borrowPhotoImportDevelopPresetCurrentV1 } from '../../import/photo-import-develop-preset-current-v1.ts';
import { resolvePhotoImportKeywordsV1 } from '../photo-library-import-keywords-v1.ts';
import type { PhotoLibrarySessionPortsV2 } from '../photo-library-session-ports-v2.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from '../photo-library-session-ports-current-v1.ts';

interface Lifetime {
	readonly presetSettings: PhotoLibrarySessionPortsV2['developPresetSettings'];
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly resetReady: () => void;
}
export interface PhotoLibrarySessionImportHostLegacyV2 extends Lifetime {
	readonly ports: PhotoLibrarySessionPortsV2;
	readonly managed: PhotoManagedImportPortsV2;
}
export interface PhotoLibrarySessionImportHostCurrentV1 extends Lifetime {
	readonly ports: PhotoLibrarySessionPortsCurrentV1;
	readonly managed: PhotoManagedImportPortsCurrentV1;
}
type LegacyRequest = PhotoLibraryImportRequestOptionsV1 | PhotoLibraryDevelopImportRequestV2;
type CurrentRequest = PhotoLibraryImportRequestOptionsV1 | PhotoLibraryDevelopImportRequestCurrentV1;
type Import<Request> = (files: readonly File[], request: Request) => Promise<readonly PhotoLibraryImportItemV1[]>;
type Host = PhotoLibrarySessionImportHostLegacyV2 | PhotoLibrarySessionImportHostCurrentV1;
const CHECK = AbortSignal.prototype.throwIfAborted;
const check = (signal: AbortSignal) => { Reflect.apply(CHECK, signal, []); };

export function createPhotoLibrarySessionImportForProfileV1(profile: 'legacy2', host: PhotoLibrarySessionImportHostLegacyV2): Import<LegacyRequest>;
export function createPhotoLibrarySessionImportForProfileV1(profile: 'current3', host: PhotoLibrarySessionImportHostCurrentV1): Import<CurrentRequest>;
export function createPhotoLibrarySessionImportForProfileV1(profile: 'legacy2' | 'current3', host: Host): Import<LegacyRequest | CurrentRequest> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed photo import profile.');
	const { ports, managed, presetSettings, mutate, resetReady } = host;
	const prepare = ports.prepare ?? (profile === 'current3' ? preparePhotoImportGestureCurrentV1 : preparePhotoImportGestureV1), legacyImport = ports.importPhotos ?? importManagedPhotosV2;
	const createIdentity = ports.createId ?? (() => crypto.randomUUID()), now = ports.now ?? (() => new Date().toISOString());
	const luts = profile === 'current3' ? ports.cubeLutResources : undefined, brushes = profile === 'current3' ? ports.maskRasterResources : undefined;
	const resources = Object.freeze({ cubeLutResources: async () => {
		if (!luts) throw new Error('Selected LUT resources are unavailable.');
		return Reflect.apply(luts, ports, []) as ReturnType<NonNullable<typeof luts>>;
	}, maskRasterResources: async () => {
		if (!brushes) throw new Error('Selected brush resources are unavailable.');
		return Reflect.apply(brushes, ports, []) as ReturnType<NonNullable<typeof brushes>>;
	} });
	return async function importFiles(files, request): Promise<readonly PhotoLibraryImportItemV1[]> {
		const selected = readClosedDomainArray(files, 'selected photo files', 1, IMAGE_IMPORT_LIMITS.maximumFilesPerGesture) as readonly File[];
		const captureDevelop = 'developPreset' in request ? profile === 'legacy2'
			? borrowPhotoImportDevelopPresetV2(presetSettings, (request as PhotoLibraryDevelopImportRequestV2).developPreset)
			: borrowPhotoImportDevelopPresetCurrentV1(presetSettings, (request as PhotoLibraryDevelopImportRequestCurrentV1).developPreset, resources) : undefined;
		return mutate(async (catalogId, signal) => {
			const root = await ports.catalog.loadCatalog(catalogId);
			if (!root) throw new ReferenceError('Photo catalog is missing.');
			const plan = planPhotoImportSettingsV1(selected, root, request.settings);
			const applyDevelop = await captureDevelop?.(catalogId, signal); check(signal);
			const createId = createIdentity;
			const ownership = selected.map(() => ({ photoId: createId(), originalId: createId(), originalStorageKey: createId(), masterVersionId: createId() }));
			const prepared = prepare({ files: selected, ownership, catalog: root, createdAt: now(), signal });
			const failed: PhotoLibraryImportItemV1[] = [];
			const admitted: Array<{ index: number; fileName: string; hasMetadataNotices: boolean }> = [];
			const acknowledged = new Set<number>();
			const present = (receipt: PhotoManagedImportReceiptV1) => {
				const selection = admitted[receipt.index];
				if (!selection) throw new Error('Photo publication receipt has no selected-file binding.');
				return Object.freeze({ ...receipt, ...selection });
			};
			const acknowledge = (receipt: PhotoManagedImportReceiptV1) => {
				if (receipt.status !== 'imported' || acknowledged.has(receipt.index)) return;
				const item = present(receipt); acknowledged.add(receipt.index);
				try { request.onAcknowledged?.(item); } catch { /* Publication observers cannot veto durable photos. */ }
			};
			let receipts: readonly PhotoManagedImportReceiptV1[];
			try {
				// Only the named facade chooses admission; both branches borrow this
				// existing outer lease for keyword and native Original publication.
				receipts = profile === 'legacy2'
					? await legacyImport(catalogId, bridge() as AsyncIterable<PhotoCatalogPackInputV2>,
						{ ...managed as PhotoManagedImportPortsV2, exclusive: async (_id, operation) => operation(signal) }, { signal, onPublished: acknowledge })
					: await importManagedPhotosCurrentV1(catalogId, bridge() as AsyncIterable<PhotoCatalogPackInputV4>,
						{ ...managed as PhotoManagedImportPortsCurrentV1, exclusive: async (_id, operation) => operation(signal) }, { signal, onPublished: acknowledge });
			} catch (failure) { resetReady(); throw failure; }
			for (const receipt of receipts) acknowledge(receipt);
			return Object.freeze([...failed, ...receipts.map(present)].sort((a, b) => a.index - b.index));

			async function* bridge() {
				for await (const outcome of prepared) {
					check(signal);
					if (outcome.outcome === 'failed') {
						failed.push(Object.freeze({ index: outcome.index, fileName: outcome.fileName, photoId: null,
							status: 'failed', reusedOriginal: false, message: errorMessage(outcome.error), hasMetadataNotices: false }));
						continue;
					}
					try {
						const settingsPhoto = request.settings === undefined ? outcome.photo : applyPhotoImportSettingsV1(outcome.photo, plan, outcome.index);
						const preparedPhoto = applyDevelop ? profile === 'current3' ? await applyDevelop(settingsPhoto)
							: applyDevelop(settingsPhoto) as PhotoDocumentV1 | PhotoDocumentV2 : settingsPhoto;
						const resolved = await resolvePhotoImportKeywordsV1(ports.catalog, catalogId, { ...outcome, photo: preparedPhoto }, createId, signal);
						const value = { ...preparedPhoto, keywordIds: resolved.ids };
						const photo = profile === 'legacy2' ? normalizePhotoDocumentV1OrV2(value) : normalizePhotoDocumentCurrentV1(value);
						admitted.push({ index: outcome.index, fileName: outcome.fileName,
							hasMetadataNotices: outcome.notices.length > 0 || (outcome.photo.extractedMetadata?.issues.length ?? 0) > 0 || resolved.notice });
						yield { photo, original: outcome.original };
					} catch (failure) {
						check(signal);
						failed.push(Object.freeze({ index: outcome.index, fileName: outcome.fileName, photoId: null,
							status: 'failed', reusedOriginal: false, message: errorMessage(failure), hasMetadataNotices: true }));
					}
				}
			}
		}, request.signal);
	};
}

function errorMessage(error: unknown): string {
	if (!error || typeof error !== 'object') return 'Photo preparation failed.';
	const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value.slice(0, 2_048) : 'Photo preparation failed.';
}
