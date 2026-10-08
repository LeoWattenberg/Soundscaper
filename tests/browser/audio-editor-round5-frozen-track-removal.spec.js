/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	closeDialog, closeEffectsPanel, getMenuItem, importFiles, openEffectsForTrack,
} from './audio-editor-test-helpers.js';
import { selectClipRange } from './helpers/complex-editing-workflows.js';

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

for (const extent of ['complete', 'partial']) test(`lifting a ${extent} frozen range preserves valid freeze ownership and one Undo`, async ({ page }) => {
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
	const beforeFreeze = await history.count();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Freeze', 'Freeze track']);
	await expect(history).toHaveCount(beforeFreeze + 1, { timeout: 10_000 });
	const tracks = editor.locator('[data-track-row]');
	const originalCount = await tracks.count();
	if (extent === 'complete') await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	else await selectClipRange(page, editor, clip, 0.2, 0.6);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split into new track']);
	await expect(tracks).toHaveCount(originalCount + 1);
	await expect(editor).toHaveAttribute('data-clip-count', extent === 'complete' ? '1' : '3');
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await expect(history).toHaveCount(beforeFreeze + 2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(tracks).toHaveCount(originalCount);
	await expect(getMenuItem(await openMenu(page, editor, 'Tracks'), 'Freeze (fresh)')).toBeVisible();
	await page.keyboard.press('Escape');
});

async function openMenu(page, editor, label) {
	await editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: label, exact: true }).click();
	const menu = page.getByRole('menu', { name: label, exact: true });
	await expect(menu).toBeVisible();
	return menu;
}
