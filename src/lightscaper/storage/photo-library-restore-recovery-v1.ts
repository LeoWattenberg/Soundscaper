/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyValueRepository } from '../../common/editor/storage/key-value-repository.ts';
import { inspectPhotoCatalogRestoreNamespaceV1 } from '../catalog/photo-catalog-restore-owner-v1.ts';
import { inspectPhotoMediaRestoreNamespaceV1 } from './photo-media-restore-namespace-v1.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from './photo-library-catalog-pointer.ts';
import { readPhotoLibraryLocationPointerV2 } from './photo-library-location-v2.ts';
import { withPhotoLibraryRestoreLockV1, withPhotoLibraryNamespaceLocksV1,
	withPhotoLibraryInitializationLockV1 } from './photo-library-namespace-lock-v1.ts';
import { normalizePhotoLibraryRestoreJournalV1, photoLibraryRestoreCommitV1, classifyPhotoLibraryRestoreCommitV1,
	photoLibraryRestoreCommitKeyV1, PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1,
	type PhotoLibraryRestoreReadyReceiptV1, type PhotoLibraryRestoreJournalV1 } from './photo-library-restore-journal-v1.ts';
import { photoLibraryRestoreNamespacesV1, type PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';

/** Trusted host ports. Point ownership alone never authorizes recovered deletion. */
export interface PhotoLibraryRestoreRecoveryNamespacePortV1 {
	inspect(databaseName: string, allocation: Readonly<PhotoLibraryRestoreAllocationV1>, signal?: AbortSignal): Promise<'absent' | 'owned' | 'foreign'>;
	remove(databaseName: string, allocation: Readonly<PhotoLibraryRestoreAllocationV1>): Promise<void>;
}
export interface PhotoLibraryRestoreRecoveryOptionsV1 {
	readonly settings: Readonly<Pick<KeyValueRepository, 'get' | 'deleteIfCurrent'>>;
	readonly locks: Pick<LockManager, 'request'> | null;
	readonly indexedDB?: IDBFactory;
	readonly namespaces?: Readonly<PhotoLibraryRestoreRecoveryNamespacePortV1>;
	readonly signal?: AbortSignal;
}
export type PhotoLibraryRestoreRecoveryResultV1 = Readonly<{
	outcome: 'none' | 'discarded' | 'protected'; errors: readonly unknown[];
}> | Readonly<{
	outcome: 'published'; receipt: Readonly<PhotoLibraryRestoreReadyReceiptV1>; errors: readonly unknown[];
}>;

/**
 * Cooperative recovery: journal + matching creation markers + absent permanent history + inactive
 * pointer, under all namespace leases, prove an unpublished candidate. Any history protects forever.
 * Raw writers bypassing these leases can still change a database between separate native requests.
 */
export async function recoverPhotoLibraryRestoreV1(options: PhotoLibraryRestoreRecoveryOptionsV1): Promise<PhotoLibraryRestoreRecoveryResultV1> {
	const settings = options.settings, read = settings.get.bind(settings), retire = settings.deleteIfCurrent.bind(settings);
	const locks = options.locks ? Object.freeze({ request: options.locks.request.bind(options.locks) }) : null;
	const signal = options.signal;
	const port = options.namespaces ?? nativeNamespaces(options.indexedDB ?? globalThis.indexedDB);
	const inspect = port.inspect.bind(port), remove = port.remove.bind(port);
	return withPhotoLibraryRestoreLockV1(locks, async restore => {
		const rawJournal = await read(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1); restore.assertActive();
		if (rawJournal === undefined) return result('none');
		let journal: Readonly<PhotoLibraryRestoreJournalV1>;
		try { journal = normalizePhotoLibraryRestoreJournalV1(rawJournal); }
		catch (error) { return result('protected', [error]); }
		const allocation = journal.allocation, names = photoLibraryRestoreNamespacesV1(allocation);
		const key = photoLibraryRestoreCommitKeyV1(allocation.namespaceToken);
		const published = async (history: unknown): Promise<PhotoLibraryRestoreRecoveryResultV1> => {
			if (journal.phase !== 'ready' || classifyPhotoLibraryRestoreCommitV1(history, photoLibraryRestoreCommitV1(journal)) !== 'matching') return result('protected');
			const errors: unknown[] = [];
			try { if (!await retire(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, rawJournal)) errors.push(new Error('Restore journal changed after publication.')); }
			catch (error) { errors.push(error); }
			// Reconciled permanent publication wins later cancellation or journal cleanup failure.
			return Object.freeze({ outcome: 'published', receipt: journal.candidateReceipt!, errors: Object.freeze(errors) });
		};
		let history: unknown;
		try { history = await read(key); }
		catch (error) { return result('protected', [error]); }
		if (history !== undefined) return published(history);
		restore.assertActive();
		const databaseNames = [names.catalogDatabaseName, names.mediaDatabaseName];
		return withPhotoLibraryNamespaceLocksV1(locks, databaseNames, async candidate => {
			const states: Array<'absent' | 'owned' | 'foreign'> = [];
			for (const name of databaseNames) states.push(await inspect(name, allocation, candidate.signal));
			candidate.assertActive(); restore.assertActive();
			if (states.includes('foreign')) return result('protected');
			return withPhotoLibraryInitializationLockV1(locks, async initialization => {
				try { history = await read(key); }
				catch (error) { return result('protected', [error]); }
				if (history !== undefined) return published(history);
				let pointer;
				try { pointer = readPhotoLibraryLocationPointerV2(await read(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1)); }
				catch (error) { return result('protected', [error]); }
				if (pointer.schemaVersion === 2 && pointer.namespaceToken === allocation.namespaceToken) return result('protected');
				const assertHeld = () => { restore.assertActive(); candidate.assertActive(); initialization.assertActive(); };
				for (const name of databaseNames) {
					assertHeld();
					const state = await inspect(name, allocation, candidate.signal); assertHeld();
					if (state === 'foreign') return result('protected');
					if (state === 'owned') await remove(name, allocation);
				}
				assertHeld();
				return await retire(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, rawJournal) ? result('discarded') : result('protected');
			}, candidate.signal);
		}, restore.signal);
	}, signal);
}

function result(outcome: 'none' | 'discarded' | 'protected', errors: readonly unknown[] = []): PhotoLibraryRestoreRecoveryResultV1 {
	return Object.freeze({ outcome, errors: Object.freeze([...errors]) });
}

function nativeNamespaces(indexedDB: IDBFactory): Readonly<PhotoLibraryRestoreRecoveryNamespacePortV1> {
	if (!indexedDB || typeof indexedDB.open !== 'function' || typeof indexedDB.deleteDatabase !== 'function') {
		throw new TypeError('Restore recovery requires durable IndexedDB.');
	}
	const open = indexedDB.open.bind(indexedDB), remove = indexedDB.deleteDatabase.bind(indexedDB);
	const factory = Object.freeze({ open, deleteDatabase: remove }) as unknown as IDBFactory;
	const component = (name: string, allocation: Readonly<PhotoLibraryRestoreAllocationV1>) => {
		const names = photoLibraryRestoreNamespacesV1(allocation);
		if (name === names.catalogDatabaseName) return 'catalog';
		if (name === names.mediaDatabaseName) return 'media';
		throw new TypeError('Recovery cannot address a namespace outside its allocation.');
	};
	return Object.freeze({
		inspect(name: string, allocation: Readonly<PhotoLibraryRestoreAllocationV1>, signal?: AbortSignal) {
			return component(name, allocation) === 'catalog' ? inspectPhotoCatalogRestoreNamespaceV1({ indexedDB: factory, allocation, signal })
				: inspectPhotoMediaRestoreNamespaceV1({ indexedDB: factory, allocation, signal });
		},
		async remove(name: string, allocation: Readonly<PhotoLibraryRestoreAllocationV1>) {
			component(name, allocation);
			await new Promise<void>((resolve, reject) => {
				const deletion = remove(name);
				deletion.onsuccess = () => { resolve(); };
				deletion.onerror = () => { reject(deletion.error ?? new Error('Restore namespace deletion failed.')); };
				// Blocked native deletion is joined through its terminal event while every lease remains held.
			});
		},
	});
}
