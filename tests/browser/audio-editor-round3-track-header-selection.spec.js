/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const gesture of ['Control click', 'Shift click', 'Control Enter']) test(`${gesture} selects the track headers for the folder command`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const files = ['first.wav', 'middle.wav', 'last.wav'].map(name => createWavFixture({ name, duration: 0.8, frequency: 440, channelCount: 1 }));
	await importFiles(editor, files);
	await chooseNestedCommandAction(page, editor, 'Select', ['Select none']);
	const rows = files.map(file => clipByName(editor, file.name).locator('xpath=ancestor::div[@data-track-row]'));
	await rows[0].locator('.track-control-panel__track-name-text').click();
	if (gesture === 'Control Enter') {
		await rows[2].locator('.track-control-panel').focus();
		await page.keyboard.press('Control+Enter');
	} else await rows[2].locator('.track-control-panel__track-name-text').click({ modifiers: [gesture.startsWith('Control') ? 'Control' : 'Shift'] });
	await chooseTrackMenuAction(page, editor, rows[2], 'Move selection into new folder');
	const folder = editor.getByRole('treeitem', { name: 'Folder Folder 1, level 1', exact: true });
	await expect(folder).toBeVisible();
	await folder.getByRole('button', { name: 'Collapse folder', exact: true }).click();
	await expect(clipByName(editor, files[0].name)).toHaveCount(0);
	if (gesture === 'Shift click') await expect(clipByName(editor, files[1].name)).toHaveCount(0);
	else await expect(clipByName(editor, files[1].name)).toBeVisible();
	await expect(clipByName(editor, files[2].name)).toHaveCount(0);
});
