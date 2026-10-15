/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryRestoreReceiptV1 } from '../../../common/editor/photo-library-restore-port-v1.ts';
import { readClosedDomainField, readClosedDomainRecord } from '../../../common/editor/closed-domain-value.ts';
import { aggregateScapeErrors } from '../../../common/editor/scape-abort.ts';
import type { ScapeProjectInput, ScapeProjectInputReaderFactories } from '../../../common/editor/scape-project-input.ts';
import { importPhotoCatalogArchiveV7 } from '../../archive/catalog-archive-import-v7.ts';
import { importPhotoCatalogArchiveV8 } from '../../archive/catalog-archive-import-v8.ts';
import type { PhotoCatalogArchiveStageV8 } from '../../archive/catalog-archive-import-kernel.ts';
import { importPhotoCatalogArchiveV6 } from '../../archive/catalog-archive-import-v6.ts';
import { readValidatedPhotoCatalogRootV1 } from '../../catalog/documents.ts';
import { assertPhotoCatalogRestoreProfileV1, normalizePhotoCatalogRestoreDocumentForProfileV1, type PhotoCatalogRestoreProfileV1 } from '../../catalog/internal/photo-catalog-restore-records-kernel-v1.ts';
import { name } from '../../catalog/value-validation.ts';
import { createPhotoCatalogRestoreStageForProfileV1, type PhotoCatalogRestoreStageV2 } from '../../catalog/internal/photo-catalog-restore-stage-kernel-v1.ts';
import { inspectPhotoCatalogRestoreNamespaceV1 } from '../../catalog/photo-catalog-restore-owner-v1.ts';
import type { PhotoMediaSettingsRepositoryV1 } from '../../storage/photo-media-store.ts';
import { createPhotoMediaRestoreCandidateForProfileV1, type PhotoMediaRestoreCandidateV2 } from '../../storage/internal/photo-media-restore-candidate-kernel-v1.ts';
import { inspectPhotoMediaRestoreNamespaceV1 } from '../../storage/photo-media-restore-namespace-v1.ts';
import { normalizePhotoLibraryRestoreAllocationV1, photoLibraryRestoreNamespacesV1,
	type PhotoLibraryRestoreAllocationV1 } from '../../storage/photo-library-restore-ownership-v1.ts';
import { normalizePhotoLibraryRestoreReadyReceiptV1 } from '../../storage/photo-library-restore-journal-v1.ts';
import { PhotoLibraryRestoreJournalOwnerV1 } from '../../storage/photo-library-restore-journal-owner-v1.ts';
import { publishPhotoLibraryRestorePointerV1 } from '../../storage/photo-library-restore-publication-v1.ts';
import { recoverPhotoLibraryRestoreV1 } from '../../storage/photo-library-restore-recovery-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../storage/photo-library-location-reader-v2.ts';
import { initializeDefaultPhotoLibraryPointerV2 } from '../../storage/photo-library-default-initializer-v2.ts';
import { withPhotoLibraryInitializationLockV1, withPhotoLibraryNamespaceLocksV1, withPhotoLibraryRestoreLockV1,
	withPhotoLibraryLegacyCatalogLockV1, type PhotoLibraryWriteAuthorityV1 } from '../../storage/photo-library-namespace-lock-v1.ts';
import { assertMediaRestoreSignalV1, checkMediaRestoreSignalV1, forwardMediaRestoreSignalV1,
	mediaRestoreCancellationV1 } from '../../storage/photo-media-restore-signal-v1.ts';

export interface PhotoLibraryArchiveRestoreOptionsV2 {
	readonly name: string;
	readonly indexedDB: IDBFactory;
	readonly locks: Pick<LockManager, 'request'> | null;
	readonly settings: PhotoMediaSettingsRepositoryV1;
	readonly signal?: AbortSignal;
	/** Trusted host allocation; production uses independent cryptographic UUIDs. */
	readonly allocateToken?: () => string;
	readonly readerFactories?: ScapeProjectInputReaderFactories;
}
const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
const reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const abort = AbortController.prototype.abort;

/** Named V6-or-legacy restore: authenticate originals/LUTs/brush bodies and mixed recipes in fresh private namespaces, then retain the unchanged one native pointer ACK. */
export async function restorePhotoLibraryArchiveForProfileV1(profile: PhotoCatalogRestoreProfileV1, input: ScapeProjectInput,
	options: PhotoLibraryArchiveRestoreOptionsV2): Promise<Readonly<PhotoLibraryRestoreReceiptV1>> {
	assertPhotoCatalogRestoreProfileV1(profile);
	const importArchive: typeof importPhotoCatalogArchiveV8 = profile === 'legacy2' ? importPhotoCatalogArchiveV6 : profile === 'current3' ? importPhotoCatalogArchiveV7 : importPhotoCatalogArchiveV8;
	const value = readClosedDomainRecord(options, 'library archive restore', ['name', 'indexedDB', 'locks', 'settings', 'signal', 'allocateToken', 'readerFactories'],
		['name', 'indexedDB', 'locks', 'settings']);
	const field = (key: string) => readClosedDomainField(value, key, 'library archive restore');
	const catalogName = name(field('name'), 'catalog name'), signal = (Object.hasOwn(value, 'signal') ? field('signal') : undefined) as AbortSignal | undefined;
	if (signal !== undefined) assertMediaRestoreSignalV1(signal);
	const factory = field('indexedDB') as IDBFactory;
	if (!factory || typeof factory.open !== 'function' || typeof factory.deleteDatabase !== 'function') throw new TypeError('Restore requires durable IndexedDB.');
	const open = factory.open, removeDatabase = factory.deleteDatabase;
	const native = Object.freeze({ open: (...args: Parameters<typeof open>) => Reflect.apply(open, factory, args),
		deleteDatabase: (...args: Parameters<typeof removeDatabase>) => Reflect.apply(removeDatabase, factory, args) }) as IDBFactory;
	const lockPort = field('locks') as Pick<LockManager, 'request'> | null;
	const requestLock = lockPort?.request;
	if (lockPort !== null && typeof requestLock !== 'function') throw new TypeError('Restore lock capability is required.');
	const capturedRequest: LockManager['request'] = <Result>(lockName: string, options: LockOptions | LockGrantedCallback<Result>, callback?: LockGrantedCallback<Result>): Promise<Awaited<Result>> =>
		Reflect.apply(requestLock!, lockPort, callback === undefined ? [lockName, options] : [lockName, options, callback]) as Promise<Awaited<Result>>;
	const locks = lockPort ? Object.freeze({ request: capturedRequest }) : null;
	const port = field('settings') as PhotoMediaSettingsRepositoryV1;
	const get = port.get, put = port.put, removeSetting = port.delete, putIfAbsent = port.putIfAbsent, replaceIfCurrent = port.replaceIfCurrent,
		replaceAndPut = port.replaceIfCurrentAndPutIfAbsent, deleteIfCurrent = port.deleteIfCurrent;
	if ([get, put, removeSetting, putIfAbsent, replaceIfCurrent, replaceAndPut, deleteIfCurrent].some(method => typeof method !== 'function')) throw new TypeError('Restore requires complete selected settings capabilities.');
	const settings = Object.freeze({ get: (...args: Parameters<typeof get>) => Reflect.apply(get, port, args),
		put: (...args: Parameters<typeof put>) => Reflect.apply(put, port, args), delete: (...args: Parameters<typeof removeSetting>) => Reflect.apply(removeSetting, port, args),
		putIfAbsent: (...args: Parameters<typeof putIfAbsent>) => Reflect.apply(putIfAbsent, port, args), replaceIfCurrent: (...args: Parameters<typeof replaceIfCurrent>) => Reflect.apply(replaceIfCurrent, port, args),
		replaceIfCurrentAndPutIfAbsent: (...args: Parameters<typeof replaceAndPut>) => Reflect.apply(replaceAndPut, port, args), deleteIfCurrent: (...args: Parameters<typeof deleteIfCurrent>) => Reflect.apply(deleteIfCurrent, port, args) });
	const cryptoPort = globalThis.crypto, uuidMethod = cryptoPort.randomUUID;
	const uuid = () => Reflect.apply(uuidMethod, cryptoPort, []);
	const allocate = (Object.hasOwn(value, 'allocateToken') ? field('allocateToken') : () => uuid().replaceAll('-', '')) as () => string;
	if (typeof allocate !== 'function') throw new TypeError('Restore token allocation must be callable.');
	const readerPort = (Object.hasOwn(value, 'readerFactories') ? field('readerFactories') : undefined) as ScapeProjectInputReaderFactories | undefined;
	const readers = readerPort === undefined ? undefined : Object.freeze({ ...readerPort });
	const stop = forwardMediaRestoreSignalV1(signal), codecStop = new AbortController();
	// Shared archive decoders receive a stable Error; opaque user cancellation stays in this owner.
	const codecAbort = new DOMException('Library restore was cancelled.', 'AbortError');
	const forwardCodec = () => { Reflect.apply(abort, codecStop, [codecAbort]); };
	Reflect.apply(add, stop.signal, ['abort', forwardCodec, { once: true }]);
	let acknowledged: Readonly<PhotoLibraryRestoreReceiptV1> | null = null;
	const cleanupErrors: unknown[] = []; let reconciled = false;
	let codecFailure: Readonly<{ primary: unknown; boundary: Error }> | null = null;
	const throughCodec = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
		try { return await operation(); }
		catch (primary) {
			// Archive cleanup may classify Error objects. Never lend it an opaque native/user failure.
			const boundary = mediaRestoreCancellationV1(primary, stop.signal) ? codecAbort : new Error('Restore candidate operation failed.', { cause: primary });
			codecFailure ??= Object.freeze({ primary, boundary }); throw boundary;
		}
	};
	try {
		checkMediaRestoreSignalV1(stop.signal);
		const recovery = await recoverPhotoLibraryRestoreV1({ settings, indexedDB: native, locks, signal: stop.signal });
		if (recovery.outcome === 'protected') throw new AggregateError(recovery.errors, 'An earlier restore requires recovery before another can start.');
		await withPhotoLibraryRestoreLockV1(locks, async restore => {
			const selected = await withPhotoLibraryInitializationLockV1(locks, initialization => readPhotoLibrarySessionLocationV2({ settings,
				initializeDefault: () => initializeDefaultPhotoLibraryPointerV2({ settings, indexedDB: native, name: catalogName, authority: initialization }),
			}, initialization.signal), restore.signal);
			restore.assertActive();
			const namespaceToken = allocate(), ownerToken = allocate();
			// Resource names depend only on the reserved token. Archived catalog identity is admitted later.
			const reservation = normalizePhotoLibraryRestoreAllocationV1({ schemaVersion: 1, kind: 'photo-library-restore-allocation',
				operationId: namespaceToken, namespaceToken, ownerToken, catalogId: selected.pointer.catalogId });
			if (selected.pointer.schemaVersion === 2 && selected.pointer.namespaceToken === namespaceToken) throw new Error('Restore requires a fresh physical namespace.');
			const names = photoLibraryRestoreNamespacesV1(reservation);
			await withPhotoLibraryNamespaceLocksV1(locks, [names.catalogDatabaseName, names.mediaDatabaseName], async candidate => {
				const assertHeld = () => { restore.assertActive(); candidate.assertActive(); checkMediaRestoreSignalV1(stop.signal); };
				const journal = new PhotoLibraryRestoreJournalOwnerV1(settings, assertHeld);
				let allocation: Readonly<PhotoLibraryRestoreAllocationV1> | null = null;
				let catalog: PhotoCatalogRestoreStageV2 | null = null, media: PhotoMediaRestoreCandidateV2 | null = null;
				let protectedCandidate = false, cleaning: Promise<void> | null = null;
				const close = async (): Promise<boolean> => {
					let clean = true;
					for (const owner of [media, catalog]) {
						try { await owner?.close(); } catch (error) { clean = false; cleanupErrors.push(error); }
					}
					return clean;
				};
				const inspect = async () => allocation === null ? null : [
					await inspectPhotoCatalogRestoreNamespaceV1({ indexedDB: native, allocation, signal: candidate.signal }),
					await inspectPhotoMediaRestoreNamespaceV1({ indexedDB: native, allocation, signal: candidate.signal }),
				];
				const withPrevious = async <Result>(operation: (guard: () => void) => Promise<Result>): Promise<Result> =>
					withPhotoLibraryNamespaceLocksV1(locks, [selected.location.catalogDatabaseName, selected.location.mediaDatabaseName], async previous => {
						const run = (legacy: PhotoLibraryWriteAuthorityV1) => withPhotoLibraryInitializationLockV1(locks, async initialization => {
							const guard = () => { assertHeld(); previous.assertActive(); legacy.assertActive(); initialization.assertActive(); };
							guard(); return operation(guard);
						}, previous.signal);
						return selected.pointer.schemaVersion === 1
							? withPhotoLibraryLegacyCatalogLockV1(locks, selected.pointer.catalogId, run, previous.signal) : run(previous);
					}, candidate.signal);
				const cleanup = (): Promise<void> => {
					if (cleaning) return cleaning;
					cleaning = (async () => {
						const clean = await close();
						if (acknowledged !== null) {
							try { await journal.retire(); } catch (error) { cleanupErrors.push(error); } return;
						}
						if (!clean || protectedCandidate || journal.current === null) return;
						try {
							await withPrevious(async guard => {
								if (!await journal.canDiscard()) return;
								const states = await inspect(); guard(); if (states === null || states.includes('foreign')) return;
								// Factories own only positive fresh creations; unknown partial owners remain journaled.
								if ((states[0] === 'owned' && catalog === null) || (states[1] === 'owned' && media === null)) return;
								await media?.rollback(); guard(); await catalog?.rollback(); guard();
								const after = await inspect(); guard();
								if (after?.every(state => state === 'absent')) await journal.retire();
							});
						} catch (error) {
							// Cancellation retains a recoverable journal; cleanup still joins both resource owners.
							if (!mediaRestoreCancellationV1(error, stop.signal)) cleanupErrors.push(error);
						}
					})(); return cleaning;
				};
				try {
					await importArchive(input, (rootValue, savedState, presetPack, lutResources, maskRasters) => throughCodec(async () => {
						assertHeld(); const root = readValidatedPhotoCatalogRootV1(rootValue);
						allocation = normalizePhotoLibraryRestoreAllocationV1({ ...reservation, catalogId: root.id });
						await journal.stage(allocation, selected.pointer); assertHeld();
						catalog = await createPhotoCatalogRestoreStageForProfileV1(profile, { indexedDB: native, databaseName: names.catalogDatabaseName,
							root, savedState, restoreAllocation: allocation, signal: stop.signal });
						assertHeld(); media = await createPhotoMediaRestoreCandidateForProfileV1(profile, { indexedDB: native, allocation, root, signal: stop.signal,
							developPresets: presetPack === null ? null : { rowSchemaVersion: presetPack.rowSchemaVersion, revision: presetPack.revision, presetCount: presetPack.presetCount }, lutResources, maskRasters });
						const catalogOwner = catalog, mediaOwner = media;
						const photoMethod = catalogOwner.writePhoto, stackMethod = catalogOwner.writeStack, savedMethod = catalogOwner.writeSavedCollection,
							originalMethod = mediaOwner.writeOriginal, presetMethod = mediaOwner.writeDevelopPresets, lutMethod = mediaOwner.writeLut, maskMethod = mediaOwner.writeMaskRaster,
							catalogFinish = catalogOwner.finish, mediaFinish = mediaOwner.finish;
						const writePhoto = (...args: Parameters<typeof photoMethod>) => Reflect.apply(photoMethod, catalogOwner, args),
							writeStack = (...args: Parameters<typeof stackMethod>) => Reflect.apply(stackMethod, catalogOwner, args),
							writeSavedCollection = (...args: Parameters<typeof savedMethod>) => Reflect.apply(savedMethod, catalogOwner, args),
							writeOriginal = (...args: Parameters<typeof originalMethod>) => Reflect.apply(originalMethod, mediaOwner, args),
							writeDevelopPresets = (...args: Parameters<typeof presetMethod>) => Reflect.apply(presetMethod, mediaOwner, args),
							writeLut = (...args: Parameters<typeof lutMethod>) => Reflect.apply(lutMethod, mediaOwner, args),
							writeMaskRaster = (...args: Parameters<typeof maskMethod>) => Reflect.apply(maskMethod, mediaOwner, args),
							finishCatalog = () => Reflect.apply(catalogFinish, catalogOwner, []), finishMedia = () => Reflect.apply(mediaFinish, mediaOwner, []);
						return Object.freeze<PhotoCatalogArchiveStageV8>({
							writePhoto: (value, original) => throughCodec(async () => {
								assertHeld(); const photo = normalizePhotoCatalogRestoreDocumentForProfileV1(profile, value);
								await writeOriginal(photo, original); assertHeld(); await writePhoto(photo);
							}),
							writeStack: value => throughCodec(async () => { assertHeld(); await writeStack(value); }),
							writeSavedCollection: value => throughCodec(async () => { assertHeld(); await writeSavedCollection(value); }),
							writeDevelopPresets: value => throughCodec(async () => { assertHeld(); await writeDevelopPresets(value); }),
							writeLut: (reference, bytes) => throughCodec(async () => { assertHeld(); await writeLut(reference, bytes); }),
							writeMaskRaster: (reference, bytes) => throughCodec(async () => { assertHeld(); await writeMaskRaster(reference, bytes); }),
							publish: () => throughCodec(async () => {
								assertHeld(); const catalogReady = await finishCatalog(); assertHeld();
								const mediaReady = await finishMedia(); assertHeld();
								if (catalogReady.photoCount !== mediaReady.photoCount) throw new Error('Candidate catalog and original counts differ.');
								const receipt = normalizePhotoLibraryRestoreReadyReceiptV1({ schemaVersion: 1, kind: 'photo-library-restore-ready',
									catalogId: root.id, ...names, catalogRevision: catalogReady.catalogRevision, photoCount: catalogReady.photoCount,
									stackCount: catalogReady.stackCount, savedCollectionCount: catalogReady.savedCollectionCount, indexRevision: 0,
									originalCount: mediaReady.originalCount, originalByteLength: mediaReady.originalByteLength }, allocation);
								if (!await close()) throw new Error('Candidate resource cleanup failed before publication.');
								assertHeld(); const readyJournal = await journal.ready(receipt); assertHeld();
								if (!(await inspect())?.every(state => state === 'owned')) throw new Error('Candidate ownership changed before publication.');
								await withPrevious(async guard => {
									const result = await publishPhotoLibraryRestorePointerV1({ settings, journal: readyJournal, admitWrite: guard });
									if (result.outcome !== 'acknowledged') {
										protectedCandidate = result.outcome === 'protected-uncertain';
										throw new AggregateError(result.errors, 'The restored library was not published.');
									}
									reconciled = result.reconciled;
									acknowledged = Object.freeze({ catalogId: root.id, catalogName: root.name, photoCount: receipt.photoCount,
										stackCount: receipt.stackCount, savedCollectionCount: receipt.savedCollectionCount,
										originalCount: receipt.originalCount, originalByteLength: receipt.originalByteLength, notices: Object.freeze([]) });
								});
							}),
							// Failures are retained by this owner; opaque reasons never enter codec cleanup reflection.
							rollback: cleanup,
						});
					}), { signal: codecStop.signal, readerFactories: readers });
				} finally { await cleanup(); }
			}, restore.signal);
		}, stop.signal);
	} catch (error) {
		if (acknowledged !== null) cleanupErrors.push(error);
		else {
			const captured = codecFailure as Readonly<{ primary: unknown; boundary: Error }> | null;
			const primary = captured !== null ? captured.primary : error === codecAbort ? Reflect.apply(reason, stop.signal, []) as unknown : error;
			if (captured !== null && error !== captured.boundary) cleanupErrors.unshift(error);
			throw aggregateScapeErrors(primary, cleanupErrors, 'Library restore and cleanup failed.', { primaryIsAbort: mediaRestoreCancellationV1(primary, stop.signal) });
		}
	} finally {
		Reflect.apply(remove, stop.signal, ['abort', forwardCodec]); stop.detach();
	}
	if (acknowledged === null) throw new Error('Library restore finished without a publication acknowledgement.');
	const notices: PhotoLibraryRestoreReceiptV1['notices'][number][] = [];
	if (reconciled) notices.push('publication-reconciled'); if (cleanupErrors.length) notices.push('cleanup-failed');
	return Object.freeze({ ...(acknowledged as PhotoLibraryRestoreReceiptV1), notices: Object.freeze(notices) });
}
