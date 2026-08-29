import { expect, test } from './audio-editor-test-fixtures.js';
import {
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;

test.describe('editor storage publication', () => {
	registerAudioEditorHooks();

	test('serializes binding and provisional-root publication before a second connection can inspect it', async ({ page }) => {
		await page.goto(resolveBrowserProductTestUrl('/framescaper/embed/en/'));
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
