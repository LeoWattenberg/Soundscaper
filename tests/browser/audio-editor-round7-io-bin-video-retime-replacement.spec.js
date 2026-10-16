/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

for (const frozen of [false, true]) test(`ordinary shorter bin replacement preserves ${frozen ? 'the authored frozen occurrence' : 'continuous video'}`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('original.webm'));
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	const oldSourceId = await card.getAttribute('data-source-id');
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const clipId = await clip.getAttribute('data-clip-id');
	if (frozen) {
		await clip.focus(); await clip.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video retime']);
		const dialog = page.getByRole('dialog', { name: 'Video retime', exact: true });
		await dialog.getByRole('textbox', { name: 'Source frame', exact: true }).fill('2');
		await dialog.getByRole('button', { name: 'Apply freeze', exact: true }).click();
		await expect(dialog.getByRole('status').last()).toHaveText('Video retime updated.');
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	}
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const original = await savedOccurrence(page, projectId, clipId);
	expect(original.frozen).toBe(frozen);
	await card.getByRole('button', { name: /More file actions/u }).click();
	const picking = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Replace', exact: true }).click();
	await (await picking).setFiles(videoRetimePreviewMedia.file);
	const choice = page.locator('[data-project-bin-replacement-dialog]');
	// Import preparation and dialog visibility are distinct public phases.
	await expect.poll(async () => (await editor.getAttribute('data-edit-block-reason')) !== 'importing'
		&& (await choice.count()) === 1, { timeout: 5000, intervals: [50, 100, 200] }).toBe(true);
	await expect(choice).toBeVisible();
	await choice.getByRole('button', { name: 'Keep timeline spacing', exact: true }).click();
	await expect(card).not.toHaveAttribute('data-source-id', oldSourceId);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(clip).toHaveAttribute('data-clip-id', clipId);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const replaced = await savedOccurrence(page, projectId, clipId);
	expect(replaced).toEqual({ source: await card.getAttribute('data-source-id'), count: 4, duration: 8,
		frozen, curveEnd: frozen ? 8 : null, curveSource: frozen ? { num: 41, den: 14 } : null });
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(card).toHaveAttribute('data-source-id', oldSourceId);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	expect(await savedOccurrence(page, projectId, clipId)).toEqual(original);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(card).not.toHaveAttribute('data-source-id', oldSourceId);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	expect(await savedOccurrence(page, projectId, clipId)).toEqual(replaced);
});

async function savedOccurrence(page, projectId, clipId) {
	return page.evaluate(async ({ databaseName, projectId, clipId }) => {
		const result = request => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(database.transaction(['projects'], 'readonly').objectStore('projects').get(projectId));
			const video = project.clips.find(item => item.id === clipId);
			return { source: video.sourceId, count: video.sourceFrameCount, duration: video.sequenceFrameCount,
				frozen: video.retimeMap?.segments.every(segment => segment.mode === 'freeze') ?? false,
				curveEnd: video.retimeMap?.points.at(-1)?.outerFrame ?? null,
				curveSource: video.retimeMap?.points[0]?.sourceFrame ?? null };
		} finally { database.close(); }
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, projectId, clipId });
}
