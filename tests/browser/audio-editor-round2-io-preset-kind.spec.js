/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, importFiles, openExportDialog } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('changing export kind retires the preset hidden by the new kind', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('preset-switch.webm')]);
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const naming = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await naming.getByRole('textbox', { name: 'Preset name', exact: true }).fill('My WAV');
	await naming.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(naming).toBeHidden();
	await expect(dialog.locator('[data-delivery-presets]')).toContainText('My WAV (custom)');
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'MP4 video');
	const presets = dialog.locator('[data-delivery-presets]');
	await expect(presets).toContainText('No preset');
	await expect(presets.getByRole('button', { name: 'Reset preset', exact: true })).toBeDisabled();
	await presets.getByRole('button', { name: 'More options', exact: true }).click();
	await expect(page.getByRole('menuitem', { name: 'Export preset', exact: true })).toBeDisabled();
});
