/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('repeated Dialogue Chain applications append independent racks with one Undo each', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'repeat-voice.wav', duration: 1 })]);
	const clip = editor.getByRole('group', { name: /^repeat-voice\.wav clip, starts/u });
	await clip.press('Enter');
	const trackId = await clip.locator('xpath=ancestor::*[@data-track-row]').getAttribute('data-track-id');
	const projectId = await editor.getAttribute('data-project-id');
	const storedRack = () => rack(page, projectId, trackId);
	await chooseCommandAction(page, editor, 'Window', 'Dialogue Chain');
	const dialog = page.getByRole('dialog', { name: 'Dialogue Chain', exact: true });
	const apply = dialog.getByRole('button', { name: 'Apply dialogue chain', exact: true });
	await apply.click();
	await expect(dialog.getByRole('status').last()).toHaveText('Dialogue chain applied.');
	await expect.poll(storedRack).toHaveLength(5);
	const first = await storedRack();
	await expect(apply).toBeEnabled();
	await apply.click();
	await expect(dialog.getByRole('status').last()).toHaveText('Dialogue chain applied.');
	await expect.poll(storedRack).toHaveLength(10);
	const twice = await storedRack();
	expect(twice.slice(0, 5)).toEqual(first);
	expect(new Set(twice.map(({ id }) => id)).size).toBe(10);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(storedRack).toEqual(first);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(storedRack).toEqual(twice);
});

async function rack(page, projectId, trackId) {
	return page.evaluate(async ({ databaseName, id, targetTrackId }) => {
		const result = request => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(database.transaction('projects', 'readonly').objectStore('projects').get(id));
			return project?.tracks?.find(({ id: candidate }) => candidate === targetTrackId)?.effects ?? [];
		} finally { database.close(); }
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId, targetTrackId: trackId });
}
