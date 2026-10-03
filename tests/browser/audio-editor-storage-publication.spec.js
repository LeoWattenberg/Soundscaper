import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { FRAMESCAPER_DATABASE_NAME, SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;

test.describe('editor storage publication', () => {
	registerAudioEditorHooks();

	test('autosave prunes mixed canonical and legacy revision keys while retaining the current project', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		const retainedHistory = await page.evaluate(async ({ databaseName, projectId }) => {
			const database = await new Promise((resolve, reject) => {
				const request = indexedDB.open(databaseName);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			try {
				const transaction = database.transaction(['projects', 'revisions'], 'readwrite');
				const completion = new Promise((resolve, reject) => {
					transaction.oncomplete = () => resolve();
					transaction.onabort = () => reject(transaction.error);
					transaction.onerror = () => reject(transaction.error);
				});
				const current = transaction.objectStore('projects').get(projectId);
				const rows = [];
				current.onsuccess = () => {
					for (let ordinal = 0; ordinal < 32; ordinal += 1) {
						const revision = current.result.revision + 100 + ordinal;
						const key = ordinal % 2 === 0
							? `${projectId}:${String(revision).padStart(12, '0')}`
							: `${projectId}:legacy:${ordinal}`;
						rows.push({ key, revision });
						transaction.objectStore('revisions').put({
							key, projectId, revision, project: { ...current.result, revision },
						});
					}
				};
				await completion;
				// The live document is older than these history rows, as after restoring a backup.
				return rows.reverse().slice(0, 19).sort((left, right) => right.revision - left.revision);
			} finally {
				database.close();
			}
		}, { databaseName: SOUNDSCAPER_DATABASE_NAME, projectId });

		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
		const rename = page.getByRole('dialog', { name: 'Rename project', exact: true });
		await rename.getByRole('textbox', { name: 'Project name', exact: true }).fill('Mixed revision pruning');
		await rename.getByRole('button', { name: 'Save name', exact: true }).click();
		await expect(rename).toBeHidden();
		await expect.poll(async () => page.evaluate(async ({ databaseName, projectId }) => {
			const request = (input) => new Promise((resolve, reject) => {
				input.onsuccess = () => resolve(input.result);
				input.onerror = () => reject(input.error);
			});
			const database = await request(indexedDB.open(databaseName));
			try {
				const transaction = database.transaction(['projects', 'revisions'], 'readonly');
				const [current, revisions] = await Promise.all([
					request(transaction.objectStore('projects').get(projectId)),
					request(transaction.objectStore('revisions').index('projectId').getAll(projectId)),
				]);
				return {
					title: current.title,
					count: revisions.length,
					currentRetained: revisions.some((row) => row.revision === current.revision
						&& row.project.title === current.title),
					history: revisions.filter((row) => row.revision !== current.revision)
						.map(({ key, revision }) => ({ key, revision }))
						.sort((left, right) => right.revision - left.revision),
				};
			} finally {
				database.close();
			}
		}, { databaseName: SOUNDSCAPER_DATABASE_NAME, projectId }), { timeout: 10_000 }).toEqual({
			title: 'Mixed revision pruning',
			count: 20,
			currentRetained: true,
			history: retainedHistory,
		});
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	});

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
