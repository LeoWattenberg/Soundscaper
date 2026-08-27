/* SPDX-License-Identifier: AGPL-3.0-only */

export const DURABLE_MEDIA_STORAGE_REQUIRED =
	'This browser environment exposes neither OPFS nor working IndexedDB Blob storage, '
	+ 'so it cannot persist an imported A/V source.';

/** Probes the two durable binary backends used by imported browser media. */
export async function hasDurableMediaStorageCapability(runtime = globalThis) {
	if (typeof runtime.navigator?.storage?.getDirectory === 'function') {
		try {
			await runtime.navigator.storage.getDirectory();
			return true;
		} catch {
			// Fall through to the IndexedDB Blob capability probe.
		}
	}
	if (typeof runtime.indexedDB?.open !== 'function') return false;

	const databaseName = `soundscaper-media-storage-capability-${String(Date.now())}`;
	let database = null;
	try {
		database = await new Promise((resolve, reject) => {
			const request = runtime.indexedDB.open(databaseName, 1);
			request.onupgradeneeded = () => request.result.createObjectStore('probe');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const blob = new runtime.Blob([new Uint8Array([0x53, 0x43])]);
		await new Promise((resolve, reject) => {
			const transaction = database.transaction(['probe'], 'readwrite');
			transaction.objectStore('probe').put(blob, 'blob');
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
		const persisted = await new Promise((resolve, reject) => {
			const request = database.transaction(['probe'], 'readonly').objectStore('probe').get('blob');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		return persisted instanceof runtime.Blob
			&& new Uint8Array(await persisted.arrayBuffer()).join(',') === '83,67';
	} catch {
		return false;
	} finally {
		database?.close();
		runtime.indexedDB.deleteDatabase(databaseName);
	}
}
