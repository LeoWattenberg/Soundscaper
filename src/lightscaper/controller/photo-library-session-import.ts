/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from '../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import type { PhotoLibraryImportItemV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryImportRequestOptionsV1 } from '../../common/editor/photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryDevelopImportRequestV2 } from '../../common/editor/photo-library-develop-import-port-v2.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { importManagedPhotosV2 } from '../import/managed-import-v2.ts';
import type { PhotoManagedImportPortsV2 } from '../import/managed-import-ports-v2.ts';
import type { PhotoManagedImportReceiptV1 } from '../import/managed-import-ports-v1.ts';
import { preparePhotoImportGestureV1 } from '../import/photo-import-preparation-v1.ts';
import { applyPhotoImportSettingsV1, planPhotoImportSettingsV1 } from '../import/photo-import-settings-v1.ts';
import { borrowPhotoImportDevelopPresetV2 } from '../import/photo-import-develop-preset-v2.ts';
import { resolvePhotoImportKeywordsV1 } from './photo-library-import-keywords-v1.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';

interface Host {
	readonly ports: PhotoLibrarySessionPortsV2;
	readonly managed: PhotoManagedImportPortsV2;
	readonly presetSettings: PhotoLibrarySessionPortsV2['developPresetSettings'];
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly resetReady: () => void;
}
/** Preparation/settings1 precede recipe promotion; final whole records and publication use current admission. */
export function createPhotoLibrarySessionImport(host: Host) {
	const { ports, managed, presetSettings, mutate, resetReady } = host;
	const prepare = ports.prepare ?? preparePhotoImportGestureV1, importPhotos = ports.importPhotos ?? importManagedPhotosV2;
	const createIdentity = ports.createId ?? (() => crypto.randomUUID()), now = ports.now ?? (() => new Date().toISOString());
	return async function importFiles(files: readonly File[], request: PhotoLibraryImportRequestOptionsV1 | PhotoLibraryDevelopImportRequestV2): Promise<readonly PhotoLibraryImportItemV1[]> {
		const selected = readClosedDomainArray(files, 'selected photo files', 1, IMAGE_IMPORT_LIMITS.maximumFilesPerGesture) as readonly File[];
		const captureDevelop = 'developPreset' in request ? borrowPhotoImportDevelopPresetV2(presetSettings, request.developPreset) : undefined;
		return mutate(async (catalogId, signal) => {
			const root = await ports.catalog.loadCatalog(catalogId);
			if (!root) throw new ReferenceError('Photo catalog is missing.');
			const plan = planPhotoImportSettingsV1(selected, root, request.settings);
			const applyDevelop = await captureDevelop?.(catalogId, signal); signal.throwIfAborted();
			const createId = createIdentity;
			const ownership = selected.map(() => ({ photoId: createId(), originalId: createId(), originalStorageKey: createId(), masterVersionId: createId() }));
			const prepared = prepare({ files: selected, ownership, catalog: root,
				createdAt: now(), signal });
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
			const managedPorts = managed;
			// The outer lease owns keyword-definition and photo publication together.
			let receipts: readonly PhotoManagedImportReceiptV1[];
			try {
				receipts = await importPhotos(catalogId, bridge(), {
					...managedPorts, exclusive: async (_id, operation) => operation(signal),
				}, { signal, onPublished: acknowledge });
			} catch (failure) { resetReady(); throw failure; }
			for (const receipt of receipts) acknowledge(receipt);
			const results = [...failed, ...receipts.map(present)].sort((a, b) => a.index - b.index);
			return Object.freeze(results);

			async function* bridge() {
				for await (const outcome of prepared) {
					signal.throwIfAborted();
					if (outcome.outcome === 'failed') {
						failed.push(Object.freeze({ index: outcome.index, fileName: outcome.fileName, photoId: null,
							status: 'failed', reusedOriginal: false, message: errorMessage(outcome.error), hasMetadataNotices: false }));
						continue;
					}
					try {
						const settingsPhoto = request.settings === undefined ? outcome.photo : applyPhotoImportSettingsV1(outcome.photo, plan, outcome.index);
						const preparedPhoto = applyDevelop ? applyDevelop(settingsPhoto) : settingsPhoto;
						const resolved = await resolvePhotoImportKeywordsV1(ports.catalog, catalogId, { ...outcome, photo: preparedPhoto }, createId, signal);
						const photo = normalizePhotoDocumentV1OrV2({ ...preparedPhoto, keywordIds: resolved.ids });
						admitted.push({ index: outcome.index, fileName: outcome.fileName,
							hasMetadataNotices: outcome.notices.length > 0 || (outcome.photo.extractedMetadata?.issues.length ?? 0) > 0 || resolved.notice });
						yield { photo, original: outcome.original };
					} catch (failure) {
						signal.throwIfAborted();
						failed.push(Object.freeze({ index: outcome.index, fileName: outcome.fileName, photoId: null,
							status: 'failed', reusedOriginal: false, message: errorMessage(failure), hasMetadataNotices: true }));
					}
				}
			}
		}, request.signal);
	}
;


}

function errorMessage(error: unknown): string {
	if (!error || typeof error !== 'object') return 'Photo preparation failed.';
	const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value.slice(0, 2_048) : 'Photo preparation failed.';
}
