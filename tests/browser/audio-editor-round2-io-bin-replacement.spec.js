/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForEditor } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('replacing a Project Bin video with a shorter ordinary video offers its timeline choice', async ({ page }) => {
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('original.webm'));
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible({ timeout: 20_000 });
	const oldSourceId = await card.getAttribute('data-source-id');
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const clipId = await clip.getAttribute('data-clip-id');
	await card.getByRole('button', { name: /More file actions/u }).click();
	const picking = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Replace', exact: true }).click();
	await (await picking).setFiles(videoRetimePreviewMedia.file);
	const choice = page.locator('[data-project-bin-replacement-dialog]');
	await expect(choice).toBeVisible({ timeout: 20_000 });
	await choice.getByRole('button', { name: 'Keep timeline spacing', exact: true }).click();
	await expect(card).not.toHaveAttribute('data-source-id', oldSourceId);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(clip).toHaveAttribute('data-clip-id', clipId);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	await expect.poll(() => savedVideoRange(page, projectId, clipId)).toEqual({ in: 0, count: 4, duration: 8 });
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(card).toHaveAttribute('data-source-id', oldSourceId);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(card).not.toHaveAttribute('data-source-id', oldSourceId);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	await waitForEditor(page);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(clip).toHaveAttribute('data-clip-id', clipId);
	await expect.poll(() => savedVideoRange(page, projectId, clipId)).toEqual({ in: 0, count: 4, duration: 8 });
});

async function savedVideoRange(page, projectId, clipId) {
	return page.evaluate(async ({ databaseName, projectId, clipId }) => {
		const result = request => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(database.transaction(['projects'], 'readonly').objectStore('projects').get(projectId));
			const video = project?.clips.find(item => item.id === clipId);
			return video ? { in: video.sourceInFrame, count: video.sourceFrameCount, duration: video.sequenceFrameCount } : null;
		} finally { database.close(); }
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, projectId, clipId });
}
