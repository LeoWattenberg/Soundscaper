/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	closeDialog, closeEffectsPanel, getMenuItem, importFiles, openEffectsForTrack,
} from './audio-editor-test-helpers.js';

test('the last editable clip can be removed from a frozen track and restored with Undo', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const effects = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, effects, 'track', 'Feedback delay');
	await closeDialog(page.getByRole('dialog', { name: 'Feedback delay', exact: true }));
	await closeEffectsPanel(effects);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Window', ['History']);
	const history = editor.locator('[data-workspace-panel="history"] [data-history-list] > li');
	const count = await history.count();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Freeze', 'Freeze track']);
	await expect(history).toHaveCount(count + 1, { timeout: 10_000 });
	let tracks = await openMenu(page, editor, 'Tracks');
	await expect(getMenuItem(tracks, 'Freeze (fresh)')).toBeVisible({ timeout: 10_000 });
	await page.keyboard.press('Escape');
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', 'Delete and leave gap']);
	await expect(clip).toHaveCount(0);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip).toHaveCount(1);
	tracks = await openMenu(page, editor, 'Tracks');
	await expect(getMenuItem(tracks, 'Freeze (fresh)')).toBeVisible();
	await page.keyboard.press('Escape');
});

async function openMenu(page, editor, label) {
	await editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: label, exact: true }).click();
	const menu = page.getByRole('menu', { name: label, exact: true });
	await expect(menu).toBeVisible();
	return menu;
}
