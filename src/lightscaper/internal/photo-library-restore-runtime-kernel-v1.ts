/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import type { PhotoLibraryRestoreRuntimeV1, PhotoLibraryRestoreReceiptV1 } from '../../common/editor/photo-library-restore-port-v1.ts';
import { name } from '../catalog/value-validation.ts';
import { restorePhotoLibraryArchiveForProfileV1 } from '../controller/internal/photo-library-archive-restore-kernel-v1.ts';
import { assertPhotoCatalogRestoreProfileV1, type PhotoCatalogRestoreProfileV1 } from '../catalog/internal/photo-catalog-restore-records-kernel-v1.ts';
import { PhotoMediaStoreV1 } from '../storage/photo-media-store.ts';
import { assertMediaRestoreSignalV1, checkMediaRestoreSignalV1, forwardMediaRestoreSignalV1 } from '../storage/photo-media-restore-signal-v1.ts';

const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;

export interface PhotoLibraryRestoreRuntimeOptionsV2 {
	readonly name: string;
	readonly indexedDB?: IDBFactory;
	readonly locks?: Pick<LockManager, 'request'> | null;
}

/** Current archive admission with the unchanged scalar restore port. The
 * fixed anchor and one admitted demand retire only after native settlement. */
export function createPhotoLibraryRestoreRuntimeForProfileV1(profile: PhotoCatalogRestoreProfileV1, options: PhotoLibraryRestoreRuntimeOptionsV2): PhotoLibraryRestoreRuntimeV1 {
	assertPhotoCatalogRestoreProfileV1(profile);
	const input = readClosedDomainRecord(options, 'photo library restore runtime', ['name', 'indexedDB', 'locks'], ['name']);
	const field = (key: string) => readClosedDomainField(input, key, 'photo library restore runtime');
	const catalogName = name(field('name'), 'catalog name');
	const factory = (Object.hasOwn(input, 'indexedDB') ? field('indexedDB') : globalThis.indexedDB) as IDBFactory;
	if (!factory) throw new TypeError('Restore requires durable IndexedDB.');
	const open = factory.open, remove = factory.deleteDatabase;
	if (typeof open !== 'function' || typeof remove !== 'function') throw new TypeError('Restore requires durable IndexedDB.');
	const native = Object.freeze({ open: pin(open, factory), deleteDatabase: pin(remove, factory) }) as IDBFactory;
	const port = (Object.hasOwn(input, 'locks') ? field('locks') : globalThis.navigator?.locks ?? null) as Pick<LockManager, 'request'> | null;
	const request = port?.request;
	if (port && typeof request !== 'function') throw new TypeError('Restore requires a callable native lock capability.');
	const locks = port && request ? Object.freeze({ request: pin(request, port) }) as LockManager : null;
	const anchor = new PhotoMediaStoreV1({ indexedDB: native, locks, preferOpfs: false });
	let active: Promise<Readonly<PhotoLibraryRestoreReceiptV1>> | null = null;
	let cancellation: ReturnType<typeof forwardMediaRestoreSignalV1> | null = null;
	let closing: Promise<void> | null = null, retired = false;
	return Object.freeze<PhotoLibraryRestoreRuntimeV1>({
		restoreArchive(blob, value = {}) {
			if (retired) return Promise.reject(new Error('Photo library restore runtime is closed.'));
			if (active) return Promise.reject(new Error('A photo library restore is pending.'));
			let accept!: (receipt: Readonly<PhotoLibraryRestoreReceiptV1> | PromiseLike<Readonly<PhotoLibraryRestoreReceiptV1>>) => void;
			let refuse!: (failure: unknown) => void;
			const work = new Promise<Readonly<PhotoLibraryRestoreReceiptV1>>((resolve, reject) => { accept = resolve; refuse = reject; });
			active = work; void work.then(finish, finish);
			try {
				Reflect.apply(BLOB_SIZE, blob, []);
				const options = readClosedDomainRecord(value, 'photo library restore demand', ['signal'], []);
				const signal = (Object.hasOwn(options, 'signal') ? readClosedDomainField(options, 'signal', 'photo library restore demand') : undefined) as AbortSignal | undefined;
				if (signal !== undefined) assertMediaRestoreSignalV1(signal);
				const stop = forwardMediaRestoreSignalV1(signal); cancellation = stop;
				// Close can reenter option reflection before the private stop exists.
				if (retired) stop.abort();
				accept((async () => {
					checkMediaRestoreSignalV1(stop.signal); await anchor.ready(); checkMediaRestoreSignalV1(stop.signal);
					return restorePhotoLibraryArchiveForProfileV1(profile, blob, { name: catalogName, indexedDB: native, locks, settings: anchor.settingsRepository, signal: stop.signal });
				})());
			} catch (error) { refuse(error); }
			return work;
		},
		close() {
			if (closing) return closing;
			retired = true;
			let resolve!: () => void, reject!: (error: unknown) => void;
			closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
			cancellation?.abort();
			void (async () => { await active?.catch(() => undefined); await anchor.close(); })().then(resolve, reject);
			return closing;
		},
	});
	function finish(): void { cancellation?.detach(); cancellation = null; active = null; }
}
function pin<Method extends (...args: never[]) => unknown>(method: Method, receiver: unknown): Method {
	return ((...args: unknown[]) => Reflect.apply(method, receiver, args)) as unknown as Method;
}
