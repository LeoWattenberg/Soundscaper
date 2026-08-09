import { expect, test } from './audio-editor-test-fixtures.js';
import {
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

const DATABASE_NAME = 'kw-media-audio-editor';

test.describe('editor storage schema migration', () => {
	registerAudioEditorHooks();

	test('atomically backfills v2 derivatives, creates v8 stores, and sanitizes v6 provenance', async ({ page }) => {
		await page.route('/__soundscaper-test/storage-migration-setup', (route) => route.fulfill({
			contentType: 'text/html; charset=utf-8',
			body: '<!doctype html><title>Storage migration setup</title>',
		}));
		await page.goto('/__soundscaper-test/storage-migration-setup');
		await page.evaluate(async (databaseName) => {
			const database = await new Promise((resolve, reject) => {
				const openRequest = indexedDB.open(databaseName, 2);
				openRequest.onupgradeneeded = () => {
					openRequest.result.createObjectStore('projects', { keyPath: 'id' });
					const derivatives = openRequest.result.createObjectStore('videoDerivatives', { keyPath: 'key' });
					derivatives.createIndex('sourceId', 'sourceId', { unique: false });
					openRequest.result.createObjectStore('mediaAssets', { keyPath: 'sourceId' });
				};
				openRequest.onsuccess = () => resolve(openRequest.result);
				openRequest.onerror = () => reject(openRequest.error);
			});
			try {
				await new Promise((resolve, reject) => {
					const transaction = database.transaction(
						['projects', 'videoDerivatives', 'mediaAssets'],
						'readwrite',
					);
					transaction.objectStore('projects').put({
						id: 'legacy-project',
						sources: [{ id: 'legacy-source' }],
						clips: [{ id: 'legacy-clip', sourceId: 'legacy-source' }],
					});
					transaction.objectStore('videoDerivatives').put({
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
					transaction.objectStore('mediaAssets').put({
						sourceId: 'legacy-source',
						storage: 'indexeddb-blob',
						blob: new Blob(['legacy-container'], { type: 'video/mp4' }),
						size: 16,
						sha256: '0'.repeat(64),
						mediaContentDigestVersion: 1,
						mediaContentToken: 'media-content-caller-controlled-token-0001',
					});
					transaction.oncomplete = () => resolve();
					transaction.onabort = () => reject(transaction.error);
					transaction.onerror = () => reject(transaction.error);
				});
			} finally {
				database.close();
			}
		}, DATABASE_NAME);

		await page.goto('/embed/en/');
		await waitForEditor(page);
		const migration = await page.evaluate(async (databaseName) => new Promise((resolve, reject) => {
			const openRequest = indexedDB.open(databaseName);
			openRequest.onerror = () => reject(openRequest.error);
			openRequest.onsuccess = () => {
				const database = openRequest.result;
				const transaction = database.transaction(
					[
						'sources', 'videoDerivatives', 'videoDerivativeCacheEntries',
						'mediaAssets', 'mediaAssetChunks', 'mediaAssetStaging',
						'linkedVideoOriginalBindings', 'linkedOriginalProvisionalRoots',
					],
					'readonly',
				);
				const payloadRequest = transaction.objectStore('videoDerivatives').getAll();
				const entryRequest = transaction.objectStore('videoDerivativeCacheEntries').getAll();
				const mediaChunkStore = transaction.objectStore('mediaAssetChunks');
				const mediaAssetStore = transaction.objectStore('mediaAssets');
				const mediaStagingStore = transaction.objectStore('mediaAssetStaging');
				const linkedVideoOriginalStore = transaction.objectStore('linkedVideoOriginalBindings');
				const linkedOriginalProvisionalRootStore = transaction.objectStore('linkedOriginalProvisionalRoots');
				const sourceStore = transaction.objectStore('sources');
				const derivativeStore = transaction.objectStore('videoDerivatives');
				const derivativeEntryStore = transaction.objectStore('videoDerivativeCacheEntries');
				const mediaChunkCountRequest = mediaChunkStore.count();
				const mediaAssetRequest = mediaAssetStore.get('legacy-source');
				const mediaStagingStateRequest = mediaStagingStore.get('state');
				const linkedVideoOriginalCountRequest = linkedVideoOriginalStore.count();
				const linkedOriginalProvisionalRootCountRequest = linkedOriginalProvisionalRootStore.count();
				const mediaStagingKeyPath = mediaStagingStore.keyPath;
				const mediaStagingIndexes = [...mediaStagingStore.indexNames]
					.map((name) => ({ name, unique: mediaStagingStore.index(name).unique }))
					.sort((left, right) => left.name.localeCompare(right.name));
				const linkedVideoOriginalIndexes = [...linkedVideoOriginalStore.indexNames]
					.map((name) => ({ name, unique: linkedVideoOriginalStore.index(name).unique }))
					.sort((left, right) => left.name.localeCompare(right.name));
				const linkedOriginalProvisionalRootIndexes = [...linkedOriginalProvisionalRootStore.indexNames]
					.map((name) => ({ name, unique: linkedOriginalProvisionalRootStore.index(name).unique }))
					.sort((left, right) => left.name.localeCompare(right.name));
				transaction.oncomplete = () => {
					const [entry] = entryRequest.result;
					resolve({
						version: database.version,
						payloadCount: payloadRequest.result.length,
						mediaChunkCount: mediaChunkCountRequest.result,
						mediaChunkIndexes: [...mediaChunkStore.indexNames],
						mediaAssetIndexes: [...mediaAssetStore.indexNames],
						mediaAssetFields: Object.keys(mediaAssetRequest.result || {}).sort(),
						mediaStagingKeyPath,
						mediaStagingIndexes,
						mediaStagingState: mediaStagingStateRequest.result,
						linkedVideoOriginalCount: linkedVideoOriginalCountRequest.result,
						linkedVideoOriginalKeyPath: linkedVideoOriginalStore.keyPath,
						linkedVideoOriginalIndexes,
						linkedOriginalProvisionalRootCount: linkedOriginalProvisionalRootCountRequest.result,
						linkedOriginalProvisionalRootKeyPath: linkedOriginalProvisionalRootStore.keyPath,
						linkedOriginalProvisionalRootIndexes,
						pathIndexes: [sourceStore, derivativeStore, derivativeEntryStore]
							.map((store) => store.indexNames.contains('path')),
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
			version: 8,
			payloadCount: 1,
			mediaChunkCount: 0,
			mediaChunkIndexes: ['mediaChunkToken'],
			mediaAssetIndexes: ['mediaChunkToken', 'path'],
			mediaAssetFields: ['blob', 'sha256', 'size', 'sourceId', 'storage'],
			mediaStagingKeyPath: 'key',
			mediaStagingIndexes: [
				{ name: 'expiresAt', unique: false },
				{ name: 'kind', unique: false },
				{ name: 'mediaChunkToken', unique: true },
				{ name: 'path', unique: true },
			],
			mediaStagingState: {
				key: 'state',
				kind: 'state',
				generation: 'initial',
			},
			linkedVideoOriginalCount: 0,
			linkedVideoOriginalKeyPath: 'key',
			linkedVideoOriginalIndexes: [
				{ name: 'projectId', unique: false },
			],
			linkedOriginalProvisionalRootCount: 0,
			linkedOriginalProvisionalRootKeyPath: 'key',
			linkedOriginalProvisionalRootIndexes: [
				{ name: 'projectId', unique: false },
			],
			pathIndexes: [true, true, true],
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

	test('serializes binding and provisional-root publication before a second connection can inspect it', async ({ page }) => {
		await page.goto('/embed/en/');
		await waitForEditor(page);
		const result = await page.evaluate(async (databaseName) => {
			const open = () => new Promise((resolve, reject) => {
				const request = indexedDB.open(databaseName);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const writerDatabase = await open();
			const cleanupDatabase = await open();
			const stores = ['linkedVideoOriginalBindings', 'linkedOriginalProvisionalRoots'];
			const projectId = 'browser-provisional-root-project';
			const sourceId = 'browser-provisional-root-source';
			const key = JSON.stringify([projectId, sourceId]);
			const bindingToken = 'binding_browser_provisional_0001';
			const binding = {
				schemaVersion: 2,
				kind: 'audio',
				projectId,
				sourceId,
				storageKey: 'browser-provisional-root-storage',
				locatorId: 'locator_browser_provisional_0001',
				locatorRevision: 'snapshot_browser_provisional_01',
				mimeType: 'audio/wav',
				byteLength: 65_536,
				sha256: 'ab'.repeat(32),
				sourceShape: {
					frameCount: 120,
					channelCount: 2,
					sampleRate: 48_000,
					originalSampleRate: 48_000,
					sampleFormat: 'float32',
					chunkFrames: 65_536,
				},
				bindingToken,
				boundAt: '2026-08-03T20:00:00.000Z',
			};
			const root = {
				schemaVersion: 1,
				key,
				projectId,
				kind: 'audio',
				sourceId,
				bindingToken,
			};

			try {
				await new Promise((resolve, reject) => {
					const transaction = writerDatabase.transaction(stores, 'readwrite');
					for (const storeName of stores) transaction.objectStore(storeName).clear();
					transaction.oncomplete = () => resolve();
					transaction.onabort = () => reject(transaction.error);
					transaction.onerror = () => reject(transaction.error);
				});

				let writerCommitted = false;
				const writer = writerDatabase.transaction(stores, 'readwrite');
				const gate = writer.objectStore('linkedVideoOriginalBindings').get('__publication_gate__');
				gate.onsuccess = () => {
					writer.objectStore('linkedVideoOriginalBindings').put({ key, projectId, binding });
					writer.objectStore('linkedOriginalProvisionalRoots').put(root);
				};
				const writerCompletion = new Promise((resolve, reject) => {
					writer.oncomplete = () => { writerCommitted = true; resolve(); };
					writer.onabort = () => reject(writer.error);
					writer.onerror = () => reject(writer.error);
				});

				const cleanup = cleanupDatabase.transaction(stores, 'readwrite');
				const bindingRead = cleanup.objectStore('linkedVideoOriginalBindings').get(key);
				const rootRead = cleanup.objectStore('linkedOriginalProvisionalRoots').get(key);
				const cleanupSnapshot = await new Promise((resolve, reject) => {
					cleanup.oncomplete = () => resolve({
						writerCommitted,
						binding: bindingRead.result?.binding ?? null,
						root: rootRead.result ?? null,
					});
					cleanup.onabort = () => reject(cleanup.error);
					cleanup.onerror = () => reject(cleanup.error);
				});
				await writerCompletion;
				return {
					distinctConnections: writerDatabase !== cleanupDatabase,
					...cleanupSnapshot,
				};
			} finally {
				writerDatabase.close();
				cleanupDatabase.close();
			}
		}, DATABASE_NAME);

		expect(result.distinctConnections).toBe(true);
		expect(result.writerCommitted).toBe(true);
		expect(result.binding).toMatchObject({
			projectId: 'browser-provisional-root-project',
			sourceId: 'browser-provisional-root-source',
			bindingToken: 'binding_browser_provisional_0001',
		});
		expect(result.root).toMatchObject({
			projectId: 'browser-provisional-root-project',
			sourceId: 'browser-provisional-root-source',
			bindingToken: 'binding_browser_provisional_0001',
		});
	});
});
