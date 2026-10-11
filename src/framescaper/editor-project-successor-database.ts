/* SPDX-License-Identifier: AGPL-3.0-only */
import { editorProjectStorageProfileNames } from '../common/editor/storage/project-storage-profile.ts';
import { assertFramescaperSuccessorLine, FRAMESCAPER_SUCCESSOR_STORAGE_PROFILE } from './editor-project-successor.ts';

/** Append link custody to the successor journal; the current family-v1 database is never opened. */
export function openFramescaperSuccessorDatabase(indexedDB: IDBFactory, line: unknown): Promise<IDBDatabase> {
	assertFramescaperSuccessorLine(line);
	return new Promise((resolve, reject) => {
		const opening = indexedDB.open(editorProjectStorageProfileNames(FRAMESCAPER_SUCCESSOR_STORAGE_PROFILE).databaseName, 5);
		let settled = false;
		opening.onupgradeneeded = () => {
			const database = opening.result;
			for (const name of ['pending', 'projects', 'portableArchives']) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' });
			if (!database.objectStoreNames.contains('archiveBodies')) database.createObjectStore('archiveBodies', { keyPath: 'token' });
			if (!database.objectStoreNames.contains('archiveStages')) database.createObjectStore('archiveStages', { keyPath: 'key' });
			if (!database.objectStoreNames.contains('archiveChunks')) { const chunks = database.createObjectStore('archiveChunks', { keyPath: 'key' }); chunks.createIndex('token', 'token', { unique: false }); }
			if (!database.objectStoreNames.contains('owners')) database.createObjectStore('owners', { keyPath: 'id' });
			if (!database.objectStoreNames.contains('linkRevisions')) database.createObjectStore('linkRevisions', { keyPath: 'key' });
			if (!database.objectStoreNames.contains('linkStates')) {
				const states = database.createObjectStore('linkStates', { keyPath: 'key' }); states.createIndex('ownerProjectId', 'ownerProjectId', { unique: false });
			}
			if (!database.objectStoreNames.contains('assets')) database.createObjectStore('assets', { keyPath: 'key' });
			if (!database.objectStoreNames.contains('chunks')) {
				const chunks = database.createObjectStore('chunks', { keyPath: 'key' }); chunks.createIndex('token', 'token', { unique: false });
			}
			if (!database.objectStoreNames.contains('staging')) database.createObjectStore('staging', { keyPath: 'key' });
		};
		opening.onsuccess = () => {
			if (settled) { opening.result.close(); return; }
			settled = true; opening.result.onversionchange = () => opening.result.close(); resolve(opening.result);
		};
		opening.onerror = () => { if (!settled) { settled = true; reject(opening.error ?? new Error('Framescaper successor storage could not open.')); } };
		opening.onblocked = () => { if (!settled) { settled = true; reject(new Error('Close other Framescaper successor windows to upgrade link storage.')); } };
	});
}
