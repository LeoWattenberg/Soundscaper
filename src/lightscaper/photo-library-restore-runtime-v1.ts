/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import type { PhotoLibraryRestoreRuntimeV1, PhotoLibraryRestoreReceiptV1 } from '../common/editor/photo-library-restore-port-v1.ts';
import { name } from './catalog/value-validation.ts';
import { restorePhotoLibraryArchiveV1 } from './controller/photo-library-archive-restore-v1.ts';
import { PhotoMediaStoreV1 } from './storage/photo-media-store.ts';
import { assertMediaRestoreSignalV1, checkMediaRestoreSignalV1, forwardMediaRestoreSignalV1 } from './storage/photo-media-restore-signal-v1.ts';

export interface PhotoLibraryRestoreRuntimeOptionsV1 {
	readonly name: string;
	readonly indexedDB?: IDBFactory;
	readonly locks?: Pick<LockManager, 'request'> | null;
}

/** Inert app-lifetime owner. Close cancels admission, joins native work, then closes its fixed anchor. */
export function createPhotoLibraryRestoreRuntimeV1(options: PhotoLibraryRestoreRuntimeOptionsV1): PhotoLibraryRestoreRuntimeV1 {
	const input = readClosedDomainRecord(options, 'photo library restore runtime', ['name', 'indexedDB', 'locks'], ['name']);
	const field = (key: string) => readClosedDomainField(input, key, 'photo library restore runtime');
	const catalogName = name(field('name'), 'catalog name');
	const factory = (Object.hasOwn(input, 'indexedDB') ? field('indexedDB') : globalThis.indexedDB) as IDBFactory;
	if (!factory || typeof factory.open !== 'function' || typeof factory.deleteDatabase !== 'function') throw new TypeError('Restore requires durable IndexedDB.');
	const native = Object.freeze({ open: factory.open.bind(factory), deleteDatabase: factory.deleteDatabase.bind(factory) }) as IDBFactory;
	const port = (Object.hasOwn(input, 'locks') ? field('locks') : globalThis.navigator?.locks ?? null) as Pick<LockManager, 'request'> | null;
	const locks = port ? Object.freeze({ request: port.request.bind(port) }) as LockManager : null;
	const anchor = new PhotoMediaStoreV1({ indexedDB: native, locks, preferOpfs: false });
	let active: Promise<Readonly<PhotoLibraryRestoreReceiptV1>> | null = null;
	let cancellation: ReturnType<typeof forwardMediaRestoreSignalV1> | null = null;
	let closing: Promise<void> | null = null, retired = false;
	return Object.freeze<PhotoLibraryRestoreRuntimeV1>({
		restoreArchive(blob, value = {}) {
			if (retired) return Promise.reject(new Error('Photo library restore runtime is closed.'));
			if (active) return Promise.reject(new Error('A photo library restore is pending.'));
			// Register admission before reflecting caller options or invoking borrowed/native callbacks.
			let accept!: (receipt: Readonly<PhotoLibraryRestoreReceiptV1> | PromiseLike<Readonly<PhotoLibraryRestoreReceiptV1>>) => void;
			let refuse!: (failure: unknown) => void;
			const work = new Promise<Readonly<PhotoLibraryRestoreReceiptV1>>((resolve, reject) => { accept = resolve; refuse = reject; });
			active = work;
			void work.then(() => finish(), () => finish());
			try {
				if (!(blob instanceof Blob)) throw new TypeError('Library restore requires a backup file.');
				const options = readClosedDomainRecord(value, 'photo library restore demand', ['signal'], []);
				const signal = (Object.hasOwn(options, 'signal') ? readClosedDomainField(options, 'signal', 'photo library restore demand') : undefined) as AbortSignal | undefined;
				if (signal !== undefined) assertMediaRestoreSignalV1(signal);
				const stop = forwardMediaRestoreSignalV1(signal); cancellation = stop;
				// Reflection may reenter Close before the private stop exists; it still owns this demand.
				if (retired) stop.abort();
				accept((async () => {
					checkMediaRestoreSignalV1(stop.signal); await anchor.ready(); checkMediaRestoreSignalV1(stop.signal);
					return restorePhotoLibraryArchiveV1(blob, { name: catalogName, indexedDB: native, locks, settings: anchor.settingsRepository, signal: stop.signal });
				})());
			} catch (error) { refuse(error); }
			return work;
		},
		close() {
			if (closing) return closing;
			retired = true; cancellation?.abort();
			closing = (async () => { await active?.catch(() => undefined); await anchor.close(); })();
			return closing;
		},
	});
	function finish(): void { cancellation?.detach(); cancellation = null; active = null; }
}
