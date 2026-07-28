import { expect, test } from './audio-editor-test-fixtures.js';
import {
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

const DATABASE_NAME = 'kw-media-audio-editor';

test.describe('editor storage schema migration', () => {
	registerAudioEditorHooks();

	test('atomically backfills v2 derivative payloads into Blob-free v3 metadata', async ({ page }) => {
		await page.goto('/logo/logo-schwarz.svg');
		await page.evaluate(async (databaseName) => {
			await new Promise((resolve, reject) => {
				const deletion = indexedDB.deleteDatabase(databaseName);
				deletion.onsuccess = () => resolve();
				deletion.onerror = () => reject(deletion.error);
			});
			await new Promise((resolve, reject) => {
				const openRequest = indexedDB.open(databaseName, 2);
				openRequest.onupgradeneeded = () => {
					openRequest.result.createObjectStore('projects', { keyPath: 'id' }).put({
						id: 'legacy-project',
						sources: [{ id: 'legacy-source' }],
						clips: [{ id: 'legacy-clip', sourceId: 'legacy-source' }],
					});
					const derivatives = openRequest.result.createObjectStore('videoDerivatives', { keyPath: 'key' });
					derivatives.createIndex('sourceId', 'sourceId', { unique: false });
					derivatives.put({
						key: 'legacy-cache',
						sourceId: 'legacy-source',
						timestamp: 3,
						type: 'thumbnail',
						storage: 'indexeddb-blob',
						path: null,
						size: 7,
						committedAt: '2026-07-28T00:00:00.000Z',
						blob: new Blob(['payload']),
						nestedPayload: { blob: new Blob(['hidden']) },
						width: 320,
					});
				};
				openRequest.onsuccess = () => {
					openRequest.result.close();
					resolve();
				};
				openRequest.onerror = () => reject(openRequest.error);
			});
		}, DATABASE_NAME);

		await page.goto('/embed/en/');
		await waitForEditor(page);
		const migration = await page.evaluate(async (databaseName) => new Promise((resolve, reject) => {
			const openRequest = indexedDB.open(databaseName, 3);
			openRequest.onerror = () => reject(openRequest.error);
			openRequest.onsuccess = () => {
				const database = openRequest.result;
				const transaction = database.transaction(
					['videoDerivatives', 'videoDerivativeCacheEntries'],
					'readonly',
				);
				const payloadRequest = transaction.objectStore('videoDerivatives').getAll();
				const entryRequest = transaction.objectStore('videoDerivativeCacheEntries').getAll();
				transaction.oncomplete = () => {
					const [entry] = entryRequest.result;
					resolve({
						version: database.version,
						payloadCount: payloadRequest.result.length,
						entry: entry ? {
							key: entry.key,
							sourceId: entry.sourceId,
							timestamp: entry.timestamp,
							type: entry.type,
							storage: entry.storage,
							path: entry.path,
							size: entry.size,
							committedAt: entry.committedAt,
							cacheToken: entry.cacheToken ?? null,
						} : null,
						entryFields: Object.keys(entry || {}).sort(),
					});
					database.close();
				};
				transaction.onabort = () => reject(transaction.error);
				transaction.onerror = () => reject(transaction.error);
			};
		}), DATABASE_NAME);

		expect(migration).toEqual({
			version: 3,
			payloadCount: 1,
			entry: {
				key: 'legacy-cache',
				sourceId: 'legacy-source',
				timestamp: 3,
				type: 'thumbnail',
				storage: 'indexeddb-blob',
				path: null,
				size: 7,
				committedAt: '2026-07-28T00:00:00.000Z',
				cacheToken: null,
			},
			entryFields: [
				'cacheToken', 'committedAt', 'key', 'path', 'size',
				'sourceId', 'storage', 'timestamp', 'type',
			],
		});
	});
});
