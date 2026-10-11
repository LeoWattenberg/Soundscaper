/* SPDX-License-Identifier: AGPL-3.0-only */

/** Independent composition storage; version 2 adds storage-only project write fences. */
export function openMotionProjectDatabase(indexedDB: IDBFactory, name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const opening = indexedDB.open(name, 2);
		let settled = false;
		opening.onupgradeneeded = (event) => {
			const database = opening.result;
			if (event.oldVersion < 1) {
				database.createObjectStore('projects', { keyPath: 'id' });
				const revisions = database.createObjectStore('revisions', { keyPath: 'key' });
				revisions.createIndex('projectId', 'projectId', { unique: false });
				database.createObjectStore('assets', { keyPath: 'key' });
				const chunks = database.createObjectStore('chunks', { keyPath: 'key' });
				chunks.createIndex('token', 'token', { unique: false });
				database.createObjectStore('staging', { keyPath: 'key' });
			}
			if (event.oldVersion < 2) database.createObjectStore('writeLeases', { keyPath: 'id' });
		};
		opening.onsuccess = () => {
			if (settled) { opening.result.close(); return; }
			settled = true;
			opening.result.onversionchange = () => opening.result.close();
			resolve(opening.result);
		};
		opening.onerror = () => { if (!settled) { settled = true; reject(opening.error); } };
		opening.onblocked = () => {
			if (!settled) { settled = true; reject(new Error('Close other Motionscaper windows to upgrade project storage.')); }
		};
	});
}
