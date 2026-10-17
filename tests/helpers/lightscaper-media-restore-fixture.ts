/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { createPhotoCatalogRestoreStageV1 } from '../../src/lightscaper/catalog/photo-catalog-restore-stage-v1.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { savedArchiveRootV3 } from './lightscaper-saved-collection-archive-fixture.ts';
import { photoLibraryRestoreNamespacesV1 } from '../../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import type { PhotoDocumentV1 } from '../../src/lightscaper/catalog/types.ts';
import { request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';

export const mediaRestoreAllocation = () => ({ schemaVersion: 1 as const, kind: 'photo-library-restore-allocation' as const,
	operationId: 'a'.repeat(32), namespaceToken: 'a'.repeat(32), ownerToken: 'b'.repeat(32), catalogId: 'catalog-1' });
export const mediaRestoreRoot = (count: number) => savedArchiveRootV3(count);

export function mediaRestoreFixture() {
	const databases = new Map<string, ReturnType<typeof createInstrumentedIndexedDB>>(), deleted: string[] = [], opens: { name: string; version?: number }[] = [];
	const decorated = new WeakSet<object>();
	let observer: ((transaction: IDBTransaction, stores: string | Iterable<string>, mode?: IDBTransactionMode) => void) | null = null;
	const raw = (name: string) => {
		let current = databases.get(name); if (!current) { current = createInstrumentedIndexedDB(); databases.set(name, current); }
		return current;
	};
	const decorateStore = (store: IDBObjectStore): void => {
		const indexes = (store as unknown as { data: { indexes: Map<string, unknown> } }).data.indexes;
		Object.defineProperty(store, 'autoIncrement', { configurable: true, value: false });
		Object.defineProperty(store, 'indexNames', { configurable: true, value: Object.assign([...indexes.keys()], { contains: (key: string) => indexes.has(key) }) });
	};
	const decorateTransaction = (transaction: IDBTransaction): void => {
		if (decorated.has(transaction)) return; decorated.add(transaction);
		const objectStore = transaction.objectStore.bind(transaction);
		transaction.objectStore = name => { const store = objectStore(name); decorateStore(store); return store; };
	};
	const decorateDatabase = (database: IDBDatabase): void => {
		if (decorated.has(database)) return; decorated.add(database);
		Object.defineProperty(database.objectStoreNames, 'length', { get: () => [...database.objectStoreNames].length });
		const transaction = database.transaction.bind(database);
		database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
			const current = transaction(...args); decorateTransaction(current); observer?.(current, args[0], args[1]); return current;
		}) as IDBDatabase['transaction'];
	};
	const factory = { open(name: string, version?: number) {
		opens.push({ name, version }); const opening = raw(name).open(name, version); let current: IDBDatabase | null = null;
		Object.defineProperty(opening, 'result', { configurable: true, set(value: IDBDatabase) { current = value; decorateDatabase(value); }, get() { return current; } });
		return opening;
	}, deleteDatabase(name: string) {
		deleted.push(name); const removal = { onsuccess: null as IDBOpenDBRequest['onsuccess'], onerror: null, onblocked: null, error: null };
		queueMicrotask(() => { databases.delete(name); removal.onsuccess?.call(removal as unknown as IDBOpenDBRequest, new Event('success')); }); return removal;
	} } as unknown as IDBFactory;
	const names = photoLibraryRestoreNamespacesV1(mediaRestoreAllocation());
	return { factory, raw, deleted, opens, names,
		observeTransactions(value: typeof observer) { observer = value; },
		async remove(name: string, store: string, key: string) {
			const opening = factory.open(name), database = await new Promise<IDBDatabase>((resolve, reject) => {
				opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
			});
			try { await transact(database, store, 'readwrite', stores => request(stores[store]!.delete(key))); }
			finally { database.close(); }
		},
		async catalog(photos: readonly PhotoDocumentV1[], finish = true) {
			const stage = await createPhotoCatalogRestoreStageV1({ indexedDB: factory, databaseName: names.catalogDatabaseName,
				root: mediaRestoreRoot(photos.length), savedState: null, restoreAllocation: mediaRestoreAllocation() });
			for (const photo of photos) await stage.writePhoto(photo);
			if (finish) await stage.finish(); return stage;
		} };
}

export function mediaRestorePhoto(index = 1, bytes = new Uint8Array([1, 2, 3]), key = `asset-${index}`): PhotoDocumentV1 {
	const photo = photoArchiveFixture(index).photo;
	return normalizePhotoDocumentV1({ ...photo, original: { ...photo.original, id: `original-${index}`, storageKey: key,
		byteLength: bytes.byteLength, contentSha256: createHash('sha256').update(bytes).digest('hex') } });
}
export async function* mediaRestoreChunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
	for (let offset = 0; offset < bytes.byteLength; offset += 4 * 1024 * 1024) yield bytes.subarray(offset, offset + 4 * 1024 * 1024);
}
