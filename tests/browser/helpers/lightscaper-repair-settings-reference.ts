/* SPDX-License-Identifier: AGPL-3.0-only */

import { readRepairExportCustodyNativeV1 } from './lightscaper-repair-export-reference.ts';
import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../../../src/lightscaper/catalog/photo-resource-reachability-current-v1.ts';
import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { photoStorageKey } from '../../../src/lightscaper/catalog/repository-records.ts';
import { readStoredPhotoCurrentV1 } from '../../../src/lightscaper/catalog/photo-catalog-records-current-v1.ts';

/** Poll committed Photo rows without acquiring an Original snapshot handle while
 * the actual preview worker reads it. Full custody is checked separately. */
export async function readRepairSettingsPhotosNativeV1(photoIds: readonly string[]) {
	check(photoIds.length >= 1 && photoIds.length <= 2 && new Set(photoIds).size === photoIds.length, 'Settings fixture needs one or two distinct Photos.');
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, preferOpfs: false, syncWorkerClient: null });
	let database: IDBDatabase | null = null;
	try {
		await anchor.ready(); const selected = await location();
		database = await new Promise<IDBDatabase>((resolve, reject) => {
			const opening = indexedDB.open(selected.location.catalogDatabaseName);
			opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true });
			opening.addEventListener('error', () => reject(opening.error), { once: true });
			opening.addEventListener('success', () => resolve(opening.result), { once: true });
		});
		const photos = await transact(database, ['photos'], 'readonly', async stores => {
			const store = stores.photos; check(store !== undefined, 'Native Current Photo store missing.');
			return await Promise.all(photoIds.map(async photoId => {
				const key = photoStorageKey(selected.location.catalogId, photoId), value: unknown = await request(store.get(key));
				check(value !== undefined, 'Native Current Photo missing.'); return { photo: readStoredPhotoCurrentV1(value, key) };
			}));
		});
		check(JSON.stringify((await location()).pointer) === JSON.stringify(selected.pointer), 'Settings observer namespace changed during Photo reads.');
		return { namespace: selected.location.namespaceToken, photos };
	} finally { database?.close(); await anchor.close(); }
	function location() {
		return withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw Error('Settings observer cannot initialize a library.'); } }));
	}
}

/** Actual complete Current photos/Original custody, then separately authenticated
 * selected brush bytes. This fresh two-photo fixture cannot initialize a library. */
export async function readRepairSettingsCustodyNativeV1(photoIds: readonly string[], beforeClose?: () => Promise<void>) {
	const custody = await readRepairExportCustodyNativeV1(photoIds, beforeClose);
	const collector = createPhotoResourceReachabilityCurrentV1();
	for (const row of custody.photos) collector.addPhoto(row.photo);
	const references = collector.finish().brushes;
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks });
	let media: PhotoMediaStoreV1 | null = null;
	let result: Awaited<ReturnType<typeof read>> | undefined, failed = false, failure: unknown;
	async function read() {
		await anchor.ready(); const selected = await location();
		check(selected.location.namespaceToken === custody.namespace, 'Settings observer selected namespace changed.');
		media = selected.allocation ? new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks,
			databaseName: selected.location.mediaDatabaseName, preferOpfs: false }) : anchor;
		await media.ready(); const resources = await media.getMaskRasterResources();
		const bodies = [];
		for (const reference of references) {
			check(reference.width * reference.height <= 4096, 'Settings fixture brush exceeds its small observer bound.');
			bodies.push(await resources.source.withBytes(reference, bytes => ({ reference, bytes: Array.from(bytes) })));
		}
		check(JSON.stringify((await location()).pointer) === JSON.stringify(selected.pointer), 'Settings observer namespace changed during brush reads.');
		await beforeClose?.(); return { ...custody, bodies };
	}
	function location() {
		return withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw Error('Settings observer cannot initialize a library.'); } }));
	}
	try { result = await read(); } catch (error) { failed = true; failure = error; }
	const closed = await Promise.allSettled([...new Set([media, anchor])].filter(owner => owner !== null).map(owner => owner.close()));
	const errors = closed.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
	if (failed && !errors.length) throw failure;
	if (errors.length) throw new AggregateError(failed ? [failure, ...errors] : errors, 'Settings custody or joined cleanup failed.', failed ? { cause: failure } : undefined);
	check(result !== undefined, 'Settings custody did not complete.'); return result;
}

function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
