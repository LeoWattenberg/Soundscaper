/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openExportDialog } from './audio-editor-test-helpers.js';

test('custom channel mapping permits clearing and typing a complete output count', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('radio', { name: 'Custom channel mapping', exact: true }).check();
	await dialog.getByRole('button', { name: 'Edit mapping', exact: true }).click();
	const mapping = page.getByRole('dialog', { name: 'Edit channel mapping', exact: true });
	const input = mapping.locator('[data-export-channel-mapping-field="outputs"] input');
	await input.focus();
	await input.press('ControlOrMeta+a');
	await input.press('Backspace');
	await input.pressSequentially('12');
	await input.press('Tab');
	await expect(input).toHaveValue('12');
	await expect(mapping.getByRole('checkbox')).toHaveCount(24);
	await mapping.getByRole('button', { name: 'Apply', exact: true }).click();
	await dialog.getByRole('button', { name: 'Edit mapping', exact: true }).click();
	await expect(mapping.locator('[data-export-channel-mapping-field="outputs"] input')).toHaveValue('12');
});
