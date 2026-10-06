/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('moving an Audio warp marker retains keyboard focus on its action', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.focus();
	await page.keyboard.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const dialog = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await dialog.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await dialog.getByLabel('Outer position', { exact: true }).fill('1000');
	await dialog.getByLabel('Source sample', { exact: true }).fill('1000');
	await dialog.getByRole('button', { name: 'Add marker', exact: true }).click();
	await dialog.getByLabel('Marker 1 outer position', { exact: true }).fill('1100');
	await dialog.getByLabel('Marker 1 source sample', { exact: true }).fill('1100');
	const move = dialog.getByRole('button', { name: 'Move marker 1', exact: true });
	await move.focus();
	await move.press('Enter');
	await expect(dialog.getByLabel('Marker 1 outer position', { exact: true })).toHaveValue('1100/1');
	await expect(move).toBeFocused();
});

test('changing drop-frame clears an invalid draft replaced by the saved start timecode', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	const input = panel.getByRole('textbox', { name: 'Start timecode', exact: true });
	const rate = panel.getByRole('combobox', { name: 'Frame rate', exact: true });
	await rate.selectOption('30000/1001');
	await input.fill('00:00:01:00');
	await input.press('Tab');
	await input.fill('bad');
	await input.press('Tab');
	await expect(input).toHaveAttribute('aria-invalid', 'true');
	await panel.getByRole('checkbox', { name: 'Drop frame', exact: true }).check();
	await expect(input).not.toHaveValue('bad');
	await expect(input).toHaveAttribute('aria-invalid', 'false');
	await expect(panel.getByRole('alert')).toHaveCount(0);
});
