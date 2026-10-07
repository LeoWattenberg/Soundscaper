/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const recording = videoTimingProbeMedia.find(({ id }) => id === 'vfr-irregular-webm-v1');

test('Source monitor insertion preserves the marked presentation span of a variable-rate recording', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const choosing = page.waitForEvent('filechooser');
	await editor.locator('button').getByText('Add media', { exact: true }).click();
	await (await choosing).setFiles(recording.file);
	const card = editor.getByRole('listitem', { name: 'Project bin: timing-probe-vfr-irregular', exact: true });
	await expect(card).toHaveAttribute('data-unavailable', 'false');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor.getByRole('group', { name: /^Video clip:/u })).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await card.getByRole('button', { name: /Open in source monitor/u }).click();
	const monitor = editor.locator('[data-source-monitor]');
	await monitor.getByRole('button', { name: 'Next frame', exact: true }).click();
	await monitor.getByRole('button', { name: 'Next frame', exact: true }).click();
	await expect(monitor).toHaveAttribute('data-source-monitor-frame', '2');
	await monitor.getByRole('button', { name: 'Mark in', exact: true }).click();
	await monitor.getByRole('button', { name: 'Mark out', exact: true }).click();
	await expect(monitor).toHaveAttribute('data-source-monitor-mark-in', '2');
	await expect(monitor).toHaveAttribute('data-source-monitor-mark-out', '3');
	await card.getByRole('button', { name: /^Insert:/u }).click();
	await expect(editor.getByRole('group', { name: /^Video clip:/u })).toHaveCount(2);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const inserted = await savedMarkedClip(page, await editor.getAttribute('data-project-id'));
	// The recorded frame occupies 200–245 ms: 45 ms rounds to one 30 fps sequence frame.
	expect(inserted.sourceInFrame).toBe(2);
	expect(inserted.sourceFrameCount).toBe(1);
	expect(inserted.sequenceFrameCount).toBe(1);
});

async function savedMarkedClip(page, projectId) {
	return page.evaluate(async ({ databaseName, projectId }) => {
		const read = request => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await read(indexedDB.open(databaseName));
		try {
			const project = await read(database.transaction('projects', 'readonly').objectStore('projects').get(projectId));
			return project.clips.find(clip => clip.kind === 'video' && clip.sourceInFrame === 2);
		} finally { database.close(); }
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, projectId });
}
