/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('Regular interval labels starts with the visible imported video timeline extent', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('marker-video.webm')]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const endFrame = await savedVideoEnd(page, projectId);
	expect(endFrame).toBeGreaterThan(40_000);
	await chooseCommandAction(page, editor, 'Tools', 'Regular interval labels');
	const dialog = page.getByRole('dialog', { name: 'Regular interval labels', exact: true });
	await expect(dialog).toBeVisible();
	// Read the timecode's existing underlying value; all actions use the visible menu/buttons.
	await expect(dialog.locator('input[name="endFrame"]')).toHaveValue(String(endFrame));
	await dialog.getByRole('button', { name: 'Create annotations', exact: true }).click();
	await expect(dialog).toBeHidden();
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	const list = editor.getByRole('list', { name: 'Marker and region list', exact: true });
	await expect(list.getByRole('listitem')).toHaveCount(1);
	await expect(list).toContainText('Cue 1');
});

async function savedVideoEnd(page, projectId) {
	return page.evaluate(async ({ databaseName, projectId }) => {
		const result = request => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(database.transaction(['projects'], 'readonly').objectStore('projects').get(projectId));
			const video = project.clips.find(clip => clip.kind === 'video');
			const sequence = project.sequences.find(sequence => sequence.id === video.sequenceId);
			return Math.round((video.sequenceStartFrame + video.sequenceFrameCount) * sequence.rate.den * project.sampleRate / sequence.rate.num);
		} finally { database.close(); }
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, projectId });
}
