/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, getMenuItem, importFiles, openNestedCommandMenu, waitForProjectActivation } from './audio-editor-test-helpers.js';

for (const noTracks of [true, false]) test(`project tabs retain ${noTracks ? 'explicit No tracks' : 'the focused recording'}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Select all']);
	if (noTracks) await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
	const before = await openNestedCommandMenu(page, editor, 'Tracks', []);
	await expect(getMenuItem(before, 'Remove tracks')).toHaveAttribute('aria-disabled', String(noTracks));
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await waitForProjectActivation(editor);
	await editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab').first().click();
	await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const after = await openNestedCommandMenu(page, editor, 'Tracks', []);
	await expect(getMenuItem(after, 'Remove tracks')).toHaveAttribute('aria-disabled', String(noTracks));
	if (!noTracks) {
		await getMenuItem(after, 'Remove tracks').click();
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
	}
});
