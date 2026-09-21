/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	getMenuItem,
	importFiles,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==',
	'base64',
);

registerAudioEditorHooks();

test.describe('Framescaper rich session clipboard', () => {
	test('preserves rich AV metadata without publishing an image body cross-project', async ({ browserName, page }) => {
		test.skip(browserName !== 'chromium', 'The nightly browser coverage surface is Chromium.');
		test.setTimeout(120_000);
		const { editor, projectId: originProjectId } = await authorRichClipboard(page);
		await expect.poll(() => storedClipboardState(page, originProjectId)).toMatchObject({
			audioClips: 1, videoClips: 1, imageClips: 1, imageSources: 1,
			videoCropLeft: 0.125, videoPositionX: 0.7, authoredVideoCompositions: 1,
		});
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(originProjectId);
		const targetProjectId = await editor.getAttribute('data-project-id');
		expect(targetProjectId).toBeTruthy();
		await expect(editor).toHaveAttribute('data-clip-count', '0', { timeout: 30_000 });
		await expect.poll(() => storedClipboardState(page, targetProjectId)).toMatchObject({
			audioClips: 0, videoClips: 0, imageClips: 0, imageSources: 0,
		});

		await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
		await expect(editor.locator('[data-clip-kind="image"]')).toHaveCount(0);
		await expect.poll(() => storedClipboardState(page, targetProjectId)).toMatchObject({
			audioClips: 1, videoClips: 1, imageClips: 0, imageSources: 0,
			videoCropLeft: 0.125, videoPositionX: 0.7, authoredVideoCompositions: 1,
		});
	});
});

async function authorRichClipboard(page) {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('clipboard-source.webm')]);
	const videoClip = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(videoClip).toHaveCount(1);
	await videoClip.focus();
	await videoClip.press('Enter');
	const clipMenu = await openNestedCommandMenu(page, editor, 'Edit', ['Audio clips']);
	await getMenuItem(clipMenu, 'Transform and compositing').click();
	const composition = page.getByRole('dialog', { name: 'Transform and compositing', exact: true });
	await composition.getByRole('spinbutton', { name: 'Left (%)', exact: true }).fill('12.5');
	await composition.getByRole('spinbutton', { name: 'Position X offset (%)', exact: true }).fill('20');
	await composition.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(composition.getByRole('status')).toContainText('Composition applied.');
	await page.keyboard.press('Escape');

	const chooserPromise = page.waitForEvent('filechooser');
	const generate = await openNestedCommandMenu(page, editor, 'Generate', []);
	await getMenuItem(generate, EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']).click();
	const chooser = await chooserPromise;
	await chooser.setFiles({ name: 'clipboard-still.png', mimeType: 'image/png', buffer: PNG });
	await expect(editor.locator('[data-clip-kind="image"]')).toHaveCount(1, { timeout: 30_000 });
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	const projectId = await editor.getAttribute('data-project-id');
	if (!projectId) throw new Error('Framescaper did not expose its active project ID.');
	return { editor, projectId };
}

async function storedClipboardState(page, projectId) {
	return page.evaluate(({ databaseName, id }) => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error || new Error(`Could not open ${databaseName}.`));
		open.onsuccess = () => {
			const database = open.result;
			const request = database.transaction('projects').objectStore('projects').get(id);
			request.onerror = () => {
				database.close();
				reject(request.error || new Error(`Could not read ${id}.`));
			};
			request.onsuccess = () => {
				const project = request.result;
				const clips = project?.clips ?? [];
				const videos = clips.filter(({ kind }) => kind === 'video');
				database.close();
				resolve({
					audioClips: clips.filter(({ kind }) => kind === 'audio').length,
					videoClips: videos.length,
					imageClips: clips.filter(({ kind }) => kind === 'image').length,
					imageSources: (project?.sources ?? []).filter(({ kind }) => kind === 'image').length,
					videoCropLeft: videos[0]?.videoComposition?.crop?.left ?? null,
					videoPositionX: videos[0]?.videoComposition?.transform?.positionX ?? null,
					authoredVideoCompositions: videos.filter(({ videoComposition }) => (
						videoComposition?.crop?.left === 0.125
						&& videoComposition?.transform?.positionX === 0.7
					)).length,
				});
			};
		};
	}), { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}
