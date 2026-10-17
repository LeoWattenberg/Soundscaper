/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import type { PhotoLibraryHdrMergePortCurrentV1, PhotoLibraryHdrMergeRequestCurrentV1, PhotoLibraryHdrMergeResultCurrentV1 } from '../../common/editor/photo-library-hdr-merge-port-current-v1.ts';
import type { PhotoLibraryImportItemV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { withMergedImageHdrOriginalCurrentV1, type ImageHdrMergePortsCurrentV1 } from '../../common/editor/controller/shared/image-hdr-merge-current-v1.ts';
import { withMergedImageHdrPreviewCurrentV1, type ImageHdrMergePreviewCurrentV1 } from '../../common/editor/controller/shared/image-hdr-merge-preview-current-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import type { PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import type { PhotoManagedImportReceiptV1 } from '../import/managed-import-ports-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import type { PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { publishManagedHdrPhotoCurrentV1 } from '../import/managed-hdr-publication-current-v1.ts';
import { createPhotoLibraryDevelopOriginalSessionCurrentV1 } from './photo-library-develop-original-session-current-v1.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from './photo-library-session-ports-current-v1.ts';
import { captureHdrPhotoIdsCurrentV1, captureHdrPhotoMergeCurrentV1, hdrPhotoSelectionCurrentV1, readHdrPhotoSourcesCurrentV1,
	prepareHdrPhotoEngineCurrentV1, hdrPhotoGuardsCurrentV1 } from './internal/photo-library-hdr-merge-capture-current-v1.ts';
import { prepareHdrPhotoResultCurrentV1 } from './internal/photo-library-hdr-merge-result-current-v1.ts';

export interface PhotoLibraryHdrMergeSessionHostCurrentV1 {
	readonly ports: Readonly<PhotoLibrarySessionPortsCurrentV1>;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal, admit?: () => void) => Promise<Result>;
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal, admit?: () => void) => Promise<Result>;
	readonly resetReady: () => void;
}

/** Private canonical readers borrow the accepted outer mutation/operation.
 * Calling the public Session or acquiring its writer again is unnecessary. */
export function createPhotoLibraryHdrMergeSessionCurrentV1(host: PhotoLibraryHdrMergeSessionHostCurrentV1): Readonly<PhotoLibraryHdrMergePortCurrentV1> | undefined {
	const ports = host.ports, catalog = ports.catalog, read = catalog.loadPhoto, publish = catalog.publishDerivedPhotoCurrentV1;
	const backup = ports.backup, loadOriginal = backup?.loadOriginal;
	if (publish === undefined || loadOriginal === undefined) return undefined;
	const originalReader = loadOriginal;
	const operation = host.operation, mutate = host.mutate, ready = host.ready, reset = host.resetReady;
	const allocate = ports.createId ?? (() => crypto.randomUUID()), now = ports.now ?? (() => new Date().toISOString());
	for (const method of [read, publish, loadOriginal, operation, mutate, ready, reset, allocate, now]) if (typeof method !== 'function') throw new TypeError('HDR Session requires complete captured ownership capabilities.');
	const load = (catalogId: string, photoId: string) => Reflect.apply(read, catalog, [catalogId, photoId]) as ReturnType<typeof read>;
	const snapshot = async (catalogId: string, request: Readonly<PhotoLibraryHdrMergeRequestCurrentV1>, signal: AbortSignal) => {
		const photos = await readHdrPhotoSourcesCurrentV1(catalogId, request.inputs.map(input => input.photoId), load,
			() => { checkRepairSignalV1(signal); }, request.inputs.map(input => input.expectedRevision));
		const engine = prepareHdrPhotoEngineCurrentV1(catalogId, photos, request, signal);
		return { photos, engine, enginePorts: canonicalPorts(catalogId, photos, signal) };
	};
	const current = async (catalogId: string, photos: readonly PhotoDocumentCurrentV1[], signal: AbortSignal) => {
		const fresh = await readHdrPhotoSourcesCurrentV1(catalogId, photos.map(photo => photo.id), load,
			() => { checkRepairSignalV1(signal); }, photos.map(photo => photo.revision));
		if (fresh.some((photo, index) => JSON.stringify(photo.original) !== JSON.stringify(photos[index]!.original))) throw new PhotoCatalogRevisionConflictError('photo');
	};
	function canonicalPorts(catalogId: string, photos: readonly PhotoDocumentCurrentV1[], signal: AbortSignal): ImageHdrMergePortsCurrentV1 {
		const byId = new Map(photos.map(photo => [photo.id, photo]));
		const canonical = createPhotoLibraryDevelopOriginalSessionCurrentV1({ repository: { async loadPhoto(ownerId, photoId) {
			checkRepairSignalV1(signal); const raw = await load(ownerId, photoId); checkRepairSignalV1(signal);
			if (raw === null) throw new ReferenceError('An HDR source Photo is missing.');
			const current = normalizePhotoDocumentCurrentV1(raw), captured = byId.get(photoId);
			if (!captured || current.catalogId !== catalogId || ownerId !== catalogId || current.id !== captured.id
				|| current.revision !== captured.revision || JSON.stringify(current.original) !== JSON.stringify(captured.original)) throw new PhotoCatalogRevisionConflictError('photo');
			return current;
		} }, ready: async () => catalogId,
			operation: <Result>(run: (signal: AbortSignal) => Promise<Result>) => run(signal),
			loadOriginal: (original, admitted) => Reflect.apply(originalReader, backup, [original, admitted]) as Promise<unknown> });
		return Object.freeze({ withCanonicalFrame: <Result>(index: number, consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, admitted?: AbortSignal) => {
			const photo = photos[index]; if (!photo) return Promise.reject(new RangeError('HDR source index exceeds its captured selection.'));
			return canonical.withFrame({ schemaVersion: 1, photoId: photo.id, expectedRevision: photo.revision }, view => consume(view.frame), { signal: admitted ?? signal }) as Promise<Result>;
		} });
	}
	return Object.freeze({ schemaVersion: 1 as const,
		async readSelection(value: Parameters<PhotoLibraryHdrMergePortCurrentV1['readSelection']>[0], options: Readonly<{ signal?: AbortSignal }> = {}) {
			const admitted = captureOptions(options, false); let photoIds!: readonly string[];
			return Reflect.apply(operation, host, [async (signal: AbortSignal) => {
				const catalogId = await Reflect.apply(ready, host, []); checkRepairSignalV1(signal);
				const photos = await readHdrPhotoSourcesCurrentV1(catalogId, photoIds, load, () => { checkRepairSignalV1(signal); });
				return hdrPhotoSelectionCurrentV1(catalogId, photos);
			}, admitted.signal, () => { photoIds = captureHdrPhotoIdsCurrentV1(value); }]) as ReturnType<PhotoLibraryHdrMergePortCurrentV1['readSelection']>;
		},
		async withPreview<Result>(value: Readonly<PhotoLibraryHdrMergeRequestCurrentV1>, consume: (view: Readonly<ImageHdrMergePreviewCurrentV1>) => Result | Promise<Result>,
			options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Result> {
			const admitted = captureOptions(options, false); let request!: Readonly<PhotoLibraryHdrMergeRequestCurrentV1>;
			return Reflect.apply(operation, host, [async (signal: AbortSignal) => {
				const catalogId = await Reflect.apply(ready, host, []); checkRepairSignalV1(signal);
				const captured = await snapshot(catalogId, request, signal);
				const result = await withMergedImageHdrPreviewCurrentV1(captured.engine, captured.enginePorts, async view => {
					await current(catalogId, captured.photos, signal); const result = await consume(view);
					checkRepairSignalV1(signal); await current(catalogId, captured.photos, signal); return result;
				});
				await current(catalogId, captured.photos, signal); return result;
			}, admitted.signal, () => {
				if (typeof consume !== 'function') throw new TypeError('HDR preview requires a scoped display consumer.'); request = captureHdrPhotoMergeCurrentV1(value);
			}]) as Promise<Result>;
		},
		async merge(value: Readonly<PhotoLibraryHdrMergeRequestCurrentV1>, options: Parameters<PhotoLibraryHdrMergePortCurrentV1['merge']>[1] = {}) {
			const admitted = captureOptions(options, true); let request!: Readonly<PhotoLibraryHdrMergeRequestCurrentV1>;
			return Reflect.apply(mutate, host, [async (catalogId: string, signal: AbortSignal): Promise<Readonly<PhotoLibraryHdrMergeResultCurrentV1>> => {
				const captured = await snapshot(catalogId, request, signal); checkRepairSignalV1(signal);
				const ownership = { photoId: Reflect.apply(allocate, ports, []) as string, originalId: Reflect.apply(allocate, ports, []) as string,
					storageKey: Reflect.apply(allocate, ports, []) as string, masterVersionId: Reflect.apply(allocate, ports, []) as string };
				const createdAt = Reflect.apply(now, ports, []) as string, selections = hdrPhotoGuardsCurrentV1(catalogId, captured.photos, ownership.photoId);
				try { return await withMergedImageHdrOriginalCurrentV1(captured.engine, captured.enginePorts, async view => {
					// Encoded merge output + immutable result Blob + body proof read are
					// the publication phase; all source/master/staging scopes have ended.
					if (BigInt(view.byteLength) * 3n + 32n * 1024n * 1024n > 1024n * 1024n * 1024n) throw new RangeError('HDR Session publication exceeds its 1 GiB phase bound.');
					const entry = prepareHdrPhotoResultCurrentV1(catalogId, request.fileName, view, ownership, createdAt);
					const present = (receipt: PhotoManagedImportReceiptV1): PhotoLibraryImportItemV1 =>
						Object.freeze({ ...receipt, fileName: request.fileName, hasMetadataNotices: false });
					const receipts = await publishManagedHdrPhotoCurrentV1(catalogId, selections, entry, { catalog: { loadCatalog: catalog.loadCatalog,
						loadPhoto: catalog.loadPhoto, publishDerivedPhotoCurrentV1: (...args) => Reflect.apply(publish, catalog, args) as ReturnType<typeof publish> },
						media: ports.media, journal: ports.journal, ...(ports.verifyResources ? { verifyResources: ports.verifyResources } : {}),
						exclusive: async (_id, run) => run(signal) }, { signal, onPublished: receipt => { admitted.acknowledge?.(present(receipt)); } });
					const receipt = receipts[0]; if (!receipt) throw new Error('HDR publication has no managed result receipt.');
					return Object.freeze({ schemaVersion: 1, receipt: present(receipt), diagnostics: view.diagnostics });
				}); } catch (error) { Reflect.apply(reset, host, []); throw error; }
			}, admitted.signal, () => { request = captureHdrPhotoMergeCurrentV1(value); }]) as ReturnType<PhotoLibraryHdrMergePortCurrentV1['merge']>;
		},
	});
}

function captureOptions(value: unknown, acknowledgement: boolean): Readonly<{ signal?: AbortSignal; acknowledge?: (item: PhotoLibraryImportItemV1) => void }> {
	const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new TypeError('HDR signal requires own data.');
	const signal = captureRepairSignalV1(descriptor?.value); checkRepairSignalV1(signal);
	const input = record(value, 'HDR Session options', acknowledgement ? ['signal', 'onAcknowledged'] : ['signal'], []);
	if ((Object.hasOwn(input, 'signal') ? field(input, 'signal', 'HDR Session options') : undefined) !== signal) throw new TypeError('HDR signal changed during capture.');
	const observer = Object.hasOwn(input, 'onAcknowledged') ? field(input, 'onAcknowledged', 'HDR Session options') : undefined;
	if (observer !== undefined && typeof observer !== 'function') throw new TypeError('HDR acknowledgement observer must be callable.');
	const callback = typeof observer === 'function' ? observer : undefined;
	return Object.freeze({ signal, ...(callback ? { acknowledge: (item: PhotoLibraryImportItemV1) => { Reflect.apply(callback, value, [item]); } } : {}) });
}
