/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	expect,
	test,
	toneA,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	collectClientErrors,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';

const PROJECT_ID = 'browser-file-handler-project';
const SESSION_DELIVERY_KEY = 'soundscaper-test-file-handler-delivered';

test.describe('installed PWA file handling', () => {
	registerAudioEditorHooks();

	test('routes a queued project and WAV through the built workspace exactly once', async ({ page }) => {
		const errors = collectClientErrors(page);
		await installLaunchQueue(page, [{
			name: 'launched-project.sscape',
			mimeType: SCAPE_MIME_TYPE,
			buffer: await projectArchive(),
		}, toneA]);

		let editor = await bootEditor(page, '/embed/en/');
		await expect(editor).toHaveAttribute('data-project-id', PROJECT_ID, { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		await expect(editor.locator('[data-save-state]'))
			.toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
		await expect.poll(() => persistedMediaCounts(page, PROJECT_ID)).toEqual({
			clipCount: 1,
			sourceCount: 1,
		});
		expect(await launchQueueState(page)).toEqual({
			consumerCalls: 1,
			deliveryCalls: 1,
			getFileCalls: 2,
		});

		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-project-id', PROJECT_ID);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		await expect.poll(() => persistedMediaCounts(page, PROJECT_ID)).toEqual({
			clipCount: 1,
			sourceCount: 1,
		});
		expect(await launchQueueState(page)).toEqual({
			consumerCalls: 1,
			deliveryCalls: 0,
			getFileCalls: 0,
		});
		expect(errors).toEqual([]);
	});
});

async function installLaunchQueue(page, files) {
	await page.addInitScript(({ deliveryKey, entries }) => {
		const state = {
			consumerCalls: 0,
			deliveryCalls: 0,
			getFileCalls: 0,
		};
		globalThis.__pwaFileHandlerLaunchState = state;
		Object.defineProperty(globalThis, 'launchQueue', {
			configurable: true,
			value: {
				setConsumer(consumer) {
					state.consumerCalls += 1;
					if (sessionStorage.getItem(deliveryKey) === 'true') return;
					sessionStorage.setItem(deliveryKey, 'true');
					state.deliveryCalls += 1;
					queueMicrotask(() => consumer({
						files: entries.map((entry) => ({
							kind: 'file',
							async getFile() {
								state.getFileCalls += 1;
								const bytes = Uint8Array.from(
									atob(entry.base64),
									(character) => character.charCodeAt(0),
								);
								return new File([bytes], entry.name, { type: entry.mimeType });
							},
						})),
					}));
				},
			},
		});
	}, {
		deliveryKey: SESSION_DELIVERY_KEY,
		entries: files.map((file) => ({
			name: file.name,
			mimeType: file.mimeType,
			base64: file.buffer.toString('base64'),
		})),
	});
}

function launchQueueState(page) {
	return page.evaluate(() => globalThis.__pwaFileHandlerLaunchState);
}

function persistedMediaCounts(page, projectId) {
	return page.evaluate(async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(
				database.transaction('projects', 'readonly').objectStore('projects').get(id),
			);
			return {
				clipCount: project?.clips?.length ?? 0,
				sourceCount: project?.sources?.length ?? 0,
			};
		} finally {
			database.close();
		}
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, id: projectId });
}

let archivePromise;

function projectArchive() {
	return archivePromise ||= createProjectArchive();
}

async function createProjectArchive() {
	const project = createSoundscaperProject({
		id: PROJECT_ID,
		title: 'Launched PWA project',
		sources: [],
		clips: [],
		tracks: [],
	});
	const exported = await exportScapeProject(project, {
		async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; },
		readSourceChunks() { return (async function* emptySource() {})(); },
	});
	if (!(exported.blob instanceof Blob)) throw new Error('The PWA file-handler fixture did not produce an archive Blob.');
	return Buffer.from(await exported.blob.arrayBuffer());
}
