/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, clipField,
	closeClipProperties, commitInput, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('an ordinary warped recording can bake its linked speed through the Clip menu', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await expect(warp).toContainText('Identity warp map created.');
	await warp.getByRole('button', { name: 'Close', exact: true }).click();
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByText('Pitch and tempo', { exact: true }).click();
	await properties.getByRole('checkbox', { name: 'Link pitch and tempo', exact: true }).check();
	await commitInput(clipField(properties, 'speedRatio'), '2');
	await expect(clipField(properties, 'speedRatio')).toHaveValue('2');
	await closeClipProperties(properties);
	await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
	await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Render pitch and speed', exact: true }).click();
	const rendered = clipByName(editor, `${monoTone.name} — Render pitch and speed`);
	await expect(rendered).toBeVisible({ timeout: 10_000 });
	await expect(editor.locator('[data-status]')).not.toHaveAttribute('data-state', 'error');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(rendered).toBeVisible();
});
